"""Tests for PDF-report changes:
- POST /api/blocks/{id}/close now produces a combined PDF (not ZIP)
- GET /api/public/download/{token} returns application/pdf starting with '%PDF'
- GET /api/blocks/{id}/report-html uses 'Allegato pagina N' label
  (anchor <a> only after close has saved last_download_url)
- Bonifico wording changes (3 directions)
- Combined PDF page count >= 1 + numero_allegati
- resend-email re-creates a PDF download_url (not ZIP)
"""
import os
import re
import io
import asyncio
import base64
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from pypdf import PdfReader

load_dotenv("/app/backend/.env")

BASE_URL = None
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL") or line.startswith("EXPO_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# ----- Test users (one per bonifico direction + preview-only user) -----
USERS = {
    "P1":      ("user_pdf_P1",      "pdf_p1@quota.local",      "tok_pdf_P1",      "Marco",    "Lucia"),
    "P2":      ("user_pdf_P2",      "pdf_p2@quota.local",      "tok_pdf_P2",      "Giovanni", "Elena"),
    "NONE":    ("user_pdf_NONE",    "pdf_none@quota.local",    "tok_pdf_NONE",    "Paolo",    "Sara"),
    "PREVIEW": ("user_pdf_PREVIEW", "pdf_preview@quota.local", "tok_pdf_PREVIEW", "Alice",    "Bob"),
}


def _hdr(role):
    return {"Authorization": f"Bearer {USERS[role][2]}", "Content-Type": "application/json"}


# 1×1 PNG
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8A"
    "AAAASUVORK5CYII="
)


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


STATE = {}


@pytest.fixture(scope="module", autouse=True)
def setup_module_fixture():
    async def seed():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        for role, (uid, email, tok, p1, p2) in USERS.items():
            await db.users.delete_many({"user_id": uid})
            await db.user_sessions.delete_many({"session_token": tok})
            await db.configs.delete_many({"user_id": uid})
            await db.blocks.delete_many({"user_id": uid})
            await db.email_downloads.delete_many({"user_id": uid})
            await db.email_rate_log.delete_many({"user_id": uid})
            await db.users.insert_one({
                "user_id": uid, "email": email, "name": p1, "picture": None,
                "created_at": datetime.now(timezone.utc),
            })
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": uid,
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            })
            await db.configs.insert_one({
                "user_id": uid,
                "parent1_name": p1, "parent2_name": p2,
                "parent1_email": "delivered@resend.dev",
                "parent2_email": "delivered@resend.dev",
                "default_pct_parent1": 50.0, "settlement_day": 20,
                "updated_at": datetime.now(timezone.utc),
            })
        c.close()

    async def cleanup():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        for role, (uid, email, tok, p1, p2) in USERS.items():
            await db.users.delete_many({"user_id": uid})
            await db.user_sessions.delete_many({"session_token": tok})
            await db.configs.delete_many({"user_id": uid})
            await db.blocks.delete_many({"user_id": uid})
            await db.email_downloads.delete_many({"user_id": uid})
            await db.email_rate_log.delete_many({"user_id": uid})
        c.close()

    _run(seed())

    # Create blocks and expenses for each user
    for role in ("P1", "P2", "NONE", "PREVIEW"):
        r = requests.post(f"{BASE_URL}/api/blocks", headers=_hdr(role),
                          json={"month": 3, "year": 2026})
        assert r.status_code == 200, r.text
        bid = r.json()["block"]["block_id"]
        STATE[f"block_{role}"] = bid

        # Expense with attachment (PNG)
        e1 = {
            "date": "2026-03-05", "description": "Visita medica",
            "amount": 100.0, "paid_by": "parent1",
            "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": PNG_B64, "attachment_mime": "image/png",
            "attachment_name": "ricevuta.png",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/expenses", headers=_hdr(role), json=e1)
        assert r.status_code == 200, r.text
        # Expense without attachment
        e2 = {
            "date": "2026-03-10", "description": "Libri scuola",
            "amount": 40.0, "paid_by": "parent2",
            "pct_parent1": 50, "pct_parent2": 50,
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/expenses", headers=_hdr(role), json=e2)
        assert r.status_code == 200, r.text

    yield
    _run(cleanup())


# ============================================================================
# 1) HTML preview: no 'Sì'/'No', 'Allegato pagina N' label, link only after close
# ============================================================================

class TestReportHtmlAllegatoColumn:
    def test_preview_before_close_label_no_anchor(self):
        """Before close: 'Allegato pagina N' as plain text, no <a> wrapper."""
        bid = STATE["block_PREVIEW"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("PREVIEW"))
        assert r.status_code == 200
        html = r.text
        # No 'Sì' / 'No' in Allegato column
        assert "<td>Sì</td>" not in html
        assert "<td>No</td>" not in html
        # 'Allegato pagina N' is present
        m = re.search(r"Allegato pagina (\d+)", html)
        assert m, html[:2000]
        page_num = int(m.group(1))
        assert page_num >= 2, f"first attachment must be after report, got {page_num}"
        # Not wrapped in anchor because block not yet closed
        assert '<a href=' not in html.lower().split('allegato pagina')[0][-200:] \
            or re.search(r'<a\b[^>]*>Allegato pagina', html) is None, html[:2000]

    def test_preview_empty_cell_for_expense_without_attachment(self):
        """Expense without attachment → empty <td></td>."""
        bid = STATE["block_PREVIEW"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("PREVIEW"))
        html = r.text
        # Confirm there is at least one empty <td></td> row cell  (last column of 2nd row)
        # Simpler: assert the plain text "Libri scuola" row ends with <td></td>
        assert "Libri scuola" in html
        # Find the row containing Libri scuola and check attachment column is empty
        row_match = re.search(r"<tr>[^<]*<td>\d+</td>.*?Libri scuola.*?</tr>", html, re.S)
        assert row_match, "row for Libri scuola not found"
        row = row_match.group(0)
        # Should end with <td></td></tr>  (empty attachment cell)
        assert re.search(r"<td>\s*</td>\s*</tr>\s*$", row), row

    def test_preview_after_close_has_anchor_link(self):
        """After close() has saved last_download_url: 'Allegato pagina N' wrapped in <a href=...#page=N>."""
        # Close a dedicated block (P1) with direction parent1_to_parent2
        bid = STATE["block_P1"]
        payload = {
            "bonifico_date": "2026-04-01",
            "bonifico_amount": 30.0,
            "bonifico_direction": "parent1_to_parent2",
            "bonifico_note": "test",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=_hdr("P1"), json=payload)
        assert r.status_code == 200, r.text
        close_resp = r.json()
        assert close_resp.get("ok") is True
        download_url = close_resp.get("download_url") or ""
        assert download_url, close_resp
        STATE["download_url_P1"] = download_url

        # Now GET the HTML preview — should contain <a href="<download_url>#page=N">
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("P1"))
        assert r.status_code == 200
        html = r.text
        # must contain anchor wrapping Allegato pagina N
        m = re.search(
            r'<a\s+href="([^"#]*)#page=(\d+)"[^>]*>Allegato pagina \2</a>',
            html,
        )
        assert m, f"anchor <a ...#page=N>Allegato pagina N</a> not found:\n{html[:3000]}"
        href_base = m.group(1)
        # must point to the just-created public download endpoint
        assert "/api/public/download/" in href_base, href_base
        # Still no 'Sì'/'No' label in the Allegato column
        assert "<td>Sì</td>" not in html
        assert "<td>No</td>" not in html


# ============================================================================
# 2) POST /blocks/{id}/close → PDF (not ZIP)
# ============================================================================

class TestClosePdfDownload:
    def test_close_download_url_serves_pdf(self):
        download_url = STATE.get("download_url_P1")
        assert download_url, "download_url missing (prior test must have closed P1)"
        # Download via public endpoint
        r = requests.get(download_url)
        assert r.status_code == 200, r.text[:500]
        # Content-Type should be application/pdf
        ct = r.headers.get("content-type", "")
        assert "application/pdf" in ct, ct
        # Content-Disposition filename ends with .pdf
        cd = r.headers.get("content-disposition", "")
        assert ".pdf" in cd.lower(), cd
        # Magic bytes
        body = r.content
        assert body[:4] == b"%PDF", body[:16]

    def test_combined_pdf_has_report_plus_attachment_pages(self):
        """Combined PDF: pages >= 1 + numero_allegati (block P1 has 1 PNG attachment)."""
        download_url = STATE.get("download_url_P1")
        r = requests.get(download_url)
        body = r.content
        reader = PdfReader(io.BytesIO(body))
        n = len(reader.pages)
        # 1 attachment → >= 2 pages (report may be 1+ pages)
        assert n >= 2, f"expected >=2 pages, got {n}"
        STATE["pdf_pages_P1"] = n

    def test_combined_pdf_first_page_contains_allegato_pagina(self):
        """Report (first page) extracted text should contain 'Allegato pagina N'."""
        download_url = STATE.get("download_url_P1")
        body = requests.get(download_url).content
        reader = PdfReader(io.BytesIO(body))
        txt = reader.pages[0].extract_text() or ""
        # Some PDFs span 2 pages for the report; include first few pages
        if "Allegato pagina" not in txt and len(reader.pages) > 1:
            txt += "\n" + (reader.pages[1].extract_text() or "")
        assert "Allegato pagina" in txt, txt[:1500]


# ============================================================================
# 3) Bonifico wording — 3 cases (3 blocks closed with different directions)
# ============================================================================

class TestBonificoWording:
    def test_direction_parent1_to_parent2(self):
        """block_P1 already closed with parent1_to_parent2 → 'Bonifico effettuato da <p1>'."""
        bid = STATE["block_P1"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("P1"))
        html = r.text
        p1 = USERS["P1"][3]  # "Marco"
        assert f"Bonifico effettuato da {p1}" in html, html[-1500:]
        # Old wording removed
        assert "Direzione: parent1_to_parent2" not in html
        assert "parent1_to_parent2" not in html

    def test_direction_parent2_to_parent1(self):
        bid = STATE["block_P2"]
        payload = {
            "bonifico_date": "2026-04-02",
            "bonifico_amount": 25.0,
            "bonifico_direction": "parent2_to_parent1",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=_hdr("P2"), json=payload)
        assert r.status_code == 200, r.text
        # Preview HTML
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("P2"))
        html = r.text
        p2 = USERS["P2"][4]  # "Elena"
        assert f"Rimborso a carico di {p2}" in html, html[-1500:]
        assert "parent2_to_parent1" not in html

    def test_direction_none_amount_zero(self):
        bid = STATE["block_NONE"]
        payload = {
            "bonifico_date": "2026-04-03",
            "bonifico_amount": 0.0,
            "bonifico_direction": "none",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=_hdr("NONE"), json=payload)
        assert r.status_code == 200, r.text
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("NONE"))
        html = r.text
        assert "Nessun bonifico da effettuare" in html, html[-1500:]
        assert "parent1_to_parent2" not in html
        assert "parent2_to_parent1" not in html

    def test_old_direzione_label_not_present_anymore(self):
        """Regression: 'Direzione:' label removed everywhere."""
        for role in ("P1", "P2", "NONE"):
            bid = STATE[f"block_{role}"]
            r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr(role))
            assert r.status_code == 200
            assert "Direzione:" not in r.text, f"'Direzione:' leaked in role={role}"


# ============================================================================
# 4) Page numbering (1-based, first attachment after report pages)
# ============================================================================

class TestPageMap:
    def test_first_attachment_page_equal_html_page_number(self):
        """The 'N' shown in HTML 'Allegato pagina N' matches the page where the attachment
        starts inside the combined PDF (page K+1 where K is report pages)."""
        bid = STATE["block_P1"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("P1"))
        html = r.text
        m = re.search(r"Allegato pagina (\d+)", html)
        assert m, html[:2000]
        page_num = int(m.group(1))
        # Download the PDF and verify total pages > page_num-1 (page exists)
        body = requests.get(STATE["download_url_P1"]).content
        total = len(PdfReader(io.BytesIO(body)).pages)
        assert page_num >= 2 and page_num <= total, \
            f"page_num={page_num} total={total}"


# ============================================================================
# 5) Regression: resend-email now re-creates a PDF (not ZIP)
# ============================================================================

class TestResendEmailPdf:
    def test_resend_recreates_pdf_download(self):
        """After resend-email, last_download_url should still serve a PDF."""
        bid = STATE["block_P1"]
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/resend-email", headers=_hdr("P1"))
        # If email proxy fails (502), skip
        if r.status_code == 502:
            pytest.skip(f"email proxy unreachable: {r.text[:200]}")
        assert r.status_code == 200, r.text
        # Reload block to get its updated last_download_url (via report-html anchor)
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("P1"))
        html = r.text
        m = re.search(r'href="([^"#]+)#page=\d+"', html)
        assert m, "anchor not found in HTML"
        download_url = m.group(1)
        # Download it and check it's a PDF (not ZIP)
        r = requests.get(download_url)
        assert r.status_code == 200
        assert r.headers.get("content-type", "").startswith("application/pdf"), r.headers
        assert r.content[:4] == b"%PDF"
        # Ensure NOT a ZIP (ZIP magic bytes PK\x03\x04)
        assert r.content[:4] != b"PK\x03\x04"


# ============================================================================
# 6) Regression: _build_report_html still produces valid HTML (no base64 leak)
# ============================================================================

class TestHtmlRegression:
    def test_report_html_no_base64_attachment_leak(self):
        bid = STATE["block_PREVIEW"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("PREVIEW"))
        assert r.status_code == 200
        html = r.text
        # Base64 of 1×1 PNG begins with iVBORw0KGgo
        assert "iVBORw0KGgo" not in html
        assert "attachment_data" not in html
        # Must contain fundamental tags
        assert "<!DOCTYPE html>" in html
        assert "<table>" in html
        assert "</html>" in html

    def test_html_still_has_header_cells(self):
        bid = STATE["block_PREVIEW"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=_hdr("PREVIEW"))
        html = r.text
        # Column headers unchanged (Allegato header still there)
        assert "<th>Allegato</th>" in html
        assert "<th>Descrizione</th>" in html
        assert "<th>Importo</th>" in html

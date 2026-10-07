"""Tests for GET /api/blocks/{id}/report-html (WebView preview endpoint)."""
import os
import asyncio
import base64
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE_URL = None
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL") or line.startswith("EXPO_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

USER_ID_A = "user_report_html_A"
EMAIL_A = "report_html_a@quota.local"
TOKEN_A = "tok_report_html_A"

USER_ID_B = "user_report_html_B"
EMAIL_B = "report_html_b@quota.local"
TOKEN_B = "tok_report_html_B"

USER_ID_NOCFG = "user_report_html_NOCFG"
EMAIL_NOCFG = "report_html_nocfg@quota.local"
TOKEN_NOCFG = "tok_report_html_NOCFG"

HEADERS_A = {"Authorization": f"Bearer {TOKEN_A}", "Content-Type": "application/json"}
HEADERS_B = {"Authorization": f"Bearer {TOKEN_B}", "Content-Type": "application/json"}
HEADERS_NOCFG = {"Authorization": f"Bearer {TOKEN_NOCFG}", "Content-Type": "application/json"}

# ---- 1×1 PNG attachment (base64) ----
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8A"
    "AAAASUVORK5CYII="
)


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


_BLOCK_IDS = {}


@pytest.fixture(scope="module", autouse=True)
def setup():
    async def seed():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        for uid, email, tok in (
            (USER_ID_A, EMAIL_A, TOKEN_A),
            (USER_ID_B, EMAIL_B, TOKEN_B),
            (USER_ID_NOCFG, EMAIL_NOCFG, TOKEN_NOCFG),
        ):
            await db.users.delete_many({"user_id": uid})
            await db.user_sessions.delete_many({"session_token": tok})
            await db.configs.delete_many({"user_id": uid})
            await db.blocks.delete_many({"user_id": uid})
            await db.email_downloads.delete_many({"user_id": uid})
            await db.email_rate_log.delete_many({"user_id": uid})
            await db.users.insert_one({
                "user_id": uid, "email": email, "name": "T", "picture": None,
                "created_at": datetime.now(timezone.utc),
            })
            await db.user_sessions.insert_one({
                "session_token": tok, "user_id": uid,
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            })
        # Configs for A and B only (NOCFG has no config)
        for uid, email, p1, p2 in (
            (USER_ID_A, EMAIL_A, "Alessandra", "Beatrice"),
            (USER_ID_B, EMAIL_B, "Barbara", "Carlo"),
        ):
            await db.configs.insert_one({
                "user_id": uid,
                "parent1_name": p1, "parent2_name": p2,
                "parent1_email": email,
                "parent2_email": "delivered@resend.dev",
                "default_pct_parent1": 50.0, "settlement_day": 20,
                "updated_at": datetime.now(timezone.utc),
            })
        c.close()

    async def cleanup():
        c = AsyncIOMotorClient(MONGO_URL)
        db = c[DB_NAME]
        for uid, tok in (
            (USER_ID_A, TOKEN_A),
            (USER_ID_B, TOKEN_B),
            (USER_ID_NOCFG, TOKEN_NOCFG),
        ):
            await db.users.delete_many({"user_id": uid})
            await db.user_sessions.delete_many({"session_token": tok})
            await db.configs.delete_many({"user_id": uid})
            await db.blocks.delete_many({"user_id": uid})
            await db.email_downloads.delete_many({"user_id": uid})
            await db.email_rate_log.delete_many({"user_id": uid})
        c.close()

    _run(seed())
    # Create blocks via API
    r = requests.post(f"{BASE_URL}/api/blocks", headers=HEADERS_A,
                      json={"month": 10, "year": 2026})
    assert r.status_code == 200, r.text
    _BLOCK_IDS["A"] = r.json()["block"]["block_id"]
    # Add expense with attachment to block A
    exp = {
        "date": "2026-10-05", "description": "Scontrino libri",
        "amount": 120.50, "paid_by": "parent1",
        "pct_parent1": 50, "pct_parent2": 50,
        "attachment_data": PNG_B64, "attachment_mime": "image/png",
        "attachment_name": "ricevuta.png",
    }
    r = requests.post(f"{BASE_URL}/api/blocks/{_BLOCK_IDS['A']}/expenses",
                      headers=HEADERS_A, json=exp)
    assert r.status_code == 200, r.text
    # Second expense without attachment
    exp2 = {
        "date": "2026-10-10", "description": "Scarpe sportive",
        "amount": 80.00, "paid_by": "parent2",
        "pct_parent1": 50, "pct_parent2": 50,
    }
    r = requests.post(f"{BASE_URL}/api/blocks/{_BLOCK_IDS['A']}/expenses",
                      headers=HEADERS_A, json=exp2)
    assert r.status_code == 200

    # Block for user B
    r = requests.post(f"{BASE_URL}/api/blocks", headers=HEADERS_B,
                      json={"month": 11, "year": 2026})
    assert r.status_code == 200
    _BLOCK_IDS["B"] = r.json()["block"]["block_id"]

    yield
    _run(cleanup())


# =========================== 1) 200 valid response ===========================

class TestReportHtmlSuccess:
    def test_content_type_is_html_utf8(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        assert r.status_code == 200, r.text
        ct = r.headers.get("content-type", "")
        assert "text/html" in ct, ct
        assert "utf-8" in ct.lower(), ct

    def test_body_non_empty_html_structure(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        html = r.text
        assert len(html) > 500
        # structural tags
        assert "<!DOCTYPE html>" in html
        assert "<style>" in html
        assert "<h1>" in html
        assert "<table>" in html
        assert "<tbody>" in html
        assert "</html>" in html

    def test_contains_block_title_and_parent_names(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        html = r.text
        # Block label: "Spese extra Ottobre '26"
        assert "Spese extra Ottobre" in html
        # Parent names (from config seeded above)
        assert "Alessandra" in html
        assert "Beatrice" in html

    def test_contains_expense_rows(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        html = r.text
        # expense descriptions
        assert "Scontrino libri" in html
        assert "Scarpe sportive" in html
        # formatted money (€ 120,50 / € 80,00)
        assert "120,50" in html
        assert "80,00" in html

    def test_shows_attachment_as_boolean_not_base64(self):
        """Report must NOT contain raw base64 of attachments."""
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        html = r.text
        # Column header
        assert "Allegato" in html
        # The PNG base64 we uploaded must NOT appear in the report
        assert PNG_B64 not in html
        assert "iVBORw0KGgo" not in html
        # Should contain Sì (has attachment) and No (second expense without)
        assert "Sì" in html
        assert "<td>No</td>" in html

    def test_html_matches_build_report_html_output(self):
        """Preview endpoint must produce the exact same HTML used in the ZIP email."""
        import sys
        sys.path.insert(0, "/app/backend")
        from server import _build_report_html, _compute_totals

        bid = _BLOCK_IDS["A"]
        # fetch raw block + cfg from Mongo
        async def fetch():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            cfg = await db.configs.find_one({"user_id": USER_ID_A}, {"_id": 0})
            blk = await db.blocks.find_one(
                {"user_id": USER_ID_A, "block_id": bid}, {"_id": 0})
            c.close()
            return cfg, blk

        cfg, blk = _run(fetch())
        totals = _compute_totals(blk.get("expenses", []), cfg.get("default_pct_parent1", 50.0))
        expected = _build_report_html(cfg, blk, totals)

        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        # Preview-env (Cloudflare) may inject a telemetry <script> before </body>.
        # Strip any injected <script>...</script> blocks before comparing.
        import re as _re
        actual = _re.sub(r"<script\b[^>]*>.*?</script>", "", r.text, flags=_re.DOTALL)
        assert actual == expected


# =========================== 2) Error paths ===========================

class TestReportHtmlErrors:
    def test_no_token_returns_401(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html")
        assert r.status_code == 401

    def test_invalid_token_returns_401(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(
            f"{BASE_URL}/api/blocks/{bid}/report-html",
            headers={"Authorization": "Bearer not_a_valid_token"},
        )
        assert r.status_code == 401

    def test_nonexistent_block_returns_404(self):
        r = requests.get(
            f"{BASE_URL}/api/blocks/blk_does_not_exist/report-html",
            headers=HEADERS_A,
        )
        assert r.status_code == 404
        assert "non trovato" in r.json().get("detail", "").lower()

    def test_cross_user_isolation_returns_404(self):
        """User B tries to access user A's block -> must be 404 (not 403)."""
        bid_a = _BLOCK_IDS["A"]
        r = requests.get(
            f"{BASE_URL}/api/blocks/{bid_a}/report-html",
            headers=HEADERS_B,
        )
        assert r.status_code == 404

    def test_no_config_returns_400(self):
        """Create a block for NOCFG user via Mongo (API would 400 at create? no, create doesn't check cfg)."""
        async def mk_block():
            c = AsyncIOMotorClient(MONGO_URL)
            db = c[DB_NAME]
            bid = "blk_nocfg_test123"
            await db.blocks.delete_many({"user_id": USER_ID_NOCFG})
            await db.blocks.insert_one({
                "block_id": bid, "user_id": USER_ID_NOCFG,
                "month": 10, "year": 2026,
                "label": "Spese extra Ottobre '26",
                "status": "open", "expenses": [],
                "created_at": datetime.now(timezone.utc),
            })
            c.close()
            return bid
        bid = _run(mk_block())
        r = requests.get(
            f"{BASE_URL}/api/blocks/{bid}/report-html",
            headers=HEADERS_NOCFG,
        )
        assert r.status_code == 400
        assert "configurazione" in r.json().get("detail", "").lower()


# =========================== 3) Security sanity ===========================

class TestReportHtmlSecurity:
    def test_no_sensitive_attachment_base64_in_payload(self):
        bid = _BLOCK_IDS["A"]
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_A)
        # the PNG base64 of expense attachment must not be inside
        assert PNG_B64 not in r.text
        # also no attachment_data key leak
        assert "attachment_data" not in r.text

    def test_empty_block_still_renders_valid_html(self):
        bid = _BLOCK_IDS["B"]  # user B's empty block
        r = requests.get(f"{BASE_URL}/api/blocks/{bid}/report-html", headers=HEADERS_B)
        assert r.status_code == 200
        html = r.text
        assert "<!DOCTYPE html>" in html
        assert "Nessuna spesa" in html
        assert "Barbara" in html
        assert "Carlo" in html

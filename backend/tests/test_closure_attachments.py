"""Backend tests for closure_attachments feature on POST /api/blocks/{id}/close
and verification of ZIP structure via GET /api/public/download/{token}."""
import os
import io
import base64
import zipfile
import asyncio
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
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL not found"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

USER_ID = "user_closure_att"
SESSION_TOKEN = "test_closure_att_token"
USER_EMAIL = "parent1_closure@example.com"
PARENT2_EMAIL = "delivered@resend.dev"
HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}", "Content-Type": "application/json"}

# 1x1 PNG transparent (67 bytes decoded)
PNG_B64 = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8//8/AwAI/AL+XJ6"
    "jFAAAAABJRU5ErkJggg=="
)
# fake small PDF content
PDF_BYTES = b"%PDF-1.4\n%fake test pdf\n%%EOF\n"
PDF_B64 = base64.b64encode(PDF_BYTES).decode("ascii")


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _seed():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    # clean target entities only
    await db.users.delete_many({"$or": [{"user_id": USER_ID}, {"email": USER_EMAIL}]})
    await db.user_sessions.delete_many({"session_token": SESSION_TOKEN})
    await db.configs.delete_many({"user_id": USER_ID})
    await db.blocks.delete_many({"user_id": USER_ID})
    await db.email_downloads.delete_many({"user_id": USER_ID})
    await db.email_rate_log.delete_many({"user_id": USER_ID})

    await db.users.insert_one({
        "user_id": USER_ID, "email": USER_EMAIL, "name": "Parent Closure",
        "picture": None, "created_at": datetime.now(timezone.utc),
    })
    await db.user_sessions.insert_one({
        "session_token": SESSION_TOKEN, "user_id": USER_ID,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })
    await db.configs.insert_one({
        "user_id": USER_ID,
        "parent1_name": "Alice", "parent2_name": "Bob",
        "parent1_email": USER_EMAIL, "parent2_email": PARENT2_EMAIL,
        "default_pct_parent1": 50.0, "settlement_day": 20,
        "updated_at": datetime.now(timezone.utc),
    })
    client.close()


async def _cleanup():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.users.delete_many({"user_id": USER_ID})
    await db.user_sessions.delete_many({"session_token": SESSION_TOKEN})
    await db.configs.delete_many({"user_id": USER_ID})
    await db.blocks.delete_many({"user_id": USER_ID})
    await db.email_downloads.delete_many({"user_id": USER_ID})
    await db.email_rate_log.delete_many({"user_id": USER_ID})
    client.close()


@pytest.fixture(scope="module", autouse=True)
def setup_module():
    _run(_seed())
    yield
    _run(_cleanup())


def _create_open_block_with_expenses(month: int, year: int):
    r = requests.post(f"{BASE_URL}/api/blocks", headers=HEADERS,
                      json={"month": month, "year": year})
    assert r.status_code == 200, r.text
    bid = r.json()["block"]["block_id"]
    # 2 expenses to have totals
    for payload in [
        {"date": f"{year}-{month:02d}-05", "description": "Scontrino libri",
         "amount": 100.0, "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50},
        {"date": f"{year}-{month:02d}-15", "description": "Visita medica",
         "amount": 60.0, "paid_by": "parent2", "pct_parent1": 50, "pct_parent2": 50},
    ]:
        r2 = requests.post(f"{BASE_URL}/api/blocks/{bid}/expenses",
                           headers=HEADERS, json=payload)
        assert r2.status_code == 200, r2.text
    return bid


# ---------- Core feature: close with closure attachments ----------
class TestCloseWithAttachments:
    def test_close_with_png_and_pdf_attachments(self):
        bid = _create_open_block_with_expenses(1, 2027)
        payload = {
            "bonifico_date": "2027-01-20",
            "bonifico_amount": 20.0,
            "bonifico_direction": "parent2_to_parent1",
            "bonifico_note": "test closure attachments",
            "attachments": [
                {"name": "ricevuta.png", "mime": "image/png", "data": PNG_B64},
                {"name": "contratto.pdf", "mime": "application/pdf", "data": PDF_B64},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=HEADERS, json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert "download_url" in data and data["download_url"].startswith("https://")

        # Block saved with closure_attachments in Mongo
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            blk = await db.blocks.find_one({"user_id": USER_ID, "block_id": bid}, {"_id": 0})
            client.close()
            return blk
        blk = _run(check())
        assert blk["status"] == "closed"
        ca = blk.get("closure_attachments") or []
        assert len(ca) == 2
        names = {a["name"] for a in ca}
        assert names == {"ricevuta.png", "contratto.pdf"}
        for a in ca:
            assert set(a.keys()) >= {"name", "mime", "data"}
            assert a["data"]  # base64 preserved

        # Download ZIP and verify "chiusura/" folder
        du = data["download_url"]
        d = requests.get(du)
        assert d.status_code == 200
        assert d.headers.get("content-type", "").startswith("application/zip")
        zbytes = d.content
        assert zbytes[:2] == b"PK"
        zf = zipfile.ZipFile(io.BytesIO(zbytes))
        names_in_zip = zf.namelist()
        # report.html present
        assert "report.html" in names_in_zip
        # chiusura/ folder entries
        chiusura = [n for n in names_in_zip if n.startswith("chiusura/")]
        assert len(chiusura) == 2, f"expected 2 closure files, got: {chiusura}"
        # spese/ folder still present (no attachments on expenses but ensure structure)
        # (expenses have no attachments → spese/ may be empty; just assert chiusura shape)
        # Also assert closure PNG/PDF filenames are preserved (safe-filename)
        joined = " ".join(chiusura)
        assert "ricevuta.png" in joined
        assert "contratto.pdf" in joined
        # Verify PDF content inside zip matches
        pdf_entry = next(n for n in chiusura if n.endswith(".pdf"))
        with zf.open(pdf_entry) as fp:
            assert fp.read() == PDF_BYTES


# ---------- SEC-002 on closure attachments ----------
class TestClosureAttachmentValidation:
    def test_unsupported_mime_returns_400(self):
        bid = _create_open_block_with_expenses(2, 2027)
        payload = {
            "bonifico_date": "2027-02-20",
            "bonifico_amount": 10.0,
            "bonifico_direction": "none",
            "attachments": [
                {"name": "note.txt", "mime": "text/plain",
                 "data": base64.b64encode(b"ciao").decode("ascii")},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=HEADERS, json=payload)
        assert r.status_code == 400, r.text
        assert "non supportato" in r.json().get("detail", "").lower()

        # Block must remain OPEN (not closed by failed request)
        g = requests.get(f"{BASE_URL}/api/blocks/{bid}", headers=HEADERS).json()["block"]
        assert g["status"] == "open"

    def test_too_large_returns_413(self):
        bid = _create_open_block_with_expenses(3, 2027)
        # 4.5MB base64 string = ~3.375MB decoded (> 3MB limit)
        big_b64 = "A" * (int(4.5 * 1024 * 1024))
        payload = {
            "bonifico_date": "2027-03-20",
            "bonifico_amount": 10.0,
            "bonifico_direction": "none",
            "attachments": [
                {"name": "huge.png", "mime": "image/png", "data": big_b64},
            ],
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=HEADERS, json=payload)
        assert r.status_code == 413, r.text
        assert "troppo grande" in r.json().get("detail", "").lower()

        g = requests.get(f"{BASE_URL}/api/blocks/{bid}", headers=HEADERS).json()["block"]
        assert g["status"] == "open"


# ---------- Retrocompatibility: close without attachments ----------
class TestCloseBackCompat:
    def test_close_without_attachments_field(self):
        bid = _create_open_block_with_expenses(4, 2027)
        payload = {
            "bonifico_date": "2027-04-20",
            "bonifico_amount": 20.0,
            "bonifico_direction": "parent2_to_parent1",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=HEADERS, json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["download_url"].startswith("https://")

        # closure_attachments stored as empty list
        async def check():
            client = AsyncIOMotorClient(MONGO_URL)
            db = client[DB_NAME]
            blk = await db.blocks.find_one({"user_id": USER_ID, "block_id": bid}, {"_id": 0})
            client.close()
            return blk
        blk = _run(check())
        assert blk["status"] == "closed"
        assert blk.get("closure_attachments") == []

        # ZIP must not include chiusura/
        d = requests.get(data["download_url"])
        assert d.status_code == 200
        zf = zipfile.ZipFile(io.BytesIO(d.content))
        chiusura = [n for n in zf.namelist() if n.startswith("chiusura/")]
        assert chiusura == []
        assert "report.html" in zf.namelist()


# ---------- Regression: core existing flows ----------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{BASE_URL}/api/")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_auth_me(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS)
        assert r.status_code == 200
        assert r.json()["user"]["user_id"] == USER_ID

    def test_config_get(self):
        r = requests.get(f"{BASE_URL}/api/config", headers=HEADERS)
        assert r.status_code == 200
        assert r.json()["config"]["parent2_email"] == PARENT2_EMAIL

    def test_blocks_list(self):
        r = requests.get(f"{BASE_URL}/api/blocks", headers=HEADERS)
        assert r.status_code == 200
        for b in r.json()["blocks"]:
            assert "_id" not in b

    def test_expense_with_attachment_validation(self):
        bid = _create_open_block_with_expenses(5, 2027)
        bad_payload = {
            "date": "2027-05-05", "description": "test",
            "amount": 10.0, "paid_by": "parent1",
            "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": base64.b64encode(b"xx").decode("ascii"),
            "attachment_mime": "text/plain",
            "attachment_name": "x.txt",
        }
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/expenses",
                          headers=HEADERS, json=bad_payload)
        assert r.status_code == 400

    def test_resend_email_after_close(self):
        bid = _create_open_block_with_expenses(6, 2027)
        r = requests.post(f"{BASE_URL}/api/blocks/{bid}/close",
                          headers=HEADERS,
                          json={"bonifico_date": "2027-06-20",
                                "bonifico_amount": 10.0,
                                "bonifico_direction": "none"})
        assert r.status_code == 200
        r2 = requests.post(f"{BASE_URL}/api/blocks/{bid}/resend-email", headers=HEADERS)
        assert r2.status_code in (200, 502)

    def test_export_year_pdf(self):
        r = requests.get(f"{BASE_URL}/api/export/year/2027", headers=HEADERS)
        assert r.status_code == 200
        data = r.json()
        assert data["mime"] == "application/pdf"
        raw = base64.b64decode(data["data"])
        assert raw[:4] == b"%PDF"

"""
Security fixes test suite for Quota backend.
Covers:
  * SEC-002: attachment MIME validation + size limit (POST & PUT expenses)
  * SEC-001: per-user rate limits on close / resend-email / export email
  * SEC-001: rate limit isolation across users
Seeds two users directly in Mongo + their sessions, teardown wipes:
  - users/user_sessions/configs/blocks for both test users
  - email_rate_log entries for both test users
"""
import os
import asyncio
from datetime import datetime, timezone, timedelta

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

# ---- Config ----
BASE_URL = None
with open("/app/frontend/.env") as f:
    for line in f:
        if line.startswith("EXPO_PUBLIC_BACKEND_URL") or line.startswith("EXPO_BACKEND_URL"):
            BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
            break
assert BASE_URL, "BASE_URL not set"

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

USER1_ID = "user_sec_test_1"
USER1_EMAIL = "sec1@quota.local"
USER1_TOKEN = "sec_token_user_1"

USER2_ID = "user_sec_test_2"
USER2_EMAIL = "sec2@quota.local"
USER2_TOKEN = "sec_token_user_2"

H1 = {"Authorization": f"Bearer {USER1_TOKEN}", "Content-Type": "application/json"}
H2 = {"Authorization": f"Bearer {USER2_TOKEN}", "Content-Type": "application/json"}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


async def _cleanup_db():
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    for uid, tok in ((USER1_ID, USER1_TOKEN), (USER2_ID, USER2_TOKEN)):
        await db.users.delete_many({"user_id": uid})
        await db.user_sessions.delete_many({"session_token": tok})
        await db.configs.delete_many({"user_id": uid})
        await db.blocks.delete_many({"user_id": uid})
        await db.email_rate_log.delete_many({"user_id": uid})
    client.close()


async def _seed_user(uid, email, tok):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    # Idempotent upsert (xdist workers may call this concurrently).
    from pymongo.errors import DuplicateKeyError
    try:
        await db.users.update_one(
            {"user_id": uid},
            {"$set": {
                "user_id": uid, "email": email, "name": uid,
                "picture": None, "created_at": datetime.now(timezone.utc),
            }},
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    try:
        await db.user_sessions.update_one(
            {"session_token": tok},
            {"$set": {
                "session_token": tok, "user_id": uid,
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            }},
            upsert=True,
        )
    except DuplicateKeyError:
        pass
    # Config: parent2_email valid syntactically; use delivered@resend.dev to be realistic
    await db.configs.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid,
            "parent1_name": "P1", "parent2_name": "P2",
            "parent1_email": email,
            "parent2_email": "delivered@resend.dev",
            "default_pct_parent1": 50.0, "settlement_day": 20,
            "updated_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )
    client.close()


async def _create_block(uid, month=1, year=2027):
    """Create an open block directly in Mongo and return its id."""
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    bid = f"blk_sec_{uid}_{month}_{year}"
    await db.blocks.delete_one({"block_id": bid})
    await db.blocks.insert_one({
        "block_id": bid,
        "user_id": uid,
        "month": month, "year": year,
        "label": f"test {month}/{year}",
        "status": "open",
        "expenses": [],
        "created_at": datetime.now(timezone.utc),
    })
    client.close()
    return bid


async def _reset_block_open(bid):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.blocks.update_one(
        {"block_id": bid},
        {"$set": {"status": "open"}, "$unset": {"bonifico": "", "closed_at": "", "email_sent_at": "", "email_error": ""}},
    )
    client.close()


async def _clear_rate_log(uid):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    await db.email_rate_log.delete_many({"user_id": uid})
    client.close()


@pytest.fixture(scope="module", autouse=True)
def setup_module():
    _run(_cleanup_db())
    _run(_seed_user(USER1_ID, USER1_EMAIL, USER1_TOKEN))
    _run(_seed_user(USER2_ID, USER2_EMAIL, USER2_TOKEN))
    yield
    _run(_cleanup_db())


# ============================================================
# SEC-002: Attachment MIME validation
# ============================================================
class TestAttachmentMimeValidation:
    """POST/PUT expenses with invalid MIME must 400, valid must 200."""

    @pytest.fixture(autouse=True)
    def _block(self):
        self.bid = _run(_create_block(USER1_ID, 2, 2027))

    def _payload(self, mime, data="SGVsbG8="):
        return {
            "date": "2027-02-05", "description": "test", "amount": 10,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": data, "attachment_mime": mime,
            "attachment_name": "f",
        }

    @pytest.mark.parametrize("mime", ["text/plain", "application/x-sh", "application/zip"])
    def test_invalid_mime_rejected(self, mime):
        r = requests.post(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses",
            headers=H1, json=self._payload(mime),
        )
        assert r.status_code == 400, r.text
        assert "non supportato" in r.json()["detail"].lower() or "tipo" in r.json()["detail"].lower()

    @pytest.mark.parametrize("mime", ["image/jpeg", "image/png", "application/pdf"])
    def test_valid_mime_accepted(self, mime):
        r = requests.post(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses",
            headers=H1, json=self._payload(mime),
        )
        assert r.status_code == 200, r.text
        assert "expense_id" in r.json()

    def test_no_attachment_accepted(self):
        # payload w/o attachment should still work
        p = {
            "date": "2027-02-10", "description": "no attach", "amount": 5,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
        }
        r = requests.post(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses", headers=H1, json=p,
        )
        assert r.status_code == 200, r.text


# ============================================================
# SEC-002: Attachment size limit (3 MB decoded)
# ============================================================
class TestAttachmentSizeLimit:
    @pytest.fixture(autouse=True)
    def _block(self):
        self.bid = _run(_create_block(USER1_ID, 3, 2027))

    def test_oversize_rejected_on_post(self):
        # 4 MB base64-ish payload => ~3 MB decoded. Need > 3*1024*1024 decoded.
        # decoded_bytes = len(clean) * 3 // 4 ; we need > 3_145_728 -> clean > 4_194_304
        clean = "A" * 4_200_000  # ~ 3,150,000 decoded bytes
        payload = {
            "date": "2027-03-01", "description": "big", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": clean, "attachment_mime": "image/jpeg",
            "attachment_name": "big.jpg",
        }
        r = requests.post(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses", headers=H1, json=payload,
        )
        assert r.status_code == 413, r.text
        assert "troppo grande" in r.json()["detail"].lower()

    def test_under_limit_accepted(self):
        # Clearly under 3MB decoded (~0.75 MB)
        clean = "A" * 1_000_000  # ~750K decoded bytes
        payload = {
            "date": "2027-03-02", "description": "ok size", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": clean, "attachment_mime": "image/jpeg",
            "attachment_name": "ok.jpg",
        }
        r = requests.post(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses", headers=H1, json=payload,
        )
        assert r.status_code == 200, r.text

    def test_oversize_rejected_on_put(self):
        # First create a small expense
        small = {
            "date": "2027-03-03", "description": "small", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": "SGVsbG8=", "attachment_mime": "image/jpeg",
            "attachment_name": "s.jpg",
        }
        c = requests.post(f"{BASE_URL}/api/blocks/{self.bid}/expenses", headers=H1, json=small)
        assert c.status_code == 200, c.text
        eid = c.json()["expense_id"]

        # Now PUT with oversize attachment
        big = {
            "date": "2027-03-03", "description": "small-upd", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": "A" * 4_200_000, "attachment_mime": "image/jpeg",
            "attachment_name": "big.jpg",
        }
        r = requests.put(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses/{eid}", headers=H1, json=big,
        )
        assert r.status_code == 413, r.text
        assert "troppo grande" in r.json()["detail"].lower()

    def test_invalid_mime_rejected_on_put(self):
        small = {
            "date": "2027-03-04", "description": "put-mime", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
        }
        c = requests.post(f"{BASE_URL}/api/blocks/{self.bid}/expenses", headers=H1, json=small)
        assert c.status_code == 200, c.text
        eid = c.json()["expense_id"]

        bad = {
            "date": "2027-03-04", "description": "put-mime", "amount": 1,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": "SGVsbG8=", "attachment_mime": "application/x-sh",
            "attachment_name": "x.sh",
        }
        r = requests.put(
            f"{BASE_URL}/api/blocks/{self.bid}/expenses/{eid}", headers=H1, json=bad,
        )
        assert r.status_code == 400, r.text


# ============================================================
# SEC-001: Rate limits per action (per user)
# ============================================================
class TestRateLimitClose:
    """11th close in the same hour must 429. First 10 pass."""

    def test_close_rate_limit(self):
        _run(_clear_rate_log(USER1_ID))
        bid = _run(_create_block(USER1_ID, 4, 2027))

        # Make 10 "close" calls. Reset block.status=open between calls so each one
        # increments the rate_log (which happens BEFORE the "already closed" check).
        statuses = []
        for i in range(10):
            _run(_reset_block_open(bid))
            r = requests.post(
                f"{BASE_URL}/api/blocks/{bid}/close",
                headers=H1,
                json={
                    "bonifico_date": "2027-04-20",
                    "bonifico_amount": 1.0,
                    "bonifico_direction": "none",
                },
            )
            statuses.append(r.status_code)
            # Should pass rate check: expect 200 (email send attempt handled gracefully)
            assert r.status_code == 200, f"call {i+1}: {r.status_code} {r.text}"

        # 11th should be rate-limited
        _run(_reset_block_open(bid))
        r = requests.post(
            f"{BASE_URL}/api/blocks/{bid}/close",
            headers=H1,
            json={
                "bonifico_date": "2027-04-20",
                "bonifico_amount": 1.0,
                "bonifico_direction": "none",
            },
        )
        assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
        assert "troppi invii" in r.json()["detail"].lower()

        _run(_clear_rate_log(USER1_ID))


class TestRateLimitResend:
    """6th resend-email in the same hour must 429. First 5 pass (or 502 on email err)."""

    def test_resend_rate_limit(self):
        _run(_clear_rate_log(USER1_ID))
        bid = _run(_create_block(USER1_ID, 5, 2027))

        # First 5 attempts: rate check passes, email may 200 or 502
        for i in range(5):
            r = requests.post(
                f"{BASE_URL}/api/blocks/{bid}/resend-email", headers=H1,
            )
            assert r.status_code in (200, 502), f"call {i+1}: {r.status_code} {r.text}"

        # 6th: rate-limited
        r = requests.post(
            f"{BASE_URL}/api/blocks/{bid}/resend-email", headers=H1,
        )
        assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
        assert "troppi invii" in r.json()["detail"].lower()

        _run(_clear_rate_log(USER1_ID))


class TestRateLimitExportEmail:
    """6th export-year email in 24h must 429. First 5 pass."""

    def test_export_email_rate_limit(self):
        _run(_clear_rate_log(USER1_ID))

        for i in range(5):
            r = requests.post(
                f"{BASE_URL}/api/export/year/2027/email", headers=H1,
            )
            # Rate check passes; export email returns 200 even on email failure
            assert r.status_code == 200, f"call {i+1}: {r.status_code} {r.text}"

        r = requests.post(
            f"{BASE_URL}/api/export/year/2027/email", headers=H1,
        )
        assert r.status_code == 429, f"expected 429, got {r.status_code}: {r.text}"
        assert "troppi invii" in r.json()["detail"].lower()

        _run(_clear_rate_log(USER1_ID))


# ============================================================
# SEC-001: Rate limit isolation across users
# ============================================================
class TestRateLimitIsolation:
    """User2 must NOT be blocked when User1 exhausts its quota."""

    def test_user2_not_affected_by_user1_quota(self):
        _run(_clear_rate_log(USER1_ID))
        _run(_clear_rate_log(USER2_ID))

        # Exhaust user1's export_email quota (5 in 24h)
        for i in range(5):
            r = requests.post(f"{BASE_URL}/api/export/year/2027/email", headers=H1)
            assert r.status_code == 200
        # 6th: user1 blocked
        r = requests.post(f"{BASE_URL}/api/export/year/2027/email", headers=H1)
        assert r.status_code == 429, r.text

        # user2 should still be able to call it
        r2 = requests.post(f"{BASE_URL}/api/export/year/2027/email", headers=H2)
        assert r2.status_code == 200, f"user2 unexpectedly blocked: {r2.status_code} {r2.text}"

        _run(_clear_rate_log(USER1_ID))
        _run(_clear_rate_log(USER2_ID))


# ============================================================
# Regression: basic flows still work
# ============================================================
class TestRegressionBasics:
    def test_auth_me(self):
        r = requests.get(f"{BASE_URL}/api/auth/me", headers=H1)
        assert r.status_code == 200
        assert r.json()["user"]["user_id"] == USER1_ID

    def test_get_config(self):
        r = requests.get(f"{BASE_URL}/api/config", headers=H1)
        assert r.status_code == 200
        assert r.json()["config"]["parent2_email"] == "delivered@resend.dev"

    def test_create_list_delete_block(self):
        c = requests.post(
            f"{BASE_URL}/api/blocks", headers=H1, json={"month": 6, "year": 2027},
        )
        assert c.status_code == 200
        bid = c.json()["block"]["block_id"]

        l = requests.get(f"{BASE_URL}/api/blocks", headers=H1)
        assert l.status_code == 200
        assert any(b["block_id"] == bid for b in l.json()["blocks"])

        d = requests.delete(f"{BASE_URL}/api/blocks/{bid}", headers=H1)
        assert d.status_code == 200

    def test_expense_crud_with_valid_attachment(self):
        bid = _run(_create_block(USER1_ID, 7, 2027))
        # Create with valid image attachment
        p = {
            "date": "2027-07-05", "description": "libri", "amount": 50,
            "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
            "attachment_data": "SGVsbG8=", "attachment_mime": "image/png",
            "attachment_name": "f.png",
        }
        c = requests.post(f"{BASE_URL}/api/blocks/{bid}/expenses", headers=H1, json=p)
        assert c.status_code == 200
        eid = c.json()["expense_id"]

        # Totals
        g = requests.get(f"{BASE_URL}/api/blocks/{bid}", headers=H1).json()["block"]
        assert g["totals"]["total"] == 50.0
        assert g["totals"]["quota_parent1"] == 25.0

        # Update
        p2 = {**p, "amount": 100}
        u = requests.put(f"{BASE_URL}/api/blocks/{bid}/expenses/{eid}", headers=H1, json=p2)
        assert u.status_code == 200

        # Delete
        dd = requests.delete(f"{BASE_URL}/api/blocks/{bid}/expenses/{eid}", headers=H1)
        assert dd.status_code == 200

    def test_export_year_pdf(self):
        r = requests.get(f"{BASE_URL}/api/export/year/2027", headers=H1)
        assert r.status_code == 200
        body = r.json()
        assert body["mime"] == "application/pdf"
        assert body["data"]

"""Backend tests for Quota co-parenting expense tracker."""
import os
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

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

SESSION_TOKEN = "test_token_123"
USER_ID = "user_test"
USER_EMAIL = "parent1_test@example.com"

HEADERS = {"Authorization": f"Bearer {SESSION_TOKEN}", "Content-Type": "application/json"}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(scope="module", autouse=True)
def setup_session():
    """Seed user + session in Mongo, teardown after."""
    async def seed():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.delete_many({"user_id": USER_ID})
        await db.user_sessions.delete_many({"session_token": SESSION_TOKEN})
        await db.configs.delete_many({"user_id": USER_ID})
        await db.blocks.delete_many({"user_id": USER_ID})
        await db.users.insert_one({
            "user_id": USER_ID,
            "email": USER_EMAIL,
            "name": "Parent One",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
        })
        await db.user_sessions.insert_one({
            "session_token": SESSION_TOKEN,
            "user_id": USER_ID,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        })
        client.close()

    async def cleanup():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        await db.users.delete_many({"user_id": USER_ID})
        await db.user_sessions.delete_many({"session_token": SESSION_TOKEN})
        await db.configs.delete_many({"user_id": USER_ID})
        await db.blocks.delete_many({"user_id": USER_ID})
        client.close()

    _run(seed())
    yield
    _run(cleanup())


# ----- Health -----
def test_health():
    r = requests.get(f"{BASE_URL}/api/")
    assert r.status_code == 200
    assert r.json()["ok"] is True


# ----- Auth -----
def test_auth_session_invalid():
    r = requests.post(f"{BASE_URL}/api/auth/session", json={"session_id": "bogus_invalid"})
    assert r.status_code == 401

def test_auth_me_no_token():
    r = requests.get(f"{BASE_URL}/api/auth/me")
    assert r.status_code == 401

def test_auth_me_with_token():
    r = requests.get(f"{BASE_URL}/api/auth/me", headers=HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["user"]["user_id"] == USER_ID
    assert data["user"]["email"] == USER_EMAIL
    assert "_id" not in data["user"]


# ----- Config -----
def test_put_config():
    payload = {
        "parent1_name": "Alice",
        "parent2_name": "Bob",
        "parent2_email": "delivered@resend.dev",
        "default_pct_parent1": 50.0,
        "settlement_day": 20,
    }
    r = requests.put(f"{BASE_URL}/api/config", headers=HEADERS, json=payload)
    assert r.status_code == 200, r.text
    cfg = r.json()["config"]
    assert cfg["parent1_name"] == "Alice"
    assert cfg["parent1_email"] == USER_EMAIL
    assert "_id" not in cfg

def test_get_config():
    r = requests.get(f"{BASE_URL}/api/config", headers=HEADERS)
    assert r.status_code == 200
    assert r.json()["config"]["parent2_name"] == "Bob"


# ----- Blocks + expenses -----
BLOCK_ID = {}
EXPENSE_IDS = {}

def test_create_block():
    r = requests.post(f"{BASE_URL}/api/blocks", headers=HEADERS, json={"month": 10, "year": 2026})
    assert r.status_code == 200, r.text
    blk = r.json()["block"]
    assert blk["month"] == 10 and blk["year"] == 2026
    assert blk["status"] == "open"
    assert blk["label"] == "Spese extra Ottobre '26"
    BLOCK_ID["id"] = blk["block_id"]
    assert "_id" not in blk

def test_list_blocks():
    r = requests.get(f"{BASE_URL}/api/blocks", headers=HEADERS)
    assert r.status_code == 200
    blocks = r.json()["blocks"]
    assert any(b["block_id"] == BLOCK_ID["id"] for b in blocks)

def test_get_block():
    r = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS)
    assert r.status_code == 200

def test_add_expense_parent1():
    payload = {
        "date": "2026-10-05", "description": "Scontrino libri", "amount": 232.11,
        "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
    }
    r = requests.post(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/expenses", headers=HEADERS, json=payload)
    assert r.status_code == 200, r.text
    EXPENSE_IDS["e1"] = r.json()["expense_id"]

def test_add_expense_parent2():
    payload = {
        "date": "2026-10-10", "description": "Scarpe", "amount": 90,
        "paid_by": "parent2", "pct_parent1": 50, "pct_parent2": 50,
    }
    r = requests.post(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/expenses", headers=HEADERS, json=payload)
    assert r.status_code == 200, r.text
    EXPENSE_IDS["e2"] = r.json()["expense_id"]

def test_totals_computation():
    r = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS)
    totals = r.json()["block"]["totals"]
    # total=322.11, quota each=161.055->161.06; paid_p1=232.11, paid_p2=90; saldo=232.11-161.06=71.05
    assert totals["total"] == 322.11
    assert totals["quota_parent1"] == 161.06
    assert totals["quota_parent2"] == 161.06
    assert totals["paid_parent1"] == 232.11
    assert totals["paid_parent2"] == 90.0
    assert totals["saldo"] == 71.06

def test_update_expense():
    payload = {
        "date": "2026-10-05", "description": "Libri scuola", "amount": 200.00,
        "paid_by": "parent1", "pct_parent1": 60, "pct_parent2": 40,
    }
    r = requests.put(
        f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/expenses/{EXPENSE_IDS['e1']}",
        headers=HEADERS, json=payload,
    )
    assert r.status_code == 200, r.text
    g = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS).json()["block"]
    e1 = next(e for e in g["expenses"] if e["expense_id"] == EXPENSE_IDS["e1"])
    assert e1["amount"] == 200.0
    assert e1["description"] == "Libri scuola"

def test_delete_expense():
    r = requests.delete(
        f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/expenses/{EXPENSE_IDS['e2']}",
        headers=HEADERS,
    )
    assert r.status_code == 200
    g = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS).json()["block"]
    assert all(e["expense_id"] != EXPENSE_IDS["e2"] for e in g["expenses"])

def test_close_block():
    payload = {
        "bonifico_date": "2026-10-20",
        "bonifico_amount": 17.88,
        "bonifico_direction": "parent2_to_parent1",
    }
    r = requests.post(
        f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/close",
        headers=HEADERS, json=payload,
    )
    # Email send may fail with 502 (external) but logic must be reachable
    assert r.status_code in (200, 502), r.text
    if r.status_code == 200:
        g = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS).json()["block"]
        assert g["status"] == "closed"
        assert g["bonifico"]["bonifico_amount"] == 17.88

def test_cannot_modify_closed_block():
    r = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS).json()["block"]
    if r["status"] != "closed":
        pytest.skip("close failed earlier (email), skip")
    payload = {
        "date": "2026-10-15", "description": "Test", "amount": 10,
        "paid_by": "parent1", "pct_parent1": 50, "pct_parent2": 50,
    }
    res = requests.post(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/expenses", headers=HEADERS, json=payload)
    assert res.status_code == 400

def test_resend_email():
    g = requests.get(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}", headers=HEADERS).json()["block"]
    if g["status"] != "closed":
        pytest.skip("block not closed")
    r = requests.post(f"{BASE_URL}/api/blocks/{BLOCK_ID['id']}/resend-email", headers=HEADERS)
    assert r.status_code in (200, 502)

def test_max_24_blocks_pruning():
    # create 25 more blocks across different months/years
    async def seed_many():
        client = AsyncIOMotorClient(MONGO_URL)
        db = client[DB_NAME]
        # Insert 26 blocks with distinct months
        docs = []
        for i in range(26):
            y = 2020 + i // 12
            m = (i % 12) + 1
            docs.append({
                "block_id": f"blk_bulk_{i}",
                "user_id": USER_ID,
                "month": m, "year": y,
                "label": f"test {m}/{y}",
                "status": "open", "expenses": [],
                "created_at": datetime.now(timezone.utc),
            })
        await db.blocks.delete_many({"user_id": USER_ID, "block_id": {"$regex": "^blk_bulk_"}})
        await db.blocks.insert_many(docs)
        client.close()
    _run(seed_many())
    # trigger a create to invoke pruning
    requests.post(f"{BASE_URL}/api/blocks", headers=HEADERS, json={"month": 11, "year": 2030})
    r = requests.get(f"{BASE_URL}/api/blocks", headers=HEADERS)
    blocks = r.json()["blocks"]
    assert len(blocks) <= 24, f"expected <=24, got {len(blocks)}"

def test_delete_block():
    # pick any existing block
    r = requests.get(f"{BASE_URL}/api/blocks", headers=HEADERS)
    blocks = r.json()["blocks"]
    assert blocks
    bid = blocks[0]["block_id"]
    d = requests.delete(f"{BASE_URL}/api/blocks/{bid}", headers=HEADERS)
    assert d.status_code == 200
    r2 = requests.get(f"{BASE_URL}/api/blocks/{bid}", headers=HEADERS)
    assert r2.status_code == 404

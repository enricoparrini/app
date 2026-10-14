"""Seed/cleanup helper for Quota frontend auth tests. Only touches TEST_ prefixed data."""
import os
import sys
from datetime import datetime, timedelta, timezone

from pymongo import MongoClient

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "quota_app")

PROTECTED_USER_ID = "user_de562635920a"
PROTECTED_EMAIL = "enricoparrini@gmail.com"


def _db():
    return MongoClient(MONGO_URL)[DB_NAME]


def seed(user_id: str, token: str, email: str, name: str, with_config: bool = True) -> None:
    assert user_id.startswith("TEST_"), "safety: user_id must start with TEST_"
    db = _db()
    now = datetime.now(timezone.utc)
    db.users.update_one(
        {"user_id": user_id},
        {"$set": {"user_id": user_id, "email": email, "name": name, "picture": None, "created_at": now}},
        upsert=True,
    )
    db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {
            "session_token": token,
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": None,
            "expires_at": now + timedelta(days=7),
            "created_at": now,
        }},
        upsert=True,
    )
    if with_config:
        db.configs.update_one(
            {"user_id": user_id},
            {"$set": {
                "user_id": user_id,
                "parent1_name": name,
                "parent1_email": email,
                "parent2_name": "TEST Partner",
                "parent2_email": "test.partner@example.com",
                "default_pct_parent1": 50.0,
                "settlement_day": 20,
                "updated_at": now,
            }},
            upsert=True,
        )
    else:
        db.configs.delete_one({"user_id": user_id})


def delete_session(token: str) -> int:
    return _db().user_sessions.delete_one({"session_token": token}).deleted_count


def cleanup() -> dict:
    db = _db()
    r = {}
    for col in ("users", "user_sessions", "configs", "blocks"):
        res = db[col].delete_many({"user_id": {"$regex": "^TEST_"}})
        r[col] = res.deleted_count
    r["user_sessions_by_token"] = db.user_sessions.delete_many(
        {"session_token": {"$regex": "^TEST_"}}
    ).deleted_count
    protected = db.users.find_one({"user_id": PROTECTED_USER_ID})
    r["protected_user_intact"] = bool(protected and protected.get("email") == PROTECTED_EMAIL)
    return r


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "cleanup"
    if cmd == "seed":
        seed(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], sys.argv[6] != "nocfg")
        print("OK seeded", sys.argv[2])
    elif cmd == "delsession":
        print("deleted", delete_session(sys.argv[2]))
    else:
        print(cleanup())

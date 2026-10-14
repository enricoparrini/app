"""Backend auth-flow tests for Quota (iteration 12).

Covers:
 - POST /api/auth/session with invalid session_id must return 401 (not 500).
 - GET  /api/auth/me without/invalid token -> 401.
 - Seed a test user + session in Mongo, verify /auth/me 200, /config works,
   POST /auth/logout deletes ONLY the session (not users/configs).
 - POST /api/export/year/{year}/email returns 200 {ok:true, queued:true}
   immediately (no 502 timeout).

Cleanup: all seeded users prefixed with TEST_. Does NOT touch user_de562635920a.
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "quota_app")

PROTECTED_USER_ID = "user_de562635920a"
PROTECTED_EMAIL = "enricoparrini@gmail.com"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="module")
def seeded(mongo):
    """Seed a TEST_ user + valid session + config, cleaned up at module end."""
    uid = f"TEST_user_{uuid.uuid4().hex[:8]}"
    email = f"TEST_{uuid.uuid4().hex[:6]}@example.com"
    token = f"TEST_tok_{uuid.uuid4().hex}"

    mongo.users.insert_one(
        {
            "user_id": uid,
            "email": email,
            "name": "TEST User",
            "picture": None,
            "created_at": datetime.now(timezone.utc),
        }
    )
    mongo.user_sessions.insert_one(
        {
            "session_token": token,
            "user_id": uid,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        }
    )
    mongo.configs.insert_one(
        {
            "user_id": uid,
            "parent1_name": "TEST P1",
            "parent2_name": "TEST P2",
            "parent1_email": email,
            "parent2_email": "TEST_p2@example.com",
            "default_pct_parent1": 50.0,
            "settlement_day": 20,
            "updated_at": datetime.now(timezone.utc),
        }
    )
    yield {"user_id": uid, "email": email, "token": token}
    mongo.users.delete_many({"user_id": uid})
    mongo.user_sessions.delete_many({"user_id": uid})
    mongo.configs.delete_many({"user_id": uid})
    mongo.blocks.delete_many({"user_id": uid})


@pytest.fixture
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ----- /api/auth/session -----

class TestAuthSession:
    def test_invalid_session_id_returns_401(self, session):
        r = session.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "bogus_invalid_session_id_xyz"},
            timeout=30,
        )
        assert r.status_code == 401, f"expected 401, got {r.status_code}: {r.text[:200]}"
        body = r.json()
        assert "detail" in body

    def test_missing_session_id_returns_422(self, session):
        r = session.post(f"{BASE_URL}/api/auth/session", json={}, timeout=15)
        assert r.status_code in (400, 422)


# ----- /api/auth/me -----

class TestAuthMe:
    def test_me_without_token_returns_401(self, session):
        r = session.get(f"{BASE_URL}/api/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_invalid_token_returns_401(self, session):
        r = session.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": "Bearer not_a_real_token"},
            timeout=15,
        )
        assert r.status_code == 401

    def test_me_with_valid_seeded_token_returns_user(self, session, seeded):
        r = session.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {seeded['token']}"},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["user_id"] == seeded["user_id"]
        assert body["user"]["email"] == seeded["email"]


# ----- /api/config -----

class TestConfigAccess:
    def test_config_requires_auth(self, session):
        r = session.get(f"{BASE_URL}/api/config", timeout=15)
        assert r.status_code == 401

    def test_config_with_valid_token(self, session, seeded):
        r = session.get(
            f"{BASE_URL}/api/config",
            headers={"Authorization": f"Bearer {seeded['token']}"},
            timeout=15,
        )
        assert r.status_code == 200
        body = r.json()
        assert body["config"] is not None
        assert body["config"]["parent1_name"] == "TEST P1"
        assert body["config"]["user_id"] == seeded["user_id"]


# ----- /api/auth/logout -----

class TestAuthLogout:
    def test_logout_deletes_only_session(self, session, mongo, seeded):
        # add a disposable session for this test (keeps the module-scoped seeded one alive)
        tmp_token = f"TEST_tmp_{uuid.uuid4().hex}"
        mongo.user_sessions.insert_one(
            {
                "session_token": tmp_token,
                "user_id": seeded["user_id"],
                "created_at": datetime.now(timezone.utc),
                "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
            }
        )
        r = session.post(
            f"{BASE_URL}/api/auth/logout",
            headers={"Authorization": f"Bearer {tmp_token}"},
            timeout=15,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True

        # session gone
        assert mongo.user_sessions.find_one({"session_token": tmp_token}) is None
        # user + config NOT deleted
        assert mongo.users.find_one({"user_id": seeded["user_id"]}) is not None
        assert mongo.configs.find_one({"user_id": seeded["user_id"]}) is not None

        # /me with that token now 401
        r2 = session.get(
            f"{BASE_URL}/api/auth/me",
            headers={"Authorization": f"Bearer {tmp_token}"},
            timeout=15,
        )
        assert r2.status_code == 401

    def test_logout_without_token_still_200(self, session):
        r = session.post(f"{BASE_URL}/api/auth/logout", timeout=15)
        assert r.status_code == 200


# ----- /api/export/year/{year}/email -----

class TestYearEmailQueued:
    def test_year_email_returns_queued_immediately(self, session, seeded):
        """Must respond fast with {ok:true, queued:true} — email sent in background,
        no 502 proxy timeout."""
        import time

        start = time.time()
        r = session.post(
            f"{BASE_URL}/api/export/year/2024/email",
            headers={"Authorization": f"Bearer {seeded['token']}"},
            timeout=60,
        )
        elapsed = time.time() - start
        assert r.status_code == 200, f"status={r.status_code} body={r.text[:300]}"
        body = r.json()
        assert body.get("ok") is True
        assert body.get("queued") is True
        # should be reasonably fast (background send). Allow generous slack for CI,
        # but it must not hang near the 30s/60s proxy ceiling.
        assert elapsed < 25, f"export email took too long: {elapsed:.1f}s"


# ----- Safety: protected user untouched -----

class TestProtectedUserIntact:
    def test_protected_user_still_exists(self, mongo):
        """Sanity check — these tests must NEVER delete the real user's data."""
        u = mongo.users.find_one({"user_id": PROTECTED_USER_ID})
        c = mongo.configs.find_one({"user_id": PROTECTED_USER_ID})
        # If the real user wasn't seeded on this cluster, skip. Otherwise verify intact.
        if u is None and c is None:
            pytest.skip("protected user not present on this environment")
        assert u is not None
        assert u.get("email") == PROTECTED_EMAIL

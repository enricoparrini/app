import os
import re
import uuid
import base64
import logging
import zipfile
import io
import ipaddress
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any
from html import escape
from html.parser import HTMLParser
from urllib.parse import urlparse

from fastapi import FastAPI, APIRouter, HTTPException, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, EmailStr
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]

EMAIL_BASE_URL = "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ["EMERGENT_EMAIL_KEY"]
EMAIL_FROM_NAME = os.environ["EMAIL_FROM_NAME"]

MONTH_NAMES_IT = [
    "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
    "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
]

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI()
api = APIRouter(prefix="/api")


# ------------- Email guardrail gate (simplified from playbook) -------------
_SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "is.gd", "cutt.ly", "goo.gl", "rebrand.ly")


def _host_ok(host: str) -> bool:
    if not host or "xn--" in host:
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    return not any(host == s or host.endswith("." + s) for s in _SHORTENERS)


class _EmailScan(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = set()
        self.urls = []

    def handle_starttag(self, tag, attrs):
        self.tags.add(tag.lower())
        self.urls += [v for k, v in attrs if k.lower() in ("href", "src") and v]


def _assert_safe_email(subject: str, html: str) -> None:
    scan = _EmailScan()
    scan.feed(html)
    if scan.tags & {"form", "input", "textarea", "select"}:
        raise ValueError("No forms in email")
    for url in scan.urls:
        low = url.strip().lower()
        if low.startswith(("mailto:", "tel:", "cid:", "#")):
            continue
        if not low.startswith("https://"):
            raise ValueError(f"Non-https url: {url}")
        host = urlparse(low).hostname or ""
        if not _host_ok(host) or urlparse(low).username is not None:
            raise ValueError(f"Unsafe url: {url}")


async def send_email(
    *,
    to_list: List[str],
    subject: str,
    html: str,
    attachments: Optional[List[Dict[str, str]]] = None,
) -> Optional[str]:
    _assert_safe_email(subject, html)
    payload: Dict[str, Any] = {
        "to": to_list,
        "subject": subject,
        "html": html,
        "from_name": EMAIL_FROM_NAME,
    }
    if attachments:
        payload["attachments"] = attachments
    try:
        async with httpx.AsyncClient(timeout=60) as http:
            resp = await http.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json=payload,
            )
        resp.raise_for_status()
        return resp.json().get("id")
    except httpx.HTTPStatusError as e:
        logger.error(f"Email send failed: {e.response.status_code} {e.response.text}")
        raise HTTPException(status_code=502, detail="Invio email fallito")
    except Exception as e:
        logger.error(f"Email send error: {e}")
        raise HTTPException(status_code=500, detail="Invio email fallito")


# ---------------------------- Models ----------------------------
class SessionIn(BaseModel):
    session_id: str


class ConfigIn(BaseModel):
    parent1_name: str
    parent2_name: str
    parent2_email: EmailStr
    default_pct_parent1: float = 50.0
    settlement_day: int = 20


class ExpenseIn(BaseModel):
    date: str  # ISO yyyy-mm-dd
    description: str
    amount: float
    paid_by: str  # "parent1" | "parent2"
    pct_parent1: float
    pct_parent2: float
    attachment_data: Optional[str] = None  # base64
    attachment_mime: Optional[str] = None
    attachment_name: Optional[str] = None


class BlockIn(BaseModel):
    month: int  # 1-12
    year: int


class CloseBlockIn(BaseModel):
    bonifico_date: str
    bonifico_amount: float
    bonifico_direction: str  # "parent1_to_parent2" | "parent2_to_parent1" | "none"
    bonifico_note: Optional[str] = None


# ---------------------------- Auth ----------------------------
async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Non autorizzato")
    token = authorization[len("Bearer ") :]
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Sessione non valida")
    exp = session.get("expires_at")
    if exp and exp.tzinfo is None:
        exp = exp.replace(tzinfo=timezone.utc)
    if exp and exp < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Sessione scaduta")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Utente non trovato")
    return user


@api.post("/auth/session")
async def auth_session(payload: SessionIn):
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": payload.session_id},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="session_id non valido")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"session exchange error: {e}")
        raise HTTPException(status_code=401, detail="session_id non valido")

    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Dati sessione incompleti")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": name,
                "picture": picture,
                "created_at": datetime.now(timezone.utc),
            }
        )

    await db.user_sessions.insert_one(
        {
            "session_token": session_token,
            "user_id": user_id,
            "created_at": datetime.now(timezone.utc),
            "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
        }
    )
    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api.get("/auth/me")
async def auth_me(user=Depends(get_current_user)):
    return {"user": user}


@api.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization[len("Bearer ") :]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ---------------------------- Config ----------------------------
@api.get("/config")
async def get_config(user=Depends(get_current_user)):
    cfg = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"config": cfg}


@api.put("/config")
async def put_config(payload: ConfigIn, user=Depends(get_current_user)):
    doc = payload.dict()
    doc["user_id"] = user["user_id"]
    doc["parent1_email"] = user["email"]
    doc["updated_at"] = datetime.now(timezone.utc)
    await db.configs.update_one(
        {"user_id": user["user_id"]}, {"$set": doc}, upsert=True
    )
    saved = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    return {"config": saved}


# ---------------------------- Blocks ----------------------------
def _block_label(month: int, year: int) -> str:
    short_year = f"'{str(year)[-2:]}"
    return f"Spese extra {MONTH_NAMES_IT[month - 1]} {short_year}"


def _compute_totals(expenses: List[Dict[str, Any]], default_pct_p1: float):
    total = 0.0
    quota_p1 = 0.0
    quota_p2 = 0.0
    paid_p1 = 0.0
    paid_p2 = 0.0
    for e in expenses:
        amt = float(e.get("amount", 0))
        pct1 = float(e.get("pct_parent1", default_pct_p1))
        pct2 = 100.0 - pct1
        total += amt
        quota_p1 += amt * pct1 / 100.0
        quota_p2 += amt * pct2 / 100.0
        if e.get("paid_by") == "parent1":
            paid_p1 += amt
        else:
            paid_p2 += amt
    # saldo: positivo = parent2 deve restituire a parent1, negativo = parent1 deve a parent2
    saldo = paid_p1 - quota_p1
    return {
        "total": round(total, 2),
        "quota_parent1": round(quota_p1, 2),
        "quota_parent2": round(quota_p2, 2),
        "paid_parent1": round(paid_p1, 2),
        "paid_parent2": round(paid_p2, 2),
        "saldo": round(saldo, 2),
    }


async def _prune_old_blocks(user_id: str):
    """Mantieni solo gli ultimi 24 blocchi (per mese/anno)."""
    cursor = db.blocks.find({"user_id": user_id}, {"_id": 0, "block_id": 1, "year": 1, "month": 1})
    all_blocks = await cursor.to_list(1000)
    all_blocks.sort(key=lambda b: (b["year"], b["month"]), reverse=True)
    if len(all_blocks) > 24:
        to_delete = [b["block_id"] for b in all_blocks[24:]]
        await db.blocks.delete_many({"user_id": user_id, "block_id": {"$in": to_delete}})


def _serialize_block(blk: Dict[str, Any], default_pct_p1: float = 50.0) -> Dict[str, Any]:
    expenses = blk.get("expenses", [])
    # strip attachment data for list responses
    for e in expenses:
        if "attachment_data" in e:
            e["has_attachment"] = bool(e["attachment_data"])
    totals = _compute_totals(expenses, default_pct_p1)
    out = {
        "block_id": blk["block_id"],
        "month": blk["month"],
        "year": blk["year"],
        "label": blk.get("label") or _block_label(blk["month"], blk["year"]),
        "status": blk.get("status", "open"),
        "closed_at": blk.get("closed_at"),
        "bonifico": blk.get("bonifico"),
        "expenses": expenses,
        "totals": totals,
    }
    return out


@api.get("/blocks")
async def list_blocks(user=Depends(get_current_user)):
    cfg = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    default_pct = cfg.get("default_pct_parent1", 50.0) if cfg else 50.0
    cursor = db.blocks.find({"user_id": user["user_id"]}, {"_id": 0})
    blocks = await cursor.to_list(100)
    blocks.sort(key=lambda b: (b["year"], b["month"]), reverse=True)
    # For list, remove attachment base64 to keep response small
    out = []
    for b in blocks:
        s = _serialize_block(b, default_pct)
        for e in s["expenses"]:
            e.pop("attachment_data", None)
        out.append(s)
    return {"blocks": out}


@api.post("/blocks")
async def create_block(payload: BlockIn, user=Depends(get_current_user)):
    if payload.month < 1 or payload.month > 12:
        raise HTTPException(status_code=400, detail="Mese non valido")
    existing = await db.blocks.find_one(
        {"user_id": user["user_id"], "month": payload.month, "year": payload.year},
        {"_id": 0},
    )
    if existing:
        return {"block": _serialize_block(existing)}
    block_id = f"blk_{uuid.uuid4().hex[:12]}"
    doc = {
        "block_id": block_id,
        "user_id": user["user_id"],
        "month": payload.month,
        "year": payload.year,
        "label": _block_label(payload.month, payload.year),
        "status": "open",
        "expenses": [],
        "created_at": datetime.now(timezone.utc),
    }
    await db.blocks.insert_one(doc)
    await _prune_old_blocks(user["user_id"])
    saved = await db.blocks.find_one({"block_id": block_id}, {"_id": 0})
    return {"block": _serialize_block(saved)}


@api.get("/blocks/{block_id}")
async def get_block(block_id: str, user=Depends(get_current_user)):
    blk = await db.blocks.find_one(
        {"user_id": user["user_id"], "block_id": block_id}, {"_id": 0}
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    cfg = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    default_pct = cfg.get("default_pct_parent1", 50.0) if cfg else 50.0
    out = _serialize_block(blk, default_pct)
    # Strip base64 from attachments in list; keep "has_attachment"
    for e in out["expenses"]:
        e.pop("attachment_data", None)
    return {"block": out}


@api.get("/blocks/{block_id}/expenses/{expense_id}/attachment")
async def get_attachment(block_id: str, expense_id: str, user=Depends(get_current_user)):
    blk = await db.blocks.find_one(
        {"user_id": user["user_id"], "block_id": block_id}, {"_id": 0}
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    for e in blk.get("expenses", []):
        if e.get("expense_id") == expense_id:
            if not e.get("attachment_data"):
                raise HTTPException(status_code=404, detail="Nessun allegato")
            return {
                "data": e["attachment_data"],
                "mime": e.get("attachment_mime"),
                "name": e.get("attachment_name"),
            }
    raise HTTPException(status_code=404, detail="Spesa non trovata")


@api.delete("/blocks/{block_id}")
async def delete_block(block_id: str, user=Depends(get_current_user)):
    res = await db.blocks.delete_one(
        {"user_id": user["user_id"], "block_id": block_id}
    )
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    return {"ok": True}


# ---------------------------- Expenses ----------------------------
async def _get_open_block(user_id: str, block_id: str):
    blk = await db.blocks.find_one({"user_id": user_id, "block_id": block_id}, {"_id": 0})
    if not blk:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    if blk.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Blocco chiuso: non modificabile")
    return blk


@api.post("/blocks/{block_id}/expenses")
async def add_expense(block_id: str, payload: ExpenseIn, user=Depends(get_current_user)):
    _ = await _get_open_block(user["user_id"], block_id)
    if abs((payload.pct_parent1 + payload.pct_parent2) - 100.0) > 0.1:
        raise HTTPException(status_code=400, detail="Le percentuali devono sommare a 100%")
    if payload.paid_by not in ("parent1", "parent2"):
        raise HTTPException(status_code=400, detail="paid_by non valido")
    expense = payload.dict()
    expense["expense_id"] = f"exp_{uuid.uuid4().hex[:12]}"
    expense["created_at"] = datetime.now(timezone.utc).isoformat()
    await db.blocks.update_one(
        {"user_id": user["user_id"], "block_id": block_id},
        {"$push": {"expenses": expense}},
    )
    return {"expense_id": expense["expense_id"]}


@api.put("/blocks/{block_id}/expenses/{expense_id}")
async def update_expense(
    block_id: str,
    expense_id: str,
    payload: ExpenseIn,
    user=Depends(get_current_user),
):
    _ = await _get_open_block(user["user_id"], block_id)
    if abs((payload.pct_parent1 + payload.pct_parent2) - 100.0) > 0.1:
        raise HTTPException(status_code=400, detail="Le percentuali devono sommare a 100%")
    update_fields = {f"expenses.$.{k}": v for k, v in payload.dict().items()}
    res = await db.blocks.update_one(
        {
            "user_id": user["user_id"],
            "block_id": block_id,
            "expenses.expense_id": expense_id,
        },
        {"$set": update_fields},
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    return {"ok": True}


@api.delete("/blocks/{block_id}/expenses/{expense_id}")
async def delete_expense(
    block_id: str, expense_id: str, user=Depends(get_current_user)
):
    _ = await _get_open_block(user["user_id"], block_id)
    res = await db.blocks.update_one(
        {"user_id": user["user_id"], "block_id": block_id},
        {"$pull": {"expenses": {"expense_id": expense_id}}},
    )
    if res.modified_count == 0:
        raise HTTPException(status_code=404, detail="Spesa non trovata")
    return {"ok": True}


# ---------------------------- Report + Close + Email ----------------------------
def _format_money(v: float) -> str:
    return f"€ {v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")


def _build_report_html(cfg: Dict[str, Any], blk: Dict[str, Any], totals: Dict[str, Any]) -> str:
    p1 = escape(cfg["parent1_name"])
    p2 = escape(cfg["parent2_name"])
    rows = ""
    for i, e in enumerate(blk["expenses"], 1):
        paid_name = p1 if e.get("paid_by") == "parent1" else p2
        att = "Sì" if e.get("attachment_data") else "No"
        rows += (
            f"<tr><td>{i}</td>"
            f"<td>{escape(e.get('date',''))}</td>"
            f"<td>{escape(e.get('description',''))}</td>"
            f"<td style='text-align:right'>{_format_money(float(e.get('amount',0)))}</td>"
            f"<td>{escape(paid_name)}</td>"
            f"<td style='text-align:right'>{e.get('pct_parent1',0):.0f}%</td>"
            f"<td style='text-align:right'>{e.get('pct_parent2',0):.0f}%</td>"
            f"<td>{att}</td></tr>"
        )
    saldo = totals["saldo"]
    if saldo > 0.009:
        saldo_text = f"{p2} deve a {p1}: <strong>{_format_money(saldo)}</strong>"
    elif saldo < -0.009:
        saldo_text = f"{p1} deve a {p2}: <strong>{_format_money(abs(saldo))}</strong>"
    else:
        saldo_text = "Nessun saldo dovuto"
    bonifico = blk.get("bonifico")
    bonifico_html = ""
    if bonifico:
        bonifico_html = (
            f"<h3>Bonifico di saldo</h3>"
            f"<p>Data: {escape(bonifico.get('bonifico_date',''))}<br>"
            f"Importo: {_format_money(float(bonifico.get('bonifico_amount',0)))}<br>"
            f"Direzione: {escape(bonifico.get('bonifico_direction',''))}<br>"
            f"Note: {escape(bonifico.get('bonifico_note') or '')}</p>"
        )
    html = f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{escape(blk['label'])}</title>
<style>
body{{font-family:Arial,sans-serif;color:#1A1C1A;padding:24px;background:#FDFBF7}}
h1{{color:#5B8266;margin:0 0 8px 0}}
table{{width:100%;border-collapse:collapse;margin-top:16px;font-size:13px}}
th,td{{border:1px solid #D1C9BC;padding:6px 8px;text-align:left}}
th{{background:#E4EDE5}}
.summary{{margin-top:24px;padding:16px;background:#FFFFFF;border:1px solid #E8E2D9;border-radius:12px}}
.saldo{{font-size:18px;margin-top:12px;color:#5B8266}}
</style></head>
<body>
<h1>{escape(blk['label'])}</h1>
<p><strong>Genitore 1:</strong> {p1} &nbsp;|&nbsp; <strong>Genitore 2:</strong> {p2}</p>
<table>
<thead><tr><th>#</th><th>Data</th><th>Descrizione</th><th>Importo</th><th>Pagato da</th><th>% {p1}</th><th>% {p2}</th><th>Allegato</th></tr></thead>
<tbody>{rows or '<tr><td colspan="8">Nessuna spesa</td></tr>'}</tbody>
</table>
<div class="summary">
<p><strong>Totale spese:</strong> {_format_money(totals['total'])}</p>
<p><strong>Quota {p1}:</strong> {_format_money(totals['quota_parent1'])} &nbsp;|&nbsp; <strong>Quota {p2}:</strong> {_format_money(totals['quota_parent2'])}</p>
<p><strong>Pagato da {p1}:</strong> {_format_money(totals['paid_parent1'])} &nbsp;|&nbsp; <strong>Pagato da {p2}:</strong> {_format_money(totals['paid_parent2'])}</p>
<p class="saldo">{saldo_text}</p>
</div>
{bonifico_html}
</body></html>"""
    return html


def _safe_filename(name: str) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", name)
    return name[:80] or "file"


def _build_zip(cfg: Dict[str, Any], blk: Dict[str, Any], totals: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        html = _build_report_html(cfg, blk, totals)
        zf.writestr("report.html", html)
        for i, e in enumerate(blk.get("expenses", []), 1):
            if e.get("attachment_data"):
                try:
                    raw = base64.b64decode(e["attachment_data"])
                    ext = ""
                    name = e.get("attachment_name") or ""
                    if "." in name:
                        ext = "." + name.rsplit(".", 1)[-1].lower()
                    elif e.get("attachment_mime", "").startswith("image/"):
                        ext = "." + e["attachment_mime"].split("/")[-1]
                    elif e.get("attachment_mime") == "application/pdf":
                        ext = ".pdf"
                    filename = f"allegati/{i:02d}_{_safe_filename(e.get('description','spesa'))}{ext}"
                    zf.writestr(filename, raw)
                except Exception as ex:
                    logger.warning(f"attach skip: {ex}")
    buf.seek(0)
    return buf.read()


def _email_body(cfg: Dict[str, Any], blk: Dict[str, Any], totals: Dict[str, Any]) -> str:
    p1 = escape(cfg["parent1_name"])
    p2 = escape(cfg["parent2_name"])
    saldo = totals["saldo"]
    if saldo > 0.009:
        saldo_text = f"{p2} deve a {p1}: <strong>{_format_money(saldo)}</strong>"
    elif saldo < -0.009:
        saldo_text = f"{p1} deve a {p2}: <strong>{_format_money(abs(saldo))}</strong>"
    else:
        saldo_text = "Nessun saldo dovuto"
    bon = blk.get("bonifico") or {}
    bon_html = ""
    if bon:
        bon_html = (
            f"<p><strong>Bonifico di saldo</strong><br>"
            f"Data: {escape(bon.get('bonifico_date',''))}<br>"
            f"Importo: {_format_money(float(bon.get('bonifico_amount',0)))}<br>"
            f"Note: {escape(bon.get('bonifico_note') or '-')}</p>"
        )
    return f"""<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif;background:#FDFBF7">
<h2 style="color:#5B8266;margin:0 0 12px 0">{escape(blk['label'])}</h2>
<p>In allegato trovi il riepilogo completo delle spese extra del mese in formato ZIP (report + eventuali scontrini).</p>
<p><strong>Totale spese:</strong> {_format_money(totals['total'])}<br>
<strong>Quota {p1}:</strong> {_format_money(totals['quota_parent1'])}<br>
<strong>Quota {p2}:</strong> {_format_money(totals['quota_parent2'])}</p>
<p>{saldo_text}</p>
{bon_html}
<p style="font-size:12px;color:#737A74;margin-top:24px">Inviato da {escape(EMAIL_FROM_NAME)}. Non chiederemo mai password o dati di pagamento via email.</p>
</td></tr></table>"""


@api.post("/blocks/{block_id}/close")
async def close_block(block_id: str, payload: CloseBlockIn, user=Depends(get_current_user)):
    cfg = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=400, detail="Configurazione mancante")
    blk = await db.blocks.find_one(
        {"user_id": user["user_id"], "block_id": block_id}, {"_id": 0}
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    if blk.get("status") == "closed":
        raise HTTPException(status_code=400, detail="Blocco già chiuso")

    totals = _compute_totals(blk.get("expenses", []), cfg.get("default_pct_parent1", 50.0))
    bonifico = payload.dict()
    blk["bonifico"] = bonifico

    zip_bytes = _build_zip(cfg, blk, totals)
    zip_b64 = base64.b64encode(zip_bytes).decode("ascii")
    subject = blk["label"]
    html = _email_body(cfg, blk, totals)
    recipients = [cfg["parent1_email"], cfg["parent2_email"]]
    zip_name = _safe_filename(blk["label"]).replace(" ", "_") + ".zip"

    await send_email(
        to_list=recipients,
        subject=subject,
        html=html,
        attachments=[{"filename": zip_name, "content": zip_b64}],
    )

    await db.blocks.update_one(
        {"user_id": user["user_id"], "block_id": block_id},
        {
            "$set": {
                "status": "closed",
                "closed_at": datetime.now(timezone.utc),
                "bonifico": bonifico,
                "email_sent_at": datetime.now(timezone.utc),
            }
        },
    )
    return {"ok": True}


@api.post("/blocks/{block_id}/resend-email")
async def resend_email_block(block_id: str, user=Depends(get_current_user)):
    cfg = await db.configs.find_one({"user_id": user["user_id"]}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=400, detail="Configurazione mancante")
    blk = await db.blocks.find_one(
        {"user_id": user["user_id"], "block_id": block_id}, {"_id": 0}
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Blocco non trovato")
    totals = _compute_totals(blk.get("expenses", []), cfg.get("default_pct_parent1", 50.0))
    zip_bytes = _build_zip(cfg, blk, totals)
    zip_b64 = base64.b64encode(zip_bytes).decode("ascii")
    subject = blk["label"]
    html = _email_body(cfg, blk, totals)
    zip_name = _safe_filename(blk["label"]).replace(" ", "_") + ".zip"
    await send_email(
        to_list=[cfg["parent1_email"]],
        subject=subject,
        html=html,
        attachments=[{"filename": zip_name, "content": zip_b64}],
    )
    return {"ok": True}


# ---------------------------- Startup ----------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.blocks.create_index([("user_id", 1), ("year", -1), ("month", -1)])


@app.on_event("shutdown")
async def shutdown():
    client.close()


@api.get("/")
async def root():
    return {"ok": True, "app": "Quota"}


app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

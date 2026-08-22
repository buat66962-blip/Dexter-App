import asyncio
import logging
import os
from datetime import timedelta
from typing import List, Optional

from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

import auth as auth_module
import services as svc
from core import audit, db, env, is_valid_oid, now_utc, oid, ser
from providers import telegram

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger("server")

app = FastAPI(title="Office Inventory Rental")
api = APIRouter(prefix="/api")
api.include_router(auth_module.router)

CurrentUser = Depends(auth_module.get_current_user)
AdminUser = Depends(auth_module.require_admin)


# --------------------------------------------------------------------- schemas
class ItemInput(BaseModel):
    name: str
    category: str
    item_code: str
    photo: Optional[str] = None
    condition: str = "BAIK"
    location: str = "Gudang Utama"
    notes: Optional[str] = None
    status: str = "AVAILABLE"


class BookingInput(BaseModel):
    item_ids: List[str]
    start_time: str
    end_time: str
    purpose: str


class ReturnInput(BaseModel):
    condition: str
    notes: Optional[str] = ""
    photo: Optional[str] = None


class RejectInput(BaseModel):
    reason: Optional[str] = ""


class ExtendInput(BaseModel):
    minutes: int = 60


class SettingsInput(BaseModel):
    buffer_before_minutes: int
    buffer_after_minutes: int


class TelegramLinkInput(BaseModel):
    telegram_id: str


class ProfileInput(BaseModel):
    whatsapp_number: Optional[str] = None
    phone: Optional[str] = None


# ----------------------------------------------------------------------- items
@api.get("/items")
async def list_items(q: str = "", category: str = "", start_time: str = "", end_time: str = "", user=CurrentUser):
    query = {}
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"item_code": {"$regex": q, "$options": "i"}}]
    if category:
        query["category"] = category
    items = [ser(i) async for i in db.items.find(query).sort("name", 1)]
    if start_time and end_time:
        conflicts = await svc.items_conflicting(
            [i["id"] for i in items], svc.parse_dt(start_time), svc.parse_dt(end_time)
        )
        for i in items:
            i["available_in_window"] = i["id"] not in conflicts and i["status"] != "MAINTENANCE"
    return items


@api.get("/items/{item_id}")
async def get_item(item_id: str, user=CurrentUser):
    if not is_valid_oid(item_id):
        raise HTTPException(404, "Barang tidak ditemukan")
    item = await db.items.find_one({"_id": oid(item_id)})
    if not item:
        raise HTTPException(404, "Barang tidak ditemukan")
    data = ser(item)
    schedule = []
    async for b in db.bookings.find({"item_ids": item_id, "status": {"$in": svc.BLOCKING_STATUSES}}).sort("start_time", 1):
        schedule.append({"booking_id": str(b["_id"]), "code": b["code"], "user_name": b["user_name"],
                         "start_time": svc.parse_dt(b["start_time"]).isoformat(),
                         "end_time": svc.parse_dt(b["end_time"]).isoformat(), "status": b["status"]})
    data["schedule"] = schedule
    return data


@api.post("/items")
async def create_item(payload: ItemInput, admin=AdminUser):
    doc = payload.model_dump()
    doc["created_at"] = now_utc()
    res = await db.items.insert_one(doc)
    await audit("ITEM_CREATED", admin["id"], metadata={"item": payload.name})
    doc["_id"] = res.inserted_id
    return ser(doc)


@api.put("/items/{item_id}")
async def update_item(item_id: str, payload: ItemInput, admin=AdminUser):
    if not is_valid_oid(item_id):
        raise HTTPException(404, "Barang tidak ditemukan")
    await db.items.update_one({"_id": oid(item_id)}, {"$set": payload.model_dump()})
    await audit("ITEM_UPDATED", admin["id"], metadata={"item_id": item_id})
    return ser(await db.items.find_one({"_id": oid(item_id)}))


@api.delete("/items/{item_id}")
async def delete_item(item_id: str, admin=AdminUser):
    if not is_valid_oid(item_id):
        raise HTTPException(404, "Barang tidak ditemukan")
    active = await db.bookings.find_one({"item_ids": item_id, "status": {"$in": svc.BLOCKING_STATUSES}})
    if active:
        raise HTTPException(400, "Barang masih punya booking aktif")
    await db.items.delete_one({"_id": oid(item_id)})
    await audit("ITEM_DELETED", admin["id"], metadata={"item_id": item_id})
    return {"ok": True}


# -------------------------------------------------------------------- bookings
async def _next_code() -> str:
    count = await db.bookings.count_documents({})
    return f"{124 + count:05d}"


@api.post("/bookings")
async def create_booking(payload: BookingInput, user=CurrentUser):
    if not payload.item_ids:
        raise HTTPException(400, "Pilih minimal satu barang")
    start, end = svc.parse_dt(payload.start_time), svc.parse_dt(payload.end_time)
    if end <= start:
        raise HTTPException(400, "Waktu selesai harus setelah waktu mulai")
    for item_id in payload.item_ids:
        if not is_valid_oid(item_id):
            raise HTTPException(400, "Barang tidak valid")
        item = await db.items.find_one({"_id": oid(item_id)})
        if not item:
            raise HTTPException(404, "Barang tidak ditemukan")
        if item["status"] == "MAINTENANCE":
            raise HTTPException(400, f"{item['name']} sedang maintenance")
    conflicts = await svc.items_conflicting(payload.item_ids, start, end)
    if conflicts:
        names = [ser(i)["name"] async for i in db.items.find({"_id": {"$in": [oid(c) for c in conflicts]}})]
        raise HTTPException(400, f"Barang tidak tersedia pada waktu tersebut: {', '.join(names)}")
    own = await db.bookings.find_one({
        "user_id": user["id"], "status": {"$in": svc.BLOCKING_STATUSES},
        "start_time": {"$lt": end}, "end_time": {"$gt": start},
    })
    if own:
        raise HTTPException(400, "Kamu sudah punya booking aktif di waktu yang sama")
    doc = {
        "code": await _next_code(),
        "user_id": user["id"],
        "user_name": user["name"],
        "item_ids": payload.item_ids,
        "start_time": start,
        "end_time": end,
        "purpose": payload.purpose,
        "status": svc.STATUS_PENDING,
        "approved_by": None,
        "created_at": now_utc(),
    }
    res = await db.bookings.insert_one(doc)
    doc["_id"] = res.inserted_id
    bid = str(res.inserted_id)
    items = [ser(i) async for i in db.items.find({"_id": {"$in": [oid(i) for i in payload.item_ids]}})]
    await db.items.update_many({"_id": {"$in": [oid(i) for i in payload.item_ids]}}, {"$set": {"status": "BOOKED"}})
    await audit("BOOKING_CREATED", user["id"], bid, {"items": [i["name"] for i in items]})
    item_lines = "\n".join(f"📦 {i['name']} ({i['item_code']})" for i in items)
    await svc.notify_admin("BOOKING_CREATED", (
        f"🔔 <b>BOOKING BARU</b>\n\n👤 {user['name']}\n{item_lines}\n"
        f"⏰ {svc.fmt(start)} - {svc.fmt(end)}\n📝 {payload.purpose}"
    ), bid, buttons=[[
        {"text": "✅ APPROVE", "callback_data": f"approve:{bid}"},
        {"text": "❌ REJECT", "callback_data": f"reject:{bid}"},
    ]], whatsapp_text=(
        f"🔔 PEMINJAMAN BARU\n\nPeminjam: {user['name']}\nBarang: {', '.join(i['name'] for i in items)}\n"
        f"Waktu: {svc.fmt(start)} - {svc.fmt(end)}\nStatus: Menunggu approval\n\nCek detail di Telegram Admin."
    ))
    await svc.notify_user(user, "BOOKING_CREATED", f"📝 Booking #{doc['code']} dibuat, menunggu persetujuan admin.", bid)
    return await svc.booking_detail(doc)


@api.get("/bookings")
async def my_bookings(user=CurrentUser):
    out = []
    async for b in db.bookings.find({"user_id": user["id"]}).sort("created_at", -1):
        out.append(await svc.booking_detail(b))
    return out


@api.get("/bookings/{booking_id}")
async def get_booking(booking_id: str, user=CurrentUser):
    if not is_valid_oid(booking_id):
        raise HTTPException(404, "Booking tidak ditemukan")
    b = await db.bookings.find_one({"_id": oid(booking_id)})
    if not b:
        raise HTTPException(404, "Booking tidak ditemukan")
    if b["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Tidak boleh melihat booking orang lain")
    data = await svc.booking_detail(b)
    if b["status"] == svc.STATUS_PENDING and data.get("access"):
        data["access"] = None
    return data


async def _load_booking(booking_id: str, user: dict, admin_only=False):
    if not is_valid_oid(booking_id):
        raise HTTPException(404, "Booking tidak ditemukan")
    b = await db.bookings.find_one({"_id": oid(booking_id)})
    if not b:
        raise HTTPException(404, "Booking tidak ditemukan")
    if admin_only and user["role"] != "admin":
        raise HTTPException(403, "Hanya admin")
    if not admin_only and b["user_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Bukan booking kamu")
    return b


@api.post("/bookings/{booking_id}/cancel")
async def cancel(booking_id: str, user=CurrentUser):
    b = await _load_booking(booking_id, user)
    try:
        return await svc.cancel_booking(b, user["name"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/bookings/{booking_id}/return")
async def return_request(booking_id: str, payload: ReturnInput, user=CurrentUser):
    b = await _load_booking(booking_id, user)
    try:
        return await svc.request_return(b, payload.condition, payload.notes or "", payload.photo)
    except ValueError as e:
        raise HTTPException(400, str(e))


# ----------------------------------------------------------------------- admin
@api.get("/admin/bookings")
async def admin_bookings(status: str = "", admin=AdminUser):
    query = {"status": status} if status else {}
    out = []
    async for b in db.bookings.find(query).sort("created_at", -1).limit(200):
        out.append(await svc.booking_detail(b))
    return out


@api.post("/admin/bookings/{booking_id}/approve")
async def approve(booking_id: str, admin=AdminUser):
    b = await _load_booking(booking_id, admin, admin_only=True)
    try:
        return await svc.approve_booking(b, admin["name"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/admin/bookings/{booking_id}/reject")
async def reject(booking_id: str, payload: RejectInput, admin=AdminUser):
    b = await _load_booking(booking_id, admin, admin_only=True)
    try:
        return await svc.reject_booking(b, admin["name"], payload.reason or "")
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/admin/bookings/{booking_id}/extend")
async def extend(booking_id: str, payload: ExtendInput, admin=AdminUser):
    b = await _load_booking(booking_id, admin, admin_only=True)
    try:
        return await svc.extend_booking(b, payload.minutes, admin["name"])
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/admin/bookings/{booking_id}/confirm-return")
async def admin_confirm_return(booking_id: str, damaged: bool = False, admin=AdminUser):
    b = await _load_booking(booking_id, admin, admin_only=True)
    try:
        return await svc.confirm_return(b, admin["name"], damaged)
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/admin/bookings/{booking_id}/regenerate-access")
async def regenerate_access(booking_id: str, admin=AdminUser):
    b = await _load_booking(booking_id, admin, admin_only=True)
    await svc.revoke_access(booking_id)
    cred = await svc.generate_access(b)
    await audit("ACCESS_REGENERATED", admin["id"], booking_id)
    return cred


@api.post("/admin/bookings/{booking_id}/disable-access")
async def disable_access(booking_id: str, admin=AdminUser):
    await _load_booking(booking_id, admin, admin_only=True)
    await svc.revoke_access(booking_id)
    await audit("ACCESS_DISABLED", admin["id"], booking_id)
    return {"ok": True}


@api.get("/admin/stats")
async def stats(admin=AdminUser):
    return {
        "borrowed": await db.bookings.count_documents({"status": svc.STATUS_ACTIVE}),
        "pending": await db.bookings.count_documents({"status": svc.STATUS_PENDING}),
        "approved": await db.bookings.count_documents({"status": svc.STATUS_APPROVED}),
        "available_items": await db.items.count_documents({"status": "AVAILABLE"}),
        "total_items": await db.items.count_documents({}),
        "overdue": await db.bookings.count_documents({"status": svc.STATUS_OVERDUE}),
        "active_access": await db.access_credentials.count_documents({"status": "ACTIVE"}),
        "return_requests": await db.bookings.count_documents({"status": svc.STATUS_RETURN_REQUESTED}),
    }


@api.get("/admin/access-logs")
async def access_logs(admin=AdminUser):
    return [ser(l) async for l in db.access_logs.find().sort("created_at", -1).limit(100)]


@api.get("/admin/audit-logs")
async def audit_logs(admin=AdminUser):
    return [ser(l) async for l in db.audit_logs.find().sort("created_at", -1).limit(100)]


@api.get("/admin/access-credentials")
async def active_access(admin=AdminUser):
    out = []
    async for c in db.access_credentials.find({"status": "ACTIVE"}).sort("valid_until", 1):
        b = await db.bookings.find_one({"_id": oid(c["booking_id"])})
        out.append({**ser(c), "user_name": b["user_name"] if b else None, "booking_code": b["code"] if b else None})
    return out


@api.get("/admin/notifications-log")
async def notifications_log(admin=AdminUser):
    return [ser(n) async for n in db.notifications.find({"channel": {"$ne": "IN_APP"}}).sort("sent_at", -1).limit(100)]


@api.get("/admin/users")
async def list_users(admin=AdminUser):
    return [ser(u) async for u in db.users.find().sort("created_at", -1)]


@api.get("/settings")
async def read_settings(user=CurrentUser):
    return await svc.get_settings()


@api.put("/settings")
async def write_settings(payload: SettingsInput, admin=AdminUser):
    await db.settings.update_one({"key": "global"}, {"$set": payload.model_dump()}, upsert=True)
    await audit("SETTINGS_UPDATED", admin["id"], metadata=payload.model_dump())
    return await svc.get_settings()


@api.get("/doors")
async def list_doors(user=CurrentUser):
    return [ser(d) async for d in db.doors.find()]


# --------------------------------------------------------------- notifications
@api.get("/notifications")
async def my_notifications(user=CurrentUser):
    return [ser(n) async for n in db.notifications.find({"user_id": user["id"], "channel": "IN_APP"}).sort("sent_at", -1).limit(50)]


@api.post("/notifications/read-all")
async def read_all(user=CurrentUser):
    await db.notifications.update_many({"user_id": user["id"]}, {"$set": {"read": True}})
    return {"ok": True}


@api.post("/me/telegram")
async def link_telegram(payload: TelegramLinkInput, user=CurrentUser):
    await db.users.update_one({"_id": oid(user["id"])}, {"$set": {"telegram_id": payload.telegram_id}})
    return ser(await db.users.find_one({"_id": oid(user["id"])}))


@api.put("/me/profile")
async def update_profile(payload: ProfileInput, user=CurrentUser):
    await db.users.update_one({"_id": oid(user["id"])}, {"$set": payload.model_dump()})
    return ser(await db.users.find_one({"_id": oid(user["id"])}))


@api.get("/admin/reports")
async def reports(days: int = 30, admin=AdminUser):
    return await svc.build_report(days)


@api.get("/admin/reports/export")
async def reports_export(days: int = 30, admin=AdminUser):
    rows = await svc.report_csv_rows(days)
    csv = "\n".join(",".join('"' + str(c).replace('"', "'") + '"' for c in r) for r in rows)
    return Response(content=csv, media_type="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=laporan-{days}hari.csv"})


# ------------------------------------------------------------ telegram webhook
@api.post("/telegram/webhook")
async def telegram_webhook(request: Request):
    secret = env("TELEGRAM_WEBHOOK_SECRET")
    if secret and request.headers.get("X-Telegram-Bot-Api-Secret-Token") != secret:
        raise HTTPException(403, "Webhook tidak terverifikasi")
    update = await request.json()
    admin_ids = [i.strip() for i in env("TELEGRAM_ADMIN_CHAT_IDS").split(",") if i.strip()]

    cq = update.get("callback_query")
    if cq:
        chat_id = str(cq["from"]["id"])
        if admin_ids and chat_id not in admin_ids:
            telegram.answer_callback(cq["id"], "Kamu bukan admin terdaftar.")
            return {"ok": True}
        data = cq.get("data", "")
        action, _, bid = data.partition(":")
        if not is_valid_oid(bid):
            telegram.answer_callback(cq["id"], "Booking tidak valid")
            return {"ok": True}
        booking = await db.bookings.find_one({"_id": oid(bid)})
        if not booking:
            telegram.answer_callback(cq["id"], "Booking tidak ditemukan")
            return {"ok": True}
        try:
            if action == "approve":
                await svc.approve_booking(booking, f"telegram:{chat_id}")
                msg = "Booking disetujui"
            elif action == "reject":
                await svc.reject_booking(booking, f"telegram:{chat_id}", "Ditolak via Telegram")
                msg = "Booking ditolak"
            elif action == "return_ok":
                await svc.confirm_return(booking, f"telegram:{chat_id}", False)
                msg = "Pengembalian diterima"
            elif action == "return_check":
                await svc.confirm_return(booking, f"telegram:{chat_id}", True)
                msg = "Ditandai rusak / perlu periksa"
            elif action == "cancel":
                await svc.cancel_booking(booking, f"telegram:{chat_id}")
                msg = "Booking dibatalkan"
            elif action == "extend":
                await svc.extend_booking(booking, 60, f"telegram:{chat_id}")
                msg = "Diperpanjang 60 menit"
            elif action == "access":
                cred = await db.access_credentials.find_one({"booking_id": bid, "status": "ACTIVE"})
                msg = f"Kode: {cred['code']}" if cred else "Tidak ada akses aktif"
            else:
                msg = "Aksi tidak dikenal"
        except ValueError as e:
            msg = str(e)
        telegram.answer_callback(cq["id"], msg)
        telegram.send(chat_id, f"ℹ️ {msg} (Booking #{booking['code']})")
        return {"ok": True}

    message = update.get("message") or {}
    text = (message.get("text") or "").strip().lower()
    chat_id = str(message.get("chat", {}).get("id", ""))
    if not chat_id:
        return {"ok": True}
    if admin_ids and chat_id not in admin_ids:
        telegram.send(chat_id, "🚫 Telegram ID kamu belum terdaftar sebagai admin.")
        return {"ok": True}
    counts = {
        "borrowed": await db.bookings.count_documents({"status": svc.STATUS_ACTIVE}),
        "pending": await db.bookings.count_documents({"status": svc.STATUS_PENDING}),
        "available": await db.items.count_documents({"status": "AVAILABLE"}),
        "overdue": await db.bookings.count_documents({"status": svc.STATUS_OVERDUE}),
        "access": await db.access_credentials.count_documents({"status": "ACTIVE"}),
    }
    if text in ("/start", "/home", "🏠 home", ""):
        telegram.send(chat_id, (
            "🏢 <b>OFFICE INVENTORY</b>\n\n"
            f"🔴 Dipinjam: {counts['borrowed']}\n🟡 Booking: {counts['pending']}\n"
            f"🟢 Tersedia: {counts['available']}\n⚠️ Overdue: {counts['overdue']}\n🔐 Active Access: {counts['access']}\n\n"
            "Perintah: /pending /overdue /akses /barang /laporan"
        ))
    elif text.startswith("/pending"):
        lines = []
        async for b in db.bookings.find({"status": svc.STATUS_PENDING}).limit(10):
            lines.append(f"#{b['code']} — {b['user_name']} ({svc.fmt(svc.parse_dt(b['start_time']))})")
            telegram.send(chat_id, f"🔔 Booking #{b['code']}\n👤 {b['user_name']}\n📝 {b.get('purpose','')}", buttons=[[
                {"text": "✅ APPROVE", "callback_data": f"approve:{str(b['_id'])}"},
                {"text": "❌ REJECT", "callback_data": f"reject:{str(b['_id'])}"},
            ]])
        if not lines:
            telegram.send(chat_id, "Tidak ada booking pending.")
    elif text.startswith("/overdue"):
        lines = [f"#{b['code']} — {b['user_name']}" async for b in db.bookings.find({"status": svc.STATUS_OVERDUE})]
        telegram.send(chat_id, "⚠️ OVERDUE\n" + ("\n".join(lines) if lines else "Tidak ada."))
    elif text.startswith("/akses"):
        lines = [f"{c['code']} — sampai {svc.fmt(svc.parse_dt(c['valid_until']))}" async for c in db.access_credentials.find({"status": "ACTIVE"})]
        telegram.send(chat_id, "🔐 AKSES AKTIF\n" + ("\n".join(lines) if lines else "Tidak ada."))
    elif text.startswith("/barang"):
        lines = [f"{i['name']} — {i['status']}" async for i in db.items.find().limit(20)]
        telegram.send(chat_id, "📦 BARANG\n" + "\n".join(lines))
    elif text.startswith("/laporan"):
        r = await svc.build_report(30)
        top_items = "\n".join(f"{i['name']} — {i['count']}x" for i in r["top_items"][:5]) or "-"
        top_users = "\n".join(f"{u['name']} — {u['count']}x" for u in r["top_users"][:5]) or "-"
        late = "\n".join(f"{u['name']} — {u['count']}x telat" for u in r["late_users"][:5]) or "-"
        telegram.send(chat_id, (
            f"📊 <b>LAPORAN 30 HARI</b>\n\nTotal booking: {r['totals']['bookings']}\n"
            f"Selesai: {r['totals']['returned']} · Overdue: {r['totals']['overdue']}\n\n"
            f"<b>Barang terfavorit</b>\n{top_items}\n\n<b>Peminjam teraktif</b>\n{top_users}\n\n"
            f"<b>Sering terlambat</b>\n{late}"
        ))
    else:
        telegram.send(chat_id, "Perintah tidak dikenal. /home")
    return {"ok": True}


app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[env("FRONTEND_URL", "http://localhost:3000"), "http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


SEED_ITEMS = [
    ("Sony A6400", "Kamera", "CAM-001", "https://images.pexels.com/photos/5875978/pexels-photo-5875978.jpeg"),
    ("Battery Sony NP-FW50", "Aksesoris", "BAT-003", "https://images.pexels.com/photos/10668297/pexels-photo-10668297.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Tripod Manfrotto", "Aksesoris", "TRI-002", "https://images.unsplash.com/photo-1612548403247-aa2873e9422d?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("MacBook Pro 14", "Laptop", "LAP-001", "https://images.pexels.com/photos/880989/pexels-photo-880989.jpeg"),
    ("Proyektor Epson EB-X51", "Proyektor", "PRJ-001", "https://images.pexels.com/photos/8761334/pexels-photo-8761334.jpeg"),
    ("Rode Wireless Go II", "Audio", "AUD-002", "https://images.unsplash.com/photo-1702360174953-b9d72d5ddba2?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2OTV8MHwxfHNlYXJjaHw0fHxtb2Rlcm4lMjBtaW5pbWFsJTIwb2ZmaWNlJTIwZGFya3xlbnwwfHx8fDE3ODczOTk3Nzl8MA&ixlib=rb-4.1.0&q=85"),
    ("Lighting Godox SL60", "Lighting", "LGT-001", "https://images.pexels.com/photos/25526512/pexels-photo-25526512.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("iPad Pro 11", "Tablet", "TAB-001", "https://images.unsplash.com/photo-1600484269056-a17ecd3cfb1f?crop=entropy&cs=srgb&fm=jpg&q=85"),
]


async def seed_data():
    await auth_module.seed_users()
    if await db.items.count_documents({}) == 0:
        await db.items.insert_many([{
            "name": n, "category": c, "item_code": code, "photo": photo,
            "status": "AVAILABLE", "condition": "BAIK", "location": "Gudang Utama",
            "notes": None, "created_at": now_utc(),
        } for n, c, code, photo in SEED_ITEMS])
    if await db.doors.count_documents({}) == 0:
        await db.doors.insert_one({
            "name": "Gudang Utama", "provider": "bardi", "device_id": env("TUYA_DEVICE_ID", "demo-device"),
            "location": "Lantai 1", "status": "ONLINE",
        })
    await svc.get_settings()


async def scheduler_loop():
    while True:
        try:
            await svc.run_scheduler_once()
        except Exception as e:
            logger.exception("scheduler error: %s", e)
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup():
    await seed_data()
    asyncio.create_task(scheduler_loop())


@app.on_event("shutdown")
async def shutdown():
    pass

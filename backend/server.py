import asyncio
import logging
import os
from datetime import timedelta
from typing import List, Optional

from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import APIRouter, Depends, FastAPI, File, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel
from starlette.middleware.cors import CORSMiddleware

import auth as auth_module
import services as svc
import storage
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
    location: str = "Storage Utama"
    notes: Optional[str] = None
    status: str = "AVAILABLE"
    quantity: int = 1


class BookingLine(BaseModel):
    item_id: str
    qty: int = 1


class BookingInput(BaseModel):
    lines: List[BookingLine]
    pickup_date: str
    return_date: str
    pickup_time: str = "08:00"
    return_time: str = "17:00"
    purpose: str
    location: Optional[str] = ""


class ChecklistInput(BaseModel):
    item_id: str
    checked: bool = True


class TemplateInput(BaseModel):
    name: str
    lines: List[BookingLine]
    is_shared: bool = False


class CategoryInput(BaseModel):
    name: str


class CategoryRenameInput(BaseModel):
    new_name: str


class HandoverInput(BaseModel):
    phase: str  # "pickup" | "return"
    photos: List[str]
    notes: Optional[str] = ""


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
    phone: Optional[str] = None


# ----------------------------------------------------------------------- items
@api.get("/items")
async def list_items(q: str = "", category: str = "", start_time: str = "", end_time: str = "", user=CurrentUser):
    query = {}
    if q:
        query["$or"] = [{"name": {"$regex": q, "$options": "i"}}, {"item_code": {"$regex": q, "$options": "i"}}]
    if category:
        query["category"] = category
    docs = [i async for i in db.items.find(query).sort([("category", 1), ("name", 1)])]
    items = []
    win = None
    if start_time and end_time:
        win = (svc.parse_dt(start_time), svc.parse_dt(end_time))
    for doc in docs:
        data = ser(doc)
        data["quantity"] = int(doc.get("quantity", 1))
        if win:
            data["available_qty"] = await svc.available_qty(doc, win[0], win[1])
        else:
            data["available_qty"] = 0 if doc.get("status") == "MAINTENANCE" else data["quantity"]
        items.append(data)
    return items


@api.get("/items/{item_id}")
async def get_item(item_id: str, user=CurrentUser):
    if not is_valid_oid(item_id):
        raise HTTPException(404, "Barang tidak ditemukan")
    item = await db.items.find_one({"_id": oid(item_id)})
    if not item:
        raise HTTPException(404, "Barang tidak ditemukan")
    data = ser(item)
    data["quantity"] = int(item.get("quantity", 1))
    schedule = []
    async for b in db.bookings.find({"item_ids": item_id, "status": {"$in": svc.BLOCKING_STATUSES}}).sort("start_time", 1):
        qty = sum(int(l.get("qty", 1)) for l in b.get("lines", []) if l["item_id"] == item_id)
        schedule.append({"booking_id": str(b["_id"]), "code": b["code"], "user_name": b["user_name"],
                         "qty": qty,
                         "start_time": svc.parse_dt(b["start_time"]).isoformat(),
                         "end_time": svc.parse_dt(b["end_time"]).isoformat(), "status": b["status"]})
    data["schedule"] = schedule
    history = []
    async for b in db.bookings.find({
        "item_ids": item_id, "status": {"$in": [svc.STATUS_RETURNED, svc.STATUS_CANCELLED, svc.STATUS_REJECTED]},
    }).sort("created_at", -1).limit(15):
        history.append({
            "booking_id": str(b["_id"]), "code": b["code"], "user_name": b["user_name"],
            "start_time": svc.parse_dt(b["start_time"]).isoformat(),
            "end_time": svc.parse_dt(b["end_time"]).isoformat(),
            "status": b["status"], "purpose": b.get("purpose"),
            "returned_at": svc.parse_dt(b["returned_at"]).isoformat() if b.get("returned_at") else None,
            "return_condition": b.get("return_condition"),
        })
    data["history"] = history
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
    if not payload.lines:
        raise HTTPException(400, "Keranjang masih kosong")
    try:
        start = svc.parse_dt(f"{payload.pickup_date}T{payload.pickup_time}:00+07:00")
    except ValueError:
        raise HTTPException(400, "Tanggal/jam pengambilan tidak valid")
    try:
        end = svc.parse_dt(f"{payload.return_date}T{payload.return_time}:00+07:00")
    except ValueError:
        raise HTTPException(400, "Tanggal/jam pengembalian tidak valid")
    if end <= start:
        raise HTTPException(400, "Waktu pengembalian harus setelah waktu pengambilan")
    duration_hours = int((end - start).total_seconds() // 3600)

    lines = []
    for line in payload.lines:
        if not is_valid_oid(line.item_id):
            raise HTTPException(400, "Barang tidak valid")
        item = await db.items.find_one({"_id": oid(line.item_id)})
        if not item:
            raise HTTPException(404, "Barang tidak ditemukan")
        if item.get("status") == "MAINTENANCE":
            raise HTTPException(400, f"{item['name']} sedang maintenance")
        if line.qty < 1:
            raise HTTPException(400, f"Jumlah {item['name']} minimal 1")
        tersedia = await svc.available_qty(item, start, end)
        if tersedia < line.qty:
            raise HTTPException(400, f"{item['name']} hanya tersedia {tersedia} pcs pada waktu tersebut")
        lines.append({
            "item_id": line.item_id, "name": item["name"], "item_code": item.get("item_code"),
            "category": item.get("category"), "qty": line.qty,
        })

    doc = {
        "code": await _next_code(),
        "user_id": user["id"],
        "user_name": user["name"],
        "lines": lines,
        "item_ids": [l["item_id"] for l in lines],
        "start_time": start,
        "end_time": end,
        "pickup_date": payload.pickup_date,
        "return_date": payload.return_date,
        "pickup_time": payload.pickup_time,
        "return_time": payload.return_time,
        "duration_days": max(1, round(duration_hours / 24) or 1),
        "duration_hours": duration_hours,
        "purpose": payload.purpose,
        "location": payload.location or "",
        "status": svc.STATUS_PENDING,
        "approved_by": None,
        "checklist": [],
        "pickup_photos": [],
        "return_photos": [],
        "created_at": now_utc(),
    }
    res = await db.bookings.insert_one(doc)
    doc["_id"] = res.inserted_id
    bid = str(res.inserted_id)
    await audit("BOOKING_CREATED", user["id"], bid, {"items": [l["name"] for l in lines]})

    by_cat = {}
    for l in lines:
        by_cat.setdefault(l["category"] or "Lainnya", []).append(f"• {l['name']} ({l['qty']} pcs)")
    item_text = "\n".join(f"<b>{c}</b>\n" + "\n".join(rows) for c, rows in by_cat.items())
    durasi = "hari yang sama" if payload.pickup_date == payload.return_date else f"{doc['duration_days']} hari"
    await svc.notify_admin("BOOKING_CREATED", (
        f"🔔 <b>BOOKING BARU</b>\n\n👤 {user['name']}\n"
        f"📅 Ambil: {payload.pickup_date} {payload.pickup_time}\n↩️ Kembali: {payload.return_date} {payload.return_time} ({durasi})\n"
        f"🎬 Acara: {payload.purpose}\n\n{item_text}"
    ), bid, buttons=[[
        {"text": "✅ APPROVE", "callback_data": f"approve:{bid}"},
        {"text": "❌ REJECT", "callback_data": f"reject:{bid}"},
    ]])
    await svc.notify_user(user, "BOOKING_CREATED",
                          f"📝 Booking #{doc['code']} dibuat ({sum(l['qty'] for l in lines)} pcs), menunggu persetujuan admin.", bid)
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
        data["access_codes"] = []
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


@api.post("/bookings/{booking_id}/checklist")
async def update_checklist(booking_id: str, payload: ChecklistInput, user=CurrentUser):
    b = await _load_booking(booking_id, user)
    try:
        return await svc.toggle_checklist(b, payload.item_id, payload.checked)
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/bookings/{booking_id}/return")
async def return_request(booking_id: str, payload: ReturnInput, user=CurrentUser):
    b = await _load_booking(booking_id, user)
    try:
        return await svc.request_return(b, payload.condition, payload.notes or "", payload.photo)
    except ValueError as e:
        raise HTTPException(400, str(e))


@api.post("/uploads")
async def upload_photo(file: UploadFile = File(...), user=CurrentUser):
    data = await file.read()
    if len(data) > 8 * 1024 * 1024:
        raise HTTPException(400, "Foto maksimal 8 MB")
    path, mime = storage.build_path(user["id"], file.filename or "foto.jpg")
    content_type = file.content_type if (file.content_type or "").startswith("image/") else mime
    try:
        result = storage.put_object(path, data, content_type)
    except Exception as e:
        logger.warning("upload gagal: %s", e)
        raise HTTPException(502, "Upload foto gagal, coba lagi")
    await db.files.insert_one({
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(data)),
        "user_id": user["id"],
        "is_deleted": False,
        "created_at": now_utc(),
    })
    return {"path": result["path"], "url": f"/api/files/{result['path']}"}


@api.get("/files/{path:path}")
async def download_file(path: str, user=CurrentUser):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(404, "File tidak ditemukan")
    data, content_type = storage.get_object(path)
    return Response(content=data, media_type=record.get("content_type", content_type))


@api.post("/bookings/{booking_id}/handover")
async def handover(booking_id: str, payload: HandoverInput, user=CurrentUser):
    b = await _load_booking(booking_id, user)
    if payload.phase not in ("pickup", "return"):
        raise HTTPException(400, "Fase harus pickup atau return")
    if len(payload.photos) > 5:
        raise HTTPException(400, "Maksimal 5 foto per fase")
    field = "pickup_photos" if payload.phase == "pickup" else "return_photos"
    if payload.phase == "pickup" and b["status"] not in (svc.STATUS_APPROVED, svc.STATUS_ACTIVE, svc.STATUS_OVERDUE):
        raise HTTPException(400, "Foto pengambilan hanya untuk order yang sudah disetujui")
    if payload.phase == "return" and not svc.return_day_reached(b):
        raise HTTPException(400, "Foto pengembalian baru bisa diunggah pada hari pengembalian")
    await db.bookings.update_one({"_id": b["_id"]}, {"$set": {
        field: payload.photos,
        f"{field}_notes": payload.notes or "",
        f"{field}_at": now_utc(),
    }})
    await audit(f"HANDOVER_{payload.phase.upper()}", user["id"], booking_id, {"count": len(payload.photos)})
    return await svc.booking_detail(await db.bookings.find_one({"_id": b["_id"]}))


@api.get("/templates")
async def list_templates(user=CurrentUser):
    out = []
    async for t in db.templates.find({"$or": [{"owner_id": user["id"]}, {"is_shared": True}]}).sort("created_at", -1):
        out.append(ser(t))
    return out


@api.post("/templates")
async def create_template(payload: TemplateInput, user=CurrentUser):
    if not payload.lines:
        raise HTTPException(400, "Template harus punya minimal satu alat")
    lines = []
    for line in payload.lines:
        if not is_valid_oid(line.item_id):
            raise HTTPException(400, "Barang tidak valid")
        item = await db.items.find_one({"_id": oid(line.item_id)})
        if not item:
            raise HTTPException(404, "Barang tidak ditemukan")
        lines.append({
            "item_id": line.item_id, "name": item["name"], "item_code": item.get("item_code"),
            "category": item.get("category"), "qty": max(1, line.qty), "photo": item.get("photo"),
            "max": int(item.get("quantity", 1)),
        })
    doc = {
        "name": payload.name.strip() or "Paket Tanpa Nama",
        "owner_id": user["id"],
        "owner_name": user["name"],
        "is_shared": payload.is_shared,
        "lines": lines,
        "created_at": now_utc(),
    }
    res = await db.templates.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit("TEMPLATE_CREATED", user["id"], metadata={"name": doc["name"]})
    return ser(doc)


@api.put("/templates/{template_id}")
async def update_template(template_id: str, payload: TemplateInput, user=CurrentUser):
    if not is_valid_oid(template_id):
        raise HTTPException(404, "Template tidak ditemukan")
    t = await db.templates.find_one({"_id": oid(template_id)})
    if not t:
        raise HTTPException(404, "Template tidak ditemukan")
    if t["owner_id"] != user["id"] and user["role"] != "admin" and not t.get("is_shared"):
        raise HTTPException(403, "Bukan template kamu")
    if not payload.lines:
        raise HTTPException(400, "Template harus punya minimal satu alat")
    lines = []
    for line in payload.lines:
        if not is_valid_oid(line.item_id):
            raise HTTPException(400, "Barang tidak valid")
        item = await db.items.find_one({"_id": oid(line.item_id)})
        if not item:
            raise HTTPException(404, "Barang tidak ditemukan")
        lines.append({
            "item_id": line.item_id, "name": item["name"], "item_code": item.get("item_code"),
            "category": item.get("category"), "qty": max(1, line.qty), "photo": item.get("photo"),
            "max": int(item.get("quantity", 1)),
        })
    await db.templates.update_one({"_id": oid(template_id)}, {"$set": {
        "name": payload.name.strip() or t["name"], "lines": lines,
        "is_shared": payload.is_shared, "updated_at": now_utc(),
    }})
    await audit("TEMPLATE_UPDATED", user["id"], metadata={"template_id": template_id})
    return ser(await db.templates.find_one({"_id": oid(template_id)}))


@api.delete("/templates/{template_id}")
async def delete_template(template_id: str, user=CurrentUser):
    if not is_valid_oid(template_id):
        raise HTTPException(404, "Template tidak ditemukan")
    t = await db.templates.find_one({"_id": oid(template_id)})
    if not t:
        raise HTTPException(404, "Template tidak ditemukan")
    if t["owner_id"] != user["id"] and user["role"] != "admin":
        raise HTTPException(403, "Bukan template kamu")
    await db.templates.delete_one({"_id": oid(template_id)})
    return {"ok": True}


@api.get("/categories")
async def list_categories(user=CurrentUser):
    counts = {}
    async for item in db.items.find({}, {"category": 1, "quantity": 1}):
        cat = item.get("category") or "Lainnya"
        entry = counts.setdefault(cat, {"name": cat, "item_count": 0, "total_qty": 0})
        entry["item_count"] += 1
        entry["total_qty"] += int(item.get("quantity", 1))
    async for c in db.categories.find():
        counts.setdefault(c["name"], {"name": c["name"], "item_count": 0, "total_qty": 0})
    return sorted(counts.values(), key=lambda c: c["name"])


@api.post("/categories")
async def create_category(payload: CategoryInput, admin=AdminUser):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Nama kategori tidak boleh kosong")
    if await db.categories.find_one({"name": name}) or await db.items.find_one({"category": name}):
        raise HTTPException(400, "Kategori sudah ada")
    await db.categories.insert_one({"name": name, "created_at": now_utc()})
    await audit("CATEGORY_CREATED", admin["id"], metadata={"name": name})
    return {"name": name, "item_count": 0, "total_qty": 0}


@api.put("/categories/{name}")
async def rename_category(name: str, payload: CategoryRenameInput, admin=AdminUser):
    new_name = payload.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Nama kategori baru tidak boleh kosong")
    if new_name != name and (await db.categories.find_one({"name": new_name}) or await db.items.find_one({"category": new_name})):
        raise HTTPException(400, "Kategori tujuan sudah ada")
    await db.items.update_many({"category": name}, {"$set": {"category": new_name}})
    await db.categories.update_one({"name": name}, {"$set": {"name": new_name}}, upsert=True)
    await db.templates.update_many({"lines.category": name}, {"$set": {"lines.$[el].category": new_name}},
                                   array_filters=[{"el.category": name}])
    await db.bookings.update_many({"lines.category": name}, {"$set": {"lines.$[el].category": new_name}},
                                  array_filters=[{"el.category": name}])
    await audit("CATEGORY_RENAMED", admin["id"], metadata={"from": name, "to": new_name})
    return {"name": new_name}


@api.delete("/categories/{name}")
async def delete_category(name: str, admin=AdminUser):
    if await db.items.count_documents({"category": name}):
        raise HTTPException(400, "Kategori masih punya alat, pindahkan dulu")
    await db.categories.delete_one({"name": name})
    await audit("CATEGORY_DELETED", admin["id"], metadata={"name": name})
    return {"ok": True}


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
        from_id = str(cq["from"]["id"])
        chat_id = str(cq.get("message", {}).get("chat", {}).get("id", from_id))
        allowed = (not admin_ids) or from_id in admin_ids or chat_id in admin_ids
        if not allowed:
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
    from_id = str(message.get("from", {}).get("id", ""))
    if not chat_id:
        return {"ok": True}
    if admin_ids and chat_id not in admin_ids and from_id not in admin_ids:
        telegram.send(chat_id, "🚫 Chat ini belum terdaftar sebagai admin.")
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
    ("Camera", "Sony A7IV YN", "CAM-A7IV", 6, "https://images.unsplash.com/photo-1612548403247-aa2873e9422d?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Camera", "Sony A7C YN", "CAM-A7C", 1, "https://images.pexels.com/photos/5875978/pexels-photo-5875978.jpeg"),
    ("Battery", "Battery Dummy FZ100", "BAT-DUMMY", 6, "https://images.pexels.com/photos/10668297/pexels-photo-10668297.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Battery", "Battery FZ100", "BAT-FZ100", 3, "https://images.pexels.com/photos/17566032/pexels-photo-17566032.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Battery", "Dock Charger FZ100", "BAT-DOCK", 1, "https://images.pexels.com/photos/10668297/pexels-photo-10668297.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Memory", "SDCard 128 GB", "MEM-128", 7, "https://images.unsplash.com/photo-1576834975354-ee694be1f0d1?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Memory", "SDCard 64 GB", "MEM-64", 2, "https://images.unsplash.com/photo-1576834975354-ee694be1f0d1?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Lens", "Sony 20mm F/1.8", "LEN-20", 1, "https://images.unsplash.com/photo-1624016687205-b1808c76ec55?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Lens", "Tamron 28-75mm F/2.8", "LEN-2875", 2, "https://images.unsplash.com/photo-1624016687205-b1808c76ec55?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Lens", "Tamron 70-180mm F/2.8", "LEN-70180", 1, "https://images.unsplash.com/photo-1624016687205-b1808c76ec55?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Multicam Set", "Mixer Switcher Roland YN", "MUL-ROLAND", 1, "https://images.pexels.com/photos/13699196/pexels-photo-13699196.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Multicam Set", "HDMI Fiber Optic", "MUL-HDMIFO", 4, "https://images.pexels.com/photos/13699196/pexels-photo-13699196.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Multicam Set", "HDMI Biasa", "MUL-HDMI", 2, "https://images.pexels.com/photos/13699196/pexels-photo-13699196.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Audio/Mic", "Rode NTG 4+", "AUD-NTG4", 1, "https://images.pexels.com/photos/25526512/pexels-photo-25526512.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Audio/Mic", "Rode Mic", "AUD-RODE", 1, "https://images.pexels.com/photos/25526512/pexels-photo-25526512.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Audio/Mic", "Zoom H8", "AUD-H8", 1, "https://images.pexels.com/photos/25526512/pexels-photo-25526512.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Cable Audio", "Cable Akai 6,5mm", "CAB-AKAI", 1, "https://images.pexels.com/photos/159674/sackcloth-sackcloth-textured-laptop-ipad-159674.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Cable Audio", "Cable XLR", "CAB-XLR", 4, "https://images.pexels.com/photos/159674/sackcloth-sackcloth-textured-laptop-ipad-159674.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Others", "Gimbal Zhiyun", "OTH-GIMBAL", 1, "https://images.unsplash.com/photo-1654723011680-0e037c2a4f18?crop=entropy&cs=srgb&fm=jpg&q=85"),
    ("Others", "Box Camera", "OTH-BOX", 2, "https://images.pexels.com/photos/13616448/pexels-photo-13616448.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Others", "Tas Camera", "OTH-TAS", 2, "https://images.pexels.com/photos/13616448/pexels-photo-13616448.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
    ("Others", "Cable Terminal", "OTH-TERM", 2, "https://images.pexels.com/photos/159674/sackcloth-sackcloth-textured-laptop-ipad-159674.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940"),
]


async def seed_data():
    await auth_module.seed_users()
    settings_doc = await db.settings.find_one({"key": "global"}) or {}
    if settings_doc.get("catalog_version") != 2:
        await db.items.delete_many({})
        await db.bookings.delete_many({})
        await db.access_credentials.delete_many({})
        await db.calendar_events.delete_many({})
        await db.notifications.delete_many({})
        await db.items.insert_many([{
            "name": name, "category": cat, "item_code": code, "photo": photo,
            "quantity": qty, "status": "AVAILABLE", "condition": "BAIK",
            "location": "Storage Utama", "notes": None, "created_at": now_utc(),
        } for cat, name, code, qty, photo in SEED_ITEMS])
        await db.settings.update_one({"key": "global"}, {"$set": {"catalog_version": 2}}, upsert=True)
    if await db.doors.count_documents({}) == 0:
        await db.doors.insert_one({
            "name": "Storage Utama", "provider": "bardi", "device_id": env("TUYA_DEVICE_ID", "demo-device"),
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
    try:
        storage.init_storage()
        logger.info("object storage siap")
    except Exception as e:
        logger.warning("storage init gagal: %s", e)
    asyncio.create_task(scheduler_loop())


@app.on_event("shutdown")
async def shutdown():
    pass

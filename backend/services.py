"""Booking lifecycle + notification engine."""
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from core import audit, db, env, now_utc, oid, ser
from providers import calendar, generate_code, get_door_provider, telegram

logger = logging.getLogger("services")

STATUS_PENDING = "PENDING"
STATUS_APPROVED = "APPROVED"
STATUS_ACTIVE = "BORROWED"
STATUS_RETURN_REQUESTED = "RETURN_REQUESTED"
STATUS_RETURNED = "RETURNED"
STATUS_REJECTED = "REJECTED"
STATUS_CANCELLED = "CANCELLED"
STATUS_OVERDUE = "OVERDUE"

ACCESS_RELEASE_MINUTES = 60  # kode dikirim & tampil 1 jam sebelum jadwal

BLOCKING_STATUSES = [STATUS_PENDING, STATUS_APPROVED, STATUS_ACTIVE, STATUS_RETURN_REQUESTED, STATUS_OVERDUE]


def parse_dt(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def fmt(dt: datetime) -> str:
    local = dt.astimezone(timezone(timedelta(hours=7)))
    return local.strftime("%d/%m/%Y %H:%M")


async def get_settings() -> dict:
    doc = await db.settings.find_one({"key": "global"})
    if not doc:
        doc = {
            "key": "global",
            "buffer_before_minutes": int(env("ACCESS_BUFFER_BEFORE_MINUTES", "10")),
            "buffer_after_minutes": int(env("ACCESS_BUFFER_AFTER_MINUTES", "15")),
        }
        await db.settings.insert_one(doc)
    return ser(doc)


# ------------------------------------------------------------------ notifications
async def _record_notification(channel: str, ntype: str, text: str, user_id: Optional[str], booking_id: Optional[str], result):
    await db.notifications.insert_one({
        "user_id": user_id,
        "booking_id": booking_id,
        "channel": channel,
        "type": ntype,
        "text": text,
        "status": "SENT" if result.ok else "FAILED",
        "simulated": result.simulated,
        "error_message": result.error,
        "retry_count": 0,
        "read": False,
        "sent_at": now_utc(),
    })


async def notify_user(user: dict, ntype: str, text: str, booking_id: Optional[str] = None):
    user_id = user.get("id") or str(user.get("_id"))
    await db.notifications.insert_one({
        "user_id": user_id,
        "booking_id": booking_id,
        "channel": "IN_APP",
        "type": ntype,
        "text": text,
        "status": "SENT",
        "simulated": False,
        "error_message": None,
        "retry_count": 0,
        "read": False,
        "sent_at": now_utc(),
    })
    if user.get("telegram_id"):
        res = telegram.send(str(user["telegram_id"]), text)
        await _record_notification("TELEGRAM", ntype, text, user_id, booking_id, res)


async def notify_admin(ntype: str, text: str, booking_id: Optional[str] = None, buttons: Optional[list] = None):
    res = telegram.broadcast_admins(text, buttons)
    await _record_notification("TELEGRAM", ntype, text, None, booking_id, res)


async def retry_failed_notifications():
    cursor = db.notifications.find({"status": "FAILED", "retry_count": {"$lt": 3}, "channel": "TELEGRAM"}).limit(20)
    async for n in cursor:
        res = telegram.broadcast_admins(n["text"])
        await db.notifications.update_one(
            {"_id": n["_id"]},
            {"$set": {"status": "SENT" if res.ok else "FAILED", "error_message": res.error}, "$inc": {"retry_count": 1}},
        )


# --------------------------------------------------------------------- booking ops
async def items_conflicting(item_ids: List[str], start: datetime, end: datetime, exclude_booking: Optional[str] = None) -> List[str]:
    query = {
        "status": {"$in": BLOCKING_STATUSES},
        "item_ids": {"$in": item_ids},
        "start_time": {"$lt": end},
        "end_time": {"$gt": start},
    }
    if exclude_booking:
        query["_id"] = {"$ne": oid(exclude_booking)}
    conflicts = []
    async for b in db.bookings.find(query):
        conflicts.extend([i for i in b["item_ids"] if i in item_ids])
    return list(set(conflicts))


async def booked_qty(item_id: str, start: datetime, end: datetime, exclude_booking: Optional[str] = None) -> int:
    """Jumlah unit barang yang sudah dipesan pada rentang waktu tertentu."""
    query = {
        "status": {"$in": BLOCKING_STATUSES},
        "item_ids": item_id,
        "start_time": {"$lt": end},
        "end_time": {"$gt": start},
    }
    if exclude_booking:
        query["_id"] = {"$ne": oid(exclude_booking)}
    total = 0
    async for b in db.bookings.find(query):
        for line in b.get("lines", []):
            if line["item_id"] == item_id:
                total += int(line.get("qty", 1))
    return total


async def available_qty(item: dict, start: datetime, end: datetime, exclude_booking: Optional[str] = None) -> int:
    if item.get("status") == "MAINTENANCE":
        return 0
    return max(0, int(item.get("quantity", 1)) - await booked_qty(str(item["_id"]), start, end, exclude_booking))


def return_day_reached(booking: dict) -> bool:
    """Checklist hanya bisa dicentang pada hari pengembalian (WIB) atau setelahnya."""
    wib = timezone(timedelta(hours=7))
    return now_utc().astimezone(wib).date() >= parse_dt(booking["end_time"]).astimezone(wib).date()


def build_checklist(lines: List[dict]) -> List[dict]:
    return [{"item_id": l["item_id"], "name": l["name"], "item_code": l.get("item_code"),
             "category": l.get("category"), "qty": l.get("qty", 1), "checked": False,
             "checked_at": None} for l in lines]


async def toggle_checklist(booking: dict, item_id: str, checked: bool) -> dict:
    if booking["status"] not in (STATUS_APPROVED, STATUS_ACTIVE, STATUS_OVERDUE):
        raise ValueError("Checklist hanya untuk peminjaman yang sedang berjalan")
    if not return_day_reached(booking):
        raise ValueError("Checklist baru bisa dicentang pada hari pengembalian")
    checklist = booking.get("checklist") or build_checklist(booking.get("lines", []))
    found = False
    for row in checklist:
        if row["item_id"] == item_id:
            row["checked"] = checked
            row["checked_at"] = now_utc() if checked else None
            found = True
    if not found:
        raise ValueError("Barang tidak ada di pesanan ini")
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {"checklist": checklist}})
    await audit("CHECKLIST_UPDATED", booking["user_id"], str(booking["_id"]), {"item_id": item_id, "checked": checked})
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    return await booking_detail(booking)


async def access_codes_for(booking: dict) -> List[dict]:
    """Kode akses pintu, hanya dibuka 1 jam sebelum jadwalnya masing-masing."""
    out = []
    now = now_utc()
    cursor = db.access_credentials.find({"booking_id": str(booking["_id"]), "status": {"$ne": "REVOKED"}}).sort("schedule_at", 1)
    async for cred in cursor:
        door = await db.doors.find_one({"_id": oid(cred["door_id"])})
        schedule = parse_dt(cred["schedule_at"]) if cred.get("schedule_at") else parse_dt(booking["start_time"])
        release = parse_dt(cred["release_at"]) if cred.get("release_at") else schedule - timedelta(minutes=ACCESS_RELEASE_MINUTES)
        released = now >= release
        out.append({
            "id": str(cred["_id"]),
            "kind": cred.get("kind", "PICKUP"),
            "door_name": door["name"] if door else "Storage",
            "code": cred["code"] if released else None,
            "released": released,
            "release_at": release.isoformat(),
            "schedule_at": schedule.isoformat(),
            "valid_from": parse_dt(cred["valid_from"]).isoformat(),
            "valid_until": parse_dt(cred["valid_until"]).isoformat(),
            "status": cred["status"],
            "simulated": cred.get("simulated", False),
        })
    return out


async def booking_detail(booking: dict) -> dict:
    data = ser(booking)
    lines, items = [], []
    for line in booking.get("lines", []):
        item = await db.items.find_one({"_id": oid(line["item_id"])})
        enriched = {**line, "photo": item.get("photo") if item else None,
                    "condition": item.get("condition") if item else None,
                    "location": item.get("location") if item else None}
        lines.append(enriched)
        if item:
            items.append(ser(item))
    data["lines"] = lines
    data["items"] = items
    data["total_qty"] = sum(int(l.get("qty", 1)) for l in lines)
    data["checklist"] = booking.get("checklist") or build_checklist(booking.get("lines", []))
    data["checklist_unlocked"] = return_day_reached(booking)
    data["checklist_complete"] = bool(data["checklist"]) and all(r.get("checked") for r in data["checklist"])
    data["pickup_photos"] = booking.get("pickup_photos", [])
    data["return_photos"] = booking.get("return_photos", [])
    cred = await db.access_credentials.find_one({"booking_id": str(booking["_id"]), "status": {"$ne": "REVOKED"}}, sort=[("_id", -1)])
    if cred:
        door = await db.doors.find_one({"_id": oid(cred["door_id"])})
        data["access"] = {**ser(cred), "door_name": door["name"] if door else "Storage"}
    else:
        data["access"] = None
    data["access_codes"] = await access_codes_for(booking)
    evt = await db.calendar_events.find_one({"booking_id": str(booking["_id"])})
    data["calendar"] = ser(evt)
    return data


async def _set_items_status(item_ids: List[str], status: str):
    await db.items.update_many({"_id": {"$in": [oid(i) for i in item_ids]}}, {"$set": {"status": status}})


async def _create_credential(booking: dict, door: dict, kind: str, schedule: datetime,
                             valid_from: datetime, valid_until: datetime) -> dict:
    code = generate_code()
    provider = get_door_provider(door.get("provider", ""))
    result = provider.create_code(ser(door), code, valid_from, valid_until)
    cred = {
        "booking_id": str(booking["_id"]),
        "door_id": str(door["_id"]),
        "kind": kind,  # PICKUP | RETURN
        "code": code,
        "schedule_at": schedule,
        "release_at": schedule - timedelta(minutes=ACCESS_RELEASE_MINUTES),
        "released_notified": False,
        "valid_from": valid_from,
        "valid_until": valid_until,
        "status": "ACTIVE" if result.ok else "FAILED",
        "provider": provider.name,
        "provider_code_id": result.data.get("provider_code_id"),
        "simulated": result.simulated,
        "error_message": result.error,
        "used_at": None,
        "created_at": now_utc(),
    }
    res = await db.access_credentials.insert_one(cred)
    cred["_id"] = res.inserted_id
    await db.access_logs.insert_one({
        "booking_id": str(booking["_id"]),
        "door_id": str(door["_id"]),
        "user_id": booking["user_id"],
        "user_name": booking.get("user_name"),
        "credential_id": str(res.inserted_id),
        "event": f"ACCESS_GENERATED_{kind}" if result.ok else "ACCESS_FAILED",
        "status": "SUCCESS" if result.ok else "FAILED",
        "error_message": result.error,
        "created_at": now_utc(),
    })
    if not result.ok:
        await notify_admin("ACCESS_FAILED", (
            f"⚠️ <b>GAGAL BUAT AKSES PINTU STORAGE ({kind})</b>\nBooking #{booking.get('code')}\nError: {result.error}"
        ), str(booking["_id"]))
    return ser(cred)


async def generate_access(booking: dict) -> List[dict]:
    """Dua kode berbeda: satu untuk pengambilan, satu untuk pengembalian."""
    settings = await get_settings()
    door = await db.doors.find_one({"status": {"$ne": "DISABLED"}})
    if not door:
        door_id = (await db.doors.insert_one({
            "name": "Storage Utama", "provider": "bardi", "device_id": "demo-device", "location": "Lantai 1", "status": "ONLINE",
        })).inserted_id
        door = await db.doors.find_one({"_id": door_id})
    start, end = parse_dt(booking["start_time"]), parse_dt(booking["end_time"])
    before = timedelta(minutes=settings["buffer_before_minutes"])
    after = timedelta(minutes=settings["buffer_after_minutes"])
    creds = [
        await _create_credential(booking, door, "PICKUP", start,
                                 start - timedelta(minutes=ACCESS_RELEASE_MINUTES) - before,
                                 min(start + timedelta(hours=3), end) + after),
        await _create_credential(booking, door, "RETURN", end,
                                 end - timedelta(minutes=ACCESS_RELEASE_MINUTES) - before,
                                 end + timedelta(hours=3) + after),
    ]
    await audit("ACCESS_GENERATED", booking["user_id"], str(booking["_id"]), {"door": door["name"], "codes": 2})
    return creds


async def revoke_access(booking_id: str):
    async for cred in db.access_credentials.find({"booking_id": booking_id, "status": "ACTIVE"}):
        door = await db.doors.find_one({"_id": oid(cred["door_id"])})
        provider = get_door_provider(door.get("provider", "") if door else "")
        provider.revoke_code(ser(door) or {}, ser(cred))
        await db.access_credentials.update_one({"_id": cred["_id"]}, {"$set": {"status": "EXPIRED"}})
        await db.access_logs.insert_one({
            "booking_id": booking_id, "door_id": cred["door_id"], "user_id": cred.get("user_id"),
            "credential_id": str(cred["_id"]), "event": "ACCESS_EXPIRED", "status": "SUCCESS",
            "error_message": None, "created_at": now_utc(),
        })


async def sync_calendar(booking: dict, items: List[dict]) -> dict:
    lines = booking.get("lines", [])
    item_names = "\n".join(f"{l['name']} ({l.get('qty', 1)} pcs)" for l in lines)
    first = lines[0]["name"] if lines else "Barang"
    extra = f" +{len(lines) - 1} item" if len(lines) > 1 else ""
    summary = f"[PINJAM] {first}{extra} — {booking.get('user_name')}"
    description = (
        f"Peminjam:\n{booking.get('user_name')}\n\nAcara:\n{booking.get('purpose')}\n\n"
        f"Lokasi:\n{booking.get('location') or '-'}\n\nAlat:\n{item_names}\n\n"
        f"Order ID:\n#{booking.get('code')}\n\nStorage:\nStorage Utama\n\nStatus:\nApproved"
    )
    result = calendar.create_event(summary, description, parse_dt(booking["start_time"]), parse_dt(booking["end_time"]))
    doc = {
        "booking_id": str(booking["_id"]),
        "google_event_id": result.data.get("google_event_id"),
        "calendar_id": result.data.get("calendar_id"),
        "summary": summary,
        "status": "SYNCED" if result.ok else "SYNC_FAILED",
        "simulated": result.simulated,
        "error_message": result.error,
        "created_at": now_utc(),
    }
    await db.calendar_events.update_one({"booking_id": str(booking["_id"])}, {"$set": doc}, upsert=True)
    if not result.ok:
        await notify_admin("CALENDAR_FAILED", f"⚠️ Google Calendar gagal disinkronkan untuk Booking #{booking.get('code')}.", str(booking["_id"]))
    return doc


async def approve_booking(booking: dict, admin_name: str) -> dict:
    if booking["status"] != STATUS_PENDING:
        raise ValueError("Order sudah diproses")
    bid = str(booking["_id"])
    start, end = parse_dt(booking["start_time"]), parse_dt(booking["end_time"])
    for line in booking.get("lines", []):
        item = await db.items.find_one({"_id": oid(line["item_id"])})
        if not item:
            raise ValueError(f"{line['name']} tidak ditemukan")
        if await available_qty(item, start, end, exclude_booking=bid) < int(line.get("qty", 1)):
            raise ValueError(f"Stok {line['name']} tidak cukup pada waktu tersebut")
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {
        "status": STATUS_APPROVED, "approved_by": admin_name, "approved_at": now_utc(),
    }})
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    await sync_calendar(booking, [])
    creds = await generate_access(booking)
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {"checklist": build_checklist(booking.get("lines", []))}})
    user = await db.users.find_one({"_id": oid(booking["user_id"])})
    await audit("BOOKING_APPROVED", booking["user_id"], bid, {"admin": admin_name})
    if user:
        await notify_user(ser(user), "BOOKING_APPROVED", (
            f"✅ Booking #{booking['code']} disetujui.\n"
            f"🔐 Kode pintu pengambilan dikirim otomatis 1 jam sebelum {fmt(start)}.\n"
            f"🔐 Kode pintu pengembalian (berbeda) dikirim 1 jam sebelum {fmt(end)}."
        ), bid)
    await notify_admin("BOOKING_APPROVED", (
        f"✅ <b>BOOKING DISETUJUI</b>\nBooking #{booking['code']}\n👤 {booking['user_name']}\n"
        f"🔐 Kode ambil: {creds[0]['code']} (rilis 1 jam sebelum {fmt(start)})\n"
        f"🔐 Kode kembali: {creds[1]['code']} (rilis 1 jam sebelum {fmt(end)})"
    ), bid)
    return await booking_detail(booking)


async def reject_booking(booking: dict, admin_name: str, reason: str = "") -> dict:
    if booking["status"] != STATUS_PENDING:
        raise ValueError("Booking sudah diproses")
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {
        "status": STATUS_REJECTED, "approved_by": admin_name, "reject_reason": reason, "approved_at": now_utc(),
    }})
    bid = str(booking["_id"])
    user = await db.users.find_one({"_id": oid(booking["user_id"])})
    await audit("BOOKING_REJECTED", booking["user_id"], bid, {"admin": admin_name, "reason": reason})
    if user:
        await notify_user(ser(user), "BOOKING_REJECTED", f"❌ Booking #{booking['code']} ditolak. {reason}".strip(), bid)
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    return await booking_detail(booking)


async def cancel_booking(booking: dict, actor: str) -> dict:
    if booking["status"] in (STATUS_RETURNED, STATUS_CANCELLED, STATUS_REJECTED):
        raise ValueError("Booking tidak bisa dibatalkan")
    bid = str(booking["_id"])
    await revoke_access(bid)
    evt = await db.calendar_events.find_one({"booking_id": bid})
    if evt and evt.get("google_event_id"):
        calendar.delete_event(evt["google_event_id"])
        await db.calendar_events.update_one({"booking_id": bid}, {"$set": {"status": "CANCELLED"}})
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {"status": STATUS_CANCELLED, "cancelled_at": now_utc()}})
    await audit("BOOKING_CANCELLED", booking["user_id"], bid, {"actor": actor})
    user = await db.users.find_one({"_id": oid(booking["user_id"])})
    if user:
        await notify_user(ser(user), "BOOKING_CANCELLED", f"🚫 Booking #{booking['code']} dibatalkan. Akses gudang dicabut.", bid)
    await notify_admin("BOOKING_CANCELLED", f"🚫 <b>BOOKING DIBATALKAN</b>\n#{booking['code']} — {booking['user_name']}", bid)
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    return await booking_detail(booking)


async def extend_booking(booking: dict, minutes: int, actor: str) -> dict:
    if booking["status"] not in (STATUS_APPROVED, STATUS_ACTIVE, STATUS_OVERDUE):
        raise ValueError("Booking tidak bisa di-extend")
    bid = str(booking["_id"])
    new_end = parse_dt(booking["end_time"]) + timedelta(minutes=minutes)
    for line in booking.get("lines", []):
        item = await db.items.find_one({"_id": oid(line["item_id"])})
        if item and await available_qty(item, parse_dt(booking["end_time"]), new_end, exclude_booking=bid) < int(line.get("qty", 1)):
            raise ValueError(f"Waktu tambahan bentrok: stok {line['name']} tidak cukup")
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {
        "end_time": new_end, "status": STATUS_ACTIVE if booking["status"] == STATUS_OVERDUE else booking["status"],
    }})
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    await revoke_access(bid)
    creds = await generate_access(booking)
    evt = await db.calendar_events.find_one({"booking_id": bid})
    if evt and evt.get("google_event_id"):
        calendar.update_event(evt["google_event_id"], parse_dt(booking["start_time"]), new_end, f"Extended by {actor}")
    await audit("BOOKING_EXTENDED", booking["user_id"], bid, {"minutes": minutes, "actor": actor})
    user = await db.users.find_one({"_id": oid(booking["user_id"])})
    if user:
        await notify_user(ser(user), "BOOKING_EXTENDED", (
            f"⏱️ Booking #{booking['code']} diperpanjang sampai {fmt(new_end)}.\n"
            f"Kode pintu pengembalian baru dikirim 1 jam sebelum jadwal."
        ), bid)
    logger.info("extend booking %s -> %s codes", bid, len(creds))
    return await booking_detail(booking)


async def request_return(booking: dict, condition: str, notes: str, photo: Optional[str]) -> dict:
    if booking["status"] not in (STATUS_APPROVED, STATUS_ACTIVE, STATUS_OVERDUE):
        raise ValueError("Order tidak dalam status peminjaman")
    if not return_day_reached(booking):
        raise ValueError("Pengembalian baru bisa diajukan pada hari pengembalian")
    checklist = booking.get("checklist") or build_checklist(booking.get("lines", []))
    if not all(r.get("checked") for r in checklist):
        raise ValueError("Centang semua alat di checklist pengembalian dulu")
    bid = str(booking["_id"])
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {
        "status": STATUS_RETURN_REQUESTED,
        "return_condition": condition,
        "return_notes": notes,
        "return_photo": photo,
        "return_requested_at": now_utc(),
    }})
    await audit("RETURN_REQUESTED", booking["user_id"], bid, {"condition": condition})
    await notify_admin("RETURN_REQUESTED", (
        f"📦 <b>RETURN REQUEST</b>\n👤 {booking['user_name']}\nBooking #{booking['code']}\nKondisi: {condition}\n{notes}"
    ), bid, buttons=[[
        {"text": "✅ TERIMA", "callback_data": f"return_ok:{bid}"},
        {"text": "⚠️ PERIKSA", "callback_data": f"return_check:{bid}"},
    ]])
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    return await booking_detail(booking)


async def confirm_return(booking: dict, admin_name: str, damaged: bool = False) -> dict:
    if booking["status"] not in (STATUS_RETURN_REQUESTED, STATUS_ACTIVE, STATUS_APPROVED, STATUS_OVERDUE):
        raise ValueError("Booking tidak bisa dikembalikan")
    bid = str(booking["_id"])
    await revoke_access(bid)
    await db.bookings.update_one({"_id": booking["_id"]}, {"$set": {
        "status": STATUS_RETURNED, "returned_at": now_utc(), "returned_confirmed_by": admin_name,
    }})
    if damaged:
        await _set_items_status(booking["item_ids"], "MAINTENANCE")
        await db.items.update_many({"_id": {"$in": [oid(i) for i in booking["item_ids"]]}}, {"$set": {"condition": "RUSAK"}})
    await db.calendar_events.update_one({"booking_id": bid}, {"$set": {"status": "COMPLETED"}})
    await audit("ITEM_DAMAGED" if damaged else "ITEM_RETURNED", booking["user_id"], bid, {"admin": admin_name})
    user = await db.users.find_one({"_id": oid(booking["user_id"])})
    if user:
        await notify_user(ser(user), "RETURN_APPROVED", (
            f"✅ Pengembalian booking #{booking['code']} diterima. Terima kasih!" if not damaged
            else f"⚠️ Pengembalian booking #{booking['code']} diterima dengan catatan kerusakan."
        ), bid)
    booking = await db.bookings.find_one({"_id": booking["_id"]})
    return await booking_detail(booking)


# ------------------------------------------------------------------------ reports
async def build_report(days: int = 30) -> dict:
    since = now_utc() - timedelta(days=days)
    bookings = [b async for b in db.bookings.find({"created_at": {"$gte": since}})]
    item_names = {}
    async for i in db.items.find():
        item_names[str(i["_id"])] = i["name"]

    item_counts, user_counts, late_counts, trend = {}, {}, {}, {}
    returned = overdue = 0
    for b in bookings:
        for line in b.get("lines", []):
            name = line.get("name") or item_names.get(line.get("item_id"), "?")
            item_counts[name] = item_counts.get(name, 0) + int(line.get("qty", 1))
        user_counts[b["user_name"]] = user_counts.get(b["user_name"], 0) + 1
        day = parse_dt(b["created_at"]).astimezone(timezone(timedelta(hours=7))).strftime("%Y-%m-%d")
        trend[day] = trend.get(day, 0) + 1
        if b["status"] == STATUS_RETURNED:
            returned += 1
        was_late = b["status"] == STATUS_OVERDUE or (
            b.get("returned_at") and parse_dt(b["returned_at"]) > parse_dt(b["end_time"])
        )
        if was_late:
            overdue += 1
            late_counts[b["user_name"]] = late_counts.get(b["user_name"], 0) + 1

    top = lambda d, key: sorted([{"name": k, "count": v} for k, v in d.items()], key=lambda x: -x["count"])
    return {
        "days": days,
        "totals": {"bookings": len(bookings), "returned": returned, "overdue": overdue,
                   "items": await db.items.count_documents({}), "users": await db.users.count_documents({})},
        "top_items": top(item_counts, "count")[:10],
        "top_users": top(user_counts, "count")[:10],
        "late_users": top(late_counts, "count")[:10],
        "trend": [{"date": d, "count": trend[d]} for d in sorted(trend)],
    }


async def report_csv_rows(days: int = 30):
    since = now_utc() - timedelta(days=days)
    item_names = {}
    async for i in db.items.find():
        item_names[str(i["_id"])] = i["name"]
    rows = [["Booking", "Peminjam", "Barang", "Mulai", "Selesai", "Status", "Dikembalikan", "Terlambat"]]
    async for b in db.bookings.find({"created_at": {"$gte": since}}).sort("created_at", -1):
        late = "Ya" if (b["status"] == STATUS_OVERDUE or (
            b.get("returned_at") and parse_dt(b["returned_at"]) > parse_dt(b["end_time"]))) else "Tidak"
        rows.append([
            f"#{b['code']}", b["user_name"],
            "; ".join(f"{l.get('name')} x{l.get('qty', 1)}" for l in b.get("lines", [])),
            fmt(parse_dt(b["start_time"])), fmt(parse_dt(b["end_time"])), b["status"],
            fmt(parse_dt(b["returned_at"])) if b.get("returned_at") else "-", late,
        ])
    return rows


# ------------------------------------------------------------------------ schedule
async def release_due_access_codes():
    """Kirim kode pintu 1 jam sebelum jadwal ambil / kembali."""
    now = now_utc()
    cursor = db.access_credentials.find({
        "status": "ACTIVE", "released_notified": {"$ne": True}, "release_at": {"$lte": now},
    })
    async for cred in cursor:
        booking = await db.bookings.find_one({"_id": oid(cred["booking_id"])})
        if not booking or booking["status"] in (STATUS_CANCELLED, STATUS_REJECTED, STATUS_RETURNED):
            await db.access_credentials.update_one({"_id": cred["_id"]}, {"$set": {"released_notified": True}})
            continue
        kind = cred.get("kind", "PICKUP")
        label = "PENGAMBILAN" if kind == "PICKUP" else "PENGEMBALIAN"
        schedule = parse_dt(cred["schedule_at"]) if cred.get("schedule_at") else parse_dt(booking["start_time"])
        user = await db.users.find_one({"_id": oid(booking["user_id"])})
        if user:
            await notify_user(ser(user), f"ACCESS_{kind}", (
                f"🔐 Kode pintu {label} booking #{booking['code']}: <b>{cred['code']}</b>\n"
                f"Jadwal {label.lower()}: {fmt(schedule)}\n"
                f"Berlaku {fmt(parse_dt(cred['valid_from']))} - {fmt(parse_dt(cred['valid_until']))}"
            ), str(booking["_id"]))
        await db.access_credentials.update_one({"_id": cred["_id"]}, {"$set": {"released_notified": True}})
        await audit(f"ACCESS_RELEASED_{kind}", booking["user_id"], str(booking["_id"]))


async def run_scheduler_once():
    now = now_utc()
    await release_due_access_codes()
    # activate started bookings
    async for b in db.bookings.find({"status": STATUS_APPROVED, "start_time": {"$lte": now}}):
        await db.bookings.update_one({"_id": b["_id"]}, {"$set": {"status": STATUS_ACTIVE}})
        await audit("ITEM_BORROWED", b["user_id"], str(b["_id"]))
    # reminder bertingkat: H-1 (24 jam) lalu 30 menit sebelum jam kembali
    for flag, minutes, label in (("reminder_24h_sent", 1440, "besok"), ("reminder_30m_sent", 30, "30 menit lagi")):
        async for b in db.bookings.find({
            "status": {"$in": [STATUS_ACTIVE, STATUS_APPROVED]}, flag: {"$ne": True},
            "end_time": {"$lte": now + timedelta(minutes=minutes), "$gt": now},
        }):
            user = await db.users.find_one({"_id": oid(b["user_id"])})
            if user:
                await notify_user(ser(user), "RETURN_DUE", (
                    f"⏰ Pengingat ({label}): booking #{b['code']} harus dikembalikan "
                    f"{fmt(parse_dt(b['end_time']))}."
                ), str(b["_id"]))
            await db.bookings.update_one({"_id": b["_id"]}, {"$set": {flag: True}})
    # overdue
    async for b in db.bookings.find({"status": {"$in": [STATUS_ACTIVE, STATUS_APPROVED]}, "end_time": {"$lt": now}}):
        await db.bookings.update_one({"_id": b["_id"]}, {"$set": {"status": STATUS_OVERDUE}})
        late = int((now - parse_dt(b["end_time"])).total_seconds() // 60)
        await audit("BOOKING_OVERDUE", b["user_id"], str(b["_id"]), {"late_minutes": late})
        await notify_admin("OVERDUE", (
            f"⚠️ <b>OVERDUE</b>\nBooking #{b['code']}\n👤 {b['user_name']}\nSeharusnya kembali: {fmt(parse_dt(b['end_time']))}\nTerlambat: {late} menit"
        ), str(b["_id"]), buttons=[[{"text": "🔐 CEK AKSES", "callback_data": f"access:{str(b['_id'])}"}]])
        user = await db.users.find_one({"_id": oid(b["user_id"])})
        if user:
            await notify_user(ser(user), "OVERDUE", f"⚠️ Peminjaman #{b['code']} sudah melewati batas waktu.", str(b["_id"]))
    # expire access
    async for cred in db.access_credentials.find({"status": "ACTIVE", "valid_until": {"$lt": now}}):
        booking = await db.bookings.find_one({"_id": oid(cred["booking_id"])})
        if booking and booking["status"] in (STATUS_OVERDUE, STATUS_ACTIVE, STATUS_RETURN_REQUESTED):
            continue
        await revoke_access(cred["booking_id"])
    # self-heal: barang non-maintenance selalu AVAILABLE (ketersediaan dihitung per qty & waktu)
    await db.items.update_many({"status": {"$in": ["BOOKED", "BORROWED"]}}, {"$set": {"status": "AVAILABLE"}})
    await retry_failed_notifications()

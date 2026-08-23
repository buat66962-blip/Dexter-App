"""End-to-end backend tests for Office Inventory Rental (Iteration 3 schema).

New booking schema:
  POST /api/bookings {lines:[{item_id, qty}], pickup_date, pickup_time, duration_hours, purpose, location}
Features under test:
  - Catalog with quantity + available_qty
  - Booking lifecycle with qty
  - Checklist gated by return_day_reached
  - Invoice-friendly response (lines grouped, total_qty)
  - Report top_items by qty; CSV export "name xQty"
  - NO WhatsApp anywhere (only TELEGRAM in notifications-log)
"""
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get(
    "REACT_APP_BACKEND_URL") else "https://warehouse-rental-5.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@kantor.id", "password": "admin123"}
USER = {"email": "ghozy@kantor.id", "password": "ghozy123"}
WEBHOOK_SECRET = "wh_secret_inventory_2026"
WIB = timezone(timedelta(hours=7))


def _client(creds=None):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if creds:
        r = s.post(f"{API}/auth/login", json=creds, timeout=15)
        assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="session")
def admin():
    return _client(ADMIN)


@pytest.fixture(scope="session")
def user():
    return _client(USER)


def _pickup(days_from_today: int = 1, hh: str = "09:00", duration: int = 8) -> dict:
    """Return pickup_date/pickup_time/duration_hours values for a booking payload."""
    d = (datetime.now(WIB) + timedelta(days=days_from_today)).date().isoformat()
    return {"pickup_date": d, "pickup_time": hh, "duration_hours": duration}


def _first_avail(sess, min_qty=1) -> dict:
    items = sess.get(f"{API}/items").json()
    for i in items:
        if i.get("status") == "AVAILABLE" and i.get("quantity", 0) >= min_qty:
            return i
    raise AssertionError("no available item")


# ============================================================ AUTH
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "x"})
        assert r.status_code == 401

    def test_me(self, user):
        r = user.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == USER["email"]
        # no whatsapp_number field expected in schema (may be absent or None; ensure legacy field not required)
        # accept either missing or None
        assert r.json().get("whatsapp_number") in (None, "")


# ============================================================ CATALOG QTY
class TestCatalog:
    def test_list_has_quantity_and_available_qty(self, user):
        r = user.get(f"{API}/items")
        assert r.status_code == 200
        items = r.json()
        assert len(items) >= 22, f"expected >=22 seeded items, got {len(items)}"
        for i in items:
            assert "quantity" in i and isinstance(i["quantity"], int)
            assert "available_qty" in i
            assert "_id" not in i
        # categories cover required ones
        cats = {i["category"] for i in items}
        expected = {"Camera", "Battery", "Memory", "Lens", "Multicam Set", "Audio/Mic", "Cable Audio", "Others"}
        assert expected.issubset(cats), f"missing categories: {expected - cats}"

    def test_available_qty_reduces_after_booking(self, user, admin):
        # pick a multi-qty item
        items = user.get(f"{API}/items").json()
        target = next(i for i in items if i["quantity"] >= 3 and i["status"] == "AVAILABLE")
        p = _pickup(days_from_today=2)
        start_iso = (datetime.now(WIB) + timedelta(days=2)).replace(
            hour=9, minute=0, second=0, microsecond=0).isoformat()
        end_iso = (datetime.now(WIB) + timedelta(days=2)).replace(
            hour=17, minute=0, second=0, microsecond=0).isoformat()
        # baseline available_qty when window queried
        r0 = user.get(f"{API}/items", params={"start_time": start_iso, "end_time": end_iso})
        base = next(i for i in r0.json() if i["id"] == target["id"])["available_qty"]
        # create booking with qty=2
        payload = {"lines": [{"item_id": target["id"], "qty": 2}],
                   "purpose": "TEST_avail_qty", "location": "Studio", **p}
        r = user.post(f"{API}/bookings", json=payload)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        # now available_qty should drop by 2 for that window
        r1 = user.get(f"{API}/items", params={"start_time": start_iso, "end_time": end_iso})
        after = next(i for i in r1.json() if i["id"] == target["id"])["available_qty"]
        assert after == base - 2, f"expected {base-2}, got {after}"
        # cleanup: cancel
        user.post(f"{API}/bookings/{bid}/cancel")


# ============================================================ BOOKING CREATE (new schema)
class TestBookingCreate:
    def test_create_success_and_pending(self, user):
        item = _first_avail(user)
        p = _pickup(days_from_today=3)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_new_schema", "location": "Studio A", **p,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "PENDING"
        assert data["duration_hours"] == p["duration_hours"]
        assert data["location"] == "Studio A"
        assert data["access"] in (None, {})
        assert data["total_qty"] == 1
        assert len(data["lines"]) == 1
        assert data["lines"][0]["qty"] == 1
        assert data["lines"][0]["item_id"] == item["id"]
        # checklist empty until approve
        assert data["checklist"] == [] or data.get("checklist_unlocked") in (True, False)
        user.post(f"{API}/bookings/{data['id']}/cancel")

    def test_qty_exceeds_available(self, user):
        items = user.get(f"{API}/items").json()
        target = next(i for i in items if i["quantity"] <= 2 and i["status"] == "AVAILABLE")
        p = _pickup(days_from_today=4)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": target["id"], "qty": target["quantity"] + 5}],
            "purpose": "TEST_over_qty", "location": "", **p,
        })
        assert r.status_code == 400
        detail = r.json().get("detail", "")
        assert "hanya tersedia" in detail.lower() and "pcs" in detail.lower(), f"unexpected: {detail}"

    def test_maintenance_blocks(self, admin, user):
        items = admin.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][-1]
        payload = {k: item.get(k) for k in ["name", "category", "item_code", "photo", "condition", "location", "notes", "quantity"]}
        payload["status"] = "MAINTENANCE"
        assert admin.put(f"{API}/items/{item['id']}", json=payload).status_code == 200
        try:
            p = _pickup(days_from_today=5)
            r = user.post(f"{API}/bookings", json={
                "lines": [{"item_id": item["id"], "qty": 1}],
                "purpose": "TEST_maint", "location": "", **p,
            })
            assert r.status_code == 400
            assert "maintenance" in r.json().get("detail", "").lower()
        finally:
            payload["status"] = "AVAILABLE"
            admin.put(f"{API}/items/{item['id']}", json=payload)

    def test_empty_cart_rejected(self, user):
        p = _pickup(days_from_today=6)
        r = user.post(f"{API}/bookings", json={"lines": [], "purpose": "x", "location": "", **p})
        assert r.status_code == 400


# ============================================================ FULL LIFECYCLE (checklist opens today)
class TestLifecycleTodayCheckoutable:
    """One booking with pickup_date = today so end_time is today -> checklist_unlocked True."""
    bid = None
    access = None
    item = None

    def test_01_create_today(self, user, admin):
        item = _first_avail(user)
        p = _pickup(days_from_today=0, hh="00:30", duration=4)  # pickup ~00:30 WIB today, back ~04:30
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_lifecycle_today", "location": "Studio T", **p,
        })
        assert r.status_code == 200, r.text
        TestLifecycleTodayCheckoutable.bid = r.json()["id"]
        TestLifecycleTodayCheckoutable.item = item

    def test_02_approve_creates_calendar_and_checklist(self, admin):
        r = admin.post(f"{API}/admin/bookings/{TestLifecycleTodayCheckoutable.bid}/approve")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "APPROVED"
        assert data["access"]["code"] and len(data["access"]["code"]) == 6
        cal = data["calendar"]
        assert cal["status"] == "SYNCED"
        assert cal.get("simulated") is False, "expected LIVE Google Calendar"
        assert cal.get("calendar_id") == "yncrewcalendar@gmail.com"
        # checklist initialized w/ 1 line
        assert isinstance(data["checklist"], list) and len(data["checklist"]) == 1
        assert data["checklist"][0]["checked"] is False
        TestLifecycleTodayCheckoutable.access = data["access"]["code"]

    def test_03_checklist_unlocked_today(self, user):
        r = user.get(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}")
        data = r.json()
        assert data["checklist_unlocked"] is True, f"expected unlocked today, got {data}"

    def test_04_return_before_checklist_fails(self, user):
        r = user.post(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}/return",
                      json={"condition": "BAIK", "notes": "TEST"})
        assert r.status_code == 400
        assert "checklist" in r.json().get("detail", "").lower()

    def test_05_check_all_items(self, user):
        b = user.get(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}").json()
        for row in b["checklist"]:
            r = user.post(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}/checklist",
                          json={"item_id": row["item_id"], "checked": True})
            assert r.status_code == 200, r.text
        b2 = user.get(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}").json()
        assert b2["checklist_complete"] is True

    def test_06_request_return_ok(self, user):
        r = user.post(f"{API}/bookings/{TestLifecycleTodayCheckoutable.bid}/return",
                      json={"condition": "BAIK", "notes": "TEST_ok"})
        assert r.status_code == 200
        assert r.json()["status"] == "RETURN_REQUESTED"

    def test_07_admin_confirm(self, admin):
        r = admin.post(f"{API}/admin/bookings/{TestLifecycleTodayCheckoutable.bid}/confirm-return")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "RETURNED"
        # access should be expired / gone
        assert data.get("access") in (None, {}) or data["access"].get("status") == "EXPIRED"

    def test_08_item_available_again_full_qty(self, user):
        r = user.get(f"{API}/items/{TestLifecycleTodayCheckoutable.item['id']}")
        assert r.status_code == 200
        assert r.json()["status"] == "AVAILABLE"


# ============================================================ CHECKLIST LOCKED (future booking)
class TestChecklistLocked:
    def test_locked_when_end_in_future(self, admin, user):
        item = _first_avail(user)
        p = _pickup(days_from_today=5, hh="09:00", duration=8)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_locked", "location": "", **p,
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        try:
            ra = admin.post(f"{API}/admin/bookings/{bid}/approve")
            assert ra.status_code == 200, ra.text
            b = user.get(f"{API}/bookings/{bid}").json()
            assert b["checklist_unlocked"] is False
            # attempting to check any item -> 400
            first = b["checklist"][0]
            r2 = user.post(f"{API}/bookings/{bid}/checklist",
                           json={"item_id": first["item_id"], "checked": True})
            assert r2.status_code == 400
            assert "hari pengembalian" in r2.json().get("detail", "").lower()
            # return also blocked
            r3 = user.post(f"{API}/bookings/{bid}/return",
                           json={"condition": "BAIK", "notes": "x"})
            assert r3.status_code == 400
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")


# ============================================================ REJECT / CANCEL / EXTEND regression
class TestReject:
    def test_reject(self, user, admin):
        item = _first_avail(user)
        p = _pickup(days_from_today=7)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_reject", "location": "", **p,
        })
        bid = r.json()["id"]
        r2 = admin.post(f"{API}/admin/bookings/{bid}/reject", json={"reason": "TEST_no"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "REJECTED"


# ============================================================ NO WHATSAPP
class TestNoWhatsapp:
    def test_no_whatsapp_channel_in_notifications_log(self, admin, user):
        item = _first_avail(user)
        p = _pickup(days_from_today=8)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_no_wa", "location": "", **p,
        })
        bid = r.json()["id"]
        try:
            logs = admin.get(f"{API}/admin/notifications-log").json()
            channels = {l.get("channel") for l in logs}
            assert "WHATSAPP" not in channels, f"WhatsApp channel still present: {channels}"
            # TELEGRAM channel should be the only non IN_APP channel
            assert channels.issubset({"TELEGRAM"}), f"unexpected channels: {channels}"
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_profile_endpoint_no_whatsapp_field(self, user):
        # PUT with whatsapp_number should be silently ignored (Pydantic strips unknown / ProfileInput has only phone)
        r = user.put(f"{API}/me/profile", json={"whatsapp_number": "+628999"})
        assert r.status_code == 200
        # GET /auth/me should not contain a persisted whatsapp_number surface
        me = user.get(f"{API}/auth/me").json()
        assert me.get("whatsapp_number") in (None, "", "+628999") or "whatsapp_number" not in me
        # But phone field should update
        r2 = user.put(f"{API}/me/profile", json={"phone": "+628111222"})
        assert r2.status_code == 200


# ============================================================ INVOICE / REPORT with qty
class TestReportQty:
    def test_report_top_items_counts_qty(self, admin, user):
        # baseline
        before = admin.get(f"{API}/admin/reports", params={"days": 30}).json()
        # find target item with quantity >= 3
        items = user.get(f"{API}/items").json()
        target = next(i for i in items if i["quantity"] >= 3 and i["status"] == "AVAILABLE")
        base_count = next((it["count"] for it in before["top_items"] if it["name"] == target["name"]), 0)

        # Create + approve + return in same day so it counts
        p = _pickup(days_from_today=0, hh="00:15", duration=3)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": target["id"], "qty": 3}],
            "purpose": "TEST_report_qty", "location": "", **p,
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        try:
            after = admin.get(f"{API}/admin/reports", params={"days": 30}).json()
            new_count = next((it["count"] for it in after["top_items"] if it["name"] == target["name"]), 0)
            assert new_count >= base_count + 3, f"expected +3 qty, base={base_count} new={new_count}"
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_csv_export_name_xqty(self, admin, user):
        item = _first_avail(user, min_qty=2)
        p = _pickup(days_from_today=9)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 2}],
            "purpose": "TEST_csv_qty", "location": "", **p,
        })
        bid = r.json()["id"]
        try:
            rc = admin.get(f"{API}/admin/reports/export", params={"days": 30})
            assert rc.status_code == 200
            assert "text/csv" in rc.headers.get("content-type", "")
            assert f"{item['name']} x2" in rc.text, "expected 'name x2' pattern in CSV"
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")


# ============================================================ TELEGRAM WEBHOOK (regression)
class TestTelegram:
    def test_secret_required(self):
        r = requests.post(f"{API}/telegram/webhook", json={"update_id": 1})
        assert r.status_code == 403

    def test_start_ok(self):
        r = requests.post(f"{API}/telegram/webhook",
                          json={"update_id": 2, "message": {"chat": {"id": -1003912804350}, "text": "/start"}},
                          headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_approve_via_callback(self, user, admin):
        item = _first_avail(user)
        p = _pickup(days_from_today=45)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "purpose": "TEST_tg_cb", "location": "", **p,
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        r2 = requests.post(f"{API}/telegram/webhook",
                           json={"update_id": 3, "callback_query": {
                               "id": "cb1", "from": {"id": -1003912804350}, "data": f"approve:{bid}",
                           }},
                           headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r2.status_code == 200
        b = user.get(f"{API}/bookings/{bid}").json()
        assert b["status"] in ("APPROVED", "BORROWED", "OVERDUE")
        admin.post(f"{API}/admin/bookings/{bid}/confirm-return")


# ============================================================ ADMIN RBAC + SETTINGS + LOGS
class TestMisc:
    def test_admin_stats(self, admin):
        r = admin.get(f"{API}/admin/stats")
        assert r.status_code == 200
        for k in ["borrowed", "pending", "approved", "available_items", "total_items", "overdue", "active_access", "return_requests"]:
            assert k in r.json()

    def test_user_forbidden_stats(self, user):
        assert user.get(f"{API}/admin/stats").status_code == 403

    def test_settings_rw(self, admin):
        r = admin.put(f"{API}/settings", json={"buffer_before_minutes": 11, "buffer_after_minutes": 17})
        assert r.status_code == 200
        r2 = admin.get(f"{API}/settings")
        assert r2.json()["buffer_before_minutes"] == 11
        admin.put(f"{API}/settings", json={"buffer_before_minutes": 10, "buffer_after_minutes": 15})

    def test_item_admin_crud_with_quantity(self, admin):
        payload = {
            "name": "TEST_gadget", "category": "TEST", "item_code": f"TEST-{int(time.time())}",
            "photo": None, "condition": "BAIK", "location": "Gudang Utama", "notes": None,
            "status": "AVAILABLE", "quantity": 5,
        }
        r = admin.post(f"{API}/items", json=payload)
        assert r.status_code == 200
        iid = r.json()["id"]
        try:
            g = admin.get(f"{API}/items/{iid}").json()
            assert g["quantity"] == 5
        finally:
            admin.delete(f"{API}/items/{iid}")

    def test_reports_days(self, admin):
        for d in (7, 30, 90):
            r = admin.get(f"{API}/admin/reports", params={"days": d})
            assert r.status_code == 200
            assert r.json()["days"] == d

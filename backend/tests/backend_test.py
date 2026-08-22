"""End-to-end backend tests for Office Inventory Rental system."""
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/") if os.environ.get("REACT_APP_BACKEND_URL") else "https://warehouse-rental-5.preview.emergentagent.com"
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@kantor.id", "password": "admin123"}
USER = {"email": "ghozy@kantor.id", "password": "ghozy123"}
WEBHOOK_SECRET = "wh_secret_inventory_2026"


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


@pytest.fixture(scope="session")
def anon():
    return _client(None)


# ---------- auth
class TestAuth:
    def test_login_admin_ok(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"
        assert "access_token" in r.cookies

    def test_login_bad_pw(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong"})
        assert r.status_code == 401

    def test_me_unauth(self, anon):
        # Fresh session with no cookies
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_authed(self, user):
        r = user.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == USER["email"]


# ---------- items catalog
class TestItems:
    def test_list_items(self, user):
        r = user.get(f"{API}/items")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list) and len(data) >= 1
        # no mongo _id leakage
        assert all("_id" not in i for i in data)
        assert all("id" in i for i in data)

    def test_search_items(self, user):
        r = user.get(f"{API}/items", params={"q": "Sony"})
        assert r.status_code == 200
        names = [i["name"] for i in r.json()]
        assert any("Sony" in n for n in names)

    def test_filter_category(self, user):
        r = user.get(f"{API}/items", params={"category": "Kamera"})
        assert r.status_code == 200
        assert all(i["category"] == "Kamera" for i in r.json())


# ---------- admin RBAC
class TestRBAC:
    def test_user_cannot_access_admin(self, user):
        r = user.get(f"{API}/admin/stats")
        assert r.status_code == 403

    def test_admin_stats_ok(self, admin):
        r = admin.get(f"{API}/admin/stats")
        assert r.status_code == 200
        for k in ["borrowed", "pending", "approved", "available_items", "total_items", "overdue", "active_access", "return_requests"]:
            assert k in r.json()


# ---------- booking flow
@pytest.fixture(scope="session")
def sample_item(user):
    items = user.get(f"{API}/items").json()
    avail = [i for i in items if i["status"] == "AVAILABLE"]
    return avail[0]


def _iso(dt):
    return dt.astimezone(timezone(timedelta(hours=7))).isoformat()


class TestBookingLifecycle:
    booking_id = None
    access_code = None

    def test_01_create_booking(self, user, sample_item):
        start = datetime.now(timezone.utc) + timedelta(days=1)
        end = start + timedelta(hours=2)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [sample_item["id"]],
            "start_time": _iso(start),
            "end_time": _iso(end),
            "purpose": "TEST_booking_e2e",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "PENDING"
        assert data.get("access") in (None, {}), "Access must NOT be shown when pending"
        TestBookingLifecycle.booking_id = data["id"]
        TestBookingLifecycle._start = start
        TestBookingLifecycle._end = end
        TestBookingLifecycle._item = sample_item

    def test_02_double_booking_blocked(self, user):
        start = TestBookingLifecycle._start + timedelta(minutes=30)
        end = TestBookingLifecycle._end + timedelta(minutes=30)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [TestBookingLifecycle._item["id"]],
            "start_time": _iso(start),
            "end_time": _iso(end),
            "purpose": "TEST_overlap",
        })
        assert r.status_code == 400
        assert "tidak tersedia" in r.json().get("detail", "").lower()

    def test_03_get_booking_pending_hides_access(self, user):
        r = user.get(f"{API}/bookings/{TestBookingLifecycle.booking_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "PENDING"
        assert data.get("access") in (None, {})

    def test_04_admin_can_see_pending(self, admin):
        r = admin.get(f"{API}/admin/bookings", params={"status": "PENDING"})
        assert r.status_code == 200
        ids = [b["id"] for b in r.json()]
        assert TestBookingLifecycle.booking_id in ids

    def test_05_approve_booking(self, admin):
        r = admin.post(f"{API}/admin/bookings/{TestBookingLifecycle.booking_id}/approve")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "APPROVED"
        assert data["access"]["code"]
        assert len(data["access"]["code"]) == 6
        assert data["calendar"]["status"] == "SYNCED"
        TestBookingLifecycle.access_code = data["access"]["code"]

    def test_06_user_sees_access_after_approval(self, user):
        r = user.get(f"{API}/bookings/{TestBookingLifecycle.booking_id}")
        assert r.status_code == 200
        assert r.json()["access"]["code"] == TestBookingLifecycle.access_code

    def test_07_notifications_visible(self, user):
        r = user.get(f"{API}/notifications")
        assert r.status_code == 200
        types = [n["type"] for n in r.json()]
        assert "BOOKING_APPROVED" in types

    def test_08_mark_all_read(self, user):
        r = user.post(f"{API}/notifications/read-all")
        assert r.status_code == 200

    def test_09_request_return(self, user):
        r = user.post(f"{API}/bookings/{TestBookingLifecycle.booking_id}/return", json={
            "condition": "BAIK", "notes": "TEST_return"
        })
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "RETURN_REQUESTED"

    def test_10_admin_confirm_return(self, admin):
        r = admin.post(f"{API}/admin/bookings/{TestBookingLifecycle.booking_id}/confirm-return")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "RETURNED"
        assert data.get("access") in (None, {}) or data["access"].get("status") == "EXPIRED"

    def test_11_item_available_again(self, user):
        r = user.get(f"{API}/items/{TestBookingLifecycle._item['id']}")
        assert r.status_code == 200
        assert r.json()["status"] == "AVAILABLE"


# ---------- reject flow
class TestReject:
    def test_reject_booking(self, user, admin):
        items = user.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][0]
        start = datetime.now(timezone.utc) + timedelta(days=3)
        end = start + timedelta(hours=1)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [item["id"]],
            "start_time": _iso(start),
            "end_time": _iso(end),
            "purpose": "TEST_reject",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        r2 = admin.post(f"{API}/admin/bookings/{bid}/reject", json={"reason": "TEST_no"})
        assert r2.status_code == 200
        assert r2.json()["status"] == "REJECTED"


# ---------- maintenance blocks booking
class TestMaintenance:
    def test_maintenance_prevents_booking(self, admin, user):
        # Get an available item, put in maintenance, try to book it
        items = admin.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][-1]
        orig = item.copy()
        payload = {k: item.get(k) for k in ["name", "category", "item_code", "photo", "condition", "location", "notes"]}
        payload["status"] = "MAINTENANCE"
        r = admin.put(f"{API}/items/{item['id']}", json=payload)
        assert r.status_code == 200
        assert r.json()["status"] == "MAINTENANCE"

        start = datetime.now(timezone.utc) + timedelta(days=5)
        r2 = user.post(f"{API}/bookings", json={
            "item_ids": [item["id"]],
            "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=1)),
            "purpose": "TEST_maint",
        })
        assert r2.status_code == 400
        assert "maintenance" in r2.json().get("detail", "").lower()

        # restore
        payload["status"] = orig["status"]
        admin.put(f"{API}/items/{item['id']}", json=payload)


# ---------- settings
class TestSettings:
    def test_read_settings(self, user):
        r = user.get(f"{API}/settings")
        assert r.status_code == 200
        assert "buffer_before_minutes" in r.json()

    def test_user_cannot_write_settings(self, user):
        r = user.put(f"{API}/settings", json={"buffer_before_minutes": 5, "buffer_after_minutes": 20})
        assert r.status_code == 403

    def test_admin_updates_settings_persist(self, admin):
        r = admin.put(f"{API}/settings", json={"buffer_before_minutes": 12, "buffer_after_minutes": 18})
        assert r.status_code == 200
        r2 = admin.get(f"{API}/settings")
        assert r2.json()["buffer_before_minutes"] == 12
        assert r2.json()["buffer_after_minutes"] == 18
        # restore
        admin.put(f"{API}/settings", json={"buffer_before_minutes": 10, "buffer_after_minutes": 15})


# ---------- logs
class TestLogs:
    def test_access_logs(self, admin):
        r = admin.get(f"{API}/admin/access-logs")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_audit_logs(self, admin):
        r = admin.get(f"{API}/admin/audit-logs")
        assert r.status_code == 200

    def test_notifications_log(self, admin):
        r = admin.get(f"{API}/admin/notifications-log")
        assert r.status_code == 200


# ---------- items admin CRUD
class TestItemAdmin:
    def test_create_and_delete(self, admin):
        payload = {
            "name": "TEST_Gadget", "category": "TEST", "item_code": f"TEST-{int(time.time())}",
            "photo": None, "condition": "BAIK", "location": "Gudang Utama", "notes": None, "status": "AVAILABLE",
        }
        r = admin.post(f"{API}/items", json=payload)
        assert r.status_code == 200
        item_id = r.json()["id"]

        # Verify via GET
        r2 = admin.get(f"{API}/items/{item_id}")
        assert r2.status_code == 200
        assert r2.json()["name"] == "TEST_Gadget"

        r3 = admin.delete(f"{API}/items/{item_id}")
        assert r3.status_code == 200

        r4 = admin.get(f"{API}/items/{item_id}")
        assert r4.status_code == 404


# ---------- telegram webhook
class TestTelegramWebhook:
    def test_webhook_rejects_without_secret(self):
        r = requests.post(f"{API}/telegram/webhook", json={"update_id": 1})
        assert r.status_code == 403

    def test_webhook_accepts_with_secret_start(self):
        r = requests.post(f"{API}/telegram/webhook",
                          json={"update_id": 2, "message": {"chat": {"id": 9999}, "text": "/start"}},
                          headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_webhook_approve_callback(self, user, admin):
        # create a fresh booking
        items = user.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][0]
        start = datetime.now(timezone.utc) + timedelta(days=45)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [item["id"]],
            "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=1)),
            "purpose": "TEST_tg_approve",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        # send approve callback via webhook (no admin_ids configured => any chat allowed)
        r2 = requests.post(f"{API}/telegram/webhook",
                           json={"update_id": 3, "callback_query": {
                               "id": "cb1", "from": {"id": -1003912804350}, "data": f"approve:{bid}",
                           }},
                           headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r2.status_code == 200
        # verify booking is approved
        r3 = admin.get(f"{API}/admin/bookings", params={"status": "APPROVED"})
        ids = [b["id"] for b in r3.json()]
        assert bid in ids


# ---------- reports (iteration 2)
class TestReports:
    def test_user_cannot_access_reports(self, user):
        r = user.get(f"{API}/admin/reports", params={"days": 30})
        assert r.status_code == 403

    def test_user_cannot_export(self, user):
        r = user.get(f"{API}/admin/reports/export", params={"days": 30})
        assert r.status_code == 403

    def test_reports_30_days_structure(self, admin):
        r = admin.get(f"{API}/admin/reports", params={"days": 30})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["days"] == 30
        for k in ["bookings", "returned", "overdue", "items", "users"]:
            assert k in data["totals"], f"missing totals.{k}"
        assert isinstance(data["top_items"], list)
        assert isinstance(data["top_users"], list)
        assert isinstance(data["late_users"], list)
        assert isinstance(data["trend"], list)

    def test_reports_7_days(self, admin):
        r = admin.get(f"{API}/admin/reports", params={"days": 7})
        assert r.status_code == 200
        assert r.json()["days"] == 7

    def test_reports_90_days(self, admin):
        r = admin.get(f"{API}/admin/reports", params={"days": 90})
        assert r.status_code == 200
        assert r.json()["days"] == 90

    def test_reports_consistency_after_full_cycle(self, admin, user):
        # snapshot
        before = admin.get(f"{API}/admin/reports", params={"days": 30}).json()
        # fresh booking cycle
        items = user.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][0]
        start = datetime.now(timezone.utc) + timedelta(days=20)
        end = start + timedelta(hours=1)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [item["id"]],
            "start_time": _iso(start), "end_time": _iso(end),
            "purpose": "TEST_report_cycle",
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        assert admin.post(f"{API}/admin/bookings/{bid}/approve").status_code == 200
        assert user.post(f"{API}/bookings/{bid}/return", json={"condition": "BAIK", "notes": "TEST"}).status_code == 200
        assert admin.post(f"{API}/admin/bookings/{bid}/confirm-return").status_code == 200

        after = admin.get(f"{API}/admin/reports", params={"days": 30}).json()
        assert after["totals"]["bookings"] >= before["totals"]["bookings"] + 1
        assert after["totals"]["returned"] >= before["totals"]["returned"] + 1
        # user should appear in top_users
        user_names = [u["name"] for u in after["top_users"]]
        assert any(user_names), "top_users should not be empty"
        # item should appear in top_items
        item_names = [i["name"] for i in after["top_items"]]
        assert item["name"] in item_names

    def test_reports_export_csv(self, admin):
        r = admin.get(f"{API}/admin/reports/export", params={"days": 30})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        cd = r.headers.get("content-disposition", "")
        assert "attachment" in cd.lower()
        assert "laporan-30hari.csv" in cd
        first_line = r.text.split("\n")[0]
        for header in ["Booking", "Peminjam", "Barang", "Mulai", "Selesai", "Status", "Dikembalikan", "Terlambat"]:
            assert header in first_line, f"Missing CSV header {header}"


# ---------- profile whatsapp (iteration 2)
class TestProfileWhatsapp:
    def test_update_whatsapp_number_persists(self, user):
        new_num = "+628123456789"
        r = user.put(f"{API}/me/profile", json={"whatsapp_number": new_num})
        assert r.status_code == 200, r.text
        r2 = user.get(f"{API}/auth/me")
        assert r2.status_code == 200
        assert r2.json().get("whatsapp_number") == new_num

    def test_whatsapp_notification_recorded(self, user, admin):
        # ensure whatsapp_number set
        user.put(f"{API}/me/profile", json={"whatsapp_number": "+628123456789"})
        # trigger event: create booking -> admin notif WA recorded (admin_number empty ok, but user WA also sent on approve)
        items = user.get(f"{API}/items").json()
        item = [i for i in items if i["status"] == "AVAILABLE"][0]
        start = datetime.now(timezone.utc) + timedelta(days=25)
        r = user.post(f"{API}/bookings", json={
            "item_ids": [item["id"]],
            "start_time": _iso(start), "end_time": _iso(start + timedelta(hours=1)),
            "purpose": "TEST_wa_notif",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        admin.post(f"{API}/admin/bookings/{bid}/approve")
        # verify WA notif recorded in admin log
        logs = admin.get(f"{API}/admin/notifications-log").json()
        wa_logs = [l for l in logs if l.get("channel") == "WHATSAPP"]
        assert len(wa_logs) > 0, "expected at least one WHATSAPP notification recorded"
        # simulated flag should be True since creds are empty
        assert any(l.get("simulated") is True for l in wa_logs)


# ---------- telegram /laporan (iteration 2)
class TestTelegramLaporan:
    def test_laporan_command(self):
        r = requests.post(f"{API}/telegram/webhook",
                          json={"update_id": 99, "message": {"chat": {"id": -1003912804350}, "text": "/laporan"}},
                          headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r.status_code == 200
        assert r.json()["ok"] is True


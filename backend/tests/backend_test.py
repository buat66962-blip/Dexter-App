"""End-to-end backend tests (Iteration 3 schema: duration_type/return_date + templates + uploads + handover + live stock)."""
import io
import os
import time
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
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


def _today_offset(days=1):
    return (datetime.now(WIB) + timedelta(days=days)).date().isoformat()


def _first_avail(sess, min_qty=1):
    items = sess.get(f"{API}/items").json()
    for i in items:
        if i.get("status") == "AVAILABLE" and i.get("quantity", 0) >= min_qty:
            return i
    raise AssertionError("no available item")


# ==================================================================== AUTH
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200 and r.json()["role"] == "admin"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "x"})
        assert r.status_code == 401

    def test_files_requires_auth(self):
        r = requests.get(f"{API}/files/dummy/path.jpg")
        assert r.status_code == 401


# =============================================================== BOOKING HOURS
class TestBookingHours:
    def test_hours_ok(self, user):
        item = _first_avail(user)
        pd = _today_offset(3)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "duration_type": "hours", "duration_hours": 6,
            "purpose": "TEST_hours", "location": "Studio",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["duration_hours"] == 6
        assert d["return_date"] == pd
        start = datetime.fromisoformat(d["start_time"].replace("Z", "+00:00")).astimezone(WIB)
        end = datetime.fromisoformat(d["end_time"].replace("Z", "+00:00")).astimezone(WIB)
        assert start.hour == 8 and start.minute == 0
        assert end.hour == 14 and end.minute == 0
        user.post(f"{API}/bookings/{d['id']}/cancel")

    def test_hours_zero_rejected(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(3), "duration_type": "hours", "duration_hours": 0,
            "purpose": "TEST_bad", "location": "",
        })
        assert r.status_code == 400

    def test_hours_thirteen_rejected(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(3), "duration_type": "hours", "duration_hours": 13,
            "purpose": "TEST_bad", "location": "",
        })
        assert r.status_code == 400


# ================================================================ BOOKING DAYS
class TestBookingDays:
    def test_days_ok(self, user):
        item = _first_avail(user)
        pd = _today_offset(4)
        rd = _today_offset(6)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "duration_type": "days", "return_date": rd,
            "purpose": "TEST_days", "location": "",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["return_date"] == rd
        end = datetime.fromisoformat(d["end_time"].replace("Z", "+00:00")).astimezone(WIB)
        assert end.hour == 17 and end.minute == 0
        # duration_hours = (2 days*24) + (17-8)=9 -> 57
        assert d["duration_hours"] == 2 * 24 + 9
        user.post(f"{API}/bookings/{d['id']}/cancel")

    def test_days_missing_return_date(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(4), "duration_type": "days",
            "purpose": "TEST", "location": "",
        })
        assert r.status_code == 400
        assert "tanggal pengembalian" in r.json().get("detail", "").lower()

    def test_days_return_before_pickup(self, user):
        item = _first_avail(user)
        pd = _today_offset(6)
        rd = _today_offset(4)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "duration_type": "days", "return_date": rd,
            "purpose": "TEST", "location": "",
        })
        assert r.status_code == 400


# ========================================================= CHECKLIST UNLOCK
class TestChecklistLock:
    def test_locked_future(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(5), "duration_type": "hours", "duration_hours": 4,
            "purpose": "TEST_lock", "location": "",
        })
        assert r.status_code == 200
        bid = r.json()["id"]
        try:
            ra = admin.post(f"{API}/admin/bookings/{bid}/approve")
            assert ra.status_code == 200, ra.text
            b = user.get(f"{API}/bookings/{bid}").json()
            assert b["checklist_unlocked"] is False
            r2 = user.post(f"{API}/bookings/{bid}/checklist",
                           json={"item_id": b["checklist"][0]["item_id"], "checked": True})
            assert r2.status_code == 400
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_unlocked_today(self, user, admin):
        item = _first_avail(user, min_qty=5)
        pd = _today_offset(0)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "duration_type": "hours", "duration_hours": 2,
            "purpose": "TEST_today", "location": "",
        })
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        try:
            admin.post(f"{API}/admin/bookings/{bid}/approve")
            b = user.get(f"{API}/bookings/{bid}").json()
            assert b["checklist_unlocked"] is True
        finally:
            admin.post(f"{API}/admin/bookings/{bid}/confirm-return")


# ================================================================== TEMPLATES
class TestTemplates:
    def test_create_and_get_own(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/templates", json={
            "name": "TEST_paket_user", "lines": [{"item_id": item["id"], "qty": 2}], "is_shared": False,
        })
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["name"] == "TEST_paket_user"
        assert t["lines"][0]["item_id"] == item["id"]
        assert t["lines"][0]["qty"] == 2
        assert t["lines"][0]["name"] == item["name"]
        assert t["lines"][0]["category"] == item["category"]
        assert t["lines"][0]["item_code"] == item["item_code"]
        assert "max" in t["lines"][0]
        tid = t["id"]

        listed = user.get(f"{API}/templates").json()
        assert any(x["id"] == tid for x in listed)
        # cleanup
        r2 = user.delete(f"{API}/templates/{tid}")
        assert r2.status_code == 200

    def test_shared_visible_to_other_user(self, admin, user):
        item = _first_avail(admin)
        r = admin.post(f"{API}/templates", json={
            "name": "TEST_paket_shared", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": True,
        })
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            listed = user.get(f"{API}/templates").json()
            assert any(x["id"] == tid for x in listed), "shared template must be visible to other user"
        finally:
            admin.delete(f"{API}/templates/{tid}")

    def test_delete_forbidden_for_non_owner(self, admin, user):
        # user creates -> admin can delete (admin bypass), other user cannot
        item = _first_avail(user)
        r = user.post(f"{API}/templates", json={
            "name": "TEST_paket_own", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": True,
        })
        tid = r.json()["id"]
        try:
            # Create a 2nd non-owner user? we only have user + admin. Admin bypasses (should succeed).
            # We verify admin CAN delete (owner-or-admin rule). To verify 403 for non-owner, we would need
            # a 2nd non-admin. Use fake: another session logging as admin's template deleted by user.
            # Instead: create with admin, try delete with user -> 403.
            r2 = admin.post(f"{API}/templates", json={
                "name": "TEST_paket_admin", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": True,
            })
            aid = r2.json()["id"]
            rf = user.delete(f"{API}/templates/{aid}")
            assert rf.status_code == 403
            admin.delete(f"{API}/templates/{aid}")
        finally:
            user.delete(f"{API}/templates/{tid}")

    def test_empty_lines_rejected(self, user):
        r = user.post(f"{API}/templates", json={"name": "TEST_kosong", "lines": [], "is_shared": False})
        assert r.status_code == 400


# =================================================================== UPLOADS
def _png_bytes(size_kb=2):
    # tiny valid PNG (1x1) then pad to reach approx size
    png = bytes.fromhex(
        "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4"
        "890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082"
    )
    pad = b"\0" * max(0, size_kb * 1024 - len(png))
    return png + pad


class TestUploadFiles:
    uploaded_path = None

    def test_upload_ok_and_get_requires_auth(self, user):
        files = {"file": ("test.png", io.BytesIO(_png_bytes(4)), "image/png")}
        sess = requests.Session()
        sess.post(f"{API}/auth/login", json=USER)
        r = sess.post(f"{API}/uploads", files=files)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "path" in j and j["path"].startswith("gudang-kantor/uploads/")
        assert j["url"].startswith("/api/files/")
        TestUploadFiles.uploaded_path = j["path"]

        # GET with cookie -> 200 image
        r2 = sess.get(f"{API}/files/{j['path']}")
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/")
        assert len(r2.content) > 0

        # GET without cookie -> 401
        r3 = requests.get(f"{API}/files/{j['path']}")
        assert r3.status_code == 401

    def test_upload_too_large(self):
        sess = requests.Session()
        sess.post(f"{API}/auth/login", json=USER)
        big = b"A" * (8 * 1024 * 1024 + 100)
        files = {"file": ("big.jpg", io.BytesIO(big), "image/jpeg")}
        r = sess.post(f"{API}/uploads", files=files)
        assert r.status_code == 400
        assert "8 mb" in r.json().get("detail", "").lower()


# ==================================================================== HANDOVER
class TestHandover:
    def _upload_photo(self, sess):
        files = {"file": ("h.png", io.BytesIO(_png_bytes(2)), "image/png")}
        sess2 = requests.Session()
        sess2.post(f"{API}/auth/login", json=USER)
        r = sess2.post(f"{API}/uploads", files=files)
        assert r.status_code == 200, r.text
        return r.json()["path"]

    def test_pickup_before_approve_rejected(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(7), "duration_type": "hours", "duration_hours": 4,
            "purpose": "TEST_handover_early", "location": "",
        })
        bid = r.json()["id"]
        try:
            path = self._upload_photo(user)
            r2 = user.post(f"{API}/bookings/{bid}/handover",
                           json={"phase": "pickup", "photos": [path]})
            assert r2.status_code == 400
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_pickup_after_approve_ok_and_return_locked(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(7), "duration_type": "hours", "duration_hours": 4,
            "purpose": "TEST_handover_ok", "location": "",
        })
        bid = r.json()["id"]
        try:
            admin.post(f"{API}/admin/bookings/{bid}/approve")
            path = self._upload_photo(user)
            r2 = user.post(f"{API}/bookings/{bid}/handover",
                           json={"phase": "pickup", "photos": [path], "notes": "TEST"})
            assert r2.status_code == 200, r2.text
            assert path in r2.json()["pickup_photos"]

            # return locked (future)
            r3 = user.post(f"{API}/bookings/{bid}/handover",
                           json={"phase": "return", "photos": [path]})
            assert r3.status_code == 400
            assert "hari pengembalian" in r3.json().get("detail", "").lower()

            # bad phase
            r4 = user.post(f"{API}/bookings/{bid}/handover",
                           json={"phase": "delivery", "photos": [path]})
            assert r4.status_code == 400
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")


# =================================================================== LIVE STOCK
class TestLiveStock:
    def test_no_window_returns_full_qty(self, user):
        items = user.get(f"{API}/items").json()
        for i in items:
            if i.get("status") != "MAINTENANCE":
                assert i["available_qty"] == i["quantity"]

    def test_available_qty_drops(self, user):
        items = user.get(f"{API}/items").json()
        target = next(i for i in items if i["quantity"] >= 3 and i["status"] == "AVAILABLE")
        pd = _today_offset(8)
        start_iso = f"{pd}T08:00:00+07:00"
        end_iso = f"{pd}T12:00:00+07:00"
        base = next(i for i in user.get(f"{API}/items", params={"start_time": start_iso, "end_time": end_iso}).json() if i["id"] == target["id"])["available_qty"]
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": target["id"], "qty": 2}],
            "pickup_date": pd, "duration_type": "hours", "duration_hours": 4,
            "purpose": "TEST_stock", "location": "",
        })
        bid = r.json()["id"]
        try:
            after = next(i for i in user.get(f"{API}/items", params={"start_time": start_iso, "end_time": end_iso}).json() if i["id"] == target["id"])["available_qty"]
            assert after == base - 2
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")


# ================================================================ TELEGRAM (regression)
class TestTelegram:
    def test_secret_required(self):
        r = requests.post(f"{API}/telegram/webhook", json={"update_id": 1})
        assert r.status_code == 403

    def test_start_ok(self):
        r = requests.post(f"{API}/telegram/webhook",
                          json={"update_id": 2, "message": {"chat": {"id": -1003912804350}, "text": "/start"}},
                          headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r.status_code == 200

    def test_approve_via_callback(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(40), "duration_type": "hours", "duration_hours": 4,
            "purpose": "TEST_tg_cb", "location": "",
        })
        bid = r.json()["id"]
        r2 = requests.post(f"{API}/telegram/webhook",
                           json={"update_id": 3, "callback_query": {
                               "id": "cb_iter3", "from": {"id": -1003912804350}, "data": f"approve:{bid}"}},
                           headers={"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET})
        assert r2.status_code == 200
        b = user.get(f"{API}/bookings/{bid}").json()
        assert b["status"] in ("APPROVED", "BORROWED", "OVERDUE")
        admin.post(f"{API}/admin/bookings/{bid}/confirm-return")


# =================================================================== ADMIN
class TestAdminMisc:
    def test_user_forbidden_stats(self, user):
        assert user.get(f"{API}/admin/stats").status_code == 403

    def test_reports_days(self, admin):
        for d in (7, 30, 90):
            r = admin.get(f"{API}/admin/reports", params={"days": d})
            assert r.status_code == 200
            assert r.json()["days"] == d

    def test_reports_csv_export(self, admin):
        r = admin.get(f"{API}/admin/reports/export", params={"days": 30})
        assert r.status_code == 200
        assert "text/csv" in r.headers.get("content-type", "")
        assert "laporan-30hari.csv" in r.headers.get("content-disposition", "")

    def test_calendar_live(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(30), "duration_type": "hours", "duration_hours": 3,
            "purpose": "TEST_cal_live", "location": "",
        })
        bid = r.json()["id"]
        try:
            ra = admin.post(f"{API}/admin/bookings/{bid}/approve")
            data = ra.json()
            cal = data["calendar"]
            assert cal["status"] == "SYNCED"
            assert cal.get("simulated") is False
            assert cal.get("calendar_id") == "yncrewcalendar@gmail.com"
        finally:
            admin.post(f"{API}/admin/bookings/{bid}/confirm-return")

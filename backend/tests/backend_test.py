"""Iteration 4 backend tests: pickup_date/return_date-only schema, Telegram webhook approve
from admin group chat, editable templates (multi + PUT), regression coverage."""
import io
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@kantor.id", "password": "admin123"}
USER = {"email": "ghozy@kantor.id", "password": "ghozy123"}
WEBHOOK_SECRET = "wh_secret_inventory_2026"
ADMIN_GROUP_ID = "-1003912804350"
RANDOM_FROM_ID = "999888777"  # not registered admin id
WIB = timezone(timedelta(hours=7))


def _client(creds):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
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


# ====================================================================== AUTH
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN)
        assert r.status_code == 200 and r.json()["role"] == "admin"

    def test_login_bad(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "x"})
        assert r.status_code == 401


# ===================================================== BOOKING (new schema)
class TestBookingSchema:
    def test_same_day_ok(self, user):
        item = _first_avail(user)
        pd = _today_offset(3)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "return_date": pd,
            "purpose": "TEST_same_day", "location": "Studio",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["pickup_date"] == pd and d["return_date"] == pd
        assert "duration_days" in d and d["duration_days"] >= 1
        assert "duration_hours" in d and d["duration_hours"] > 0
        start = datetime.fromisoformat(d["start_time"].replace("Z", "+00:00")).astimezone(WIB)
        end = datetime.fromisoformat(d["end_time"].replace("Z", "+00:00")).astimezone(WIB)
        assert (start.hour, start.minute) == (8, 0)
        assert (end.hour, end.minute) == (17, 0)
        user.post(f"{API}/bookings/{d['id']}/cancel")

    def test_multi_day_ok(self, user):
        item = _first_avail(user)
        pd = _today_offset(4)
        rd = _today_offset(6)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "return_date": rd,
            "purpose": "TEST_multi_day", "location": "",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["return_date"] == rd
        user.post(f"{API}/bookings/{d['id']}/cancel")

    def test_return_before_pickup_400(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(6), "return_date": _today_offset(4),
            "purpose": "TEST_bad", "location": "",
        })
        assert r.status_code == 400

    def test_missing_return_date_422(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(4),
            "purpose": "TEST_bad", "location": "",
        })
        assert r.status_code == 422

    def test_old_duration_type_field_not_required(self, user):
        # Payload has NO duration_type/duration_hours/pickup_time; must still work.
        item = _first_avail(user)
        pd = _today_offset(5)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "return_date": pd,
            "purpose": "TEST_no_duration_type", "location": "",
        })
        assert r.status_code == 200, r.text
        user.post(f"{API}/bookings/{r.json()['id']}/cancel")


# ============================================ CHECKLIST UNLOCK (return_date)
class TestChecklistUnlock:
    def test_locked_when_future(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(5), "return_date": _today_offset(6),
            "purpose": "TEST_lock", "location": "",
        })
        bid = r.json()["id"]
        try:
            admin.post(f"{API}/admin/bookings/{bid}/approve")
            b = user.get(f"{API}/bookings/{bid}").json()
            assert b["checklist_unlocked"] is False
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_unlocked_today(self, user, admin):
        item = _first_avail(user, min_qty=3)
        pd = _today_offset(0)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": pd, "return_date": pd,
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


# =========================================================== TEMPLATES (PUT)
class TestTemplates:
    def test_user_can_have_multiple_templates(self, user):
        item = _first_avail(user)
        created = []
        for name in ("TEST_pkt_A", "TEST_pkt_B"):
            r = user.post(f"{API}/templates", json={
                "name": name, "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": False,
            })
            assert r.status_code == 200, r.text
            created.append(r.json()["id"])
        try:
            listed = user.get(f"{API}/templates").json()
            mine = [t for t in listed if t["id"] in created]
            assert len(mine) == 2
        finally:
            for tid in created:
                user.delete(f"{API}/templates/{tid}")

    def test_put_updates_name_shared_and_lines(self, user):
        items_all = user.get(f"{API}/items").json()
        it1 = next(i for i in items_all if i.get("status") == "AVAILABLE")
        it2 = next(i for i in items_all if i["id"] != it1["id"] and i.get("status") == "AVAILABLE")
        r = user.post(f"{API}/templates", json={
            "name": "TEST_pkt_edit", "lines": [{"item_id": it1["id"], "qty": 1}], "is_shared": False,
        })
        tid = r.json()["id"]
        try:
            r2 = user.put(f"{API}/templates/{tid}", json={
                "name": "TEST_pkt_edit_v2",
                "is_shared": True,
                "lines": [
                    {"item_id": it1["id"], "qty": 3},   # qty changed
                    {"item_id": it2["id"], "qty": 1},   # new item added
                ],
            })
            assert r2.status_code == 200, r2.text
            d = r2.json()
            assert d["name"] == "TEST_pkt_edit_v2"
            assert d["is_shared"] is True
            by_id = {l["item_id"]: l for l in d["lines"]}
            assert by_id[it1["id"]]["qty"] == 3
            assert it2["id"] in by_id
            # remove it2 next
            r3 = user.put(f"{API}/templates/{tid}", json={
                "name": "TEST_pkt_edit_v2", "is_shared": False,
                "lines": [{"item_id": it1["id"], "qty": 2}],
            })
            assert r3.status_code == 200
            d3 = r3.json()
            assert len(d3["lines"]) == 1
            assert d3["is_shared"] is False
        finally:
            user.delete(f"{API}/templates/{tid}")

    def test_put_by_non_owner_forbidden(self, admin, user):
        item = _first_avail(admin)
        r = admin.post(f"{API}/templates", json={
            "name": "TEST_pkt_admin_owned", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": True,
        })
        tid = r.json()["id"]
        try:
            rf = user.put(f"{API}/templates/{tid}", json={
                "name": "hijack", "is_shared": False,
                "lines": [{"item_id": item["id"], "qty": 5}],
            })
            assert rf.status_code == 403
        finally:
            admin.delete(f"{API}/templates/{tid}")

    def test_put_admin_can_edit_user_template(self, admin, user):
        item = _first_avail(user)
        r = user.post(f"{API}/templates", json={
            "name": "TEST_pkt_user_by_admin", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": False,
        })
        tid = r.json()["id"]
        try:
            r2 = admin.put(f"{API}/templates/{tid}", json={
                "name": "TEST_admin_edited", "is_shared": True,
                "lines": [{"item_id": item["id"], "qty": 2}],
            })
            assert r2.status_code == 200, r2.text
            assert r2.json()["name"] == "TEST_admin_edited"
        finally:
            user.delete(f"{API}/templates/{tid}")

    def test_put_empty_lines_400(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/templates", json={
            "name": "TEST_pkt_empty_edit", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": False,
        })
        tid = r.json()["id"]
        try:
            r2 = user.put(f"{API}/templates/{tid}",
                          json={"name": "x", "is_shared": False, "lines": []})
            assert r2.status_code == 400
        finally:
            user.delete(f"{API}/templates/{tid}")

    def test_delete_by_non_owner_forbidden(self, admin, user):
        item = _first_avail(admin)
        r = admin.post(f"{API}/templates", json={
            "name": "TEST_pkt_del", "lines": [{"item_id": item["id"], "qty": 1}], "is_shared": True,
        })
        tid = r.json()["id"]
        try:
            assert user.delete(f"{API}/templates/{tid}").status_code == 403
        finally:
            admin.delete(f"{API}/templates/{tid}")


# ========================================== TELEGRAM webhook — the main bug
class TestTelegramWebhook:
    def _hdr(self):
        return {"X-Telegram-Bot-Api-Secret-Token": WEBHOOK_SECRET}

    def test_missing_secret_403(self):
        r = requests.post(f"{API}/telegram/webhook", json={"update_id": 1})
        assert r.status_code == 403

    def test_message_from_non_admin_rejected(self):
        # random chat.id + random from.id
        r = requests.post(f"{API}/telegram/webhook", headers=self._hdr(), json={
            "update_id": 2,
            "message": {"chat": {"id": 111111}, "from": {"id": 111111}, "text": "/home"},
        })
        assert r.status_code == 200  # webhook always returns 200; behavior is send()

    def test_callback_from_random_user_in_random_chat_rejected(self, user):
        # create a booking to have valid bid
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(41), "return_date": _today_offset(41),
            "purpose": "TEST_tg_reject", "location": "",
        })
        bid = r.json()["id"]
        try:
            r2 = requests.post(f"{API}/telegram/webhook", headers=self._hdr(), json={
                "update_id": 3,
                "callback_query": {
                    "id": "cb_random",
                    "from": {"id": int(RANDOM_FROM_ID)},
                    "message": {"chat": {"id": 42424242}},
                    "data": f"approve:{bid}",
                },
            })
            assert r2.status_code == 200
            b = user.get(f"{API}/bookings/{bid}").json()
            # Must still be pending (rejected by webhook)
            assert b["status"] == "PENDING"
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")

    def test_bug_approve_from_random_user_in_admin_group(self, user, admin):
        """PRIMARY BUG: from.id NOT in admin list but chat.id IS admin group → approve succeeds."""
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(42), "return_date": _today_offset(42),
            "purpose": "TEST_tg_group_approve", "location": "",
        })
        bid = r.json()["id"]
        try:
            r2 = requests.post(f"{API}/telegram/webhook", headers=self._hdr(), json={
                "update_id": 4,
                "callback_query": {
                    "id": "cb_group_approve",
                    "from": {"id": int(RANDOM_FROM_ID)},   # not registered admin
                    "message": {"chat": {"id": int(ADMIN_GROUP_ID)}},  # admin group
                    "data": f"approve:{bid}",
                },
            })
            assert r2.status_code == 200
            b = user.get(f"{API}/bookings/{bid}").json()
            assert b["status"] in ("APPROVED", "BORROWED", "OVERDUE"), f"got {b['status']}"
        finally:
            admin.post(f"{API}/admin/bookings/{bid}/confirm-return")

    def test_reject_via_group(self, user):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(43), "return_date": _today_offset(43),
            "purpose": "TEST_tg_group_reject", "location": "",
        })
        bid = r.json()["id"]
        r2 = requests.post(f"{API}/telegram/webhook", headers=self._hdr(), json={
            "update_id": 5,
            "callback_query": {
                "id": "cb_group_reject",
                "from": {"id": int(RANDOM_FROM_ID)},
                "message": {"chat": {"id": int(ADMIN_GROUP_ID)}},
                "data": f"reject:{bid}",
            },
        })
        assert r2.status_code == 200
        b = requests.Session()
        b.post(f"{API}/auth/login", json=USER)
        got = b.get(f"{API}/bookings/{bid}").json()
        assert got["status"] == "REJECTED"


# ======================================================================= ADMIN
class TestAdmin:
    def test_user_forbidden_stats(self, user):
        assert user.get(f"{API}/admin/stats").status_code == 403

    def test_reports_and_csv(self, admin):
        r = admin.get(f"{API}/admin/reports", params={"days": 30})
        assert r.status_code == 200 and r.json()["days"] == 30
        rc = admin.get(f"{API}/admin/reports/export", params={"days": 30})
        assert rc.status_code == 200
        assert "text/csv" in rc.headers.get("content-type", "")

    def test_admin_tabs_load(self, admin):
        for path in ("/admin/bookings", "/admin/access-logs", "/admin/audit-logs",
                     "/admin/access-credentials", "/admin/notifications-log", "/admin/users"):
            r = admin.get(f"{API}{path}")
            assert r.status_code == 200, f"{path} -> {r.status_code}"


# ================================================== LIVE STOCK (regression)
class TestLiveStock:
    def test_available_drops(self, user):
        items_all = user.get(f"{API}/items").json()
        target = next(i for i in items_all if i["quantity"] >= 3 and i["status"] == "AVAILABLE")
        pd = _today_offset(20)
        start_iso = f"{pd}T08:00:00+07:00"
        end_iso = f"{pd}T17:00:00+07:00"
        base = next(i for i in user.get(f"{API}/items", params={
            "start_time": start_iso, "end_time": end_iso}).json() if i["id"] == target["id"])["available_qty"]
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": target["id"], "qty": 2}],
            "pickup_date": pd, "return_date": pd,
            "purpose": "TEST_stock", "location": "",
        })
        bid = r.json()["id"]
        try:
            after = next(i for i in user.get(f"{API}/items", params={
                "start_time": start_iso, "end_time": end_iso}).json() if i["id"] == target["id"])["available_qty"]
            assert after == base - 2
        finally:
            user.post(f"{API}/bookings/{bid}/cancel")


# =============================================== Google Calendar LIVE regression
class TestCalendar:
    def test_calendar_live_on_approve(self, user, admin):
        item = _first_avail(user)
        r = user.post(f"{API}/bookings", json={
            "lines": [{"item_id": item["id"], "qty": 1}],
            "pickup_date": _today_offset(35), "return_date": _today_offset(35),
            "purpose": "TEST_cal_live", "location": "",
        })
        bid = r.json()["id"]
        try:
            ra = admin.post(f"{API}/admin/bookings/{bid}/approve")
            assert ra.status_code == 200, ra.text
            cal = ra.json()["calendar"]
            assert cal["status"] == "SYNCED"
            assert cal.get("simulated") is False
            assert cal.get("calendar_id") == "yncrewcalendar@gmail.com"
        finally:
            admin.post(f"{API}/admin/bookings/{bid}/confirm-return")

"""Abstraction layer for external providers.

Every provider degrades gracefully to SIMULATION mode when credentials are
missing, so the core booking flow never fails because of an external API.
"""
import hashlib
import hmac
import json
import logging
import random
import time
from datetime import datetime
from typing import Optional

import requests

from core import env

logger = logging.getLogger("providers")
TIMEOUT = 12


class ProviderResult:
    def __init__(self, ok: bool, data: Optional[dict] = None, error: Optional[str] = None, simulated: bool = False):
        self.ok = ok
        self.data = data or {}
        self.error = error
        self.simulated = simulated

    def dict(self):
        return {"ok": self.ok, "data": self.data, "error": self.error, "simulated": self.simulated}


# --------------------------------------------------------------------------- door
class DoorProvider:
    name = "base"

    def create_code(self, door: dict, code: str, valid_from: datetime, valid_until: datetime) -> ProviderResult:
        raise NotImplementedError

    def revoke_code(self, door: dict, credential: dict) -> ProviderResult:
        raise NotImplementedError


class SimulatedDoorProvider(DoorProvider):
    name = "simulated"

    def create_code(self, door, code, valid_from, valid_until) -> ProviderResult:
        return ProviderResult(True, {"provider_code_id": f"sim-{int(time.time())}-{code}"}, simulated=True)

    def revoke_code(self, door, credential) -> ProviderResult:
        return ProviderResult(True, {"revoked": True}, simulated=True)


class TuyaDoorProvider(DoorProvider):
    """BARDI devices run on the Tuya cloud."""

    name = "tuya"

    def __init__(self):
        self.base = env("TUYA_API_BASE", "https://openapi.tuyaeu.com")
        self.access_id = env("TUYA_ACCESS_ID")
        self.access_secret = env("TUYA_ACCESS_SECRET")
        self._token = None
        self._token_exp = 0

    def configured(self) -> bool:
        return bool(self.access_id and self.access_secret)

    def _sign(self, token: str, method: str, path: str, body: str = "") -> dict:
        t = str(int(time.time() * 1000))
        content_sha = hashlib.sha256(body.encode()).hexdigest()
        string_to_sign = f"{method}\n{content_sha}\n\n{path}"
        payload = f"{self.access_id}{token}{t}{string_to_sign}"
        sign = hmac.new(self.access_secret.encode(), payload.encode(), hashlib.sha256).hexdigest().upper()
        return {
            "client_id": self.access_id,
            "access_token": token,
            "sign": sign,
            "t": t,
            "sign_method": "HMAC-SHA256",
            "Content-Type": "application/json",
        }

    def _get_token(self) -> str:
        if self._token and time.time() < self._token_exp:
            return self._token
        path = "/v1.0/token?grant_type=1"
        r = requests.get(self.base + path, headers=self._sign("", "GET", path), timeout=TIMEOUT)
        data = r.json()
        if not data.get("success"):
            raise RuntimeError(data.get("msg", "tuya token error"))
        self._token = data["result"]["access_token"]
        self._token_exp = time.time() + int(data["result"].get("expire_time", 3600)) - 60
        return self._token

    def create_code(self, door, code, valid_from, valid_until) -> ProviderResult:
        try:
            token = self._get_token()
            device_id = door.get("device_id")
            path = f"/v1.0/devices/{device_id}/door-lock/temp-password"
            body = json.dumps({
                "name": f"BOOK-{code}",
                "password": code,
                "effective_time": int(valid_from.timestamp()),
                "invalid_time": int(valid_until.timestamp()),
                "type": 0,
            })
            r = requests.post(self.base + path, headers=self._sign(token, "POST", path, body), data=body, timeout=TIMEOUT)
            data = r.json()
            if not data.get("success"):
                return ProviderResult(False, error=data.get("msg", "tuya error"))
            return ProviderResult(True, {"provider_code_id": str(data.get("result", {}).get("id", ""))})
        except Exception as e:  # network / offline door
            logger.warning("tuya create_code failed: %s", e)
            return ProviderResult(False, error=str(e))

    def revoke_code(self, door, credential) -> ProviderResult:
        try:
            token = self._get_token()
            path = f"/v1.0/devices/{door.get('device_id')}/door-lock/temp-passwords/{credential.get('provider_code_id')}"
            r = requests.delete(self.base + path, headers=self._sign(token, "DELETE", path), timeout=TIMEOUT)
            data = r.json()
            return ProviderResult(bool(data.get("success")), error=None if data.get("success") else data.get("msg"))
        except Exception as e:
            logger.warning("tuya revoke_code failed: %s", e)
            return ProviderResult(False, error=str(e))


def get_door_provider(provider_name: str = "") -> DoorProvider:
    tuya = TuyaDoorProvider()
    if provider_name in ("", "bardi", "tuya") and tuya.configured():
        return tuya
    return SimulatedDoorProvider()


def generate_code() -> str:
    return f"{random.randint(100000, 999999)}"


# ----------------------------------------------------------------------- telegram
class TelegramProvider:
    def __init__(self):
        self.token = env("TELEGRAM_BOT_TOKEN")
        self.admin_chat_ids = [c for c in env("TELEGRAM_ADMIN_CHAT_IDS").split(",") if c.strip()]

    def configured(self) -> bool:
        return bool(self.token)

    def _call(self, method: str, payload: dict) -> ProviderResult:
        if not self.configured():
            logger.info("[SIMULATED TELEGRAM] %s %s", method, payload)
            return ProviderResult(True, {"simulated": True}, simulated=True)
        try:
            r = requests.post(f"https://api.telegram.org/bot{self.token}/{method}", json=payload, timeout=TIMEOUT)
            data = r.json()
            if not data.get("ok"):
                return ProviderResult(False, error=str(data.get("description")))
            return ProviderResult(True, {"message_id": data.get("result", {}).get("message_id")})
        except Exception as e:
            return ProviderResult(False, error=str(e))

    def send(self, chat_id: str, text: str, buttons: Optional[list] = None) -> ProviderResult:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
        if buttons:
            payload["reply_markup"] = {"inline_keyboard": buttons}
        return self._call("sendMessage", payload)

    def broadcast_admins(self, text: str, buttons: Optional[list] = None) -> ProviderResult:
        if not self.admin_chat_ids:
            logger.info("[SIMULATED TELEGRAM ADMIN] %s", text)
            return ProviderResult(True, {"simulated": True}, simulated=True)
        last = ProviderResult(True)
        for chat_id in self.admin_chat_ids:
            last = self.send(chat_id.strip(), text, buttons)
        return last

    def answer_callback(self, callback_id: str, text: str) -> ProviderResult:
        return self._call("answerCallbackQuery", {"callback_query_id": callback_id, "text": text})


# ----------------------------------------------------------------------- whatsapp
class WhatsAppProvider:
    """Meta WhatsApp Cloud API. Groups are not supported by Meta — individual numbers only."""

    def __init__(self):
        self.phone_number_id = env("WHATSAPP_PHONE_NUMBER_ID")
        self.token = env("WHATSAPP_ACCESS_TOKEN")
        self.version = env("META_GRAPH_VERSION", "v23.0")
        self.admin_number = env("WHATSAPP_ADMIN_NUMBER")

    def configured(self) -> bool:
        return bool(self.phone_number_id and self.token)

    def send(self, to: str, text: str) -> ProviderResult:
        if not self.configured() or not to:
            logger.info("[SIMULATED WHATSAPP -> %s] %s", to or self.admin_number, text)
            return ProviderResult(True, {"simulated": True}, simulated=True)
        try:
            r = requests.post(
                f"https://graph.facebook.com/{self.version}/{self.phone_number_id}/messages",
                headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
                json={
                    "messaging_product": "whatsapp",
                    "recipient_type": "individual",
                    "to": str(to).lstrip("+"),
                    "type": "text",
                    "text": {"body": text, "preview_url": False},
                },
                timeout=TIMEOUT,
            )
            data = r.json() if r.content else {}
            if r.status_code >= 300:
                return ProviderResult(False, error=str(data.get("error", {}).get("message", r.text))[:300])
            return ProviderResult(True, {"message_id": data.get("messages", [{}])[0].get("id")})
        except Exception as e:
            return ProviderResult(False, error=str(e))

    def send_admin(self, text: str) -> ProviderResult:
        return self.send(self.admin_number, text)


# ---------------------------------------------------------------- google calendar
class CalendarProvider:
    def __init__(self):
        self.calendar_id = env("GOOGLE_CALENDAR_ID")
        self.sa_json = env("GOOGLE_SERVICE_ACCOUNT_JSON")

    def configured(self) -> bool:
        return bool(self.calendar_id and self.sa_json)

    def _service(self):
        from google.oauth2 import service_account  # type: ignore
        from googleapiclient.discovery import build  # type: ignore

        info = json.loads(self.sa_json)
        creds = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/calendar"]
        )
        return build("calendar", "v3", credentials=creds, cache_discovery=False)

    def create_event(self, summary: str, description: str, start: datetime, end: datetime) -> ProviderResult:
        if not self.configured():
            logger.info("[SIMULATED CALENDAR] %s %s-%s", summary, start, end)
            return ProviderResult(True, {"google_event_id": f"sim-evt-{int(time.time())}", "calendar_id": "simulated"}, simulated=True)
        try:
            body = {
                "summary": summary,
                "description": description,
                "start": {"dateTime": start.isoformat()},
                "end": {"dateTime": end.isoformat()},
                "reminders": {"useDefault": False, "overrides": [
                    {"method": "popup", "minutes": 1440},
                    {"method": "popup", "minutes": 15},
                ]},
            }
            evt = self._service().events().insert(calendarId=self.calendar_id, body=body).execute()
            return ProviderResult(True, {"google_event_id": evt.get("id"), "calendar_id": self.calendar_id})
        except Exception as e:
            return ProviderResult(False, error=str(e))

    def update_event(self, event_id: str, start: datetime, end: datetime, description: str) -> ProviderResult:
        if not self.configured():
            return ProviderResult(True, {"updated": True}, simulated=True)
        try:
            self._service().events().patch(
                calendarId=self.calendar_id,
                eventId=event_id,
                body={"start": {"dateTime": start.isoformat()}, "end": {"dateTime": end.isoformat()}, "description": description},
            ).execute()
            return ProviderResult(True, {"updated": True})
        except Exception as e:
            return ProviderResult(False, error=str(e))

    def delete_event(self, event_id: str) -> ProviderResult:
        if not self.configured():
            return ProviderResult(True, {"deleted": True}, simulated=True)
        try:
            self._service().events().delete(calendarId=self.calendar_id, eventId=event_id).execute()
            return ProviderResult(True, {"deleted": True})
        except Exception as e:
            return ProviderResult(False, error=str(e))


telegram = TelegramProvider()
whatsapp = WhatsAppProvider()
calendar = CalendarProvider()

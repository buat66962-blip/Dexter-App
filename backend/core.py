import os
from datetime import datetime, timezone
from typing import Annotated, Any, Optional

from bson import ObjectId
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


def _to_str_id(v: Any) -> Any:
    if isinstance(v, ObjectId):
        return str(v)
    return v


PyObjectId = Annotated[str, BeforeValidator(_to_str_id)]


class BaseDocument(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="ignore")

    id: Optional[PyObjectId] = Field(default=None, alias="_id")

    @classmethod
    def from_mongo(cls, doc: dict):
        if not doc:
            return None
        return cls(**doc)

    def to_mongo(self) -> dict:
        data = self.model_dump(by_alias=True, exclude_none=True)
        data.pop("_id", None)
        return data


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def oid(value: str) -> ObjectId:
    return ObjectId(value)


def is_valid_oid(value: str) -> bool:
    return ObjectId.is_valid(value)


def ser(doc: Optional[dict]) -> Optional[dict]:
    """Serialize a mongo document for JSON output."""
    if doc is None:
        return None
    out = {}
    for k, v in doc.items():
        key = "id" if k == "_id" else k
        if isinstance(v, ObjectId):
            out[key] = str(v)
        elif isinstance(v, datetime):
            out[key] = v.isoformat()
        elif isinstance(v, list):
            out[key] = [ser(i) if isinstance(i, dict) else (str(i) if isinstance(i, ObjectId) else i) for i in v]
        elif isinstance(v, dict):
            out[key] = ser(v)
        else:
            out[key] = v
    out.pop("password_hash", None)
    return out


def env(key: str, default: str = "") -> str:
    return (os.environ.get(key) or default).strip()


async def audit(action: str, user_id: Optional[str] = None, booking_id: Optional[str] = None, metadata: Optional[dict] = None):
    await db.audit_logs.insert_one({
        "action": action,
        "user_id": user_id,
        "booking_id": booking_id,
        "metadata": metadata or {},
        "created_at": now_utc(),
    })

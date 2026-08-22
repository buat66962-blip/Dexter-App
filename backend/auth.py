import os
from datetime import timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from core import audit, db, env, is_valid_oid, now_utc, oid, ser

JWT_ALGORITHM = "HS256"
router = APIRouter(prefix="/auth", tags=["auth"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str) -> str:
    payload = {"sub": user_id, "email": email, "exp": now_utc() + timedelta(hours=12), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {"sub": user_id, "exp": now_utc() + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


class RegisterInput(BaseModel):
    name: str
    email: EmailStr
    password: str
    phone: Optional[str] = None
    whatsapp_number: Optional[str] = None


class LoginInput(BaseModel):
    email: EmailStr
    password: str


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        header = request.headers.get("Authorization", "")
        if header.startswith("Bearer "):
            token = header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Belum login")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesi kedaluwarsa")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token tidak valid")
    if payload.get("type") != "access" or not is_valid_oid(payload.get("sub", "")):
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"_id": oid(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    return ser(user)


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Hanya admin")
    return user


async def _check_lockout(identifier: str):
    rec = await db.login_attempts.find_one({"identifier": identifier})
    if rec and rec.get("count", 0) >= 5:
        last = rec["last_attempt"]
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        if (now_utc() - last).total_seconds() < 900:
            raise HTTPException(status_code=429, detail="Terlalu banyak percobaan. Coba lagi 15 menit.")
        await db.login_attempts.delete_one({"identifier": identifier})


@router.post("/register")
async def register(payload: RegisterInput, response: Response):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email sudah terdaftar")
    doc = {
        "name": payload.name,
        "email": email,
        "password_hash": hash_password(payload.password),
        "phone": payload.phone,
        "whatsapp_number": payload.whatsapp_number,
        "telegram_id": None,
        "role": "user",
        "created_at": now_utc(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    await audit("USER_REGISTERED", user_id=uid, metadata={"email": email})
    doc["_id"] = res.inserted_id
    return ser(doc)


@router.post("/login")
async def login(payload: LoginInput, request: Request, response: Response):
    email = payload.email.lower()
    identifier = f"{request.client.host if request.client else 'x'}:{email}"
    await _check_lockout(identifier)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user.get("password_hash", "")):
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": now_utc()}},
            upsert=True,
        )
        raise HTTPException(status_code=401, detail="Email atau password salah")
    await db.login_attempts.delete_one({"identifier": identifier})
    uid = str(user["_id"])
    set_auth_cookies(response, create_access_token(uid, email), create_refresh_token(uid))
    return ser(user)


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Tidak ada refresh token")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Refresh token tidak valid")
    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Token tidak valid")
    user = await db.users.find_one({"_id": oid(payload["sub"])})
    if not user:
        raise HTTPException(status_code=401, detail="User tidak ditemukan")
    access = create_access_token(str(user["_id"]), user["email"])
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=43200, path="/")
    return {"ok": True}


async def seed_users():
    await db.users.create_index("email", unique=True)
    await db.login_attempts.create_index("identifier")
    for email_key, pass_key, name, role in [
        ("ADMIN_EMAIL", "ADMIN_PASSWORD", "Admin Kantor", "admin"),
        ("DEMO_USER_EMAIL", "DEMO_USER_PASSWORD", "Ghozy", "user"),
    ]:
        email = env(email_key).lower()
        password = env(pass_key)
        if not email or not password:
            continue
        existing = await db.users.find_one({"email": email})
        if not existing:
            await db.users.insert_one({
                "name": name,
                "email": email,
                "password_hash": hash_password(password),
                "phone": None,
                "whatsapp_number": None,
                "telegram_id": None,
                "role": role,
                "created_at": now_utc(),
            })
        elif not verify_password(password, existing.get("password_hash", "")):
            await db.users.update_one({"_id": existing["_id"]}, {"$set": {"password_hash": hash_password(password)}})

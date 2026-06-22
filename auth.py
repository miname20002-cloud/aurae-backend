"""
Authentication for Aurae.

Design: short-lived JWT access tokens for normal API calls, paired with a
longer-lived, rotating refresh token bound to a device_id. Every successful
refresh issues a brand new refresh token and invalidates the old one
(rotation), so a captured refresh token is only useful once. A device_id
mismatch on refresh is treated as a likely account/device hijack signal.
"""
import os
import secrets
import hashlib
from datetime import datetime, timedelta

import jwt
from fastapi import HTTPException, Header

JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_TTL_MINUTES = 120
REFRESH_TOKEN_TTL_DAYS = 30


def create_access_token(user_id: int) -> str:
    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES),
        "iat": datetime.utcnow(),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> int:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Access token expired.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid access token.")
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Invalid token type.")
    return int(payload["sub"])


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def get_current_user_id(authorization: str = Header(...)) -> int:
    """FastAPI dependency. Expects header: Authorization: Bearer <access_token>"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or malformed Authorization header.")
    token = authorization[len("Bearer "):]
    return decode_access_token(token)

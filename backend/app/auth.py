"""Clerk Bearer-token auth.

Production path: verify the JWT against Clerk's JWKS (RS256) and check the
issuer. MVP stub (``AUTH_STUB=true``, the default): decode the token without
signature verification so the rest of the app can be exercised before the
Clerk keys are wired. Either way we return the Clerk user id (``sub``).
"""
from __future__ import annotations

import functools

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from . import config

_bearer = HTTPBearer(auto_error=True)


@functools.lru_cache(maxsize=1)
def _jwks_client() -> jwt.PyJWKClient:
    if not config.CLERK_JWKS_URL:
        raise RuntimeError("CLERK_JWKS_URL not configured")
    return jwt.PyJWKClient(config.CLERK_JWKS_URL)


def _verify(token: str) -> dict:
    if config.AUTH_STUB:
        # Decode only — no signature check. Documented MVP stub.
        return jwt.decode(token, options={"verify_signature": False, "verify_aud": False})
    signing_key = _jwks_client().get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        signing_key,
        algorithms=["RS256"],
        issuer=config.CLERK_ISSUER,
        options={"verify_aud": False},
    )


def current_user_id(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    try:
        claims = _verify(creds.credentials)
    except (jwt.PyJWTError, httpx.HTTPError, RuntimeError) as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    sub = claims.get("sub")
    if not sub:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token missing subject")
    return sub

"""Google sign-in: OpenID Connect, server-side authorization code flow, standard library only.

The ID token comes straight from Google's token endpoint over TLS, in exchange for our client
secret, so its signature need not be checked (OpenID Connect Core 3.1.3.7, step 6). Its claims
still are: issuer, audience, expiry, nonce and a verified email.
"""

import base64
import json
import time
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from django.conf import settings

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"  # noqa: S105 (a URL, not a password)
ISSUERS = ("https://accounts.google.com", "accounts.google.com")
SCOPES = "openid email profile"


class GoogleError(Exception):
    """Google refused the code, could not be reached, or sent a token we do not accept."""


@dataclass(frozen=True)
class GoogleUser:
    sub: str  # Google's stable account id
    email: str  # lower-case, verified by Google
    name: str


def configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def authorize_url(state: str, nonce: str) -> str:
    query = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": settings.GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
        "nonce": nonce,
        # A household shares devices: always let the person pick the account.
        "prompt": "select_account",
    }
    return f"{AUTHORIZE_URL}?{urlencode(query)}"


def _post_token(data: dict[str, str]) -> dict[str, Any]:
    request = Request(
        TOKEN_URL,
        data=urlencode(data).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=10) as response:  # noqa: S310 (fixed https URL)
            body: dict[str, Any] = json.load(response)
    except (URLError, TimeoutError, ValueError) as exc:  # HTTPError is a URLError
        raise GoogleError(f"token request failed: {exc}") from exc
    return body


def _claims(id_token: str) -> dict[str, Any]:
    try:
        payload = id_token.split(".")[1]
        claims: dict[str, Any] = json.loads(base64.urlsafe_b64decode(payload + "=" * 4))
    except (IndexError, ValueError) as exc:
        raise GoogleError("malformed id_token") from exc
    return claims


def exchange_code(code: str, nonce: str) -> GoogleUser:
    """Trade the callback's code for the signed-in Google account."""
    body = _post_token(
        {
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": settings.GOOGLE_REDIRECT_URI,
            "grant_type": "authorization_code",
        }
    )
    id_token = body.get("id_token")
    if not isinstance(id_token, str):
        raise GoogleError(f"no id_token: {body.get('error', 'unknown error')}")
    claims = _claims(id_token)

    if claims.get("iss") not in ISSUERS:
        raise GoogleError("wrong issuer")
    if claims.get("aud") != settings.GOOGLE_CLIENT_ID:
        raise GoogleError("wrong audience")
    if not isinstance(claims.get("exp"), int) or claims["exp"] < time.time():
        raise GoogleError("expired")
    if not nonce or claims.get("nonce") != nonce:
        raise GoogleError("wrong nonce")
    email, sub = claims.get("email"), claims.get("sub")
    if not isinstance(email, str) or not isinstance(sub, str) or not email or not sub:
        raise GoogleError("no email or subject")
    if claims.get("email_verified") is not True:
        raise GoogleError("email not verified")

    name = claims.get("name")
    return GoogleUser(sub=sub, email=email.lower(), name=name if isinstance(name, str) else "")

"""Personal keys for assistants (ST-833): an editor makes one per assistant on the key page and
the assistant sends it as `Authorization: Bearer <token>` to /api/mcp.

The token is `food_sk_` and 43 random URL-safe characters. Only its SHA-256 is stored: the
token has 256 bits of randomness, so a fast hash is enough and a lookup is one indexed query.
The token is in the answer to the POST that makes it, and nowhere else, ever.
"""

import hashlib
import secrets

from django.contrib.auth.models import User
from django.http import HttpRequest
from django.shortcuts import get_object_or_404
from django.utils import timezone
from ninja import Router, Status
from ninja.errors import HttpError

from food.auth import editor_auth, is_editor
from food.models import ApiKey
from food.schemas import ApiKeyCreatedOut, ApiKeyIn, ApiKeyOut, ErrorOut, ValidationErrors

KEY_START = "food_sk_"
# What the key page shows of a token: the prefix and four characters, "food_sk_7Qd4".
VISIBLE_CHARS = len(KEY_START) + 4

# Editors only, CSRF-checked like every other write: a key is a way to write recipes.
router = Router(tags=["keys"], auth=editor_auth)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def make_key(user: User, name: str) -> tuple[ApiKey, str]:
    """A new key for `user`, and its token: the only time the token exists outside the caller."""
    token = KEY_START + secrets.token_urlsafe(32)
    key = ApiKey.objects.create(
        user=user, name=name, token_hash=hash_token(token), prefix=token[:VISIBLE_CHARS]
    )
    return key, token


def editor_for(token: str) -> tuple[ApiKey | None, str]:
    """The live key behind `token`, if its user may write recipes now, and else why not.

    Checked on every call, so deleting a key or taking someone off the editor list closes it at
    once. Marks the key as used."""
    key = (
        ApiKey.objects.select_related("user")
        .filter(token_hash=hash_token(token), deleted_at=None)
        .first()
    )
    if key is None:
        return None, "Nøkkelen finnes ikke eller er slettet. Lag en ny på food.st44.no."
    key.last_used_at = timezone.now()
    key.save(update_fields=["last_used_at"])
    if not is_editor(key.user):
        return None, "Kontoen nøkkelen hører til, er ikke lenger redaktør."
    return key, ""


def _user(request: HttpRequest) -> User:
    user = request.user
    if not isinstance(user, User):  # editor_auth lets only a User through; this is for mypy
        raise HttpError(403, "Bare husstandens redaktører kan lage nøkler.")
    return user


@router.get(
    "", response=list[ApiKeyOut], operation_id="list_keys", summary="Your keys, newest first"
)
def list_keys(request: HttpRequest) -> list[ApiKey]:
    return list(ApiKey.objects.filter(user=_user(request), deleted_at=None))


@router.post(
    "",
    response={201: ApiKeyCreatedOut, 403: ErrorOut, 422: ValidationErrors},
    operation_id="create_key",
    summary="Make a key; the answer holds the token, which is never shown again",
)
def create_key(request: HttpRequest, payload: ApiKeyIn) -> Status[dict[str, object]]:
    key, token = make_key(_user(request), payload.name)
    out = ApiKeyOut.from_orm(key).model_dump()
    return Status(201, {**out, "token": token})


@router.delete(
    "/{key_id}",
    response={204: None, 403: ErrorOut, 404: ErrorOut},
    operation_id="delete_key",
    summary="Delete one of your keys; it stops working at once",
)
def delete_key(request: HttpRequest, key_id: int) -> Status[None]:
    key = get_object_or_404(ApiKey, pk=key_id, user=_user(request), deleted_at=None)
    key.deleted_at = timezone.now()
    key.save(update_fields=["deleted_at"])
    return Status(204, None)

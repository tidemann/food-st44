from django.contrib.auth.models import User
from django.http import HttpRequest

class _VerifiedRequest:
    user: User | None
    scopes: list[str]

class _Server:
    def verify_request(
        self,
        uri: str,
        http_method: str = ...,
        body: str | None = ...,
        headers: dict[str, str] | None = ...,
        scopes: list[str] | None = ...,
    ) -> tuple[bool, _VerifiedRequest]: ...

class OAuthLibCore:
    server: _Server
    def validate_authorization_request(
        self, request: HttpRequest
    ) -> tuple[list[str], dict[str, object]]: ...

def get_oauthlib_core() -> OAuthLibCore: ...

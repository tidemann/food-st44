from datetime import datetime

from django.contrib.auth.models import User

class _QuerySet[T]:
    def filter(self, **kwargs: object) -> _QuerySet[T]: ...
    def get(self, **kwargs: object) -> T: ...
    def first(self) -> T | None: ...
    def count(self) -> int: ...
    def exists(self) -> bool: ...
    def update(self, **kwargs: object) -> int: ...

class Application:
    objects: _QuerySet[Application]
    client_id: str
    name: str
    user: User | None

class AccessToken:
    objects: _QuerySet[AccessToken]
    user: User | None
    scope: str
    expires: datetime

class RefreshToken:
    objects: _QuerySet[RefreshToken]
    user: User | None
    revoked: datetime | None

def get_application_model() -> type[Application]: ...
def get_access_token_model() -> type[AccessToken]: ...
def get_refresh_token_model() -> type[RefreshToken]: ...

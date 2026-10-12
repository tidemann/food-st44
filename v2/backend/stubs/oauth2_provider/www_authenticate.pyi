from django.http import HttpRequest

def build_bearer_challenge(
    request: HttpRequest,
    oauth2_error: dict[str, str] | None = ...,
    realm: str | None = ...,
    resource_metadata_url: str | None = ...,
) -> str: ...

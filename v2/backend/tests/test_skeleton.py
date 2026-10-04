from pathlib import Path

import pytest
from django.test import Client
from pytest_django import Settings


def test_healthz_returns_ok(client: Client) -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_client_routes_get_the_spa_index(
    client: Client, settings: Settings, tmp_path: Path
) -> None:
    (tmp_path / "index.html").write_text("<app-root></app-root>")
    settings.SPA_DIR = tmp_path

    response = client.get("/recipes/42")

    assert response.status_code == 200
    assert b"<app-root>" in b"".join(response.streaming_content)  # type: ignore[attr-defined]


@pytest.mark.parametrize("path", ["/api/nope", "/static/nope.js"])
def test_api_and_static_misses_are_not_swallowed_by_the_spa(client: Client, path: str) -> None:
    assert client.get(path).status_code == 404

from pathlib import Path

import pytest
from django.test import Client
from pytest_django import Settings


def test_healthz_returns_ok(client: Client) -> None:
    response = client.get("/healthz")

    # The deploy's public gate requires exactly this body.
    assert response.status_code == 200
    assert response.content == b"ok"


def test_the_spa_404s_when_the_frontend_is_not_built(
    client: Client, settings: Settings, tmp_path: Path
) -> None:
    settings.SPA_DIR = tmp_path

    assert client.get("/").status_code == 404


@pytest.mark.parametrize("path", ["/api/nope", "/static/nope.js"])
def test_api_and_static_misses_are_not_swallowed_by_the_spa(client: Client, path: str) -> None:
    assert client.get(path).status_code == 404

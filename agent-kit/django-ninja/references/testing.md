# Testing Django Ninja endpoints

Stack: `pytest` + `pytest-django`, Ninja's `TestClient`. Tests are typed
(`mypy --strict` covers them too).

## TestClient against a router

```python
import pytest
from django.contrib.auth.models import User
from ninja.testing import TestClient

from recipes.api import router
from recipes.models import Recipe

pytestmark = pytest.mark.django_db

@pytest.fixture
def client() -> TestClient:
    return TestClient(router)

@pytest.fixture
def editor() -> User:
    return User.objects.create_user("eva", password="x")

def test_get_recipe(client: TestClient) -> None:
    recipe = Recipe.objects.create(title="Pai", servings=4)
    response = client.get(f"/{recipe.id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Pai"

def test_get_missing_recipe_is_404(client: TestClient) -> None:
    response = client.get("/999")
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}

def test_create_needs_login(client: TestClient) -> None:
    response = client.post("/", json={"title": "Pai", "servings": 4})
    assert response.status_code == 401

def test_create_as_editor(client: TestClient, editor: User) -> None:
    response = client.post("/", json={"title": "Pai", "servings": 4}, user=editor)
    assert response.status_code == 201
    assert Recipe.objects.get().title == "Pai"

def test_create_rejects_bad_payload(client: TestClient, editor: User) -> None:
    response = client.post("/", json={"title": ""}, user=editor)
    assert response.status_code == 422
```

- Paths are relative to the router (`"/"`, `"/{id}"`), not `/api/recipes/`.
- `user=` logs a user in for that request. `headers=` and `COOKIES=` work
  on the client or per request.
- Test every declared response code: success, 401/403, 404, 422.
- For a list endpoint, assert the pagination shape (`items`, `count`) once.
- Async views (if ever approved) use `TestAsyncClient`.

## What TestClient does not cover

`TestClient` calls the operation directly: no URLconf, no middleware, no
real session cookie, **no CSRF enforcement**. Cover those once with Django's
client:

```python
from django.test import Client

def test_post_without_csrf_token_is_rejected(editor: User) -> None:
    client = Client(enforce_csrf_checks=True)
    client.force_login(editor)
    response = client.post(
        "/api/recipes/", {"title": "Pai", "servings": 4}, content_type="application/json"
    )
    assert response.status_code == 403
```

## Services

Test `services.py` functions directly (no HTTP) for business rules; keep API
tests about status codes, auth and shapes.

## OpenAPI drift

A CI step exports the schema and diffs it with the committed
`openapi.json`. To assert declared error codes in a test (response keys are
`int` in the Python dict, strings only in the exported JSON):

```python
from <project>.api import api

def test_get_recipe_documents_404() -> None:
    op = api.get_openapi_schema()["paths"]["/api/recipes/{recipe_id}"]["get"]
    assert set(op["responses"]) == {200, 404}
```

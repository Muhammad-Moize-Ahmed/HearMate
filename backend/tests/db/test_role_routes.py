"""A parent who signs in for real (POST /api/auth/login, as the shared sign-in form does) is
refused by every therapist and admin route. Routes come from the app, so new ones are covered."""

import re
import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from tests.factories import DEFAULT_PASSWORD, make_user

ROLE_PREFIXES = ("/api/therapist", "/api/admin")


def role_routes(app: FastAPI) -> list[tuple[str, str]]:
    # From the OpenAPI schema: every documented path and method (app.routes nests routers).
    routes = [
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        if path.startswith(ROLE_PREFIXES)
        for method in operations
    ]
    assert len(routes) >= 8  # links: list, accept, leave; admin: therapists, approve, reject, ...
    return routes


def test_a_signed_in_parent_gets_403_from_every_therapist_and_admin_route(
    app: FastAPI, db_client: TestClient, db_session: Session
) -> None:
    parent = make_user(db_session, password=DEFAULT_PASSWORD)
    login = db_client.post(
        "/api/auth/login", json={"email": parent.email, "password": DEFAULT_PASSWORD}
    )
    assert login.status_code == 200, login.text
    assert login.json()["principal"]["kind"] == "parent"
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    refused = []
    for method, template in role_routes(app):
        path = re.sub(r"\{[^}]+\}", str(uuid.uuid4()), template)
        body = {"reason": "Not a therapist"} if method in {"POST", "PUT", "PATCH"} else None
        response = db_client.request(method, path, headers=headers, json=body)
        refused.append((method, template, response.status_code))

    assert all(status == 403 for _, _, status in refused), refused


def test_sign_in_cannot_ask_for_a_role(db_client: TestClient, db_session: Session) -> None:
    # One login for every adult: the account's own role decides, never the request.
    parent = make_user(db_session, password=DEFAULT_PASSWORD)
    body = {"email": parent.email, "password": DEFAULT_PASSWORD, "role": "therapist"}

    assert db_client.post("/api/auth/login", json=body).status_code == 422

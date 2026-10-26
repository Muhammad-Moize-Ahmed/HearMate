import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.core.errors import ConflictError, NotFoundError


class SignupIn(BaseModel):
    password: str
    age: int


@pytest.fixture
def error_client(app: FastAPI) -> TestClient:
    @app.get("/api/_test/not-found")
    def raise_not_found() -> None:
        raise NotFoundError("Child not found", details={"child_id": "abc"})

    @app.get("/api/_test/conflict")
    def raise_conflict() -> None:
        raise ConflictError("Email already registered")

    @app.get("/api/_test/crash")
    def crash() -> None:
        raise RuntimeError("database password is hunter2")

    @app.post("/api/_test/signup")
    def signup(body: SignupIn) -> dict[str, int]:
        return {"age": body.age}

    return TestClient(app)


def test_app_errors_use_the_standard_shape(error_client: TestClient) -> None:
    response = error_client.get("/api/_test/not-found")

    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["message"] == "Child not found"
    assert error["details"] == {"child_id": "abc"}
    assert error["request_id"] == response.headers["x-request-id"]


def test_app_error_subclasses_set_their_status(error_client: TestClient) -> None:
    response = error_client.get("/api/_test/conflict")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_unknown_routes_use_the_standard_shape(error_client: TestClient) -> None:
    response = error_client.get("/api/does-not-exist")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_wrong_method_uses_the_standard_shape(error_client: TestClient) -> None:
    response = error_client.delete("/api/health")

    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_validation_errors_never_echo_submitted_values(error_client: TestClient) -> None:
    response = error_client.post("/api/_test/signup", json={"password": "hunter2"})

    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["loc"] == ["body", "age"]
    assert "hunter2" not in response.text


def test_crashes_return_a_generic_500_and_are_logged_with_the_request_id(
    error_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.ERROR):
        response = error_client.get("/api/_test/crash", headers={"X-Request-ID": "req-42"})

    assert response.status_code == 500
    assert response.json()["error"] == {
        "code": "internal_error",
        "message": "An unexpected error occurred",
        "request_id": "req-42",
    }
    assert "hunter2" not in response.text
    crash_logs = [r for r in caplog.records if r.getMessage() == "Unhandled error"]
    assert len(crash_logs) == 1
    assert getattr(crash_logs[0], "request_id", None) == "req-42"


def test_a_safe_incoming_request_id_is_reused(error_client: TestClient) -> None:
    response = error_client.get("/api/health", headers={"X-Request-ID": "abc-123"})

    assert response.headers["x-request-id"] == "abc-123"


def test_an_unsafe_incoming_request_id_is_replaced(error_client: TestClient) -> None:
    response = error_client.get("/api/health", headers={"X-Request-ID": "bad id; drop table"})

    request_id = response.headers["x-request-id"]
    assert request_id != "bad id; drop table"
    assert len(request_id) == 32

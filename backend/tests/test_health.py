from collections.abc import Iterator

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db.session import get_db


def test_liveness_returns_ok(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_openapi_schema_is_served_under_api_prefix(client: TestClient) -> None:
    response = client.get("/api/openapi.json")

    assert response.status_code == 200
    assert response.json()["info"]["title"] == "HearMate API"


def test_readiness_reports_503_when_the_database_is_unreachable(app: FastAPI) -> None:
    # Port 1 refuses connections immediately.
    engine = create_engine("postgresql+psycopg://nobody:nothing@127.0.0.1:1/none")

    def broken_db() -> Iterator[Session]:
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = broken_db
    response = TestClient(app).get("/api/health/ready")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "database_unavailable"
    engine.dispose()

from fastapi.testclient import TestClient


def test_readiness_is_ok_when_the_database_answers(db_client: TestClient) -> None:
    response = db_client.get("/api/health/ready")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}

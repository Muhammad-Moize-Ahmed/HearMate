import logging
from http import HTTPStatus
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from ...core.errors import AppError
from ...db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["meta"])


class DatabaseUnavailableError(AppError):
    status_code = HTTPStatus.SERVICE_UNAVAILABLE
    code = "database_unavailable"


@router.get("")
def liveness() -> dict[str, str]:
    """The process is up. Does not touch the database."""
    return {"status": "ok"}


@router.get("/ready")
def readiness(db: Annotated[Session, Depends(get_db)]) -> dict[str, str]:
    """The API can serve traffic: the database answers."""
    try:
        db.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        logger.warning("Readiness check failed: %s", type(exc).__name__)
        raise DatabaseUnavailableError("Database is not reachable") from exc
    return {"status": "ok", "database": "ok"}

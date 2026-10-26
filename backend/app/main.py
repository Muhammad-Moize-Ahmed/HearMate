from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth.rate_limit import RateLimiter
from .core.config import Settings, get_settings
from .core.errors import register_error_handlers
from .core.logging import configure_logging
from .core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from .modules.admin.router import router as admin_router
from .modules.auth.router import router as auth_router
from .modules.care_team.router import parent_router as care_team_parent_router
from .modules.care_team.router import therapist_router as care_team_therapist_router
from .modules.children.router import router as children_router
from .modules.games.router import (
    audio_router,
    child_progress_router,
    games_router,
    sessions_router,
)
from .modules.goals.router import router as goals_router
from .modules.health.router import router as health_router
from .providers.email import build_email_sender


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.LOG_LEVEL, settings.log_format)

    prefix = settings.API_PREFIX
    app = FastAPI(
        title="HearMate API",
        version="0.1.0",
        openapi_url=f"{prefix}/openapi.json",
        docs_url=f"{prefix}/docs",
        redoc_url=None,
    )
    app.state.settings = settings
    app.state.rate_limiter = RateLimiter()
    app.state.email_sender = build_email_sender(settings)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", REQUEST_ID_HEADER],
        expose_headers=[REQUEST_ID_HEADER],
    )
    # Added last = outermost, so every response, including CORS rejections, gets a request ID.
    app.add_middleware(RequestContextMiddleware)
    register_error_handlers(app)

    api = APIRouter(prefix=prefix)
    api.include_router(health_router)
    api.include_router(auth_router)
    api.include_router(admin_router)
    api.include_router(children_router)
    api.include_router(goals_router)
    api.include_router(care_team_parent_router)
    api.include_router(care_team_therapist_router)
    api.include_router(games_router)
    api.include_router(sessions_router)
    api.include_router(child_progress_router)
    api.include_router(audio_router)
    app.include_router(api)

    return app


app = create_app()

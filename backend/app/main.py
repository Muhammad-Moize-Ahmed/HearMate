from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import Settings, get_settings
from .core.errors import register_error_handlers
from .core.logging import configure_logging
from .core.middleware import REQUEST_ID_HEADER, RequestContextMiddleware
from .modules.health.router import router as health_router


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
    app.include_router(api)

    return app


app = create_app()

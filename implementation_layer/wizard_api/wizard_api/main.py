import asyncio
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from wizard_api.routers.sessions import router as sessions_router
from wizard_api.services import agent_service

# Dev-facing structured-ish logging (S3-10 covers the Next.js side; this is
# the lightweight Python counterpart — plain stdlib logging, visible in
# `uvicorn` console output without extra setup). Not the Postgres-backed
# audit trail from lib/audit.ts; see agent_service's per-turn cost logging.
logging.basicConfig(
    level=os.getenv("WIZARD_LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Reap idle live wizard-agent clients so subprocesses don't accumulate.
    reaper = asyncio.create_task(agent_service.cleanup_idle_sessions())
    try:
        yield
    finally:
        reaper.cancel()


app = FastAPI(title="GAIK Wizard API", version="0.1.0", lifespan=lifespan)

app.include_router(sessions_router)

if os.getenv("WIZARD_TEST_HOOKS") == "1":
    from wizard_api.routers.test_hooks import router as test_hooks_router

    app.include_router(test_hooks_router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}

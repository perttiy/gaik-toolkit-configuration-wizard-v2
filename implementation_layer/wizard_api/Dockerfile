FROM python:3.11-slim AS base

WORKDIR /app

RUN pip install --no-cache-dir --upgrade pip

COPY pyproject.toml ./
COPY wizard_api ./wizard_api
COPY alembic ./alembic
COPY alembic.ini ./
COPY tests ./tests

RUN pip install --no-cache-dir -e .

ENV WIZARD_SESSION_OUTPUT_ROOT=/data/sessions

EXPOSE 8100

FROM base AS dev

RUN pip install --no-cache-dir -e ".[dev]"

CMD ["sh", "-c", "alembic upgrade head && uvicorn wizard_api.main:app --host 0.0.0.0 --port 8100"]

FROM base AS production

CMD ["sh", "-c", "alembic upgrade head && uvicorn wizard_api.main:app --host 0.0.0.0 --port 8100"]

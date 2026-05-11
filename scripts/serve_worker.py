"""Inngest Dev Server / 프로덕션 서버 연결 스크립트.

개발:
    1. uv run python scripts/serve_worker.py
    2. npx inngest-cli@latest dev   (별도 터미널)

프로덕션:
    INNGEST_IS_PRODUCTION=true uv run python scripts/serve_worker.py
    (또는 uvicorn src.worker:app 과 동일하게 WSGI/ASGI 서버로 실행)

엔드포인트: POST /api/inngest  (Inngest Dev Server가 여기로 연결)
"""

from __future__ import annotations

from dotenv import load_dotenv
load_dotenv()

import logging

import uvicorn
import inngest.fast_api
from fastapi import FastAPI

from src.worker import (
    cleanup_orphan_meetings_scheduled,
    client,
    process_meeting,
    publish_meeting_handler,
    send_email_handler,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

app = FastAPI(title="Actnote Inngest Worker", version="0.1.0")

inngest.fast_api.serve(
    app,
    client,
    [
        process_meeting,
        publish_meeting_handler,
        send_email_handler,
        cleanup_orphan_meetings_scheduled,
    ],
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

"""Entrypoint: runs the poll loop as a background task inside the same
process as the dashboard web server — one process, one deployable service,
simplest possible ops for something this small."""
import asyncio
import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

from dashboard import app
from engine import poll_forever


@app.on_event("startup")
async def _start_poll_loop():
    asyncio.create_task(poll_forever())

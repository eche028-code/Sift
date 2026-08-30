"""In-process APScheduler: one cron job for the monthly crawl + backfill."""

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from . import settings_store as st
from .pipeline import monthly_crawl

log = logging.getLogger("sift.scheduler")

scheduler = AsyncIOScheduler()


def schedule_monthly() -> None:
    day = min(max(st.get_int("crawl_day", 1), 1), 28)
    scheduler.add_job(
        monthly_crawl,
        CronTrigger(day=day, hour=3, minute=30),
        id="monthly_crawl",
        replace_existing=True,
    )
    log.info("monthly crawl scheduled for day %d at 03:30", day)


def start() -> None:
    scheduler.start()
    schedule_monthly()


def shutdown() -> None:
    if scheduler.running:
        scheduler.shutdown(wait=False)

"""Deprecated alias for ta_worker; scheduling runs in same PG worker."""

from config.management.commands.ta_worker import Command

__all__ = ["Command"]

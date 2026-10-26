"""Startup never logs authorization callback query strings, even in debug."""

import runpy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest


@pytest.mark.parametrize("debug,level", [("", "error"), ("1", "info")])
def test_backend_start_disables_access_logs(monkeypatch, debug, level):
    run = Mock()
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=run))
    monkeypatch.setenv("DJANGO_DEBUG", debug)
    monkeypatch.setenv("TA_PORT", "8123")
    startup = (
        Path(__file__).resolve().parents[3] / "docker_assets/backend_start.py"
    )
    runpy.run_path(str(startup), run_name="__main__")
    run.assert_called_once_with(
        "config.asgi:application",
        host="0.0.0.0",
        port=8123,
        workers=4,
        log_level=level,
        access_log=False,
        reload=False,
    )

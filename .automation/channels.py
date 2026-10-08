#!/usr/bin/env python3
"""Resolve official Tube Archivist sources and channel image aliases."""
from __future__ import annotations

from datetime import datetime
import json
from zoneinfo import ZoneInfo
import os
import re
import subprocess
import sys
import urllib.request

API = "https://api.github.com/repos/tubearchivist/tubearchivist/releases/latest"
VERSION = re.compile(r"v[0-9]+\.[0-9]+\.[0-9]+$")


def resolve(channel: str) -> dict[str, str]:
    if channel not in ("stable", "nightly"):
        raise ValueError("Invalid channel.")
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "tubearchivist-automation"}
    if token := os.environ.get("GH_TOKEN"):
        headers["Authorization"] = f"Bearer {token}"
    with urllib.request.urlopen(urllib.request.Request(API, headers=headers), timeout=30) as response:
        release = json.load(response)
    tag = release.get("tag_name", "")
    if release.get("draft") is not False or release.get("prerelease") is not False or not VERSION.fullmatch(tag):
        raise ValueError("Upstream latest is not a published stable vX.Y.Z release.")
    if channel == "nightly":
        return {"ref": "refs/heads/develop", "tag": tag, "version": "nightly"}
    return {"ref": f"refs/tags/{tag}", "tag": tag, "version": tag.removeprefix("v")}


def identity(channel: str, tag: str, existing: list[str], now: datetime | None = None) -> str:
    if channel not in ("stable", "nightly") or not VERSION.fullmatch(tag):
        raise ValueError("Invalid channel/tag.")
    day = (now or datetime.now(ZoneInfo("Europe/Berlin"))).astimezone(ZoneInfo("Europe/Berlin")).strftime("%Y.%m.%d")
    prefix = f"{tag if channel == 'stable' else 'nightly-' + tag}-{day}."
    numbers = [int(name[len(prefix):]) for name in existing if name.startswith(prefix) and name[len(prefix):].isdigit()]
    return prefix + str(max(numbers, default=0) + 1)


def aliases(channel: str, version: str) -> list[str]:
    if channel == "stable" and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version):
        return ["latest", "stable"]
    if channel == "nightly" and version == "nightly":
        return ["nightly", "edge", "develop"]
    raise ValueError("Invalid channel/version.")


def main() -> None:
    channel = sys.argv[1]
    result = resolve(channel)
    result["aliases"] = "\n".join(aliases(channel, result["version"]))
    refs = subprocess.run(["git", "ls-remote", "--tags", "origin"], check=True, text=True, capture_output=True).stdout
    tags = [line.split("refs/tags/", 1)[1] for line in refs.splitlines() if not line.endswith("^{}")]
    result["identity"] = identity(channel, result.get("tag", ""), tags)
    for key, value in result.items():
        print(f"{key}={value}")
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a", encoding="utf-8") as stream:
                stream.write(f"{key}<<EOF\n{value}\nEOF\n")


if __name__ == "__main__":
    main()

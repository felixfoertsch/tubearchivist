#!/usr/bin/env python3
"""Rebuild main from one official upstream ref plus every ordered fork patch."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import tempfile


def git(root: Path, *args: str, check: bool = True) -> str:
    result = subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def commit(root: Path, message: str, timestamp: str) -> None:
    env = {**os.environ, "GIT_AUTHOR_DATE": timestamp, "GIT_COMMITTER_DATE": timestamp}
    result = subprocess.run(["git", "-C", str(root), "-c", "commit.gpgsign=false", "-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com", "commit", "-m", message], text=True, capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())


def fork_readme(upstream: str, patches: list[str]) -> str:
    base = "https://github.com/felixfoertsch/tubearchivist/blob/patch-queue/.automation/patches/"
    links = ", ".join(f"[{name[:4]}]({base}{name})" for name in patches)
    return ("This fork follows upstream [Tube Archivist](https://github.com/tubearchivist/tubearchivist) "
            f"plus ordered patches {links}. `patch-queue` owns patches and workflows; generated `main` "
            "contains upstream source plus the full queue. Stable builds follow upstream releases; nightly builds follow `develop`.\n\n"
            "# Patched Tube Archivist\n\nApplied patches, oldest first:\n\n"
            + "".join(f"{index}. [{name}]({base}{name})\n" for index, name in enumerate(patches, 1))
            + "\n---\n\n" + upstream)


def sync(root: Path, upstream_url: str, upstream_ref: str) -> dict[str, str]:
    if git(root, "status", "--porcelain"):
        raise RuntimeError("Refusing dirty checkout.")
    automation = git(root, "rev-parse", "HEAD")
    git(root, "fetch", "--no-tags", upstream_url, upstream_ref)
    upstream = git(root, "rev-parse", "FETCH_HEAD^{commit}")
    timestamp = git(root, "show", "-s", "--format=%cI", upstream)
    with tempfile.TemporaryDirectory(prefix="tubearchivist-sync-") as directory:
        candidate = Path(directory) / "candidate"
        git(root, "worktree", "add", "--detach", str(candidate), upstream)
        try:
            git(candidate, "rm", "-r", "--ignore-unmatch", ".github/workflows")
            git(candidate, "restore", "--source=" + automation, "--staged", "--worktree", "--", ".automation")
            git(candidate, "add", "--all")
            commit(candidate, "Maintain fork automation", timestamp)
            patches: list[str] = []
            series = (candidate / ".automation/series").read_text(encoding="utf-8").splitlines()
            ordered = [name.strip() for name in series if name.strip() and not name.strip().startswith("#")]
            if not ordered or ordered[0] != "0001-remove-upstream-ai-policy.patch" or len(set(ordered)) != len(ordered):
                raise RuntimeError("Queue must start with accepted policy removal and contain no duplicates.")
            for name in series:
                name = name.strip()
                if not name or name.startswith("#"):
                    continue
                patch = candidate / ".automation/patches" / name
                if Path(name).name != name or not patch.is_file() or patch.is_symlink():
                    raise RuntimeError(f"Invalid patch: {name}")
                result = subprocess.run(["git", "-C", str(candidate), "apply", "--index", "--check", str(patch)], text=True, capture_output=True)
                if result.returncode:
                    policy_paths = ("AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md")
                    if name == "0001-remove-upstream-ai-policy.patch":
                        present = [path for path in policy_paths if (candidate / path).exists()]
                        if present:
                            git(candidate, "rm", "--", *present)
                            commit(candidate, f"Apply fork policy removal: {name}", timestamp)
                        patches.append(name)
                        continue
                    reverse = subprocess.run(["git", "-C", str(candidate), "apply", "--index", "--reverse", "--check", str(patch)], text=True, capture_output=True)
                    if reverse.returncode == 0:
                        patches.append(name)
                        continue
                    raise RuntimeError(f"Patch no longer applies: {name}\n{result.stderr.strip()}")
                git(candidate, "apply", "--index", "--whitespace=error-all", str(patch))
                commit(candidate, f"Apply fork patch: {name}", timestamp)
                patches.append(name)
            readme = candidate / "README.md"
            upstream_readme = readme.read_text(encoding="utf-8") if readme.exists() else ""
            readme.write_text(fork_readme(upstream_readme, patches), encoding="utf-8")
            git(candidate, "add", "README.md")
            commit(candidate, "Document ordered fork patches", timestamp)
            git(candidate, "rm", "-r", ".automation")
            commit(candidate, "Remove fork automation from generated source", timestamp)
            source = git(candidate, "rev-parse", "HEAD")
            tree = git(candidate, "rev-parse", "HEAD^{tree}")
        finally:
            git(root, "worktree", "remove", "--force", str(candidate))
    git(root, "reset", "--hard", source)
    return {"upstream_sha": upstream, "source_sha": source, "source_tree": tree}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--upstream-url", default="https://github.com/tubearchivist/tubearchivist.git")
    parser.add_argument("--upstream-ref", required=True)
    args = parser.parse_args()
    try:
        values = sync(Path(git(Path.cwd(), "rev-parse", "--show-toplevel")), args.upstream_url, args.upstream_ref)
    except RuntimeError as error:
        raise SystemExit(str(error)) from error
    for key, value in values.items():
        print(f"{key}={value}")
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a", encoding="utf-8") as stream:
                stream.write(f"{key}={value}\n")


if __name__ == "__main__":
    main()

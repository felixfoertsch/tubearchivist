#!/usr/bin/env python3
"""Reconstruct control with trusted code; archive and lease promotion separately."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

from sync import commit, git, sync

UPSTREAM = "https://github.com/tubearchivist/tubearchivist.git"
WORKFLOWS = ("downstream.yml", "pre_commit.yml", "unit_tests.yml")
OVERLAY = (".automation", ".gitattributes", "FORK.md") + tuple(
    ".github/workflows/" + name for name in WORKFLOWS
)
LEGACY_BASE = "920b550ef8aa0606682d4fd8a216c44c5bd60c8e"
LEGACY_CONTROL = "2ad21b79676b9ec8579845c937dcf01a4bbbf89a"
POLICY = {"AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"}


def owned(path):
    return path.startswith(".automation/") or path in OVERLAY


def upstream_head(url):
    lines = git(Path.cwd(), "ls-remote", "--symref", url, "HEAD").splitlines()
    branch = next(line.split()[1] for line in lines if line.startswith("ref: "))
    sha = next(line.split()[0] for line in lines if line.endswith("\tHEAD") and not line.startswith("ref:"))
    if not branch.startswith("refs/heads/") or len(sha) != 40:
        raise RuntimeError("Invalid upstream default branch.")
    return branch, sha


def reconstruct(root, control, upstream, destination, state=None):
    git(root, "clone", "--no-hardlinks", "--no-checkout", str(root), str(destination))
    git(destination, "checkout", "--detach", control)
    sync(destination, str(root), upstream)
    git(destination, "restore", "--source=" + control, "--staged", "--worktree", "--", *OVERLAY)
    if git(destination, "ls-tree", "-r", "HEAD", "--", ".github/workflows"):
        raise RuntimeError("Generated source retained workflows.")
    if state is not None:
        (destination / ".automation/upstream.json").write_text(json.dumps(state, sort_keys=True) + "\n")
        git(destination, "add", ".automation/upstream.json")
    commit(destination, "Maintain trusted control overlay", git(root, "show", "-s", "--format=%cI", upstream))
    if git(destination, "ls-tree", "-r", "HEAD", "--", ".github/workflows") != git(root, "ls-tree", "-r", control, "--", ".github/workflows"):
        raise RuntimeError("Entire workflow tree must remain identical.")
    return git(destination, "rev-parse", "HEAD")


def prepare(root, output, url=UPSTREAM):
    if git(root, "status", "--porcelain"):
        raise RuntimeError("Refusing dirty control checkout.")
    control = git(root, "rev-parse", "HEAD")
    branch, upstream = upstream_head(url)
    git(root, "fetch", "--no-tags", url, branch)
    if git(root, "rev-parse", "FETCH_HEAD") != upstream:
        raise RuntimeError("Upstream moved during discovery.")
    paths = git(root, "ls-tree", "-r", "--name-only", upstream).splitlines()
    if any(p.startswith(".automation/") or p in ("FORK.md", ".github/workflows/downstream.yml") for p in paths):
        raise RuntimeError("Upstream reserved control path collision.")
    state_path = root / ".automation/upstream.json"
    state = json.loads(state_path.read_text()) if state_path.exists() else None
    if state:
        if state["repository"] != url or state["branch"] != branch:
            raise RuntimeError("Upstream repository/default branch changed.")
        base = state["upstream"]
        git(root, "merge-base", "--is-ancestor", base, upstream)
    else:
        base = git(root, "merge-base", control, upstream)
        if base == LEGACY_BASE:
            git(root, "merge-base", "--is-ancestor", LEGACY_CONTROL, control)
            delta = git(root, "diff", "--name-only", LEGACY_CONTROL, control).splitlines()
            if any(not owned(p) for p in delta):
                raise RuntimeError("Initial migration changed reviewed application source.")
    with tempfile.TemporaryDirectory() as temporary:
        expected = Path(temporary) / "expected"
        reconstruct(root, control, base, expected)
        changes = git(expected, "diff", "--name-only", control, "HEAD").splitlines()
        unknown = [p for p in changes if not owned(p)]
        # Initial historical control stored unpatched upstream source. Only its
        # known base may use this migration exception; unknown edits still stop.
        if unknown:
            legacy = git(root, "diff", "--name-only", base, control).splitlines()
            if state or base != LEGACY_BASE or any(not owned(p) and p not in POLICY | {"README.md"} for p in legacy):
                raise RuntimeError("Unqueued application customization: " + ", ".join(unknown))
    output.mkdir(parents=True, exist_ok=True)
    candidate = output / "candidate"
    candidate_sha = reconstruct(root, control, upstream, candidate, {"repository": url, "branch": branch, "upstream": upstream})
    tree = git(candidate, "rev-parse", "HEAD^{tree}")
    ancestry = subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", upstream, control], capture_output=True)
    if ancestry.returncode not in (0, 1):
        raise RuntimeError("Cannot verify selected upstream ancestry.")
    changed = tree != git(root, "rev-parse", "HEAD^{tree}") or ancestry.returncode != 0
    metadata = {"control": control, "branch": branch, "upstream": upstream,
                "candidate": candidate_sha if changed else control, "tree": tree,
                "changed": changed}
    (output / "refresh.json").write_text(json.dumps(metadata, sort_keys=True) + "\n")
    return metadata


def backup(root, control, directory):
    bundle = directory / "control.bundle"
    if git(root, "rev-parse", "HEAD") != control:
        raise RuntimeError("Backup checkout differs from old control.")
    git(root, "bundle", "create", str(bundle), "HEAD")
    verify_backup(root, control, directory)
    digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
    (directory / "control.sha256").write_text(digest + "\n")
    manifest = {"control": control, "bundle_sha256": digest}
    if (directory.parent / "refresh/refresh.json").exists():
        meta = json.loads((directory.parent / "refresh/refresh.json").read_text())
        manifest.update({key: meta[key] for key in ("upstream", "candidate", "branch")})
    (directory / "manifest.json").write_text(json.dumps(manifest, sort_keys=True) + "\n")


def verify_backup(root, control, directory):
    bundle = directory / "control.bundle"
    if (directory / "control.sha256").exists():
        if hashlib.sha256(bundle.read_bytes()).hexdigest() != (directory / "control.sha256").read_text().strip():
            raise RuntimeError("Backup digest mismatch.")
    git(root, "bundle", "verify", str(bundle))
    with tempfile.TemporaryDirectory() as temporary:
        restored = Path(temporary)
        git(root, "init", "--bare", str(restored))
        git(restored, "fetch", str(bundle), control)
        if git(restored, "rev-parse", "FETCH_HEAD^{commit}") != control:
            raise RuntimeError("Backup cannot restore exact old control.")
        git(restored, "fsck", "--full", "--strict", control)


def promote(root, directory, downloaded, repository, force=False, url=UPSTREAM):
    meta = json.loads((directory / "refresh.json").read_text())
    if not meta["changed"]:
        return
    control = meta["control"]
    if not (downloaded / "control.sha256").is_file():
        raise RuntimeError("Uploaded backup digest missing.")
    verify_backup(root, control, downloaded)
    manifest = json.loads((downloaded / "manifest.json").read_text())
    expected_manifest = {"control": control, "upstream": meta["upstream"], "candidate": meta["candidate"],
                         "branch": meta["branch"], "bundle_sha256": (downloaded / "control.sha256").read_text().strip()}
    if manifest != expected_manifest:
        raise RuntimeError("Uploaded backup manifest mismatch.")
    if git(root, "rev-parse", "HEAD") != control:
        raise RuntimeError("Promoter must execute exact old control checkout.")
    if upstream_head(url) != (meta["branch"], meta["upstream"]):
        raise RuntimeError("Upstream default branch or tip changed.")
    if git(root, "ls-remote", "origin", "refs/heads/patch-queue").split()[0] != control:
        raise RuntimeError("Control changed before promotion.")
    tag = "refs/tags/archive/patch-queue/" + control
    existing = git(root, "ls-remote", "origin", tag).split()
    if existing and existing[0] != control:
        raise RuntimeError("Archive tag does not point directly to old control.")
    candidate = directory / "candidate"
    git(root, "fetch", str(candidate), meta["candidate"])
    args = ["push", "--atomic", "--force-with-lease=refs/heads/patch-queue:" + control]
    args += ["--force-with-lease=" + tag + ":" + (control if existing else "")]
    args += ["origin", meta["candidate"] + ":refs/heads/patch-queue", control + ":" + tag]
    git(root, *args)
    remote = dict(line.split()[::-1] for line in git(root, "ls-remote", "origin", "refs/heads/patch-queue", tag).splitlines())
    if remote != {"refs/heads/patch-queue": meta["candidate"], tag: control}:
        raise RuntimeError("Promoted control/archive readback mismatch; refusing dispatch.")
    # GITHUB_TOKEN pushes do not trigger push workflows. Dispatch only after
    # successful atomic promotion; failure remains visible and schedule recovers.
    payload = {"ref": "patch-queue", "inputs": {"expected_control": meta["candidate"], "rebuild": force}}
    subprocess.run(["gh", "api", "--method", "POST", f"repos/{repository}/actions/workflows/downstream.yml/dispatches", "--input", "-"], input=json.dumps(payload), text=True, check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("prepare", "backup", "promote"))
    parser.add_argument("directory", type=Path)
    parser.add_argument("--downloaded", type=Path)
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    root = Path.cwd()
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.mode == "prepare":
        meta = prepare(root, args.directory.resolve())
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a") as stream:
                stream.write(f"changed={str(meta['changed']).lower()}\n")
    elif args.mode == "backup":
        backup(root, git(root, "rev-parse", "HEAD"), args.directory.resolve())
    else:
        promote(root, args.directory.resolve(), args.downloaded.resolve(), os.environ["GITHUB_REPOSITORY"], args.force)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Publish immutable source tag and optional generated main together."""
import argparse
from pathlib import Path
import subprocess


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result.stdout.strip()


def promote(root, source, identity, expected_main=None):
    tag = "refs/tags/" + identity
    existing = git(root, "ls-remote", "origin", tag).split()
    if existing and existing[0] != source:
        raise RuntimeError("Immutable source tag mismatch.")
    # Check full reachable closure before asking the server to accept refs.
    git(root, "fsck", "--full", "--strict", source)
    args = ["push", "--atomic", "--force-with-lease=" + tag + ":" + (source if existing else "")]
    if expected_main is not None:
        args += ["--force-with-lease=refs/heads/main:" + expected_main]
    args += ["origin", source + ":" + tag]
    if expected_main is not None:
        args += [source + ":refs/heads/main"]
    git(root, *args)
    refs = [tag] + (["refs/heads/main"] if expected_main is not None else [])
    actual = dict(line.split()[::-1] for line in git(root, "ls-remote", "origin", *refs).splitlines())
    if actual != {ref: source for ref in refs}:
        raise RuntimeError("Source promotion readback mismatch.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("source")
    parser.add_argument("identity")
    parser.add_argument("--expected-main")
    args = parser.parse_args()
    promote(args.root, args.source, args.identity, args.expected_main)

#!/usr/bin/env python3
"""Skip only fully published, unchanged multiarch candidates and delivery aliases."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile


class MissingImage(Exception):
    pass


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        # Absence permits repair; authentication/transport failures must stop publication.
        if args[0] == "skopeo" and any(error in result.stderr.lower() for error in ("manifest unknown", "name unknown", "blob unknown")):
            raise MissingImage()
        raise RuntimeError(result.stderr.strip())
    return result.stdout


def complete(channel, image, source, upstream, queue, force=False):
    if force:
        return False
    refs = dict(line.split("\t")[::-1] for line in run("git", "ls-remote", "origin", "refs/tags/*", "refs/heads/main", "refs/heads/patch-queue").splitlines())
    if refs.get("refs/heads/patch-queue") != queue:
        raise RuntimeError("Patch queue changed.")
    if channel == "nightly" and refs.get("refs/heads/main") != source:
        return False
    pattern = r"v[0-9]+\.[0-9]+\.[0-9]+-[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[0-9]+"
    if channel == "nightly":
        pattern = "nightly-" + pattern
    tags = [ref.removeprefix("refs/tags/") for ref, sha in refs.items() if sha == source and ref.startswith("refs/tags/") and re.fullmatch(pattern, ref.removeprefix("refs/tags/"))]
    aliases = ["latest", "stable"] if channel == "stable" else ["nightly", "edge", "develop"]
    expected = {"org.opencontainers.image.revision": source, "org.opencontainers.image.base.digest": upstream, "de.felixfoertsch.patch-queue": queue}
    for tag in tags:
        digest = None
        try:
            for name in [tag, *aliases]:
                location = f"docker://{image}:{name}"
                raw = run("skopeo", "inspect", "--raw", location)
                current = hashlib.sha256(raw.encode()).hexdigest()
                if digest is not None and current != digest:
                    break
                digest = current
                location = f"docker://{image}@sha256:{current}"
                platforms = {(entry.get("platform", {}).get("os"), entry.get("platform", {}).get("architecture")) for entry in json.loads(raw).get("manifests", [])}
                if not {("linux", "amd64"), ("linux", "arm64")} <= platforms:
                    break
                for arch in ("amd64", "arm64"):
                    config = json.loads(run("skopeo", "inspect", "--override-os", "linux", "--override-arch", arch, location))
                    if config.get("Architecture") != arch or config.get("Os") != "linux" or any(config.get("Labels", {}).get(key) != value for key, value in expected.items()):
                        break
                else:
                    continue
                break
            else:
                # Fetch every referenced blob before treating registry state as complete.
                with tempfile.TemporaryDirectory(prefix="publication-check-") as directory:
                    run("skopeo", "copy", "--all", "--preserve-digests", f"docker://{image}@sha256:{digest}", f"dir:{directory}")
                return True
        except MissingImage:
            continue
    return False


def defer_missing_candidate(skip, force, repository, run_id, channel, queue):
    if skip:
        return True
    pages = json.loads(run("gh", "api", "--paginate", "--slurp", f"repos/{repository}/actions/runs/{run_id}/artifacts"))
    if any(artifact.get("name") == f"candidate-{channel}" and artifact.get("expired") is False for page in pages for artifact in page["artifacts"]):
        return False
    if force:
        raise RuntimeError("Forced rebuild produced no candidate; refusing another retry.")
    if run("git", "ls-remote", "origin", "refs/heads/patch-queue").split()[0] != queue:
        raise RuntimeError("Patch queue changed before repair dispatch.")
    run("gh", "api", "--method", "POST", f"repos/{repository}/actions/workflows/downstream.yml/dispatches", "-f", "ref=patch-queue")
    print("::notice::Publication changed after build skipped. Forced read-only rebuild dispatched; publication deferred.")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("channel", choices=("stable", "nightly"))
    parser.add_argument("image")
    parser.add_argument("source")
    parser.add_argument("upstream")
    parser.add_argument("queue")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--repair-missing-candidate", action="store_true")
    args = parser.parse_args()
    skip = complete(args.channel, args.image, args.source, args.upstream, args.queue, args.force)
    if args.repair_missing_candidate:
        skip = defer_missing_candidate(skip, args.force, os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_RUN_ID"], args.channel, args.queue)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        output.write(f"skip={str(skip).lower()}\n")


if __name__ == "__main__":
    main()

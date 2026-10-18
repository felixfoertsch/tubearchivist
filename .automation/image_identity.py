#!/usr/bin/env python3
"""Create an absent immutable image, or verify and reuse identical bytes."""
import argparse
import hashlib
import json
import re
import subprocess
import tempfile


def run(*args):
    return subprocess.run(args, capture_output=True)


def manifest(location, missing_ok=False):
    result = run("skopeo", "inspect", "--raw", location)
    if result.returncode:
        # Only explicit registry manifest/name absence permits creation.
        error = result.stderr.decode(errors="replace")
        if missing_ok and re.search(r"(?:manifest unknown|name unknown):", error, re.IGNORECASE):
            return None
        # Project fixed markers only; registry stderr can contain credentials.
        markers = [name for name in ("manifest unknown", "name unknown", "unauthorized", "denied", "timeout", "connection refused", "404", "403", "401") if name in error.lower()]
        raise RuntimeError("Cannot verify immutable image manifest; markers=" + json.dumps(markers))
    value = json.loads(result.stdout)
    if not isinstance(value, dict) or value.get("schemaVersion") != 2:
        raise RuntimeError("Invalid immutable image manifest.")
    return hashlib.sha256(result.stdout).hexdigest()


def publish(candidate, destination):
    expected = manifest(candidate)
    existing = manifest(destination, missing_ok=True)
    if existing is not None and existing != expected:
        raise RuntimeError("Immutable image digest mismatch; refusing overwrite.")
    if existing is None:
        result = run("skopeo", "copy", "--all", "--preserve-digests", candidate, destination)
        if result.returncode:
            raise RuntimeError("Immutable image creation failed.")
    if manifest(destination) != expected:
        raise RuntimeError("Immutable image readback mismatch.")
    # Download every platform and blob, not just the index. Reuse never writes
    # registry bytes; incomplete existing objects fail before refs or aliases.
    with tempfile.TemporaryDirectory() as directory:
        result = run("skopeo", "copy", "--all", "--preserve-digests", destination, "oci:" + directory + ":verified")
        if result.returncode:
            raise RuntimeError("Immutable image closure verification failed.")
    return expected


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("candidate")
    parser.add_argument("destination")
    args = parser.parse_args()
    print(publish(args.candidate, args.destination))

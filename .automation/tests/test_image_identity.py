"""Immutable registry boundary: only explicit absence permits upload."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("image_identity", Path(__file__).resolve().parents[1] / "image_identity.py")
image = importlib.util.module_from_spec(spec)
spec.loader.exec_module(image)
MANIFEST = json.dumps({"schemaVersion": 2, "manifests": []}).encode()


class ImageIdentityTests(unittest.TestCase):
    def test_existing_identity_matrix(self):
        for state in ("match", "different", "absent", "auth", "network", "badjson", "blobunknown", "closure", "readback"):
            with self.subTest(state=state):
                writes = []
                reads = []
                def run(*args):
                    if args[1] == "copy":
                        if args[-1] == "docker://image:identity":
                            writes.append(args)
                        return subprocess.CompletedProcess(args, 1 if state == "closure" else 0, b"", b"")
                    if args[-1].startswith("oci-archive:"):
                        return subprocess.CompletedProcess(args, 0, MANIFEST, b"")
                    reads.append(args)
                    if len(reads) == 1 and state in ("absent", "auth", "network", "blobunknown"):
                        message = {"absent": b"manifest unknown: missing", "auth": b"unauthorized: denied", "network": b"timeout", "blobunknown": b"blob unknown: missing"}[state]
                        return subprocess.CompletedProcess(args, 1, b"", message)
                    data = b"bad" if state == "badjson" else MANIFEST
                    if state == "different" or state == "readback" and len(reads) > 1:
                        data = b'{"schemaVersion":2,"manifests":[1]}'
                    return subprocess.CompletedProcess(args, 0, data, b"")
                with patch.object(image, "run", side_effect=run):
                    if state in ("match", "absent"):
                        image.publish("oci-archive:candidate", "docker://image:identity")
                    else:
                        with self.assertRaises((RuntimeError, ValueError)):
                            image.publish("oci-archive:candidate", "docker://image:identity")
                self.assertEqual(len(writes), 1 if state == "absent" else 0)

    def test_explicit_absence_accepts_ghcr_without_colon(self):
        for message in (b'manifest unknown: missing', b'reading manifest v0.5.12 in ghcr.io/felixfoertsch/tubearchivist: manifest unknown', b'name unknown', b'MANIFEST UNKNOWN'):
            with self.subTest(message=message), patch.object(image, "run", return_value=subprocess.CompletedProcess([], 1, b"", message)):
                self.assertIsNone(image.manifest("docker://image:identity", missing_ok=True))
                with self.assertRaises(RuntimeError):
                    image.manifest("docker://image:identity")
        for message in (b'manifest unknownish', b'notmanifest unknown', b'unauthorized: denied', b'timeout', b'blob unknown: missing'):
            with self.subTest(message=message), patch.object(image, "run", return_value=subprocess.CompletedProcess([], 1, b"", message)):
                with self.assertRaises(RuntimeError):
                    image.manifest("docker://image:identity", missing_ok=True)

    def test_manifest_failure_projects_only_fixed_markers(self):
        result = subprocess.CompletedProcess([], 1, b"", b'unauthorized; synthetic-secret-token')
        with patch.object(image, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, r'markers=\["unauthorized"\]') as error:
                image.manifest("docker://image:identity", missing_ok=True)
        self.assertNotIn("synthetic-secret-token", str(error.exception))

    def test_workflow_stops_on_helper_failure_before_source_and_aliases(self):
        workflow = (Path(__file__).resolve().parents[2] / ".github/workflows/downstream.yml").read_text()
        self.assertLess(workflow.index(".automation/image_identity.py"), workflow.index(".automation/source_refs.py"))
        self.assertNotIn('skopeo copy --all --preserve-digests "oci-archive:', workflow)


if __name__ == "__main__":
    unittest.main()

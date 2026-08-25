import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("publication", Path(__file__).parents[1] / "publication.py")
publication = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publication)


class PublicationTests(unittest.TestCase):
    def setUp(self):
        self.source, self.upstream, self.queue = "a" * 40, "b" * 40, "c" * 40
        self.tag = "v1.2.3-2026.10.09.1"
        self.index = json.dumps({"manifests": [{"platform": {"os": "linux", "architecture": arch}} for arch in ("amd64", "arm64")]})
        self.images = {name: self.index for name in (self.tag, "stable", "latest")}
        self.labels = {"org.opencontainers.image.revision": self.source, "org.opencontainers.image.base.digest": self.upstream, "de.felixfoertsch.patch-queue": self.queue}
        self.refs = f"{self.source}\trefs/tags/{self.tag}\n{self.source}\trefs/heads/main\n{self.queue}\trefs/heads/patch-queue"

    def run_command(self, *args):
        if args[0] == "git":
            return self.refs
        if args[1] == "copy":
            return ""
        if "--raw" in args:
            name = args[-1].rsplit(":", 1)[1]
            if name not in self.images:
                raise publication.MissingImage()
            return self.images[name]
        return json.dumps({"Architecture": args[args.index("--override-arch") + 1], "Os": "linux", "Labels": self.labels})

    def complete(self, channel="stable", force=False):
        with patch.object(publication, "run", side_effect=self.run_command):
            return publication.complete(channel, "ghcr.io/fork/image", self.source, self.upstream, self.queue, force)

    def test_unchanged_and_force(self):
        self.assertTrue(self.complete())
        self.assertFalse(self.complete(force=True))

    def test_changed_source_queue_upstream(self):
        for label in self.labels:
            with self.subTest(label=label):
                previous = self.labels[label]
                self.labels[label] = "d" * 40
                self.assertFalse(self.complete())
                self.labels[label] = previous
        self.refs = self.refs.replace(self.source, "d" * 40)
        self.assertFalse(self.complete())

    def test_incomplete_or_mismatched_artifacts_and_aliases(self):
        for name in self.images.copy():
            saved = self.images.pop(name)
            self.assertFalse(self.complete())
            self.images[name] = saved
            self.images[name] = json.dumps({"manifests": [{"platform": {"os": "linux", "architecture": "amd64"}}]})
            self.assertFalse(self.complete())
            self.images[name] = saved

    def test_alias_digest_mismatch_requires_repair(self):
        self.images["latest"] = self.index + "\n"
        self.assertFalse(self.complete())

    def test_nightly_requires_main_and_all_aliases(self):
        tag = "nightly-" + self.tag
        self.refs = self.refs.replace(self.tag, tag)
        self.images = {name: self.index for name in (tag, "nightly", "edge", "develop")}
        self.assertTrue(self.complete("nightly"))
        self.refs = self.refs.replace(f"{self.source}\trefs/heads/main", f"{'d' * 40}\trefs/heads/main")
        self.assertFalse(self.complete("nightly"))

    def test_missing_blobs_require_repair(self):
        original = self.run_command
        def missing_blob(*args):
            if args[:2] == ("skopeo", "copy"):
                raise publication.MissingImage()
            return original(*args)
        with patch.object(publication, "run", side_effect=missing_blob):
            self.assertFalse(publication.complete("stable", "ghcr.io/fork/image", self.source, self.upstream, self.queue))

    def test_missing_or_changed_queue_fails_closed(self):
        self.refs = self.refs.replace(f"{self.queue}\trefs/heads/patch-queue", "")
        with self.assertRaises(RuntimeError):
            self.complete()

    def test_workflow_gates_build_and_publication_independently(self):
        workflow = (Path(__file__).parents[2] / ".github/workflows/downstream.yml").read_text()
        self.assertEqual(workflow.count("id: publication"), 2)
        self.assertEqual(workflow.count("FORCE: ${{ github.event_name == 'workflow_dispatch' }}"), 2)
        for step in ("Build read-only candidate", "Record artifact provenance", "Verify artifact provenance and revision", "Publish verified image and source"):
            self.assertIn(f"- name: {step}\n        if: steps.publication.outputs.skip != 'true'", workflow)

    def test_skipped_build_lost_publication_dispatches_one_forced_repair(self):
        self.assertTrue(self.complete())
        self.images.pop("latest")
        self.assertFalse(self.complete())
        calls = []
        artifacts = []
        def boundary(*args):
            calls.append(args)
            if args[:2] == ("git", "ls-remote"):
                return f"{self.queue}\trefs/heads/patch-queue\n"
            if "--slurp" in args:
                return json.dumps([{"artifacts": artifacts}])
            return ""
        with patch.object(publication, "run", side_effect=boundary):
            self.assertTrue(publication.defer_missing_candidate(False, False, "fork/repo", "123", "stable", self.queue))
            self.assertEqual(sum("POST" in call for call in calls), 1)
            with self.assertRaisesRegex(RuntimeError, "refusing another retry"):
                publication.defer_missing_candidate(False, True, "fork/repo", "124", "stable", self.queue)
            self.assertEqual(sum("POST" in call for call in calls), 1)
            artifacts.append({"name": "candidate-stable", "expired": False})
            self.assertFalse(publication.defer_missing_candidate(False, True, "fork/repo", "124", "stable", self.queue))
            self.images["latest"] = self.index
            self.assertTrue(self.complete())
            self.assertTrue(publication.defer_missing_candidate(True, False, "fork/repo", "125", "stable", self.queue))
            self.assertEqual(sum("POST" in call for call in calls), 1)

    def test_registry_errors_fail_closed(self):
        with patch.object(publication, "run", side_effect=RuntimeError("unauthorized")):
            with self.assertRaises(RuntimeError):
                publication.complete("stable", "ghcr.io/fork/image", self.source, self.upstream, self.queue)


if __name__ == "__main__":
    unittest.main()

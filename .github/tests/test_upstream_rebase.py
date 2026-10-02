"""Offline integration tests for the real upstream replay script."""

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "rebase_upstream.sh"


class UpstreamReplayTests(unittest.TestCase):
    """Exercise real Git repositories, not mocked rebase commands."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.env = {
            **os.environ,
            "GIT_AUTHOR_NAME": "Patch test",
            "GIT_AUTHOR_EMAIL": "test@example.invalid",
            "GIT_COMMITTER_NAME": "Patch test",
            "GIT_COMMITTER_EMAIL": "test@example.invalid",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_OUTPUT": str(self.root / "outputs"),
            "GITHUB_STEP_SUMMARY": str(self.root / "summary"),
        }
        self.upstream = self.root / "upstream"
        self.git(self.root, "init", "-b", "develop", str(self.upstream))
        self.base = self.commit(self.upstream, "base.txt", "base\n", "upstream base")
        self.env["UPSTREAM_URL"] = str(self.upstream)
        self.origin = self.root / "origin.git"
        self.git(self.root, "clone", "--bare", str(self.upstream), str(self.origin))
        self.work = self.root / "work"
        self.git(self.root, "clone", str(self.origin), str(self.work))
        self.git(self.work, "branch", "upstream-base", self.base)
        self.git(self.work, "push", "origin", "upstream-base")
        self.commit(self.work, "pipeline.txt", "pipeline\n", "setup pipeline")
        self.commit(self.work, "filter.txt", "filter\n", "add filtering")
        self.commit(self.work, "embed.txt", "simple\n", "add simple embedding")
        self.original = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "push", "origin", "develop")

    def git(self, cwd, *args):
        return subprocess.run(
            ["git", *args], cwd=cwd, env=self.env, check=True,
            text=True, capture_output=True,
        ).stdout.strip()

    def commit(self, repo, path, content, message):
        (repo / path).write_text(content, encoding="utf-8")
        self.git(repo, "add", path)
        self.git(repo, "commit", "-m", message)
        return self.git(repo, "rev-parse", "HEAD")

    def replay(self):
        return subprocess.run(
            ["bash", str(SCRIPT)], cwd=self.work, env=self.env,
            text=True, capture_output=True, timeout=30,
        )

    def assert_remote_unchanged(self):
        self.assertEqual(self.git(self.origin, "rev-parse", "develop"), self.original)
        self.assertEqual(self.git(self.origin, "rev-parse", "upstream-base"), self.base)

    def test_new_upstream_keeps_all_three_patches_in_order(self):
        new_base = self.commit(self.upstream, "new.txt", "new\n", "upstream update")
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.git(self.work, "rev-parse", "HEAD~3"), new_base)
        self.assertEqual(
            self.git(self.work, "log", "--reverse", "--format=%s", f"{new_base}..HEAD"),
            "setup pipeline\nadd filtering\nadd simple embedding",
        )
        for path in ("new.txt", "pipeline.txt", "filter.txt", "embed.txt"):
            self.assertTrue((self.work / path).exists())
        self.assert_remote_unchanged()

    def test_conflicting_patch_fails_and_restores_checkout(self):
        self.commit(self.upstream, "filter.txt", "different\n", "conflicting upstream feature")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cannot replay", result.stderr)
        self.assertIn("add filtering", result.stderr)
        self.assertEqual(self.git(self.work, "rev-parse", "HEAD"), self.original)
        self.assertEqual(self.git(self.work, "status", "--porcelain"), "")
        self.assert_remote_unchanged()

    def test_patch_already_in_upstream_fails_instead_of_disappearing(self):
        self.commit(self.upstream, "filter.txt", "filter\n", "upstream implements filtering")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Cannot replay", result.stderr)
        self.assertIn("add filtering", result.stderr)
        self.assertEqual(self.git(self.work, "rev-parse", "HEAD"), self.original)
        self.assert_remote_unchanged()

    def test_unchanged_released_schedule_skips_build(self):
        self.git(self.work, "tag", "fork-test", self.original)
        self.env["GITHUB_EVENT_NAME"] = "schedule"
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("publish=false", (self.root / "outputs").read_text())
        self.assertEqual(self.git(self.work, "rev-parse", "HEAD"), self.original)
        self.assert_remote_unchanged()

    def test_unreleased_schedule_retries_build(self):
        self.env["GITHUB_EVENT_NAME"] = "schedule"
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("publish=true", (self.root / "outputs").read_text())
        self.assert_remote_unchanged()

    def test_upstream_history_rewrite_fails(self):
        self.git(self.upstream, "checkout", "--orphan", "replacement")
        self.git(self.upstream, "rm", "-rf", ".")
        self.commit(self.upstream, "replacement.txt", "new history\n", "rewritten upstream")
        self.git(self.upstream, "branch", "-M", "develop")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Upstream history was rewritten", result.stderr)
        self.assert_remote_unchanged()

    def test_stale_checkout_fails_without_overwriting_a_new_push(self):
        newer = self.commit(self.work, "other.txt", "other\n", "concurrent change")
        self.git(self.work, "push", "origin", "develop")
        self.git(self.work, "reset", "--hard", self.original)
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("develop changed after checkout", result.stderr)
        self.assertEqual(self.git(self.origin, "rev-parse", "develop"), newer)

    def test_atomic_push_lease_rejects_concurrent_changes(self):
        new_base = self.commit(self.upstream, "new.txt", "new\n", "upstream update")
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stderr)
        other = self.root / "other"
        self.git(self.root, "clone", str(self.origin), str(other))
        concurrent = self.commit(other, "other.txt", "other\n", "concurrent push")
        self.git(other, "push", "origin", "develop")
        result = subprocess.run(
            ["git", "push", "--atomic",
             f"--force-with-lease=refs/heads/develop:{self.original}",
             f"--force-with-lease=refs/heads/upstream-base:{self.base}",
             "origin", "HEAD:refs/heads/develop", f"{new_base}:refs/heads/upstream-base"],
            cwd=self.work, env=self.env, text=True, capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.git(self.origin, "rev-parse", "develop"), concurrent)
        self.assertEqual(self.git(self.origin, "rev-parse", "upstream-base"), self.base)

    def test_atomic_push_updates_stack_and_boundary_together(self):
        new_base = self.commit(self.upstream, "new.txt", "new\n", "upstream update")
        result = self.replay()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.git(
            self.work, "push", "--atomic",
            f"--force-with-lease=refs/heads/develop:{self.original}",
            f"--force-with-lease=refs/heads/upstream-base:{self.base}",
            "origin", "HEAD:refs/heads/develop", f"{new_base}:refs/heads/upstream-base",
        )
        self.assertEqual(self.git(self.origin, "rev-parse", "upstream-base"), new_base)
        self.assertEqual(self.git(self.origin, "rev-parse", "develop~3"), new_base)


    def test_dirty_checkout_fails(self):
        (self.work / "filter.txt").write_text("unsaved work\n")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("dirty checkout", result.stderr)
        self.assertEqual((self.work / "filter.txt").read_text(), "unsaved work\n")
        self.assert_remote_unchanged()

    def test_empty_patch_is_rejected(self):
        self.git(self.work, "commit", "--allow-empty", "-m", "empty patch")
        self.original = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "push", "origin", "develop")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Empty fork patch", result.stderr)
        self.assert_remote_unchanged()

    def test_merge_commit_is_rejected(self):
        self.git(self.work, "checkout", "-b", "side", self.base)
        self.commit(self.work, "side.txt", "side\n", "side change")
        self.git(self.work, "checkout", "develop")
        self.git(self.work, "merge", "--no-ff", "side", "-m", "merge side")
        self.original = self.git(self.work, "rev-parse", "HEAD")
        self.git(self.work, "push", "origin", "develop")
        result = self.replay()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("contains merge commits", result.stderr)
        self.assert_remote_unchanged()

if __name__ == "__main__":
    unittest.main()

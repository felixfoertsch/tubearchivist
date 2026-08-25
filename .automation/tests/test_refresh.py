"""Real Git reconstruction/backup and bounded promotion checks."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import refresh


class RefreshTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        self.git("init", "-b", "develop")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.root / "README.md").write_text("Complete upstream README\n")
        (self.root / "AGENTS.md").write_text("Policy\n")
        self.save("upstream")
        self.upstream = self.git("rev-parse", "HEAD")
        self.git("branch", "official", self.upstream)
        automation = self.root / ".automation"
        (automation / "patches").mkdir(parents=True)
        (automation / "series").write_text("0001-remove-upstream-ai-policy.patch\n")
        self.git("rm", "AGENTS.md")
        (automation / "patches/0001-remove-upstream-ai-policy.patch").write_text(self.git("diff", "--cached") + "\n")
        for name in refresh.WORKFLOWS:
            path = self.root / ".github/workflows" / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("name: trusted\n")
        (self.root / ".gitattributes").write_text("* text=auto\n")
        (self.root / "FORK.md").write_text("Fork\n")
        self.save("control")
        self.control = self.git("rev-parse", "HEAD")

    def git(self, *args):
        return refresh.git(self.root, *args)

    def save(self, message):
        self.git("add", "--all")
        refresh.commit(self.root, message, "2026-01-01T00:00:00Z")

    def test_backup_restores_exact_control_and_detects_corruption(self):
        directory = Path(self.temp.name) / "backup"
        directory.mkdir()
        refresh.backup(self.root, self.control, directory)
        refresh.verify_backup(self.root, self.control, directory)
        (directory / "control.bundle").write_bytes(b"corrupt")
        with self.assertRaises(RuntimeError):
            refresh.verify_backup(self.root, self.control, directory)

    def test_reconstruction_preserves_overlay_readme_policy_and_noop(self):
        candidate = Path(self.temp.name) / "candidate"
        sha = refresh.reconstruct(self.root, self.control, self.upstream, candidate, {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        self.assertEqual(refresh.git(candidate, "ls-tree", "-r", sha, "--", ".github/workflows"), self.git("ls-tree", "-r", self.control, "--", ".github/workflows"))
        self.assertFalse((candidate / "AGENTS.md").exists())
        self.assertEqual((candidate / "README.md").read_text().count("Complete upstream README"), 1)
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)):
            result = refresh.prepare(candidate, Path(self.temp.name) / "next", str(self.root))
        self.assertFalse(result["changed"])
        self.assertEqual(result["candidate"], sha)

    def test_unknown_customization_blocks(self):
        (self.root / "unshipped.py").write_text("unknown\n")
        self.save("unshipped")
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)):
            with self.assertRaisesRegex(RuntimeError, "Unqueued"):
                refresh.prepare(self.root, Path(self.temp.name) / "next", str(self.root))

    def test_reserved_collision_blocks(self):
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/develop", self.control)):
            self.git("branch", "collision", self.control)
            with patch.object(refresh, "upstream_head", return_value=("refs/heads/collision", self.control)):
                with self.assertRaisesRegex(RuntimeError, "collision"):
                    refresh.prepare(self.root, Path(self.temp.name) / "next", str(self.root))

    def test_second_upstream_and_empty_commit_refresh_once(self):
        first = Path(self.temp.name) / "first"
        refresh.reconstruct(self.root, self.control, self.upstream, first,
                            {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        self.git("checkout", "official")
        self.git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "empty upstream")
        newer = self.git("rev-parse", "HEAD")
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", newer)):
            result = refresh.prepare(first, Path(self.temp.name) / "second", str(self.root))
        self.assertTrue(result["changed"])
        second = Path(self.temp.name) / "second/candidate"
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", newer)):
            again = refresh.prepare(second, Path(self.temp.name) / "third", str(self.root))
        self.assertFalse(again["changed"])

    def test_promote_atomic_archive_and_exact_dispatch(self):
        directory = Path(self.temp.name) / "promotion"
        directory.mkdir()
        meta = {"control": self.control, "branch": "refs/heads/official",
                "upstream": self.upstream, "candidate": "a" * 40, "changed": True}
        (directory / "refresh.json").write_text(json.dumps(meta))
        refresh.backup(self.root, self.control, directory)
        (directory / "manifest.json").write_text(json.dumps({"control": self.control, "upstream": self.upstream, "candidate": "a" * 40, "branch": meta["branch"], "bundle_sha256": (directory / "control.sha256").read_text().strip()}))
        real_git = refresh.git
        calls = []
        def fake_git(root, *args, **kwargs):
            calls.append(args)
            if args[:2] == ("ls-remote", "origin"):
                if len(args) == 4:
                    return "a" * 40 + "\trefs/heads/patch-queue\n" + self.control + "\t" + args[-1]
                return self.control + "\trefs/heads/patch-queue" if args[-1].startswith("refs/heads/") else ""
            if args[0] in ("push", "fetch"):
                return ""
            return real_git(root, *args, **kwargs)
        with patch.object(refresh, "git", side_effect=fake_git), patch.object(refresh, "upstream_head", return_value=(meta["branch"], self.upstream)), patch.object(refresh.subprocess, "run") as dispatch, patch.object(refresh, "verify_backup"):
            dispatch.return_value.returncode = 0
            # rev-parse is supplied explicitly because subprocess.run is mocked.
            with patch.object(refresh, "git", side_effect=lambda root, *a, **k: self.control if a == ("rev-parse", "HEAD") else fake_git(root, *a, **k)):
                refresh.promote(self.root, directory, directory, "owner/repo", False)
            push = next(c for c in calls if c[0] == "push")
            self.assertIn("--atomic", push)
            self.assertIn("--force-with-lease=refs/heads/patch-queue:" + self.control, push)
            self.assertIn("--force-with-lease=refs/tags/archive/patch-queue/" + self.control + ":", push)
            payload = json.loads(dispatch.call_args.kwargs["input"])
            self.assertEqual(payload["inputs"], {"expected_control": "a" * 40, "rebuild": False})
            self.assertEqual(dispatch.call_count, 1)

    def test_promotion_negative_guards_and_rebuild_intent(self):
        directory = Path(self.temp.name) / "negative"
        directory.mkdir()
        meta = {"control": self.control, "branch": "refs/heads/official",
                "upstream": self.upstream, "candidate": "a" * 40, "changed": True}
        (directory / "refresh.json").write_text(json.dumps(meta))
        (directory / "control.sha256").write_text("synthetic digest")
        (directory / "manifest.json").write_text(json.dumps({"control": self.control, "upstream": self.upstream, "candidate": "a" * 40, "branch": meta["branch"], "bundle_sha256": "synthetic digest"}))
        tag = "refs/tags/archive/patch-queue/" + self.control
        for failure in ("control", "upstream", "default", "archive", "annotated", "atomic", "readback", "dispatch", None):
            for force in (False, True):
                with self.subTest(failure=failure, force=force):
                    calls = []
                    def fake_git(root, *args, **kwargs):
                        calls.append(args)
                        if args == ("rev-parse", "HEAD"):
                            return self.control
                        if args[:2] == ("ls-remote", "origin"):
                            if len(args) == 4:
                                return ("b" * 40 if failure == "readback" else "a" * 40) + "\trefs/heads/patch-queue\n" + self.control + "\t" + tag
                            if args[-1] == tag:
                                # Annotated tag object differs even when peeled commit is C.
                                return "b" * 40 + "\t" + tag if failure in ("archive", "annotated") else ""
                            return ("b" * 40 if failure == "control" else self.control) + "\trefs/heads/patch-queue"
                        if args[0] == "push" and failure == "atomic":
                            raise RuntimeError("atomic push unsupported or rejected")
                        return ""
                    selected = ("refs/heads/changed" if failure == "default" else meta["branch"], "b" * 40 if failure == "upstream" else self.upstream)
                    with patch.object(refresh, "git", side_effect=fake_git), patch.object(refresh, "verify_backup"), patch.object(refresh, "upstream_head", return_value=selected), patch.object(refresh.subprocess, "run", side_effect=RuntimeError("dispatch failed") if failure == "dispatch" else None) as dispatch:
                        if failure:
                            with self.assertRaises(RuntimeError):
                                refresh.promote(self.root, directory, directory, "owner/repo", force)
                        else:
                            refresh.promote(self.root, directory, directory, "owner/repo", force)
                        if failure not in (None, "dispatch"):
                            dispatch.assert_not_called()
                        else:
                            self.assertEqual(dispatch.call_count, 1)
                            self.assertEqual(json.loads(dispatch.call_args.kwargs["input"])["inputs"]["rebuild"], force)
                        pushes = [call for call in calls if call[0] == "push"]
                        self.assertEqual(len(pushes), 0 if failure in ("control", "upstream", "default", "archive", "annotated") else 1)
                        if pushes:
                            self.assertIn("--atomic", pushes[0])

    def test_prerequisite_bundle_cannot_restore_into_empty_repository(self):
        directory = Path(self.temp.name) / "incremental"
        directory.mkdir()
        self.git("bundle", "create", str(directory / "control.bundle"), "HEAD", "^" + self.upstream)
        with self.assertRaises(RuntimeError):
            refresh.verify_backup(self.root, self.control, directory)

    def test_upstream_default_change_blocks(self):
        candidate = Path(self.temp.name) / "candidate"
        refresh.reconstruct(self.root, self.control, self.upstream, candidate,
                            {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        self.git("branch", "renamed", self.upstream)
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/renamed", self.upstream)):
            with self.assertRaisesRegex(RuntimeError, "default branch changed"):
                refresh.prepare(candidate, Path(self.temp.name) / "next", str(self.root))

    def test_upstream_force_push_blocks(self):
        candidate = Path(self.temp.name) / "candidate"
        refresh.reconstruct(self.root, self.control, self.upstream, candidate,
                            {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        self.git("checkout", "--orphan", "rewritten")
        self.git("rm", "-rf", ".")
        (self.root / "README.md").write_text("Unrelated upstream")
        self.save("force pushed upstream")
        rewritten = self.git("rev-parse", "HEAD")
        self.git("branch", "-f", "official", rewritten)
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", rewritten)):
            with self.assertRaises(RuntimeError):
                refresh.prepare(candidate, Path(self.temp.name) / "next", str(self.root))

    def test_archive_control_not_reachable_from_reconstructed_source(self):
        archive = "archive/patch-queue/" + self.control
        self.git("-c", "tag.gpgSign=false", "tag", archive, self.control)
        self.git("-c", "tag.gpgSign=false", "tag", "v1.0.0", self.upstream)
        candidate = Path(self.temp.name) / "candidate"
        refresh.reconstruct(self.root, self.control, self.upstream, candidate)
        self.assertEqual(refresh.git(candidate, "describe", "--tags", "--abbrev=0"), "v1.0.0")
        selected = refresh.git(candidate, "rev-parse", "HEAD")
        self.assertNotEqual(selected, self.control)
        result = subprocess.run(["git", "-C", str(candidate), "merge-base", "--is-ancestor", self.control, selected])
        self.assertEqual(result.returncode, 1)

    def test_flattened_identical_tree_is_not_noop(self):
        candidate = Path(self.temp.name) / "candidate"
        refresh.reconstruct(self.root, self.control, self.upstream, candidate,
                            {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        tree = refresh.git(candidate, "rev-parse", "HEAD^{tree}")
        flattened = subprocess.check_output(["git", "-C", str(candidate), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit-tree", tree, "-m", "flattened"], text=True).strip()
        refresh.git(candidate, "reset", "--hard", flattened)
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)):
            result = refresh.prepare(candidate, Path(self.temp.name) / "next", str(self.root))
        self.assertTrue(result["changed"])

    def test_archive_exclusions_select_real_release_even_when_archive_nearest(self):
        self.git("-c", "tag.gpgSign=false", "tag", "v1.0.0", self.upstream)
        self.git("-c", "tag.gpgSign=false", "tag", "archive/patch-queue/" + self.control, self.control)
        self.assertEqual(self.git("describe", "--tags", "--exclude=archive/patch-queue/*", "--abbrev=0"), "v1.0.0")
        self.assertEqual(self.git("for-each-ref", "--exclude=refs/tags/archive/patch-queue/*", "--format=%(refname:strip=2)", "refs/tags"), "v1.0.0")
        patch_text = (Path(__file__).resolve().parents[1] / "patches/0002-fork-runtime-defaults.patch").read_text()
        self.assertEqual(patch_text.count("+    git for-each-ref --exclude='refs/tags/archive/patch-queue/*'"), 2)
        self.assertEqual(patch_text.count("+    git log \"$(git describe --tags --exclude='archive/patch-queue/*'"), 2)

    def test_real_atomic_rejection_keeps_branch_and_missing_archive_absent(self):
        remote = Path(self.temp.name) / "remote.git"
        self.git("init", "--bare", str(remote))
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "origin", "HEAD:refs/heads/patch-queue")
        hook = remote / "hooks/pre-receive"
        hook.write_text("#!/bin/sh\nexit 1\n")
        hook.chmod(0o755)
        (self.root / "new.txt").write_text("new")
        self.save("candidate")
        newer = self.git("rev-parse", "HEAD")
        tag = "refs/tags/archive/patch-queue/" + self.control
        with self.assertRaises(RuntimeError):
            self.git("push", "--atomic", "--force-with-lease=refs/heads/patch-queue:" + self.control,
                     "--force-with-lease=" + tag + ":", "origin", newer + ":refs/heads/patch-queue", self.control + ":" + tag)
        self.assertEqual(self.git("ls-remote", "origin", "refs/heads/patch-queue").split()[0], self.control)
        self.assertEqual(self.git("ls-remote", "origin", tag), "")

    def test_dispatch_failure_next_schedule_noop_recovers(self):
        remote = Path(self.temp.name) / "remote.git"
        self.git("init", "--bare", str(remote))
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "origin", "HEAD:refs/heads/patch-queue")
        initial = Path(self.temp.name) / "initial"
        new_control = refresh.reconstruct(self.root, self.control, self.upstream, initial,
                            {"repository": str(self.root), "branch": "refs/heads/official", "upstream": self.upstream})
        self.git("fetch", str(initial), new_control)
        self.git("reset", "--hard", new_control)
        self.control = new_control
        self.git("push", "--force", "origin", "HEAD:refs/heads/patch-queue")
        self.git("checkout", "official")
        self.git("-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "next upstream")
        newer = self.git("rev-parse", "HEAD")
        self.git("checkout", "--detach", new_control)
        self.upstream = newer
        directory = Path(self.temp.name) / "refresh"
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)):
            meta = refresh.prepare(self.root, directory, str(self.root))
        backup = Path(self.temp.name) / "backup"
        backup.mkdir()
        refresh.backup(self.root, self.control, backup)
        run = subprocess.run
        def fail_dispatch(args, **kwargs):
            if args[0] == "gh":
                raise RuntimeError("dispatch failed")
            return run(args, **kwargs)
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)), patch.object(refresh.subprocess, "run", side_effect=fail_dispatch):
            with self.assertRaisesRegex(RuntimeError, "dispatch failed"):
                refresh.promote(self.root, directory, backup, "owner/repo", False, str(self.root))
        self.assertEqual(self.git("ls-remote", "origin", "refs/heads/patch-queue").split()[0], meta["candidate"])
        candidate = directory / "candidate"
        with patch.object(refresh, "upstream_head", return_value=("refs/heads/official", self.upstream)):
            recovery = refresh.prepare(candidate, Path(self.temp.name) / "recovery", str(self.root))
        self.assertFalse(recovery["changed"])

    def test_extra_control_workflow_blocks(self):
        (self.root / ".github/workflows/unknown.yml").write_text("unknown\n")
        self.save("extra workflow")
        with self.assertRaisesRegex(RuntimeError, "workflow tree"):
            refresh.reconstruct(self.root, self.git("rev-parse", "HEAD"), self.upstream, Path(self.temp.name) / "candidate")


if __name__ == "__main__":
    unittest.main()

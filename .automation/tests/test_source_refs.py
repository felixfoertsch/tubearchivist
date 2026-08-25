"""Real Git source promotion, including rejected branch updates."""
from pathlib import Path
import importlib.util
import subprocess
import tempfile
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / "source_refs.py"


class SourceRefsTests(unittest.TestCase):
    def test_atomic_creation_rejection_and_existing_exact_tag(self):
        spec = importlib.util.spec_from_file_location("source_refs", MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "source"
            remote = Path(temp) / "remote.git"
            def git(*args):
                return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()
            root.mkdir()
            git("init")
            git("config", "user.name", "Test")
            git("config", "user.email", "test@example.invalid")
            git("config", "commit.gpgsign", "false")
            git("config", "tag.gpgsign", "false")
            (root / "file").write_text("old")
            git("add", ".")
            git("commit", "-m", "old")
            old = git("rev-parse", "HEAD")
            git("init", "--bare", str(remote))
            git("remote", "add", "origin", str(remote))
            git("push", "origin", "HEAD:refs/heads/main")
            (root / "file").write_text("new")
            git("commit", "-am", "new")
            new = git("rev-parse", "HEAD")
            hook = remote / "hooks/pre-receive"
            hook.write_text('#!/bin/sh\nwhile read old new ref; do\n test "$ref" != refs/heads/main || exit 1\ndone\n')
            hook.chmod(0o755)
            with self.assertRaises(RuntimeError):
                module.promote(root, new, "nightly-test", old)
            self.assertEqual(git("ls-remote", "origin", "refs/tags/nightly-test"), "")
            self.assertEqual(git("ls-remote", "origin", "refs/heads/main").split()[0], old)
            hook.unlink()
            module.promote(root, new, "nightly-test", old)
            self.assertEqual(git("ls-remote", "origin", "refs/heads/main").split()[0], new)
            # Existing immutable exact tag is reusable, never overwritten.
            module.promote(root, new, "nightly-test", new)
            module.promote(root, old, "stable-test")
            self.assertEqual(git("ls-remote", "origin", "refs/heads/main").split()[0], new)
            git("-c", "tag.gpgsign=false", "tag", "-a", "annotated", "-m", "annotated", new)
            git("push", "origin", "refs/tags/annotated")
            with self.assertRaisesRegex(RuntimeError, "Immutable"):
                module.promote(root, new, "annotated", new)
            with self.assertRaises(RuntimeError):
                module.promote(root, "0" * 40, "invalid-source", new)
            self.assertEqual(git("ls-remote", "origin", "refs/tags/invalid-source"), "")
            real_git = module.git
            for bad in ("missing", "wrong", "error"):
                def readback(root, *args):
                    if args[:2] == ("ls-remote", "origin") and len(args) > 3:
                        if bad == "error":
                            raise RuntimeError("readback failed")
                        return "" if bad == "missing" else old + "\trefs/heads/main"
                    return real_git(root, *args)
                with patch.object(module, "git", side_effect=readback):
                    with self.assertRaises(RuntimeError):
                        module.promote(root, new, "nightly-test", new)
            git("tag", "wrong", old)
            git("push", "origin", "refs/tags/wrong")
            with self.assertRaisesRegex(RuntimeError, "Immutable"):
                module.promote(root, new, "wrong", new)


if __name__ == "__main__":
    unittest.main()

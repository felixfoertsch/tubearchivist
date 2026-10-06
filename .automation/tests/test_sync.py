import io
import os
from pathlib import Path
import shutil
import tarfile
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "fork"
        shutil.copytree(ROOT, self.root, ignore=shutil.ignore_patterns(".git", "__pycache__"))
        self.git_run(self.root, "init", "-b", "automation")
        self.git_run(self.root, "config", "user.name", "Test")
        self.git_run(self.root, "config", "user.email", "test@example.invalid")
        self.git_run(self.root, "add", ".")
        self.git_run(self.root, "commit", "-m", "automation")
        self.upstream = Path(self.temp.name) / "upstream"
        self.git_run(self.temp.name, "init", "-b", "develop", str(self.upstream))
        archive = subprocess.run(["git", "archive", "920b550ef8aa0606682d4fd8a216c44c5bd60c8e"], cwd=ROOT, capture_output=True, check=True).stdout
        with tarfile.open(fileobj=io.BytesIO(archive)) as files:
            files.extractall(self.upstream)
        (self.upstream / "AGENTS.md").write_text((self.upstream / "AGENTS.md").read_text(encoding="utf-8"), encoding="utf-8")
        self.git_run(self.upstream, "add", ".")
        self.git_run(self.upstream, "commit", "-m", "upstream")
        self.git_run(self.upstream, "tag", "-a", "v0.0.1", "-m", "release")

    def git_run(self, cwd, *args, check=True):
        result = subprocess.run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", "-c", "gc.auto=0", *args], cwd=cwd, text=True, capture_output=True, env={**os.environ, "GIT_EDITOR": "true"})
        if check and result.returncode:
            raise RuntimeError(f"git {' '.join(args)}: {result.stderr}\n{result.stdout}")
        return result

    def sync(self, ref="refs/heads/develop"):
        return subprocess.run(["python3", ".automation/sync.py", "--upstream-url", str(self.upstream), "--upstream-ref", ref], cwd=self.root, text=True, capture_output=True)

    def test_rebuild_removes_automation_and_documents_all_patches(self):
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / ".automation").exists())
        self.assertFalse((self.root / "AGENTS.md").exists())
        readme = (self.root / "README.md").read_text(encoding="utf-8")
        self.assertTrue(readme.startswith("This fork follows upstream [Tube Archivist]"))
        self.assertEqual(readme.split("\n---\n\n", 1)[1], (self.upstream / "README.md").read_text(encoding="utf-8"))
        self.assertIn("1. [0001-remove-upstream-ai-policy.patch]", readme)
        self.assertIn("https://github.com/felixfoertsch/tubearchivist/blob/automation/.automation/patches/", readme)
        self.assertIn("0004-simple-download-only-metadata-embedding.patch", readme)

    def test_absent_policy_files_are_accepted(self):
        patch = (self.root / ".automation/patches/0001-remove-upstream-ai-policy.patch").read_text(encoding="utf-8")
        self.assertIn("AGENTS.md", patch)
        for name in ("AGENTS.md", "CLAUDE.md", "CONTRIBUTING.md"):
            (self.upstream / name).unlink()
        self.git_run(self.upstream, "add", "-A")
        self.git_run(self.upstream, "commit", "-m", "already removed")
        result = self.sync()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((self.root / "AGENTS.md").exists())

    def test_conflicting_patch_fails(self):
        (self.upstream / "backend/appsettings").mkdir(parents=True, exist_ok=True)
        (self.upstream / "backend/appsettings/index_mapping.json").write_text("conflict\n", encoding="utf-8")
        self.git_run(self.upstream, "add", ".")
        self.git_run(self.upstream, "commit", "-m", "conflict")
        result = self.sync()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Patch no longer applies", result.stderr)


if __name__ == "__main__":
    unittest.main()

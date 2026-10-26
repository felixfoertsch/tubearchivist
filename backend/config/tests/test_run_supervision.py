"""Container startup exits when either long-running service exits."""

import os
import shutil
import subprocess
from pathlib import Path


def test_worker_exit_stops_web_and_fails_container(tmp_path):
    bash = shutil.which("bash")
    if not bash:
        return
    version = subprocess.run(
        [bash, "-c", 'printf "%s" "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    major, minor = map(int, version.split("."))
    if (major, minor) < (5, 1):
        return

    root = Path(__file__).resolve().parents[3]
    runner = tmp_path / "run.sh"
    shutil.copy(root / "docker_assets/run.sh", runner)
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    worker_pid = tmp_path / "worker.pid"
    web_pid = tmp_path / "web.pid"
    fake_python = fake_bin / "python"
    fake_python.write_text(
        "#!/bin/bash\n"
        'if [[ "$*" == *"ta_worker"* ]]; then\n'
        f'  echo "$$" > "{worker_pid}"\n'
        "  sleep 0.2\n"
        "  exit 7\n"
        "fi\n"
        'if [[ "$*" == *"backend_start.py"* ]]; then\n'
        f'  echo "$$" > "{web_pid}"\n'
        "  exec sleep 60\n"
        "fi\n"
    )
    fake_python.chmod(0o755)
    env = os.environ.copy()
    env.update(
        PATH=f"{fake_bin}:{env['PATH']}",
        TA_AUTO_UPDATE_YTDLP="",
        DJANGO_DEBUG="",
    )

    result = subprocess.run(
        [bash, str(runner)], env=env, capture_output=True, text=True, timeout=5
    )

    assert result.returncode == 7, result.stderr
    for pid_file in (worker_pid, web_pid):
        pid = int(pid_file.read_text())
        with subprocess.Popen(
            ["/bin/kill", "-0", str(pid)], stdout=subprocess.DEVNULL
        ) as probe:
            assert (
                probe.wait() != 0
            ), f"service process {pid} survived shutdown"

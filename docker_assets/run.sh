#!/bin/bash
# startup script inside the container for tubearchivist

set -e

if [[ -n "$DJANGO_DEBUG" ]]; then
  LOGLEVEL="DEBUG"
else
  LOGLEVEL="INFO"
fi

# update yt-dlp if needed
YTDLP_UPDATE_DIR=/tmp/ta-yt-dlp
if [[ "${TA_AUTO_UPDATE_YTDLP,,}" =~ ^(release|nightly)$ ]]; then
  echo "Updating yt-dlp..."
  preflag=""
  if [[ "${TA_AUTO_UPDATE_YTDLP,,}" == "nightly" ]]; then
    preflag="--pre"
  fi

  if python -m pip install \
    --no-cache-dir \
    --target="$YTDLP_UPDATE_DIR" \
    --upgrade \
    $preflag \
    "yt-dlp[default]"
  then
    export PYTHONPATH="$YTDLP_UPDATE_DIR${PYTHONPATH:+:$PYTHONPATH}"
  else
    echo "yt-dlp update failed, using bundled version"
  fi
fi

# Wait for PostgreSQL before migrations or database-dependent startup commands.
python manage.py ta_connection
python manage.py migrate
python manage.py ta_envcheck

# ta setup
python manage.py ta_startup

# Keep web and worker in same container failure domain.
python manage.py ta_worker &
worker_pid=$!
python backend_start.py &
web_pid=$!

cleanup() {
  trap - TERM INT
  kill "$worker_pid" "$web_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
  wait "$web_pid" 2>/dev/null || true
}
trap cleanup TERM INT

if wait -n -p exited_pid "$worker_pid" "$web_pid"; then
  status=0
else
  status=$?
fi
cleanup
trap - TERM INT

# Either long-running service exiting means container is unhealthy.
if [[ "$status" -eq 0 ]]; then
  exit 1
fi
exit "$status"

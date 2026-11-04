#!/bin/sh
set -eu

# Fail startup if either media tool cannot run in the deployed image.
yt-dlp --version >/dev/null || { echo "yt-dlp is unavailable" >&2; exit 1; }
ffmpeg -version >/dev/null || { echo "ffmpeg is unavailable" >&2; exit 1; }

data_dir="${DATA_DIR:-/data}"
mkdir -p "$data_dir"
chown -R node:node "$data_dir"

exec gosu node "$@"

#!/bin/sh
set -eu

data_dir="${DATA_DIR:-/data}"
mkdir -p "$data_dir"
chown -R node:node "$data_dir"

exec gosu node "$@"

#!/usr/bin/env bash

set -o errexit
set -o pipefail
# set -o xtrace

__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)" # Directory where this script exists.
__root="$(cd "$(dirname "${__dir}")" && pwd)"         # Root directory of project.

if [ "$1" = "remote" ]; then
  mode="remote"
else
  mode="local"
fi

cd "${__root}"

go run . render --kind cfkv > cf-worker/data.jsonl

cd cf-worker

npx wrangler kv bulk put --binding=KV --${mode} ./data.jsonl

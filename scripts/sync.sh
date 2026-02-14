#!/usr/bin/env bash

set -o errexit
set -o pipefail
# set -o xtrace

__dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
__root="$(cd "$(dirname "${__dir}")" && pwd)"

if [ "$1" = "remote" ] || [ "$1" = "--remote" ]; then
  mode="remote"
else
  mode="local"
fi

function _ARKS {
  go run . ${@}
}

cd "${__root}"
_ARKS test
_ARKS diff --kind cfkv > ./cf-worker/data.jsonl

cd "${__root}/cf-worker"
if [ "$(stat -c %s data.jsonl)" -lt 14 ]; then
  echo "No changes to sync."
  exit 0
fi

npx wrangler kv bulk put --binding=KV --${mode} ./data.jsonl

if [ "$mode" = "remote" ]; then
  cd "${__root}"
  _ARKS commit
fi

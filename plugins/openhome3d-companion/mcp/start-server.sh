#!/bin/bash
set -euo pipefail

plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v node >/dev/null 2>&1; then
  exec node "${plugin_root}/mcp/server.mjs" --stdio
fi

bundled_node="${HOME}/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ -x "${bundled_node}" ]]; then
  exec "${bundled_node}" "${plugin_root}/mcp/server.mjs" --stdio
fi

for nvm_node in "${HOME}"/.nvm/versions/node/*/bin/node; do
  if [[ -x "${nvm_node}" ]]; then
    exec "${nvm_node}" "${plugin_root}/mcp/server.mjs" --stdio
  fi
done

echo "openhome3d_companion: Node.js runtime not found" >&2
exit 127

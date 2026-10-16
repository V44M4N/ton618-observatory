#!/bin/zsh
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  runtime="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  runtime="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print 'Please install Node.js 20 or newer to run this observatory.'
  read '?Press Return to close.'
  exit 1
fi
TON618_OPEN=1 "$runtime" serve.mjs

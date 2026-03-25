#!/bin/sh
set -eu

if [ ! -d node_modules ]; then
  npm install
fi

exit 0

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Installing dependencies"
npm ci

echo "==> Typechecking server"
npm run typecheck -w server

echo "==> Running server tests"
npm run test -w server

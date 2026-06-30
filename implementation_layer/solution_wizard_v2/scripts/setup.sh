#!/usr/bin/env bash
# Install solution_wizard_v2 npm deps
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
echo "UI ready. Copy .env.local.example → .env.local, then: npm run dev"

#!/usr/bin/env bash
# Pulls the shared mobile core and route files from the main Kuvos repo (one-way), then
# regenerates the derived web overrides. Usage: pnpm sync-core [path-to-main-kuvos-repo] (default: its checkout folder ../flora-loop)
# NEAR routes (src/app/(caregiver)/verify*, src/app/verify*) are ours and are never deleted.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
main="${1:-$repo/../flora-loop}"
[ -d "$main/packages/mobile-core/src" ] || { echo "Main repo not found at $main" >&2; exit 1; }

rsync -a --delete --exclude node_modules "$main/packages/mobile-core/" "$repo/packages/mobile-core/"
rsync -a --delete --exclude _layout.tsx --exclude 'verify*' --exclude 'near*' "$main/apps/mobile/src/app/" "$here/src/app/"
cp "$main/apps/mobile/src/app/(caregiver)/(tabs)/_layout.tsx" "$here/src/app/(caregiver)/(tabs)/_layout.tsx"
for group in '(auth)' '(onboarding)'; do
  cp "$main/apps/mobile/src/app/$group/_layout.tsx" "$here/src/app/$group/_layout.tsx"
done

node "$here/scripts/derive-overrides.mjs"
echo "Synced. Now run: pnpm install && pnpm --filter @kuvos-near/web typecheck && pnpm --filter @kuvos-near/web build"

# Shared mobile app

`apps/mobile` (standard iOS/Android) and `apps/solana-mobile` (Solana Android) reuse this package. Change common screens, route bodies, components, care API types, notifications, review logic, fonts and theme here. The workspace uses hoisted installs so both apps resolve one physical copy of their native modules. Each app's `src/app` contains Expo Router entry wrappers, and each shell owns its native dependencies, icons, splash, bundle ID, deep-link scheme, session-storage prefix and EAS project.

Internal imports are relative. Better Auth 1.7.3 client plugins use its installed per-plugin files because its public barrel also bundles an unused Ethereum sign-in helper; switch to public per-plugin exports when Better Auth provides them. Public imports use `@kuvos/mobile-core/<module>`. Both Tailwind configurations consume this package's token configuration and scan its source files.

The core never imports an app shell, wallet SDK or Solana API. `app-extensions.tsx` exposes only the UI slots and activity callback currently needed by the Android shell. The standard app uses the normal care log endpoint. The Android callback saves through the receipt endpoint, then optionally signs after the care UI reports success; signing failures remain independently retryable.

The ordinary `/api/patients/:id/rhythm` endpoint works without Solana configuration. The legacy Solana rhythm endpoint delegates to the same care implementation for installed Android apps.

## Local checks

From the repository root:

```sh
pnpm --filter @kuvos/mobile-core typecheck
pnpm --filter @kuvos/mobile-core lint
pnpm --filter @kuvos/mobile-core check:review
pnpm --filter @kuvos/mobile-core check:notifications
pnpm --filter @kuvos/mobile-core check:scans
pnpm --filter @kuvos/mobile-core check:activity
pnpm --filter @kuvos/mobile-core check:loading
pnpm check:mobile-boundary
pnpm --filter @kuvos-near/web typecheck
pnpm --filter @kuvos/solana-mobile typecheck
pnpm --filter @kuvos-near/api check:rhythm
```

`check:mobile-boundary` checks standard/core source and dependency declarations. Pass an Expo export source map to also check its bundled module graph:

```sh
pnpm check:mobile-boundary /path/to/ios-export.map
```

## Releases

This migration adds native SVG rendering to the standard app and changes its embedded font configuration. It requires a new native build, not an OTA-only rollout. Both projects retain their `appVersion` runtime policy: increment the app version before releasing this native change or publishing updates for it. Keep each app's existing EAS project and update channels separate.

## Removing the Solana distribution

Delete `apps/solana-mobile`, its workspace entry and root development script, then run `pnpm install` to prune its dependencies. The standard app and core require no replacement implementations. Retire the Solana distribution/update channels separately; remove backend receipt and reward features only after installed clients, stored records and outstanding rewards are handled.

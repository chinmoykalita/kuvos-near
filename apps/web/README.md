# Kuvos web (NEAR edition)

The Kuvos app in the browser: the same React Native screens as the mobile app (`packages/mobile-core`),
rendered with React Native for Web, plus the NEAR features in `web/near/`:

- `extensions.tsx`: plugs NEAR into the shared app through `AppExtensions` (Proofs card, optional
  NEP-413 signing after Done/Skip/Undo).
- `wallet.ts`: NEAR Connect; only NEP-413 messages are ever requested, never transactions.
- `proofs-screen.tsx`, `proof-screen.tsx`: commitments, TEE signatures, anchors and in-app verification.
- `verify-screen.tsx`: public `/verify` page for downloaded proofs.

Web-only replacements for native modules live in `web/shims` and are swapped in by `metro.config.js`.
Run with `pnpm dev:web` from the repository root (http://localhost:8090). See the root README.

Browser onboarding regression tests use synthetic data and mocked API responses (no live
invitations or accounts). Install Chromium once with `pnpm --filter @kuvos-near/web exec playwright install chromium`,
then run `pnpm --filter @kuvos-near/web test:browser`. The runner starts its own web server on port 8097.
The tests cover automatic focus, keyboard navigation, numeric validation, exact routine times,
and invitation submission. Run `pnpm --filter @kuvos-near/web derive` after syncing the mobile core
to regenerate the browser form overrides.

# Physiotherapy library

The standalone library is available under More → Explore physiotherapy in both app shells. Standalone browsing uses no plan APIs. Review can attach demonstrations or add reviewer-authored library exercises using the existing extraction review/confirmation APIs. Catalogue and animation assets are bundled for offline use.

`library.json` preserves the supplied export's 79 exercises, 18 categories, stable IDs, instructions, notices, default doses, variations and animation keyframes. `renderer.json` preserves the original SVG rig and colours; the prototype's plan matching and default-dose parser are deliberately excluded. A small isolated WebView runs only the animation. Browsing, instructions and playback controls are native.

The source explicitly labels doses and precautions as prototype material requiring physiotherapist review. The notice remains in the source catalogue; patient screens omit import, reference and review disclaimers. Default dosage and easier/harder progression fields are retained in the data but are not offered as a patient prescription. Animation timings demonstrate the movement; they do not prescribe a hold or repetition count. The animation stays fixed above the scrolling instructions and loops automatically at normal or slow speed. It pauses when leaving the screen or backgrounding the app and resumes on return. Reduced-motion users see a still frame.

## Adding exercises

From the repo root, import a new trusted export using the same `kuvos.physio.library/1` format:

```sh
node packages/mobile-core/tools/import-physio.mjs '/path/to/export.html'
pnpm --filter @kuvos/mobile-core check:physio
pnpm --filter @kuvos/mobile-core typecheck
pnpm --filter @kuvos/mobile-core lint
```

The import replaces the catalogue. Include existing exercises in the new export and preserve their IDs. Review the JSON diff for unexpected removals and renderer changes. The importer validates IDs, categories, keyframe timing/coordinates and embedded SVG before writing. This is a development-time import of trusted source code, never a patient upload feature.

For a single new exercise in the same rig format, add its full record to `library.json`, reuse or add category metadata, and run the checks. Do not change the renderer unless the new format needs it. Category results are calculated from exercises, not the export's cached counts.

Before external patient use, have a qualified physiotherapist review the instructions and animations. Verify playback, app background/resume, large text, VoiceOver/TalkBack and motion on physical iOS and Android devices. Adding WebView to the standard app requires a native rebuild before an OTA update can use it; the Solana shell already includes WebView.

Older installed binaries without `RNCWebViewModule` show an app-update message and retain written instructions. Do not eagerly import WebView: its native module lookup throws during module evaluation. The standard app uses the `appVersion` runtime policy; increment the app version for the next WebView-containing native build, then target that runtime for subsequent animation updates. A compatibility fallback OTA does not install WebView.

## Review integration deployment

Deploy the API migration `20261015000100_plan_item_physio` and API changes before the mobile update. `PlanItem.physio` records the library ID/version, origin, reviewer and instruction snapshot. Added items use `library:<exercise-id>` candidate IDs and empty document evidence; original candidate membership remains locked. Dosage, daily reminders and duration are explicitly entered. Catalogue defaults are never used. All existing patient/Care Circle membership checks apply. No new account role is required.

The importer also writes the compact API catalogue in `apps/api/src/physio-catalogue.ts`. Run `pnpm --filter @kuvos-near/api check:physio` to verify catalogue parity and the review/confirmation path. Publish matching catalogue versions to the API and app. Existing active items retain their stored instruction snapshots.

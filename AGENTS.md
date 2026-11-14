# Kuvos on NEAR: agent guide

Kuvos turns care instructions a healthcare professional already wrote into a source-backed,
human-confirmed routine. It never diagnoses, triages, gives medical advice or creates treatment plans.
This repository is the public NEAR edition. Use **Kuvos** as the product name everywhere. The canonical
domain is **kuvosai.com** (product links `https://kuvosai.com`, email `@kuvosai.com`); the web app is
served from **https://app.kuvosai.com**. Synthetic accounts use `@synthetic.kuvosai.com`, which never
receives mail.

## Trust rules (non-negotiable)

1. Every document-derived plan item links to source evidence (document, page, exact text, coordinates).
2. Nothing becomes an active plan item until a person reviews and confirms it. LLM agreement is not proof.
3. Never invent doses, clock times, durations, meal offsets, start dates or clinical meaning.
4. Deliberate skips and silent misses are different states. Misses get no commitment.
5. Model calls go only to NEAR AI Cloud Confidential TEE models and must verify a `provider_tee`
   signature; never fall back silently to a non-TEE model.
6. Nothing identifying or clinical goes on-chain: only salted SHA-256 commitments inside Merkle roots,
   and the hash of the public Tomo gate rules.
7. Care never waits for a wallet or the chain. Signing is optional; anchoring is asynchronous.
8. Any change to `GATE_RULES` requires a new version number (the published hash is immutable).
9. Synthetic data only. Never commit `.env`, keys, real documents, runs or model responses.

## Layout

- `apps/api` (NestJS): API and source of truth. `src/near/` holds commitments (`near.service.ts`),
  the Merkle publisher, NEAR AI client, Tomo gate, verifier and `near.check.ts`.
- `apps/worker` (Python): extraction; `near_ai_adapter.py` is the attested NEAR AI path.
- `apps/web` (Expo web): `web/near/` holds NEAR Connect signing and the Proofs/Verify screens. Add
  NEAR features through `AppExtensions`; keep `packages/mobile-core` a verbatim copy of the main app.
- `contracts/kuvos-anchor` (Rust): `anchor` and `publish_policy`, callable only by the contract account.

## Definition of done

`pnpm --filter @kuvos-near/api check:near`, the other API checks, `cargo test` in the contract,
API and web lint/typecheck, and the README's "Do X, see Y" steps still hold.

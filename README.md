# Kuvos on NEAR: provable, private care plans

**Kuvos** turns the discharge instructions a patient already received into a daily routine that a person
reviews and confirms. This repository is the NEAR edition: a private AI reads the document inside TEEs on
**NEAR AI Cloud**, a human confirms every line against its source, and every confirmed plan, check-in and
assistant decision becomes a salted commitment anchored on **NEAR**. No health data ever goes on-chain.

> Synthetic data only. Kuvos does not diagnose, triage, give medical advice or create treatment plans. It
> only organises instructions a clinician already wrote. Never upload a real patient document to this demo.

## The problem

After a hospital stay, families get a dense PDF of medicines, exercises, restrictions and appointments.
AI can structure it, but in healthcare two questions block adoption:

1. **Who saw the document?** Discharge summaries are special-category health data.
2. **Who decided what the routine is?** An AI draft must never silently become someone's care plan.

## What Kuvos on NEAR does

| Step | What happens | NEAR piece |
| --- | --- | --- |
| 1. Private draft | The worker sends the document to NEAR AI Cloud **Confidential TEE** models: `Qwen/Qwen3-VL-30B-A3B-Instruct` reads photos and scans, `Qwen/Qwen3.6-35B-A3B-FP8` drafts the items. (A second extractor and a model evaluator can be switched on for cross-checking; they are off by default for speed, since a person reviews every item.) The official SDK verifies the Gateway and model Intel TDX + NVIDIA attestation before sending, end-to-end encrypts the prompt to the attested model key, and verifies the model's `provider_tee` signature over the exact request and response bytes. A reply without a model-TEE signature fails the job. | NEAR AI Cloud, TEE attestation |
| 2. Human gate | Every candidate is shown beside its highlighted source span. Nothing becomes a task until a person accepts it. | Existing Kuvos review flow |
| 3. Plan = policy | Confirming creates **plan version N**: a salted, canonical commitment to every confirmed item, its evidence span IDs, the immutable extraction result and the NEAR AI TEE signatures behind the draft. | Commitment, later anchored |
| 4. Person signs | Optionally, the confirming person signs that exact digest with their NEAR wallet (NEP-413 message, no transaction, no fee) through **NEAR Connect**. | NEP-413, NEAR Connect |
| 5. Daily check-ins | Done / Skip (with reason) / Undo each get their own commitment, linked to the previous one and to the plan version in force. Silent misses get none: a miss is not a statement. | Commitment, optional NEP-413 |
| 6. Tomo gate | Every chat message passes a published rule set first: emergency and advice requests get fixed text, treatment-change and symptom questions are escalated to the care team, and only ALLOW reaches a NEAR AI TEE model. Each decision is committed with the rules hash, the hash of the active plan versions and salted hashes of the words. | `publish_policy` on NEAR, NEAR AI Cloud |
| 7. Anchoring | Every ~30 s the API batches commitments into a Merkle root and calls `anchor(batch_id, root, count)` on the `kuvos-anchor` contract, signing with a **function-call access key** that can call only `anchor` and `publish_policy` and cannot move funds. | Rust contract, function-call keys |
| 8. Verify | Anyone with a downloaded proof can re-run every check (digest, NEP-413 signature, Merkle inclusion, root on NEAR, TEE signatures, rules hash) in the app at `/verify` or offline with `pnpm verify proof.json`. | Public RPC only |

### What a proof shows, and what it does not

- ✅ This exact plan version, check-in or decision existed in this form no later than the anchoring block.
- ✅ A specific NEAR account endorsed it (when signed), with a full-access key of that account.
- ✅ The AI draft or reply came from a NEAR AI model whose signing key is bound to an attested TEE.
- ✅ Tomo decided under rules version N, whose hash is on NEAR, and only ALLOW turns reached a model.
- ❌ It does **not** prove a medicine was taken or an exercise done: it proves a person's statement.
- ❌ It does **not** prove the AI was right. The document is the authority, and a person must confirm.
- ❌ Instances of one NEAR AI model share a signing key, so a signature does not identify one machine.
- ❌ The Kuvos API itself (outside NEAR AI) still processes plaintext; it is not a TEE in this version.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    W[Kuvos web app<br/>Expo + React Native Web] -- NEP-413 via NEAR Connect --> Wallet[(NEAR wallet)]
  end
  W -- HTTPS --> API[NestJS API<br/>apps/api]
  W -- signed PUT --> S3[(Private object storage)]
  API --> DB[(PostgreSQL)]
  Worker[Python worker<br/>apps/worker] --> DB
  Worker --> S3
  Worker -- attested, E2EE --> NAI[NEAR AI Cloud<br/>TEE models]
  API -- Tomo ALLOW only --> NAI
  API -- function-call key: anchor / publish_policy --> C[kuvos-anchor contract<br/>NEAR testnet]
  V[Anyone: /verify or pnpm verify] -- public RPC --> C
```

Only 32-byte hashes reach the chain. Commitments carry 32 random bytes of salt, so a guessable value
(a medicine and a time) cannot be confirmed by hashing candidates against a public root.

## NEAR technology used

- **NEAR AI Cloud** private inference (`@nearai/inference-sdk`, `nearai-inference-sdk`): Gateway and model
  TDX attestation, E2EE, and per-reply `provider_tee` signature verification; Whisper dictation on the same
  TEE fleet.
- **Smart contract** (`contracts/kuvos-anchor`, Rust, `near-sdk` 5.30): idempotent Merkle-root anchoring and
  immutable, versioned policy hashes, emitting NEP-297 events.
- **Function-call access keys**: the API's publisher key is limited to two methods on one contract.
- **Continue with NEAR**: a NEAR account is a sign-in method (a Better Auth plugin, `near-login.ts`). The
  wallet signs a one-use NEP-413 sign-in message; the API checks the signature and that the key is a
  full-access key of the account over RPC. The same NEAR account opens the same Kuvos account on any device.
  Identity never depends on a wallet: phone, email link, Google and Apple sign-in remain available.
- **NEP-413 message signing** through **NEAR Connect** (`@hot-labs/near-connect`), with keys checked as
  full-access keys over RPC. On testnet the selector offers wallets that support testnet and message signing
  (Meteor, Intear, Nightly, Ledger, NEAR CLI); mainnet-only wallets such as NEAR Mobile appear on mainnet.
- **near-api-js 7** for the publisher and NEP-413 interoperability tests; public RPC for verification.

## Try it (local, about 15 minutes)

Prerequisites: macOS or Linux, Node **24.22+**, pnpm 10, Python 3.12, Homebrew `postgresql@17` and
`minio`, Rust with `cargo-near` and `near-cli-rs` (only to deploy your own contract), and a NEAR AI Cloud
API key (from [cloud.near.ai](https://cloud.near.ai), or $10 of credits via
[NEAR Builders](https://nearbuilders.org/join)).

```bash
git clone <this repo> kuvos-near && cd kuvos-near
pnpm install
python3.12 -m venv apps/worker/.venv && apps/worker/.venv/bin/pip install -e apps/worker
cp .env.example .env               # set BETTER_AUTH_SECRET (openssl rand -hex 32) and NEARAI_API_KEY
cp apps/web/.env.example apps/web/.env
scripts/dev-up.sh                  # Postgres :5433 + MinIO :9000, bucket and schema
scripts/near-testnet-setup.sh <your-name>-kuvos.testnet   # optional: your own contract + publisher key

pnpm dev:api        # http://localhost:3001
pnpm dev:worker     # extraction worker
pnpm dev:web        # http://localhost:8090
```

Production: the web app is served from **https://app.kuvosai.com** (`WEB_ORIGIN`), with the API on the
same site so Better Auth's session cookie works. Local development uses `localhost:8090` and `:3001`.

Without `NEAR_CONTRACT_ID`/`NEAR_PUBLISHER_KEY` everything works except anchoring: commitments stay
"Committed" until a contract is configured.

### Do X, see Y

| # | Do | See |
| --- | --- | --- |
| 1 | Open http://localhost:8090 and tap **Continue with NEAR** (a free testnet account from [Meteor](https://wallet.meteorwallet.app) works), or **Try the synthetic demo** to skip the wallet. Finish the short setup (any name). | Today screen for a synthetic patient. With NEAR, the account is already linked as your signer. |
| 2 | **Plan → Add document**, upload `samples/synthetic-discharge.pdf`, accept the AI processing notice. | "Reading your document" for about 30 seconds (about a minute for a photo, which is read by the vision model first). The worker log shows `NEAR AI request verified … signature=provider_tee` for each model call. |
| 3 | Open the review. Tap an item. | The instruction beside its highlighted source text. Edit, accept or reject each item; fill reminder times. |
| 4 | Confirm the plan. Open **Proofs** (sidebar) or **More → Proofs on NEAR**. | "Confirmed plan · version 1" in state *Committed*, then *On NEAR* within ~30 s. |
| 5 | Open it. | Every confirmed item with its evidence IDs, the NEAR AI TEE signatures behind the draft, the Merkle root and a testnet transaction link. |
| 6 | With the demo login, tap **Link NEAR account** on the Proofs screen and approve the message in your testnet wallet. Then open the plan proof and tap **Sign as …**. | State shows *Signed*; the human signature card shows your account. |
| 7 | On **Today**, mark a task **Done** (or **Skip** with a reason). | Your wallet asks you to sign the check-in. A new *Care activity* proof appears. |
| 8 | Open **Tomo** and send `Can I double my dose?` then `What is next today?`. | First: fixed escalation text, no model call, a *Tomo ESCALATE* proof. Second: a normal answer from a NEAR AI TEE model, a *Tomo ALLOW* proof that includes its TEE signature. |
| 9 | On any proof tap **Verify now**, then **Download proof**. | All checks PASS (digest, NEP-413, Merkle inclusion, root on NEAR, TEE signatures, rules hash). |
| 10 | Open http://localhost:8090/verify (no login), paste the file, or run `pnpm verify ~/Downloads/kuvos-proof-*.json`. Then change one character in `payload` and verify again. | PASS for the original; `FAIL Commitment digest` for the edited copy. |

## Run with Docker

The whole stack (Postgres, MinIO, API, worker, and the web app behind Caddy) also runs with Docker
Compose. Caddy serves everything from one origin: the web app at `/`, the API at `/api` and signed
document uploads at `/<DOCUMENTS_BUCKET>/` (proxied to MinIO). `scripts/dev-up.sh` still works for the
non-Docker setup above; the two use separate data.

**Local**

```bash
cp .env.example .env     # set BETTER_AUTH_SECRET (openssl rand -hex 32) and NEARAI_API_KEY
docker compose up --build
```

Open http://localhost:8090 (change `HTTP_PORT` if `pnpm dev:web` is using it). The "Do X, see Y" steps
above apply unchanged. Logs: `docker compose logs -f api worker`. Stop: `docker compose down` (add `-v`
to delete the database, documents and runs).

**Server (Ubuntu, behind the host's nginx)**

The stack's Caddy listens on `127.0.0.1:${HTTP_PORT}` only; the host's nginx terminates HTTPS for the
site and proxies to it. Example below: `app.kuvosai.com` on port 8090.

1. Docker with Compose v2 installed, and a DNS record for the site pointing at the server.
   Building the web app needs about 4 GB of memory, so add swap on small servers.
2. Create `~/kuvos-near/.env` on the server from `.env.example`, with these changes:

   ```bash
   NODE_ENV=production
   PUBLIC_URL=https://app.kuvosai.com
   HTTP_PORT=8090                   # any free loopback port
   BETTER_AUTH_SECRET=...           # openssl rand -hex 32
   POSTGRES_PASSWORD=...            # strong random value, fixed when the database is first created
   AWS_SECRET_ACCESS_KEY=...        # strong random value (the MinIO root password)
   NEARAI_API_KEY=...
   NEAR_CONTRACT_ID=...             # optional: anchoring
   NEAR_PUBLISHER_KEY=...
   ```

3. Add an nginx site (`/etc/nginx/sites-available/app.kuvosai.com`, linked into `sites-enabled`),
   then `sudo certbot --nginx -d app.kuvosai.com`. Keep `Host $host`: upload URLs are signed for it.

   ```nginx
   server {
       listen 80;
       listen [::]:80;
       server_name app.kuvosai.com;
       client_max_body_size 50M;
       location / {
           proxy_pass http://127.0.0.1:8090;
           proxy_http_version 1.1;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_read_timeout 300s;
       }
   }
   ```

4. From your machine: `scripts/deploy.sh ubuntu@<server-ip>`. It copies the checkout to `~/kuvos-near`
   (never `.env`, keys or `data/`) and runs `docker compose up -d --build`. Run it again to deploy
   changes. Postgres and MinIO are never published outside Docker.

On a server without a host proxy, Caddy can serve HTTPS itself: set `SITE_ADDRESS` to the domain,
`HTTP_BIND=0.0.0.0`, `HTTP_PORT=80` and `COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml`.

With `NODE_ENV=production` only the synthetic demo phone can sign in by OTP; Continue with NEAR works
as usual.

## Checks

```bash
pnpm --filter @kuvos-near/api check:near    # end-to-end NEAR trust flow against Postgres
pnpm --filter @kuvos-near/api check:near-login  # Continue with NEAR: session, single-use challenge, key checks
pnpm --filter @kuvos-near/api check:near-ai # live NEAR AI Cloud: chat, structured output, tools (synthetic text, needs NEARAI_API_KEY)
cd contracts/kuvos-anchor && cargo test     # contract unit tests
apps/worker/.venv/bin/python -m kuvos_worker.near_ai_check   # extraction rules (offline)
pnpm --filter @kuvos-near/api lint && pnpm --filter @kuvos-near/web lint
```

`check:near` covers canonical commitments, Merkle proofs, NEP-413 signatures produced by `near-api-js` and
verified by Kuvos, `provider_tee` signature checks (and rejection of Gateway-only signatures), every Tomo
gate route, plan version chaining, linked check-ins, salted gate decisions, one-use wallet challenges,
actor-only signing, access control, batching and tamper detection. The existing Kuvos checks (care,
workflow, uploads, rhythm, physio review, chat, transcription, notifications) also run under `apps/api`.

## Repository

```text
apps/api/       NestJS API: auth, upload, review/confirm, Today, Tomo; src/near = commitments, publisher, verifier
apps/worker/    Python extraction pipeline; near_ai_adapter.py = attested NEAR AI Cloud calls
apps/web/       Expo web app; web/near = NEAR Connect signing, Proofs and /verify screens
packages/mobile-core/  Shared Kuvos screens and care flows (unchanged from the main product)
contracts/kuvos-anchor/  Rust NEAR contract
samples/        Synthetic discharge PDF (fictional patient, clinic and medicines)
scripts/        Local services, testnet setup, sample generator
```

## Disclosure (NEAR HACKATHON rules Q-001, Q-002, Q-005)

Kuvos is a pre-existing product (a private mobile app). This public repository is a NEAR edition built for
NEAR HACKATHON from a snapshot of that codebase. **Baseline (pre-existing):** the care workflow (upload,
extraction pipeline, review, plans, Today, Tomo chat, Care Circles) and the shared mobile UI. **Built in
the hackathon window:** everything NEAR: the NEAR AI Cloud adapters and attestation records, the Tomo gate
and its published rules, plan-version / activity / gate commitments, the Merkle publisher, the
`kuvos-anchor` contract, NEP-413 wallet linking and signing, the Proofs and Verify screens, the offline
verifier, `check:near` and `check:near-login`, Continue with NEAR sign-in, plus local MinIO support and the synthetic demo sign-in. An earlier Solana
receipt experiment from the private codebase is not included. Libraries are listed in each
`package.json`, `pyproject.toml` and `Cargo.toml`.

## License

Apache-2.0. See [LICENSE](LICENSE).

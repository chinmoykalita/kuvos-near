#!/usr/bin/env bash
# Creates a faucet-funded NEAR testnet account, deploys the kuvos-anchor contract to it and
# adds the API publisher's function-call key (methods: anchor, publish_policy; no deposits).
# Usage: scripts/near-testnet-setup.sh <new-account>.testnet
# Requires near-cli-rs and cargo-near. Testnet only: these tokens have no value.
set -euo pipefail
account="${1:?Usage: scripts/near-testnet-setup.sh <new-account>.testnet}"
[[ "$account" == *.testnet ]] || { echo "Use a .testnet account name." >&2; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.cargo/bin:$PATH"

echo "1/5 Creating $account with the testnet faucet (full-access key saved to ~/.near-credentials)"
near account create-account sponsor-by-faucet-service "$account" autogenerate-new-keypair \
  save-to-legacy-keychain network-config testnet create

echo "2/5 Building the contract"
(cd "$root/contracts/kuvos-anchor" && cargo near build non-reproducible-wasm)

echo "3/5 Deploying and initialising"
near contract deploy "$account" use-file "$root/contracts/kuvos-anchor/target/near/kuvos_anchor.wasm" \
  with-init-call new json-args '{}' prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

echo "4/5 Generating the publisher key (private key written to .env only)"
public_key="$(cd "$root/apps/api" && npx ts-node src/near/publisher-key.ts)"

echo "5/5 Adding $public_key as a function-call key limited to anchor and publish_policy"
near account add-key "$account" grant-function-call-access --allowance '1 NEAR' \
  --contract-account-id "$account" --function-names 'anchor, publish_policy' \
  use-manually-provided-public-key "$public_key" network-config testnet sign-with-legacy-keychain send

if grep -q '^NEAR_CONTRACT_ID=' "$root/.env"; then
  sed -i.bak "s/^NEAR_CONTRACT_ID=.*/NEAR_CONTRACT_ID=$account/" "$root/.env" && rm -f "$root/.env.bak"
else
  echo "NEAR_CONTRACT_ID=$account" >> "$root/.env"
fi
echo "Done. Restart the API; it publishes Tomo gate rules v1 and anchors batches to $account."
echo "Contract: https://testnet.nearblocks.io/address/$account"

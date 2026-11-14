// Generates the publisher's function-call key pair and stores the private key in the root .env
// (gitignored). Prints only the public key, which scripts/near-testnet-setup.sh adds to the
// contract account restricted to `anchor` and `publish_policy`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { KeyPair } from 'near-api-js';

const envPath = resolve(__dirname, '../../../../.env');
const env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
const existing = /^NEAR_PUBLISHER_KEY=(ed25519:\S+)$/m.exec(env)?.[1];
const keyPair = existing
  ? KeyPair.fromString(existing as `ed25519:${string}`)
  : KeyPair.fromRandom('ed25519');
if (!existing) {
  const line = `NEAR_PUBLISHER_KEY=${keyPair.toString()}`;
  writeFileSync(
    envPath,
    /^NEAR_PUBLISHER_KEY=.*$/m.test(env)
      ? env.replace(/^NEAR_PUBLISHER_KEY=.*$/m, line)
      : `${env.trimEnd()}\n${line}\n`,
    { mode: 0o600 },
  );
}
console.log(keyPair.getPublicKey().toString());

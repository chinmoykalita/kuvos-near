// Offline/online verifier for an exported Kuvos proof bundle. Usage:
//   pnpm verify path/to/bundle.json [--rpc https://test.rpc.fastnear.com]
// Exit code 0 only when no check failed.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBundle } from './verify-core';

async function main() {
  const [file, flag, rpc] = process.argv.slice(2);
  if (!file)
    throw new Error('Usage: verify-bundle <bundle.json> [--rpc <url>]');
  const bundle: unknown = JSON.parse(
    // pnpm runs this from apps/api; resolve paths from where the command was typed.
    readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), file), 'utf8'),
  );
  const checks = await verifyBundle(bundle, {
    rpcUrl:
      flag === '--rpc'
        ? rpc
        : process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com',
  });
  for (const check of checks)
    console.log(
      `${check.ok === true ? 'PASS' : check.ok === false ? 'FAIL' : 'SKIP'}  ${check.name}: ${check.detail}`,
    );
  process.exitCode = checks.some((check) => check.ok === false) ? 1 : 0;
}

void main();

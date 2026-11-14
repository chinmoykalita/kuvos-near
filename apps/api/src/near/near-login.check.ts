// "Continue with NEAR" against the local database and a fake NEAR RPC (synthetic, cleaned up).
// Run: pnpm --filter @kuvos-near/api check:near-login
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigService } from '@nestjs/config';
import { Account, JsonRpcProvider, KeyPair } from 'near-api-js';
import { signMessage } from 'near-api-js/nep413';
import { config as loadEnv } from 'dotenv';
import { createAuth } from '../auth';
import { PrismaService } from '../database/prisma.service';

loadEnv({ path: '../../.env' });

const accountId = 'kuvos-login-check.testnet';
const origin = process.env.WEB_ORIGIN || 'http://localhost:8090';
const fullKey = KeyPair.fromRandom('ed25519');
const limitedKey = KeyPair.fromRandom('ed25519');

async function main() {
  // Fake RPC: only `fullKey` is a full-access key of the account.
  const rpc = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    request.on('end', () => {
      const params = (
        JSON.parse(raw) as {
          params: { account_id: string; public_key: string };
        }
      ).params;
      const full =
        params.account_id === accountId &&
        params.public_key === fullKey.getPublicKey().toString();
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'kuvos',
          result: {
            permission: full
              ? 'FullAccess'
              : { FunctionCall: { receiver_id: 'x', method_names: [] } },
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => rpc.listen(0, '127.0.0.1', resolve));
  const rpcUrl = `http://127.0.0.1:${(rpc.address() as AddressInfo).port}`;

  const config = new ConfigService({
    ...process.env,
    NEAR_NETWORK: 'testnet',
    NEAR_RPC_URL: rpcUrl,
  });
  const prisma = new PrismaService(config);
  const auth = createAuth(prisma, config);
  const base = `${(process.env.BETTER_AUTH_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/api/auth`;
  const call = (path: string, body?: unknown, cookie?: string) =>
    auth.handler(
      new Request(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          'content-type': 'application/json',
          ...(cookie ? { cookie } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );

  const cleanup = async () => {
    const logins = await prisma.account.findMany({
      where: { providerId: 'near', accountId },
      select: { userId: true },
    });
    await prisma.user.deleteMany({
      where: { id: { in: logins.map((login) => login.userId) } },
    });
  };

  async function signIn(key: KeyPair) {
    const challenge = (await (await call('/near/challenge', {})).json()) as {
      message: string;
      nonce: string;
      recipient: string;
    };
    assert.match(challenge.message, /^Sign in to Kuvos\n/);
    const signed = await signMessage({
      signerAccount: new Account(
        accountId,
        new JsonRpcProvider({ url: rpcUrl }),
        key.toString(),
      ),
      payload: {
        message: challenge.message,
        recipient: challenge.recipient,
        nonce: Buffer.from(challenge.nonce, 'hex'),
      },
    });
    const body = {
      nonce: challenge.nonce,
      accountId,
      publicKey: signed.publicKey.toString(),
      signature: Buffer.from(signed.signature).toString('base64'),
    };
    return { body, response: await call('/near/verify', body) };
  }

  try {
    await cleanup();

    // First sign-in creates the account, links the signer and starts a session.
    const first = await signIn(fullKey);
    assert.equal(first.response.status, 200);
    const cookie = first.response.headers.get('set-cookie')?.split(';')[0];
    assert(cookie, 'session cookie is set');
    const session = (await (
      await call('/get-session', undefined, cookie)
    ).json()) as { user: { id: string; name: string } };
    assert.equal(session.user.name, accountId);
    const wallet = await prisma.nearWallet.findUnique({
      where: { userId: session.user.id },
    });
    assert.equal(wallet?.accountId, accountId);

    // The challenge is single use.
    assert.equal((await call('/near/verify', first.body)).status, 401);

    // Signing in again (another device) opens the same account.
    const second = await signIn(fullKey);
    assert.equal(second.response.status, 200);
    const again = (await second.response.json()) as { user: { id: string } };
    assert.equal(again.user.id, session.user.id);

    // A key that is not a full-access key of the account is refused.
    assert.equal((await signIn(limitedKey)).response.status, 401);

    // A signature over a different message is refused.
    const forged = await signIn(fullKey);
    const tampered = (await (await call('/near/challenge', {})).json()) as {
      nonce: string;
    };
    assert.equal(
      (
        await call('/near/verify', {
          ...forged.body,
          nonce: tampered.nonce,
        })
      ).status,
      401,
    );

    console.log(
      'NEAR login checks passed: challenge, NEP-413 verification, full-access key, session, single-use nonce, same account across sign-ins, wrong key and wrong message refused.',
    );
  } finally {
    await cleanup();
    await prisma.$disconnect();
    rpc.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

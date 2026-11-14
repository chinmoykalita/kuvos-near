import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaService } from '../database/prisma.service';
import {
  fullAccessKeyOf,
  SIGN_RECIPIENT,
  validAccountId,
  verifyNep413,
} from './near-protocol';

// "Continue with NEAR": a NEAR account is one more way to sign in, beside phone, email,
// Google and Apple. The wallet signs a one-use NEP-413 message (no transaction, no fee); the
// API checks the signature and, over RPC, that the key is a full-access key of the account.
// The login identity is a Better Auth account row (provider "near"), so the same NEAR account
// opens the same Kuvos account on any device. It is also linked as the person's signer.

const CHALLENGE_SECONDS = 300;
const identifier = (nonce: string) => `near-login:${nonce}`;
const hex64 = /^[0-9a-f]{64}$/;

export function loginMessage(network: string, nonce: string, expires: string) {
  return `Sign in to Kuvos\nNetwork: ${network}\nNonce: ${nonce}\nExpires: ${expires}\nThis signs you in. It is not a transaction and costs nothing.`;
}

function nearEmail(accountId: string) {
  const id = createHash('sha256').update(accountId).digest('hex').slice(0, 32);
  return `near-${id}@synthetic.kuvosai.com`;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export function nearLogin(options: {
  prisma: PrismaService;
  network: () => string;
  rpcUrl: () => string;
}) {
  return {
    id: 'near-login',
    endpoints: {
      nearLoginChallenge: createAuthEndpoint(
        '/near/challenge',
        { method: 'POST' },
        async (ctx) => {
          const nonce = randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + CHALLENGE_SECONDS * 1_000);
          const message = loginMessage(
            options.network(),
            nonce,
            expiresAt.toISOString(),
          );
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: identifier(nonce),
            value: message,
            expiresAt,
          });
          return ctx.json({
            message,
            nonce,
            recipient: SIGN_RECIPIENT,
            network: options.network(),
          });
        },
      ),
      nearLoginVerify: createAuthEndpoint(
        '/near/verify',
        { method: 'POST' },
        async (ctx) => {
          const body = (ctx.body ?? {}) as Record<string, unknown>;
          const nonce = text(body.nonce);
          const accountId = text(body.accountId);
          const publicKey = text(body.publicKey);
          const signature = text(body.signature);
          if (!hex64.test(nonce) || !validAccountId(accountId))
            throw new APIError('BAD_REQUEST', {
              message: 'NEAR sign-in request is invalid.',
            });
          // One use only: the row is deleted even when it has expired.
          const challenge =
            await ctx.context.internalAdapter.consumeVerificationValue(
              identifier(nonce),
            );
          if (
            !challenge ||
            !verifyNep413({
              message: challenge.value,
              nonce,
              recipient: SIGN_RECIPIENT,
              publicKey,
              signature,
            })
          )
            throw new APIError('UNAUTHORIZED', {
              message:
                'NEAR signature is invalid or expired. Please try again.',
            });
          let fullAccess = false;
          try {
            fullAccess = await fullAccessKeyOf(
              options.rpcUrl(),
              accountId,
              publicKey,
            );
          } catch {
            throw new APIError('SERVICE_UNAVAILABLE', {
              message: 'NEAR RPC is unavailable. Please retry.',
            });
          }
          if (!fullAccess)
            throw new APIError('UNAUTHORIZED', {
              message:
                'That key is not a full-access key of this NEAR account.',
            });

          const adapter = ctx.context.internalAdapter;
          const login = await ctx.context.adapter.findOne<{ userId: string }>({
            model: 'account',
            where: [
              { field: 'providerId', value: 'near' },
              { field: 'accountId', value: accountId },
            ],
          });
          let userId = login?.userId;
          if (!userId) {
            // An account that linked this NEAR account as its signer keeps its data.
            const signers = await options.prisma.nearWallet.findMany({
              where: { accountId },
              select: { userId: true },
              take: 2,
            });
            userId =
              signers.length === 1
                ? signers[0].userId
                : (
                    await adapter.createUser(
                      {
                        name: accountId,
                        email: nearEmail(accountId),
                        emailVerified: false,
                      },
                      { method: 'near' },
                    )
                  )?.id;
            if (!userId)
              throw new APIError('INTERNAL_SERVER_ERROR', {
                message: 'Could not create the account.',
              });
            await adapter.linkAccount({
              userId,
              providerId: 'near',
              accountId,
            });
          }
          const user = await adapter.findUserById(userId);
          if (!user)
            throw new APIError('UNAUTHORIZED', {
              message: 'This account no longer exists.',
            });
          // The login account becomes the signer unless another one is already linked.
          await options.prisma.nearWallet.upsert({
            where: { userId },
            create: { userId, accountId, publicKey, connectedAt: new Date() },
            update: {},
          });
          await options.prisma.nearWallet.updateMany({
            where: { userId, accountId: null },
            data: { accountId, publicKey, connectedAt: new Date() },
          });
          const session = await adapter.createSession(user.id);
          if (!session)
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Could not start a session.',
            });
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            status: true,
            user: { id: user.id, name: user.name },
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { expo } from '@better-auth/expo';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { createHash } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { magicLink, phoneNumber } from 'better-auth/plugins';
import { PrismaService } from './database/prisma.service';
import { emailLink, mobileDeepLink, sendResendEmail } from './email';
import { nearLogin } from './near/near-login';

const logger = new Logger('KuvosAuth');

const OTP_EXPIRES_IN_SECONDS = 300;
// The synthetic demo account behind "Try the synthetic demo": one fixed number and code, so a
// judge can sign in without SMS. Synthetic data only; each local setup has its own database.
export const DEMO_PHONE = '+919000000001';
export const DEMO_OTP = '900001';

export function fixedPhoneOtp(phoneNumber: string) {
  return phoneNumber === DEMO_PHONE ? DEMO_OTP : undefined;
}

export function phoneNumberAllowed(phoneNumber: string, production: boolean) {
  return (
    /^\+[1-9]\d{7,14}$/.test(phoneNumber) &&
    (!production || fixedPhoneOtp(phoneNumber) !== undefined)
  );
}

function syntheticEmail(phone: string): string {
  const id = createHash('sha256').update(phone).digest('hex').slice(0, 32);
  return `phone-${id}@synthetic.kuvosai.com`;
}

function magicLinkReturnTo(value: unknown): string {
  return typeof value === 'string' &&
    (/^\/join\/[0-9a-f-]{36}$/i.test(value) || value === '/')
    ? value
    : '/';
}

export function createAuth(prisma: PrismaService, config: ConfigService) {
  const secret = config.get<string>('BETTER_AUTH_SECRET');
  if (!secret || secret.length < 32) {
    throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
  }
  const production = config.get('NODE_ENV') === 'production';
  if (
    !production &&
    (config.get('AUTH_SMS_MODE', 'console') !== 'console' ||
      config.get('AUTH_ALLOW_CONSOLE_OTP', 'false') !== 'true')
  ) {
    throw new Error(
      'SMS delivery is not configured. Set AUTH_SMS_MODE=console and AUTH_ALLOW_CONSOLE_OTP=true only for team testing.',
    );
  }

  const baseUrl = (
    config.get<string>('BETTER_AUTH_URL') ?? 'http://localhost:3001'
  ).replace(/\/$/, '');
  const webOrigin = config.get<string>('WEB_ORIGIN') ?? 'http://localhost:8090';
  // Social sign-in is optional in kuvos-near: a local judge setup uses the synthetic demo phone.
  const googleClientId = config.get<string>('GOOGLE_CLIENT_ID');
  const googleClientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
  const appleClientId = config.get<string>('APPLE_CLIENT_ID');
  const appleClientSecret = config.get<string>('APPLE_CLIENT_SECRET');
  const appleAppBundleIdentifier = config.get<string>(
    'APPLE_APP_BUNDLE_IDENTIFIER',
  );
  const expoDevelopmentOrigins = production
    ? []
    : ['exp://', 'exp://**', 'http://localhost:8090'];

  return betterAuth({
    appName: 'Kuvos',
    baseURL: `${baseUrl}/api/auth`,
    secret,
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    rateLimit: { enabled: true, window: 60, max: 20 },
    account: {
      accountLinking: { enabled: true, allowDifferentEmails: false },
    },
    socialProviders: {
      ...(appleClientId && appleClientSecret && appleAppBundleIdentifier
        ? {
            apple: {
              clientId: appleClientId,
              clientSecret: appleClientSecret,
              appBundleIdentifier: appleAppBundleIdentifier,
              requireEmailVerification: true,
            },
          }
        : {}),
      ...(googleClientId && googleClientSecret
        ? {
            google: {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              requireEmailVerification: true,
            },
          }
        : {}),
    },
    trustedOrigins: [
      webOrigin,
      'https://appleid.apple.com',
      ...expoDevelopmentOrigins,
    ],
    plugins: [
      expo(),
      nearLogin({
        prisma,
        network: () => config.get<string>('NEAR_NETWORK') || 'testnet',
        rpcUrl: () =>
          config.get<string>('NEAR_RPC_URL') ||
          (config.get<string>('NEAR_NETWORK') === 'mainnet'
            ? 'https://rpc.mainnet.fastnear.com'
            : 'https://test.rpc.fastnear.com'),
      }),
      phoneNumber({
        allowedAttempts: 3,
        expiresIn: OTP_EXPIRES_IN_SECONDS,
        phoneNumberValidator: (phone) => phoneNumberAllowed(phone, production),
        sendOTP: async ({ phoneNumber: phone, code }, context) => {
          const fixedOtp = fixedPhoneOtp(phone);
          if (fixedOtp) {
            if (!context) throw new Error('OTP context is unavailable.');
            // ponytail: shared synthetic demo account; remove before onboarding real users.
            await context.context.internalAdapter.deleteVerificationByIdentifier(
              phone,
            );
            await context.context.internalAdapter.createVerificationValue({
              identifier: phone,
              value: `${fixedOtp}:0`,
              expiresAt: new Date(Date.now() + OTP_EXPIRES_IN_SECONDS * 1_000),
            });
            return;
          }
          if (production) {
            throw new Error('SMS delivery is not configured.');
          }
          const masked = `${phone.slice(0, 3)}******${phone.slice(-2)}`;
          // ponytail: console delivery keeps the real OTP flow; replace this callback before external testing.
          logger.warn(`Team-test OTP for ${masked}: ${code}`);
        },
        signUpOnVerification: {
          getTempEmail: syntheticEmail,
          getTempName: () => 'Kuvos user',
        },
      }),
      magicLink({
        expiresIn: 600,
        storeToken: 'hashed',
        rateLimit: { window: 60, max: 5 },
        sendMagicLink: async ({ email, token, metadata }) => {
          const url = new URL(
            mobileDeepLink(config, 'MAGIC_LINK', metadata?.mobileApp),
          );
          url.searchParams.set('token', token);
          url.searchParams.set(
            'returnTo',
            magicLinkReturnTo(metadata?.returnTo),
          );
          await sendResendEmail(config, {
            to: email,
            subject: 'Your Kuvos sign-in link',
            text: `Open this one-time link to sign in to Kuvos. It expires in 10 minutes.\n\n${url.toString()}\n\nIf you did not request this link, you can ignore this email.`,
            html: `<p>Open this one-time link to sign in to Kuvos. It expires in 10 minutes.</p><p>${emailLink(url.toString(), 'Sign in to Kuvos')}</p><p>If you did not request this link, you can ignore this email.</p>`,
            idempotencyKey: `magic-link/${createHash('sha256').update(token).digest('hex')}`,
          });
        },
      }),
    ],
  });
}

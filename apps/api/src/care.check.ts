import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import {
  AI_PROCESSING_CONSENT_VERSION,
  accountDeletionNotice,
  accountDeletionContact,
  canNotifyCareCircleMember,
  careInvitationEmail,
  hasCurrentAiProcessingConsent,
  invitationAllowed,
  invitationMatchesUser,
  normalizeExpoPushToken,
  normalizeInvitationContact,
  normalizePhoneNumber,
  normalizePushPlatform,
  parseDailyRoutine,
  parseHealthProfile,
} from './care.utils';
import { emailLink, mobileDeepLink } from './email';
import { CareService } from './care.service';
import {
  fixedPhoneOtp,
  phoneNumberAllowed,
  DEMO_OTP,
  DEMO_PHONE,
} from './auth';

assert.deepEqual(
  parseDailyRoutine({
    wake: '07:00',
    sleep: '22:30',
    meals: { breakfast: '08:00', dinner: '20:00', snack: '16:00' },
  }),
  {
    wake: '07:00',
    sleep: '22:30',
    meals: { breakfast: '08:00', dinner: '20:00' },
  },
);
assert.throws(() => parseDailyRoutine({ wake: '7am', sleep: '22:00' }));
assert.throws(() =>
  parseDailyRoutine({ wake: '07:00', sleep: '22:00', exercise: '25:00' }),
);
assert.deepEqual(
  parseHealthProfile({
    gender: 'female',
    age: 72,
    heightCm: 158,
    weightKg: 61.25,
    conditions: ['diabetes', 'diabetes', 'tb'],
    otherConditions: '  Thyroid ',
  }),
  {
    gender: 'female',
    age: 72,
    heightCm: 158,
    weightKg: 61.3,
    conditions: ['diabetes', 'tb'],
    otherConditions: 'Thyroid',
  },
);
assert.deepEqual(parseHealthProfile({ gender: null }), { conditions: [] });
assert.throws(() => parseHealthProfile({ conditions: ['cancer'] }));
assert.throws(() => parseHealthProfile({ age: 300 }));
assert.throws(() => parseHealthProfile({ heightCm: '170' }));
assert(hasCurrentAiProcessingConsent(AI_PROCESSING_CONSENT_VERSION));
assert(!hasCurrentAiProcessingConsent(undefined));
assert(!hasCurrentAiProcessingConsent('older-consent'));
const shared = new ConfigService({ WEB_ORIGIN: 'https://near.example' });
assert.equal(
  mobileDeepLink(shared, 'MAGIC_LINK', undefined),
  'https://near.example/magic-link',
);
assert.equal(
  mobileDeepLink(shared, 'INVITATION', 'web'),
  'https://near.example/join',
);
assert.throws(() =>
  mobileDeepLink(shared, 'MAGIC_LINK', 'https://attacker.test'),
);
assert.throws(() => mobileDeepLink(shared, 'INVITATION', 'solana'));
shared.set('MAGIC_LINK_DEEP_LINK_URL', 'https://near.example/custom-link');
assert.equal(
  mobileDeepLink(shared, 'MAGIC_LINK', undefined),
  'https://near.example/custom-link',
);

assert.equal(fixedPhoneOtp(DEMO_PHONE), DEMO_OTP);
assert.equal(fixedPhoneOtp('+919000000002'), undefined);
assert(phoneNumberAllowed(DEMO_PHONE, true));
assert(!phoneNumberAllowed('+919000000002', true));
assert(phoneNumberAllowed('+919000000002', false));

assert.equal(normalizePhoneNumber('+91 98765-43210'), '+919876543210');
assert.deepEqual(accountDeletionContact({ email: ' Person@Example.com ' }), {
  email: 'person@example.com',
  phoneNumber: null,
});
assert.deepEqual(accountDeletionContact({ phoneNumber: '+91 98765-43210' }), {
  email: null,
  phoneNumber: '+919876543210',
});
assert.throws(() => accountDeletionContact({}));
assert.throws(() => accountDeletionContact({ email: 'wrong' }));
assert.throws(() => accountDeletionContact({ phoneNumber: '9876543210' }));
assert.throws(() => normalizePhoneNumber('9876543210'));
assert.deepEqual(normalizeInvitationContact(' Person@Example.com '), {
  email: 'person@example.com',
});
assert.throws(() => normalizeInvitationContact('+91 98765-43210'));
assert(
  invitationMatchesUser(
    { email: 'person@example.com' },
    { email: 'person@example.com', emailVerified: true },
  ),
);
assert(
  !invitationMatchesUser(
    { email: 'person@example.com' },
    { email: 'person@example.com', emailVerified: false },
  ),
);
assert(
  invitationMatchesUser(
    { phoneNumber: '+919876543210' },
    {
      email: 'phone-user@synthetic.kuvosai.com',
      emailVerified: false,
      phoneNumber: '+919876543210',
      phoneNumberVerified: true,
    },
  ),
);
assert(invitationAllowed('PATIENT', 'CAREGIVER'));
assert(invitationAllowed('CAREGIVER', 'PATIENT'));
assert(!invitationAllowed('PATIENT', 'PATIENT'));
assert(!invitationAllowed('CAREGIVER', 'CAREGIVER'));
assert.equal(
  normalizeExpoPushToken('ExponentPushToken[abc_123-XYZ]'),
  'ExponentPushToken[abc_123-XYZ]',
);
assert.equal(
  normalizeExpoPushToken('ExpoPushToken[abc123]'),
  'ExpoPushToken[abc123]',
);
assert.throws(() => normalizeExpoPushToken('not-a-token'));
assert.equal(normalizePushPlatform('ios'), 'ios');
assert.throws(() => normalizePushPlatform('web'));
assert.equal(
  emailLink('kuvos://magic-link?token=a&returnTo=%2F', 'Sign in'),
  '<a href="kuvos://magic-link?token=a&amp;returnTo=%2F">Sign in</a>',
);
assert(
  canNotifyCareCircleMember({
    email: ' Person@Example.com ',
    emailVerified: true,
  }),
);
assert(
  !canNotifyCareCircleMember({
    email: 'person@example.com',
    emailVerified: false,
  }),
);
assert(
  !canNotifyCareCircleMember({
    email: 'phone-user@synthetic.kuvosai.com',
    emailVerified: true,
  }),
);
assert.equal(
  accountDeletionNotice({
    name: 'Ada',
    patientName: 'Lin',
    removesCareRecord: false,
  }).text,
  'Ada deleted their Kuvos account and left the Care Circle for Lin. The care routine is unchanged.',
);
assert.equal(
  accountDeletionNotice({
    name: 'Ada <script>',
    patientName: 'Lin',
    removesCareRecord: true,
  }).html,
  '<p>Ada &lt;script&gt; deleted their Kuvos account. The Care Circle for Lin and the routine stored in Kuvos have been removed.</p>',
);
const webInvitation = careInvitationEmail({
  link: 'https://near.example/join/invitation-1',
});
assert(webInvitation.text.includes('https://near.example/join/invitation-1'));
assert(!/testflight|app store|install/i.test(webInvitation.text));

async function checkAccountDeletionRequest() {
  let saved: { id: string; notifiedAt: Date | null } | null = null;
  let created = 0;
  let emailed = 0;
  const prisma = {
    accountDeletionRequest: {
      findFirst: () => Promise.resolve(saved),
      count: () => Promise.resolve(created),
      create: ({
        data,
      }: {
        data: { email: string | null; phoneNumber: string | null };
      }) => {
        assert.deepEqual(data, {
          email: 'person@example.com',
          phoneNumber: null,
        });
        created++;
        saved = { id: 'request-1', notifiedAt: null };
        return Promise.resolve(saved);
      },
      update: () => {
        assert(saved);
        saved.notifiedAt = new Date();
        return Promise.resolve();
      },
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    emailed++;
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  try {
    const care = new CareService(
      prisma as never,
      new ConfigService({
        RESEND_API_KEY: 'synthetic-only',
        RESEND_FROM_EMAIL: 'Kuvos <test@example.test>',
        ACCOUNT_DELETION_EMAIL: 'privacy@example.test',
      }),
      {} as never,
    );
    assert.deepEqual(
      await care.requestAccountDeletion({ email: ' Person@Example.com ' }),
      { status: 'received' },
    );
    assert.deepEqual(
      await care.requestAccountDeletion({ email: ' Person@Example.com ' }),
      { status: 'received' },
    );
    assert.equal(created, 1);
    assert.equal(emailed, 1);
    const limited = new CareService(
      {
        accountDeletionRequest: {
          findFirst: () => Promise.resolve(null),
          count: () => Promise.resolve(60),
        },
      } as never,
      new ConfigService(),
      {} as never,
    );
    await assert.rejects(
      () => limited.requestAccountDeletion({ email: 'another@example.com' }),
      { status: 429 },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void checkAccountDeletionRequest().then(
  () => console.log('care check passed'),
  (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  },
);

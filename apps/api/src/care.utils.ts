import { BadRequestException } from '@nestjs/common';
import { emailLink } from './email';

export type CareRoleValue = 'PATIENT' | 'CAREGIVER';
export type InvitationContact = { email: string };

export const AI_PROCESSING_CONSENT_VERSION = 'synthetic-ai-v1';

export function hasCurrentAiProcessingConsent(
  version: string | null | undefined,
) {
  return version === AI_PROCESSING_CONSENT_VERSION;
}

export function normalizeInvitationContact(value: unknown): InvitationContact {
  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException('An email address is required.');
  }
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return { email };
}

export function invitationMatchesUser(
  invitation: { email?: string | null; phoneNumber?: string | null },
  user: {
    email: string;
    emailVerified: boolean;
    phoneNumber?: string | null;
    phoneNumberVerified?: boolean | null;
  },
): boolean {
  return Boolean(
    (invitation.email &&
      user.emailVerified &&
      invitation.email === user.email.toLowerCase()) ||
    (invitation.phoneNumber &&
      user.phoneNumberVerified &&
      invitation.phoneNumber === user.phoneNumber),
  );
}

export function normalizePhoneNumber(value: unknown): string {
  if (typeof value !== 'string')
    throw new BadRequestException('A mobile number is required.');
  const normalized = value.replace(/[\s()-]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new BadRequestException(
      'Use an international mobile number such as +919876543210.',
    );
  }
  return normalized;
}

export function accountDeletionContact(value: unknown): {
  email: string | null;
  phoneNumber: string | null;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Enter an email address or mobile number.');
  }
  const body = value as Record<string, unknown>;
  const email =
    body.email === undefined || body.email === '' ? null : body.email;
  const phone =
    body.phoneNumber === undefined || body.phoneNumber === ''
      ? null
      : body.phoneNumber;
  if (email === null && phone === null) {
    throw new BadRequestException('Enter an email address or mobile number.');
  }
  if (
    email !== null &&
    (typeof email !== 'string' ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
  ) {
    throw new BadRequestException('Enter a valid email address.');
  }
  return {
    email: typeof email === 'string' ? email.trim().toLowerCase() : null,
    phoneNumber: phone === null ? null : normalizePhoneNumber(phone),
  };
}

const SYNTHETIC_ACCOUNT_EMAIL_DOMAIN = '@synthetic.kuvosai.com';

export function canNotifyCareCircleMember(member: {
  email: string;
  emailVerified: boolean;
}): boolean {
  const email = member.email.trim().toLowerCase();
  return (
    member.emailVerified &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    !email.endsWith(SYNTHETIC_ACCOUNT_EMAIL_DOMAIN)
  );
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character]!,
  );
}

export function accountDeletionNotice(input: {
  name: string;
  patientName: string;
  removesCareRecord: boolean;
}): { subject: string; text: string; html: string } {
  const name = input.name.trim() || 'A Care Circle member';
  const patientName = input.patientName.trim() || 'your Care Circle';
  const text = input.removesCareRecord
    ? `${name} deleted their Kuvos account. The Care Circle for ${patientName} and the routine stored in Kuvos have been removed.`
    : `${name} deleted their Kuvos account and left the Care Circle for ${patientName}. The care routine is unchanged.`;
  return {
    subject: 'A Kuvos account was deleted',
    text,
    html: `<p>${escapeHtml(text)}</p>`,
  };
}

// kuvos-near is a browser app: the invitation only links to it, there is nothing to install.
export function careInvitationEmail(input: { link: string }): {
  subject: string;
  text: string;
  html: string;
} {
  return {
    subject: 'You have been invited to Kuvos',
    text: `You have been invited to join a Care Circle in Kuvos.\n\nOpen Kuvos and sign in with this email address to review the invitation:\n${input.link}\n\nThis invitation expires in 7 days. No care details are included in this email.`,
    html: `<p>You have been invited to join a Care Circle in Kuvos.</p><p>${emailLink(input.link, 'Open Kuvos')}</p><p>Sign in with this email address to review the invitation. It expires in 7 days. No care details are included in this email.</p>`,
  };
}

export function invitationAllowed(
  inviter: CareRoleValue,
  invited: CareRoleValue,
): boolean {
  return (
    (inviter === 'PATIENT' && invited === 'CAREGIVER') ||
    (inviter === 'CAREGIVER' && invited === 'PATIENT')
  );
}

export function normalizeExpoPushToken(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/.test(value)
  ) {
    throw new BadRequestException('A valid Expo push token is required.');
  }
  return value;
}

export function normalizePushPlatform(value: unknown): 'ios' | 'android' {
  if (value !== 'ios' && value !== 'android') {
    throw new BadRequestException('Platform must be ios or android.');
  }
  return value;
}

export type DailyRoutine = {
  wake: string;
  sleep: string;
  meals: Partial<Record<'breakfast' | 'lunch' | 'dinner', string>>;
  exercise?: string;
};

const MEALS = ['breakfast', 'lunch', 'dinner'] as const;

function clockTime(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new BadRequestException(`${label} must be a time like 07:30.`);
  }
  return value;
}

/** Usual times the patient keeps. Used for reminder suggestions only, never dosing. */
export function parseDailyRoutine(value: unknown): DailyRoutine {
  const body =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const rawMeals =
    body.meals !== null &&
    typeof body.meals === 'object' &&
    !Array.isArray(body.meals)
      ? (body.meals as Record<string, unknown>)
      : {};
  const meals: DailyRoutine['meals'] = {};
  for (const meal of MEALS) {
    if (rawMeals[meal] !== undefined) {
      meals[meal] = clockTime(rawMeals[meal], `${meal} time`);
    }
  }
  return {
    wake: clockTime(body.wake, 'Wake-up time'),
    sleep: clockTime(body.sleep, 'Bedtime'),
    meals,
    ...(body.exercise === undefined
      ? {}
      : { exercise: clockTime(body.exercise, 'Exercise time') }),
  };
}

export const CONDITIONS = [
  'blood_pressure',
  'diabetes',
  'tb',
  'lung_infection',
] as const;

export type HealthProfile = {
  gender?: 'female' | 'male' | 'other';
  age?: number;
  heightCm?: number;
  weightKg?: number;
  conditions: (typeof CONDITIONS)[number][];
  otherConditions?: string;
};

function measure(
  value: unknown,
  label: string,
  min: number,
  max: number,
  decimals = 0,
): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !(value >= min && value <= max)) {
    throw new BadRequestException(
      `${label} must be between ${min} and ${max}.`,
    );
  }
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/** What the person tells us about themselves. Shown on their profile only; never shapes a plan. */
export function parseHealthProfile(value: unknown): HealthProfile {
  const body =
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const gender = body.gender ?? undefined;
  if (
    gender !== undefined &&
    !['female', 'male', 'other'].includes(gender as string)
  ) {
    throw new BadRequestException('Choose female, male or other.');
  }
  const rawConditions = body.conditions ?? [];
  if (
    !Array.isArray(rawConditions) ||
    rawConditions.some((item) => !CONDITIONS.includes(item as never))
  ) {
    throw new BadRequestException('Choose conditions from the list.');
  }
  const other =
    typeof body.otherConditions === 'string' ? body.otherConditions.trim() : '';
  if (other.length > 200) {
    throw new BadRequestException(
      'Keep other conditions under 200 characters.',
    );
  }
  const profile: HealthProfile = {
    conditions: [...new Set(rawConditions as HealthProfile['conditions'])],
  };
  if (gender) profile.gender = gender as HealthProfile['gender'];
  const age = measure(body.age, 'Age', 0, 120);
  if (age !== undefined) profile.age = age;
  const heightCm = measure(body.heightCm, 'Height', 30, 250);
  if (heightCm !== undefined) profile.heightCm = heightCm;
  const weightKg = measure(body.weightKg, 'Weight', 1, 400, 1);
  if (weightKg !== undefined) profile.weightKg = weightKg;
  if (other) profile.otherConditions = other;
  return profile;
}

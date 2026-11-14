import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type Email = {
  to: string;
  subject: string;
  text: string;
  html: string;
  idempotencyKey: string;
};

export function mobileDeepLink(
  config: ConfigService,
  kind: 'INVITATION' | 'MAGIC_LINK',
  app: unknown,
): string {
  if (app !== undefined && app !== 'ios' && app !== 'web') {
    throw new BadRequestException('Invalid app.');
  }
  // kuvos-near is a browser app: links open the web origin, never a native scheme.
  const web = (
    config.get<string>('WEB_ORIGIN') ?? 'http://localhost:8090'
  ).replace(/\/$/, '');
  return (
    config.get<string>(`${kind}_DEEP_LINK_URL`) ||
    `${web}/${kind === 'INVITATION' ? 'join' : 'magic-link'}`
  );
}

export function emailLink(href: string, label: string): string {
  const escape = (value: string) =>
    value.replace(
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
  return `<a href="${escape(href)}">${escape(label)}</a>`;
}

export async function sendResendEmail(
  config: ConfigService,
  email: Email,
): Promise<void> {
  const apiKey = config.get<string>('RESEND_API_KEY');
  const from = config.get<string>('RESEND_FROM_EMAIL');
  if (!apiKey || !from) {
    throw new ServiceUnavailableException('Email delivery is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': email.idempotencyKey,
    },
    body: JSON.stringify({
      from,
      to: [email.to],
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new ServiceUnavailableException('Email delivery failed.');
  });

  if (!response.ok) {
    throw new ServiceUnavailableException('Email delivery failed.');
  }
}

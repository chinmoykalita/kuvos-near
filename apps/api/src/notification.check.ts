import assert from 'node:assert/strict';
import {
  careCirclePushMessage,
  firstExpoResult,
  nextPushAttempt,
} from './notification.utils';

const message = careCirclePushMessage('ExponentPushToken[test]');
assert.equal(message.title, 'Kuvos check-in');
assert.equal(
  message.body,
  'Someone in your Care Circle may need a check-in. Open Kuvos for the latest status.',
);
assert.deepEqual(message.data, { kuvosCareCircleAlert: true });
assert(!JSON.stringify(message).includes('medication'));
assert.deepEqual(
  firstExpoResult({ data: [{ status: 'ok', id: 'ticket-1' }] }),
  { status: 'ok', id: 'ticket-1' },
);
assert.equal(
  nextPushAttempt(new Date('2026-09-17T10:00:00.000Z'), 2).toISOString(),
  '2026-09-17T10:04:00.000Z',
);

console.log('notification check passed');

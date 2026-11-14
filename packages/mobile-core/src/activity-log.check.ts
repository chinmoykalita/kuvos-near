import assert from 'node:assert/strict';
import { saveActivity } from './activity-log.ts';

const events: string[] = [];
assert.equal(await saveActivity(async () => {
  events.push('saved');
  return undefined;
}, () => events.push('shown')), undefined);
assert.deepEqual(events, ['saved', 'shown']);

events.length = 0;
const notice = await saveActivity(async () => {
  events.push('saved');
  return async () => {
    events.push('follow-up');
    throw new Error('Signing unavailable');
  };
}, () => events.push('shown'));
assert.deepEqual(events, ['saved', 'shown', 'follow-up']);
assert.equal(notice, 'Activity saved. Additional confirmation could not be completed.');

events.length = 0;
await assert.rejects(() => saveActivity(async () => {
  throw new Error('Care log failed');
}, () => events.push('shown')), /Care log failed/);
assert.deepEqual(events, []);

assert.equal(await saveActivity(async () => async () => 'Activity saved. Retry the signature.', () => {}), 'Activity saved. Retry the signature.');
console.log('Activity logging checks passed.');

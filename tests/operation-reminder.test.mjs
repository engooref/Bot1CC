import assert from 'node:assert/strict';
import { test } from 'node:test';
const {
  OPERATION_CALENDAR_ICON,
  OPERATION_REMINDER_DELAY_MS,
  OPERATION_REMINDER_MARKER,
  buildReminderMessage,
  channelNameMatches,
  hasCalendarIcon,
  isOperationMessage,
  isReminderDue,
  reminderDelayMs,
  shouldPlanReminder,
  withCalendarIcon,
  withoutCalendarIcon,
} = await import('../dist/src/utils/OperationReminder.js');

const MIN = 60_000;
const t0 = new Date('2026-11-02T20:00:00Z');
const after = (min) => new Date(t0.getTime() + min * MIN);

test('l\'icône calendrier est ajoutée une seule fois', () => {
  assert.equal(withCalendarIcon('minage'), 'minage' + OPERATION_CALENDAR_ICON);
  assert.equal(withCalendarIcon('minage📅'), 'minage📅');
  assert.equal(hasCalendarIcon('minage📅'), true);
  assert.equal(hasCalendarIcon('minage'), false);
});

test('l\'icône calendrier est retirée seulement si elle est présente', () => {
  assert.equal(withoutCalendarIcon('minage📅'), 'minage');
  assert.equal(withoutCalendarIcon('minage'), 'minage');
});

test('le délai du rappel est de 30 minutes', () => {
  assert.equal(OPERATION_REMINDER_DELAY_MS, 30 * MIN);
});

test('pas de rappel prévu si l\'OP commence moins de 30 minutes après sa création', () => {
  assert.equal(shouldPlanReminder(after(29), t0), false);
  assert.equal(shouldPlanReminder(after(0), t0), false);
  assert.equal(shouldPlanReminder(after(30), t0), true);
  assert.equal(shouldPlanReminder(after(120), t0), true);
});

test('le rappel est dû dans les 30 minutes avant le départ, pas après', () => {
  assert.equal(isReminderDue(after(31), t0), false);
  assert.equal(isReminderDue(after(30), t0), true);
  assert.equal(isReminderDue(after(1), t0), true);
  assert.equal(isReminderDue(after(0), t0), false);
  assert.equal(isReminderDue(after(-5), t0), false);
});

test('le délai avant le rappel ne devient jamais négatif', () => {
  assert.equal(reminderDelayMs(after(90), t0), 60 * MIN);
  assert.equal(reminderDelayMs(after(10), t0), 0);
});

test('un message d\'opération est un message du bot avec un pied connu et une date', () => {
  const base = { authorId: 'bot', botId: 'bot', footerText: 'Interstellar Companion | 1er Corps Colonial', embedTimestamp: '2026-11-02T20:00:00.000Z' };
  assert.equal(isOperationMessage(base), true);
  assert.equal(isOperationMessage({ ...base, footerText: 'Création automatique depuis le web' }), true);
  assert.equal(isOperationMessage({ ...base, authorId: 'membre' }), false);
  assert.equal(isOperationMessage({ ...base, footerText: 'autre' }), false);
  assert.equal(isOperationMessage({ ...base, embedTimestamp: null }), false);
  assert.equal(isOperationMessage({ ...base, embedTimestamp: 'pas une date' }), false);
});

test('le rappel mentionne les membres une seule fois et commence par le marqueur', () => {
  const msg = buildReminderMessage(['1', '2', '1'], t0);
  assert.ok(msg.startsWith(OPERATION_REMINDER_MARKER));
  assert.equal(msg.match(/<@1>/g).length, 1);
  assert.ok(msg.includes('<@2>'));
  assert.ok(msg.includes(`<t:${t0.getTime() / 1000}:R>`));
});

test('le rappel reste sous 2000 caractères même avec beaucoup de présents', () => {
  const ids = Array.from({ length: 300 }, (_, i) => String(100000000000000000n + BigInt(i)));
  const msg = buildReminderMessage(ids, t0);
  assert.ok(msg.length < 2000);
  assert.ok(msg.includes('et 240 autres'));
});

test('un canal est retrouvé avec ou sans l\'icône calendrier, jamais confondu avec un autre', () => {
  assert.equal(channelNameMatches('op-minage', 'op-minage'), true);
  assert.equal(channelNameMatches('op-minage' + OPERATION_CALENDAR_ICON, 'op-minage'), true);
  assert.equal(channelNameMatches('création-opération' + OPERATION_CALENDAR_ICON, 'création-opération'), true);
  assert.equal(channelNameMatches('op-minage-2' + OPERATION_CALENDAR_ICON, 'op-minage'), false);
  assert.equal(channelNameMatches('op-combat', 'op-minage'), false);
});

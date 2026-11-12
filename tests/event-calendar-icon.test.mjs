import assert from 'node:assert/strict';
import { test } from 'node:test';

const { channelsWithActiveEvents, startOfWeek } = await import('../dist/src/utils/EventCalendarIcon.js');

// Jeudi 12 novembre 2026, 12:00 (heure locale)
const now = new Date(2026, 10, 12, 12, 0);
const d = (day, h = 20) => new Date(2026, 10, day, h, 0);

test('startOfWeek renvoie le lundi 00:00', () => {
  const s = startOfWeek(now);
  assert.equal(s.getDay(), 1);
  assert.equal(s.getDate(), 9);
  assert.equal(s.getHours(), 0);
  // dimanche appartient à la semaine qui finit
  assert.equal(startOfWeek(new Date(2026, 10, 15, 10)).getDate(), 9);
});

test('canal d\'un jour : événement de la semaine en cours', () => {
  const r = channelsWithActiveEvents([{ channelId: 'jeudi', persistent: false, start: d(12), end: d(12, 22) }], now);
  assert.ok(r.has('jeudi'));
});

test('canal d\'un jour : événement de la semaine suivante ignoré', () => {
  const r = channelsWithActiveEvents([{ channelId: 'lundi', persistent: false, start: d(16), end: d(16, 22) }], now);
  assert.equal(r.size, 0);
});

test('canal d\'un jour : événement déjà passé cette semaine garde l\'icône', () => {
  const r = channelsWithActiveEvents([{ channelId: 'lundi', persistent: false, start: d(9), end: d(9, 22) }], now);
  assert.ok(r.has('lundi'));
});

test('canal persistant : événement dans plusieurs semaines gardé', () => {
  const r = channelsWithActiveEvents([{ channelId: 'gros', persistent: true, start: d(30), end: d(30, 23) }], now);
  assert.ok(r.has('gros'));
});

test('canal persistant : événement en cours qui dure depuis des semaines gardé', () => {
  const r = channelsWithActiveEvents(
    [{ channelId: 'gros', persistent: true, start: new Date(2026, 9, 20), end: new Date(2026, 11, 1) }],
    now,
  );
  assert.ok(r.has('gros'));
});

test('canal persistant : événement terminé ignoré', () => {
  const r = channelsWithActiveEvents([{ channelId: 'training', persistent: true, start: d(5), end: d(5, 22) }], now);
  assert.equal(r.size, 0);
});

test('deux événements dans le même canal : l\'icône reste si un seul est retiré', () => {
  const a = { channelId: 'jeudi', persistent: false, start: d(12, 18), end: d(12, 19) };
  const b = { channelId: 'jeudi', persistent: false, start: d(12, 21), end: d(12, 22) };
  assert.ok(channelsWithActiveEvents([b], now).has('jeudi'));
  assert.ok(channelsWithActiveEvents([a, b], now).has('jeudi'));
  assert.equal(channelsWithActiveEvents([], now).size, 0);
});

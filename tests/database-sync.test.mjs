import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection, ChannelType } from 'discord.js';
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { DatabaseManager } = await import('../dist/src/managers/DatabaseManager.js');

function fixture(rows) {
  let flushes = 0;
  const em = {
    find: async () => rows,
    create: (_entity, data) => data,
    persist(created) { rows.push(...created); return this; },
    async flush() { flushes++; },
  };
  const db = new DatabaseManager({ excludeCategory: [], guild: { channels: { cache: new Collection() } } });
  db.orm = { em: { fork: () => em } };
  return { db, em, flushes: () => flushes };
}

test('force updates existing roles by Discord ID and preserves relationships', async () => {
  const role = { id: 42, discordId: '123', name: 'Ancien', users: ['member'], rank: { id: 1 } };
  const { db, em, flushes } = fixture([role]);
  const roles = new Collection([['123', { id: '123', name: 'Nouveau' }]]);
  await db.syncRoles(roles, em);
  assert.equal(role.name, 'Ancien');
  const result = await db.syncRoles(roles, em, true);
  assert.equal(result[0], role);
  assert.equal(role.name, 'Nouveau');
  assert.equal(role.id, 42);
  assert.deepEqual(role.users, ['member']);
  assert.deepEqual(role.rank, { id: 1 });
  assert.equal(flushes(), 1);
});

test('force refreshes channel names and clears a removed category without duplicates', async () => {
  const channel = { id: 7, discordId: '123', name: 'Ancien', categoryName: 'Cat', categoryId: '456' };
  const { db, flushes } = fixture([channel]);
  const channels = new Collection([['123', { id: '123', name: 'Nouveau', parent: null, type: ChannelType.GuildText }]]);
  const result = await db.syncChannels(channels, true);
  assert.equal(result.length, 1);
  assert.equal(result[0], channel);
  assert.deepEqual(channel, { id: 7, discordId: '123', name: 'Nouveau', categoryName: '', categoryId: '' });
  assert.equal(flushes(), 1);
});

test('database errors propagate instead of reporting a successful sync', async () => {
  const { db, em } = fixture([]);
  em.find = async () => { throw new Error('database unavailable'); };
  await assert.rejects(db.syncRoles(new Collection([['123', { id: '123' }]]), em, true), /database unavailable/);
});

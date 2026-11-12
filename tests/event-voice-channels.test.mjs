import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType } from 'discord.js';

const { SchedulerEvent } = await import('../dist/src/managers/schedulers/SchedulerEvent.js');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function makeScheduler({ roleMember = { id: 'role' }, failOn = null } = {}) {
  const created = [];
  const cache = new Map();
  cache.filter = (fn) => [...cache.values()].filter(fn);
  let flushes = 0;
  const em = { persist() { return { flush: async () => { flushes++; } }; } };
  const guild = {
    roles: { everyone: 'everyone' },
    channels: {
      cache,
      fetch: async (id) => cache.get(id) ?? null,
      create: async (opts) => {
        if (failOn === opts.type) throw new Error('boom');
        const ch = { id: `c${created.length + 1}`, type: opts.type, parentId: opts.parent ?? null, setPosition: async () => {} };
        created.push(opts);
        cache.set(ch.id, ch);
        return ch;
      },
    },
  };
  const sched = Object.create(SchedulerEvent.prototype);
  sched.logger = silentLogger;
  sched.bot = { roleMember, guild, eventManager: { em } };
  return { sched, created, getFlushes: () => flushes, setFail: (t) => { failOn = t; } };
}

const newEvent = () => ({ id: 1, name: 'Minage', discord: {} });

test('crée catégorie, vocal créateur et briefing, et enregistre vocalParentId', async () => {
  const { sched, created } = makeScheduler();
  const ev = newEvent();
  assert.equal(await sched.ensureEventVoiceChannels(ev), true);
  assert.deepEqual(created.map(c => c.type), [ChannelType.GuildCategory, ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
  assert.ok(ev.discord.vocalParentId);
});

test('rôle membre absent : échec signalé, rien de créé, pas d\'exception', async () => {
  const { sched, created } = makeScheduler({ roleMember: undefined });
  assert.equal(await sched.ensureEventVoiceChannels(newEvent()), false);
  assert.equal(created.length, 0);
});

test('un deuxième passage ne crée aucun doublon', async () => {
  const { sched, created } = makeScheduler();
  const ev = newEvent();
  await sched.ensureEventVoiceChannels(ev);
  assert.equal(await sched.ensureEventVoiceChannels(ev), true);
  assert.equal(created.length, 3);
});

test('échec en cours de route : la catégorie est mémorisée et le nouvel essai complète sans doublon', async () => {
  const ctx = makeScheduler({ failOn: ChannelType.GuildStageVoice });
  const ev = newEvent();
  assert.equal(await ctx.sched.ensureEventVoiceChannels(ev), false);
  assert.ok(ev.discord.vocalParentId, 'vocalParentId enregistré dès la création de la catégorie');
  ctx.setFail(null);
  assert.equal(await ctx.sched.ensureEventVoiceChannels(ev), true);
  assert.deepEqual(ctx.created.map(c => c.type), [ChannelType.GuildCategory, ChannelType.GuildVoice, ChannelType.GuildStageVoice]);
});

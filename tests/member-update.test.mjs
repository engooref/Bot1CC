import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection } from 'discord.js';
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { _onGuildMemberUpdate: update } = await import('../dist/src/bootstrap/DiscordEventHandlers.js');
const { settingsService } = await import('../dist/src/services/SettingsService.js');
settingsService.getString = async key => ({ 'bot.roles.postulant': 'postulant', 'bot.diplomatie.role_ambassadeur': 'ambassadeur' }[key] ?? '');
const roles = ids => new Collection(ids.map(id => [id, { id }]));
function fixture({ old = [], current = [], userExists = true, partial = false } = {}) {
  const calls = [];
  const user = { id: 42, username: 'Alice', rolesDiscord: { set(value) { calls.push(['roles', value.map(r => r.id)]); } } };
  const after = { id: 'alice', displayName: 'Alice', user: { bot: false, avatar: null }, roles: { cache: roles(current) } };
  const before = { partial, displayName: 'Alice', roles: { cache: roles(old) } };
  const em = {
    async findOne() { return userExists ? user : null; },
    create(_entity, values) { return { ...values, rolesDiscord: user.rolesDiscord }; },
    persist(u) { calls.push(['persist', u]); return this; }, async flush() {},
    async find(_type, filter) { calls.push(['events', filter]); return [{ id: 1 }, { id: 2 }]; },
  };
  const bot = {
    guild: { id: 'guild', members: { async fetch() { return after; } } }, roleMember: { id: 'official' },
    db: { getEm: () => em, async syncRoles(value, manager) { assert.equal(manager, em); return [...value.values()]; } },
    recrutementManager: { async onMember() { calls.push(['recrutement']); } },
    diploManager: { async createRequest() { calls.push(['diplo']); } },
    userManager: { async deleteUser(u) { calls.push(['anonymize', u.id]); } },
    eventManager: { async updateEvent(e) { calls.push(['event', e.id]); } },
  };
  after.guild = bot.guild;
  return { bot, before, after, calls, user, run: () => update(bot, before, after) };
}
test('un ajout quelconque ne déclenche pas le recrutement ; les rôles sont remplacés en base', async () => {
  const f = fixture({ old: ['postulant', 'ancien'], current: ['postulant', 'nouveau'] });
  await f.run();
  assert.equal(f.calls.some(c => c[0] === 'recrutement'), false);
  assert.deepEqual(f.calls.find(c => c[0] === 'roles')[1], ['postulant', 'nouveau']);
});
test('Postulant déclenche le recrutement même sans profil User', async () => {
  const f = fixture({ current: ['postulant'], userExists: false }); await f.run();
  assert.equal(f.calls.filter(c => c[0] === 'recrutement').length, 1);
  assert.equal(f.calls.some(c => c[0] === 'persist'), false);
});
test('une erreur recrutement ne bloque ni la diplomatie ni la synchronisation', async () => {
  const f = fixture({ current: ['postulant', 'ambassadeur'] });
  f.bot.recrutementManager.onMember = async () => { throw new Error('test failure'); };
  await f.run();
  assert.ok(f.calls.some(c => c[0] === 'diplo'));
  assert.ok(f.calls.some(c => c[0] === 'persist'));
});
test('retrait du rôle officiel anonymise sans suppression du profil', async () => {
  const f = fixture({ old: ['official'], current: [] }); await f.run();
  assert.ok(f.calls.some(c => c[0] === 'anonymize'));
  assert.equal(f.calls.some(c => c[0] === 'persist'), false);
});
test('un retrait devenu obsolète ne supprime pas un membre déjà rétabli', async () => {
  const f = fixture({ old: ['official'], current: [] });
  f.bot.guild.members.fetch = async () => ({ ...f.after, roles: { cache: roles(['official']) } });
  await f.run(); assert.equal(f.calls.some(c => c[0] === 'anonymize'), false);
});
test('un membre officiel sans profil est créé avec tous ses rôles', async () => {
  const f = fixture({ current: ['official', 'metier'], userExists: false }); await f.run();
  const user = f.calls.find(c => c[0] === 'persist')[1];
  assert.equal(user.discordId, 'alice');
  assert.deepEqual(f.calls.find(c => c[0] === 'roles')[1], ['official', 'metier']);
});
test('pseudo actuel et événements du mois entier, sans requête par événement', async () => {
  const f = fixture(); f.after.displayName = '[P] Alice'; await f.run();
  assert.equal(f.user.username, '[P] Alice');
  const query = f.calls.find(c => c[0] === 'events')[1];
  assert.equal(query.start.$lt.getDate(), 1);
  assert.deepEqual(query.responses, { users: { id: 42 } });
  assert.equal(f.calls.filter(c => c[0] === 'event').length, 2);
});
test('ancien membre partiel : rapprochement idempotent sans déduire de retrait', async () => {
  const f = fixture({ old: ['official'], current: ['postulant'], partial: true }); await f.run();
  assert.ok(f.calls.some(c => c[0] === 'recrutement'));
  assert.equal(f.calls.some(c => c[0] === 'anonymize'), false);
});
test('absence de rôle officiel configuré et événement sans changement sont supportés', async () => {
  const f = fixture({ current: ['autre'], userExists: false }); f.bot.roleMember = undefined; await f.run();
  assert.equal(f.calls.length, 0);
  const unchanged = fixture(); await unchanged.run(); assert.equal(unchanged.calls.length, 0);
});

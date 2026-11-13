import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection, ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { ParrainageManager, candidatePeriodEnded, candidatePeriodEnd, reminderDue, parseParrainReturn, parrainAvailability, parrainCapacity, parseExtensionDays, requestSiteAcceptance } = await import('../dist/src/managers/ParrainageManager.js');
const { RecrutementDemande: D } = await import('../dist/src/entities/recrutement/RecrutementDemande.js');
const { RecrutementParrainage: A } = await import('../dist/src/entities/recrutement/RecrutementParrainage.js');
const { ParrainPreference: Pref } = await import('../dist/src/entities/recrutement/ParrainPreference.js');
const { InteractionContext } = await import('../dist/src/entities/ui/ViewContext.js');
const { settingsService } = await import('../dist/src/services/SettingsService.js');
const { default: View, parrainButton, parrainSelect } = await import('../dist/src/view/ParrainageView.js');
const { default: RecruitmentView } = await import('../dist/src/view/RecrutementView.js');
const { JSONTypeComponent: T } = await import('../dist/src/utils/Type.js');
const ids = { guild: '100000000000000001', staff: '100000000000000002', parrain: '100000000000000003', other: '100000000000000004', applicant: '100000000000000005', role: '100000000000000006', rh: '100000000000000007', official: '100000000000000008', bot: '100000000000000009', ticket: '100000000000000010', channelRh: '100000000000000011', mentora: '100000000000000012' };
let config;
settingsService.getString = async key => config[key] ?? '';
settingsService.get = async (key, fallback) => config[key] ?? fallback;
function matches(row, filter) {
    if (typeof filter !== 'object' || filter === null) return (row?.id ?? row) === filter;
    return Object.entries(filter).every(([key, value]) => {
        const actual = row?.[key];
        if (value === null) return actual == null;
        if (value && typeof value === 'object') {
            if ('$lte' in value) return actual != null && actual <= value.$lte;
            return matches(actual, value);
        }
        return (actual?.id ?? actual) === value;
    });
}
function fixture() {
    config = { 'bot.recrutement.role_parrain': ids.role, 'bot.recrutement.parrain_capacity_max': 2, 'site.roles.rh': ids.rh, 'bot.channels.rh': ids.channelRh };
    const requests = [Object.assign(new D(), { id: 1, guildId: ids.guild, applicantId: ids.applicant, status: 'candidate', channelId: ids.ticket, notificationChannelId: ids.channelRh, needsSync: false })];
    const assignments = [], prefs = [], contexts = [], operations = [];
    const tables = new Map([[D, requests], [A, assignments], [Pref, prefs], [InteractionContext, contexts]]);
    let serial = 100, tail = Promise.resolve(), failMessage = false, failRH = false;
    const em = {
        getConnection: () => ({ execute: async (_sql, values) => {
            const [guildId, userId, capacity] = values;
            if (!prefs.some(p => p.guildId === guildId && p.userId === userId)) prefs.push(Object.assign(new Pref(), { id: ++serial, guildId, userId, capacity }));
        } }),
        async find(Type, filter) { return (tables.get(Type) ?? []).filter(row => matches(row, filter)); },
        async findOne(Type, filter) { return (await this.find(Type, filter))[0] ?? null; },
        async findOneOrFail(Type, filter) { const row = await this.findOne(Type, filter); if (!row) throw new Error('not found'); return row; },
        async count(Type, filter) { return (await this.find(Type, filter)).length; },
        create(Type, data) { return Object.assign(new Type(), data); },
        persist(row) { if (!row.id) row.id = ++serial; const list = tables.get(row.constructor); if (!list.includes(row)) list.push(row); return this; },
        async flush() {},
        async transactional(fn) {
            const previous = tail; let release; tail = new Promise(resolve => { release = resolve; });
            await previous;
            const snapshot = [...tables].map(([Type, rows]) => [Type, rows.map(row => [row, structuredClone({ ...row, demande: undefined }), row.demande])]);
            try { return await fn(this); }
            catch (error) {
                for (const [Type, rows] of snapshot) {
                    const table = tables.get(Type); table.splice(0);
                    for (const [row, values, demande] of rows) {
                        for (const key of Object.keys(row)) delete row[key];
                        Object.assign(row, values); if (demande) row.demande = demande;
                        table.push(row);
                    }
                }
                throw error;
            } finally { release(); }
        },
    };
    const members = new Collection(), closedDMs = new Set();
    function member(id, roles = []) {
        const m = { id, displayName: `Membre ${id}`, user: { id, bot: false }, roles: { cache: new Collection(roles.map(r => [r, { id: r }])) }, permissions: new PermissionsBitField(0n), async send(content) { operations.push(['dm', id, content]); },
            async createDM() {
                if (closedDMs.has(id)) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
                return { id: `dm-${id}`, async send(options) { operations.push(['mentor-dm', id, options]); return { id: String(++serial), channelId: `dm-${id}` }; } };
            } };
        members.set(id, m); return m;
    }
    member(ids.parrain, [ids.role]); member(ids.other, [ids.role]); member(ids.staff, [ids.rh]); member(ids.applicant);
    const overwriteApi = (overwrites, channelId) => ({
        cache: overwrites,
        async edit(id, values) {
            const old = overwrites.get(id); let allow = old?.allow.bitfield ?? 0n, deny = old?.deny.bitfield ?? 0n;
            for (const [name, value] of Object.entries(values)) { allow &= ~P[name]; deny &= ~P[name]; if (value === true) allow |= P[name]; if (value === false) deny |= P[name]; }
            overwrites.set(id, { allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
            operations.push(['permissions', id, values, channelId]);
        },
        async delete(id) { overwrites.delete(id); operations.push(['delete-permissions', id, channelId]); },
    });
    const overwrites = new Collection();
    const channel = {
        id: ids.ticket, type: ChannelType.GuildText,
        isThread: () => false,
        permissionOverwrites: overwriteApi(overwrites, ids.ticket),
        async send(options) {
            if (failMessage) throw new Error('Discord unavailable');
            operations.push(['message', options]); return { id: String(++serial), channelId: ids.ticket };
        },
    };
    const mentoraOverwrites = new Collection();
    const mentora = { ...channel, id: ids.mentora, permissionOverwrites: overwriteApi(mentoraOverwrites, ids.mentora),
        async send(options) { operations.push(['mentora-message', options]); return { id: String(++serial), channelId: ids.mentora }; },
        messages: { fetch: async id => {
            if (id !== 'welcome') throw Object.assign(new Error('Unknown Message'), { code: 10008 });
            return { id, async edit(options) { operations.push(['mentora-edit', options]); } };
        } } };
    const rh = { ...channel, id: ids.channelRh, async send(options) { if (failRH) throw new Error('RH indisponible'); operations.push(['rh', options]); } };
    const bot = {
        user: { id: ids.bot }, roleMember: { id: ids.official }, db: { getEm: () => em },
        guild: {
            id: ids.guild, roles: { fetch: async id => id === ids.role ? { id } : null },
            members: { list: async () => members, fetch: async query => { if (!query) return members; const m = members.get(typeof query === 'string' ? query : query.user); if (!m) throw Object.assign(new Error('Unknown member'), { code: 10007 }); return m; } },
            channels: { fetch: async id => id === ids.ticket ? channel : id === ids.channelRh ? rh : id === ids.mentora ? mentora : null },
        },
    };
    const manager = new ParrainageManager(bot);
    function pref(userId = ids.parrain, extras = {}) {
        const p = Object.assign(new Pref(), { id: ++serial, guildId: ids.guild, userId, ...extras }); prefs.push(p); return p;
    }
    function assignment(userId = ids.parrain, d = requests[0], extras = {}) {
        const a = Object.assign(new A(), { id: ++serial, demande: d, parrainId: userId, details: {}, ...extras }); assignments.push(a); return a;
    }
    function interaction(userId = ids.parrain, action = 'home') {
        const replies = [];
        return {
            user: { id: userId }, customId: `parrain_${action}`, guildId: ids.guild, channelId: ids.ticket,
            deferred: true, replied: false,
            isChatInputCommand: () => false, isButton: () => true, isStringSelectMenu: () => false, isModalSubmit: () => false, inGuild: () => true,
            async editReply(options) { replies.push(options); return { id: String(++serial), channelId: ids.ticket }; }, replies,
        };
    }
    return { bot, manager, em, requests, assignments, prefs, contexts, members, closedDMs, channel, mentora, mentoraOverwrites, operations, pref, assignment, interaction, failMessage: value => { failMessage = value; }, failRH: value => { failRH = value; } };
}

test('dates de retour : Paris hiver/été, dates impossibles et passées', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    assert.equal(parseParrainReturn('', now), undefined);
    assert.equal(parseParrainReturn('10/01/2026', now).toISOString(), '2026-01-09T23:00:00.000Z');
    assert.equal(parseParrainReturn('10/07/2026', now).toISOString(), '2026-07-09T22:00:00.000Z');
    assert.throws(() => parseParrainReturn('31/02/2026', now));
    assert.throws(() => parseParrainReturn('2026-07-10', now));
    assert.throws(() => parseParrainReturn('01/01/2025', now));
    assert.equal(parrainAvailability(true, 2, 2), 'En pause');
    assert.equal(parrainAvailability(false, 2, 2), 'Complet');
    assert.equal(parrainCapacity(undefined), 2);
});

test('attribution : historique, accès ticket et absence de modification XP/rôles', async () => {
    const f = fixture();
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    assert.equal(f.assignments.length, 1);
    assert.equal(f.assignments[0].parrainId, ids.parrain);
    assert.equal(f.requests[0].status, 'candidate');
    assert.equal(f.channel.permissionOverwrites.cache.get(ids.parrain).allow.has(P.ViewChannel), true);
    assert.equal(f.operations.filter(([kind]) => kind === 'message').length, 1);
    assert.equal(f.requests[0].mentorship.needsSync, false);
});

test('remplacement restaure les permissions et conserve les avis précédents', async () => {
    const f = fixture();
    await f.channel.permissionOverwrites.edit(ids.parrain, { SendMessages: false, AttachFiles: true });
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const first = f.assignments[0];
    first.details.reviews = [{ avis: 'favorable', comment: 'Esprit collectif', at: new Date().toISOString(), actorId: ids.parrain }];
    await f.manager.assign(1, ids.other, ids.staff, first.id, 'Indisponibilité');
    assert.ok(first.endedAt);
    assert.equal(first.details.reviews[0].comment, 'Esprit collectif');
    const restored = f.channel.permissionOverwrites.cache.get(ids.parrain);
    assert.ok(restored.deny.has(P.SendMessages));
    assert.ok(restored.allow.has(P.AttachFiles));
    assert.equal(restored.allow.has(P.ViewChannel), false);
    assert.ok(f.channel.permissionOverwrites.cache.get(ids.other).allow.has(P.ViewChannel));
});

test('échec Discord : intention et permissions antérieures durables, reprise sans nouvel accompagnement', async () => {
    const f = fixture(); f.failMessage(true);
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 0), /Discord unavailable/);
    assert.equal(f.assignments.length, 1);
    assert.equal(f.assignments[0].details.access.permissions.ViewChannel, null);
    assert.equal(f.requests[0].mentorship.needsSync, true);
    f.failMessage(false); await f.manager.sync(1);
    assert.equal(f.assignments.length, 1);
    assert.equal(f.requests[0].mentorship.needsSync, false);
    await f.manager.finish(1, ids.staff, 'Remplacement à organiser', false, f.assignments[0].id);
    assert.equal(f.channel.permissionOverwrites.cache.has(ids.parrain), false);
});

test('attributions simultanées : une seule prend la dernière place', async () => {
    const f = fixture(); f.pref(ids.parrain, { capacity: 1 });
    f.requests.push(Object.assign(new D(), { id: 2, guildId: ids.guild, applicantId: ids.other, status: 'candidate', channelId: ids.ticket }));
    const results = await Promise.allSettled([f.manager.assign(1, ids.parrain, ids.staff, 0), f.manager.assign(2, ids.parrain, ids.staff, 0)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(f.assignments.filter(a => !a.endedAt).length, 1);
});

test('auto-parrainage, pause, rôle absent, non-RH et ancienne attribution sont refusés', async () => {
    const f = fixture(); const p = f.pref(ids.parrain, { paused: true });
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 0), /disponible/);
    p.paused = false;
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.other, 0), /RH/);
    await assert.rejects(f.manager.assign(1, ids.applicant, ids.staff, 0), /Parrain/);
    f.members.get(ids.applicant).roles.cache.set(ids.role, { id: ids.role });
    await assert.rejects(f.manager.assign(1, ids.applicant, ids.staff, 0), /Auto-parrainage/);
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 99), /changé/);
    assert.equal(f.assignments.length, 0);
});

test('pause et réduction de capacité conservent les accompagnements', async () => {
    const f = fixture(); f.assignment(); f.pref();
    await f.manager.changePreference(ids.parrain, ids.parrain, p => { p.capacity = 1; p.paused = true; }, 'Pause');
    assert.equal(f.assignments[0].endedAt, undefined);
    assert.equal(f.prefs[0].history.length, 1);
    assert.equal(f.prefs[0].paused, true);
});

test('bilan confidentiel et ancien parrain refusé après remplacement', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const first = f.assignments[0];
    await f.manager.reviewOrRelay(first.id, ids.parrain, 'Commentaire confidentiel', 'favorable');
    assert.ok(f.assignments[0].details.reviews.length);
    assert.equal(f.operations.some(([kind, payload]) => kind === 'message' && payload.content.includes('Commentaire confidentiel')), false);
    await f.manager.assign(1, ids.other, ids.staff, first.id);
    await assert.rejects(f.manager.reviewOrRelay(first.id, ids.parrain, 'Ancien formulaire', 'defavorable'));
    await assert.rejects(f.manager.reviewOrRelay(f.assignments[1].id, ids.staff, 'Avis RH', 'favorable'), /Seul le parrain/);
});

test('demande de relais : pause, notification RH unique et attribution conservée', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.reviewOrRelay(f.assignments[0].id, ids.parrain, 'Absence prolongée');
    await f.manager.sync(1);
    assert.equal(f.prefs[0].paused, true);
    assert.equal(f.assignments[0].endedAt, undefined);
    assert.equal(f.operations.filter(([kind, payload]) => kind === 'rh' && payload.content.includes('Relais demandé')).length, 1);
});

test('rôle Membre : clôture automatique et place libérée', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    f.members.get(ids.applicant).roles.cache.set(ids.official, { id: ids.official });
    await f.manager.check();
    assert.ok(f.assignments[0].endedAt);
    assert.ok(f.requests[0].mentorship.closedAt);
    assert.equal(f.requests[0].mentorship.closedReason, 'Passage membre officiel');
});

test('perte du rôle Parrain : attente et alerte RH, pas de réattribution automatique', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    f.members.get(ids.parrain).roles.cache.delete(ids.role);
    await f.manager.check();
    assert.ok(f.assignments[0].endedAt);
    assert.ok(f.requests[0].mentorship.waitingSince);
    assert.equal(f.requests[0].mentorship.closedAt, undefined);
    assert.ok(f.operations.some(([kind, payload]) => kind === 'rh' && payload.content.includes('nouveau parrain')));
});

test('départ du candidat clôture le suivi', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    f.members.delete(ids.applicant); await f.manager.check();
    assert.equal(f.requests[0].mentorship.closedReason, 'Départ du candidat');
});

test('attente : initialise les dossiers existants et relance une seule fois après 48 h', async () => {
    const f = fixture(); await f.manager.check();
    assert.ok(f.requests[0].mentorship.waitingSince);
    assert.equal(f.operations.filter(([kind]) => kind === 'rh').length, 0);
    f.requests[0].mentorship.waitingSince = new Date(Date.now() - 49 * 3600000).toISOString();
    await f.manager.check(); await f.manager.check();
    assert.equal(f.operations.filter(([kind]) => kind === 'rh').length, 1);
});

test('attente : le rappel suit la durée configurée en jours et l’affiche', async () => {
    const f = fixture(); config['bot.recrutement.mentor_wait_days'] = 3; await f.manager.check();
    const rh = () => f.operations.filter(([kind]) => kind === 'rh');
    f.requests[0].mentorship.waitingSince = new Date(Date.now() - 49 * 3600000).toISOString();
    await f.manager.check(); assert.equal(rh().length, 0);
    f.requests[0].mentorship.waitingSince = new Date(Date.now() - 73 * 3600000).toISOString();
    await f.manager.check(); assert.equal(rh().length, 1);
    assert.match(rh()[0][1].content, /depuis plus de 3 jours\./);
});

test('attente : une durée invalide retombe sur 2 jours (48 h)', async () => {
    for (const bad of [0, -1, 'abc', null]) {
        const f = fixture(); config['bot.recrutement.mentor_wait_days'] = bad; await f.manager.check();
        f.requests[0].mentorship.waitingSince = new Date(Date.now() - 47 * 3600000).toISOString();
        await f.manager.check(); assert.equal(f.operations.filter(([kind]) => kind === 'rh').length, 0, String(bad));
        f.requests[0].mentorship.waitingSince = new Date(Date.now() - 49 * 3600000).toISOString();
        await f.manager.check();
        const rh = f.operations.filter(([kind]) => kind === 'rh');
        assert.equal(rh.length, 1, String(bad)); assert.match(rh[0][1].content, /depuis plus de 2 jours\./);
    }
});

test('retour prévu : un rappel, jamais de reprise automatique', async () => {
    const f = fixture(); const p = f.pref(ids.parrain, { paused: true, returnAt: new Date(Date.now() - 10000) });
    await f.manager.check(); await f.manager.check();
    assert.ok(p.remindedAt); assert.equal(p.paused, true);
    assert.equal(f.operations.filter(([kind]) => kind === 'dm').length, 1);
});

test('panneau usurpé ou rôle retiré : aucune donnée personnelle renvoyée', async () => {
    const f = fixture();
    const i = f.interaction(ids.other);
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain });
    assert.match(i.replies[0].content, /ne vous appartient pas/);
    f.members.get(ids.parrain).roles.cache.delete(ids.role);
    const lost = f.interaction(); await f.manager.handler(lost, { guildId: ids.guild, actorId: ids.parrain });
    assert.match(lost.replies[0].content, /Parrain est requis/);
});

test('navigation : listes paginées, sélection multiple et boutons limités à cinq par ligne', async () => {
    const f = fixture();
    for (let n = 20; n < 50; n++) f.members.set(String(n), { id: String(n), displayName: `Parrain ${n}`, user: { bot: false }, roles: { cache: new Collection([[ids.role, { id: ids.role }]]) } });
    const i = f.interaction(ids.staff);
    await f.manager.listing(i, 'choose', { demandeId: 1, expectedId: 0 }, 0);
    assert.equal(i.replies[0].components[0].components[0].options.length, 25);
    const view = new View(f.bot, {}, [...Array.from({ length: 7 }, (_, n) => parrainButton(String(n), String(n))), parrainSelect('multi', [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }], 2)]);
    assert.deepEqual(view.rows.map(r => r.components.length), [1, 5, 2]);
    assert.equal(view.rows[0].components[0].data.max_values, 2);
    assert.ok(RecruitmentView.staff(f.bot, f.requests[0]).rows.flatMap(r => r.components).some(c => c.data.custom_id === 'parrain_staff'));
});

test('MP fermés : le parrain conserve un bouton pour poursuivre sur le serveur', async () => {
    const f = fixture(); const i = f.interaction(ids.parrain, 'dm');
    i.user.createDM = async () => { throw Object.assign(new Error('MP fermés'), { code: 50007 }); };
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain });
    assert.match(i.replies[0].content, /continuer ici/);
    assert.equal(i.replies[0].components[0].components[0].data.custom_id, 'parrain_home');
});

test('panneau MP : même profil, sans réponse éphémère, et rôles vérifiés', async () => {
    const f = fixture(); const i = f.interaction(); i.guildId = null; i.inGuild = () => false;
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain });
    assert.match(i.replies[0].content, /Espace parrain/);
    assert.equal(i.replies[0].flags, undefined);
    assert.ok(f.contexts.every(c => c.data.actorId === ids.parrain && c.data.guildId === ids.guild));
});

test('formulaire pause : contexte persistant et aucune réponse différée avant showModal', async () => {
    const f = fixture(); const i = f.interaction(ids.parrain, 'pause');
    i.deferred = false; i.message = { id: 'private-panel' };
    i.deferReply = async () => { throw new Error('Ne pas différer un formulaire'); };
    i.showModal = async modal => { i.modal = modal; };
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, userId: ids.parrain });
    assert.equal(i.modal.data.custom_id, 'parrain_save_pause');
    assert.ok(f.contexts.some(c => c.customId === 'parrain_save_pause' && c.messageId === 'private-panel' && c.data.actorId === ids.parrain));
});

test('relais multiples : un formulaire lié à tous les candidats sélectionnés', async () => {
    const f = fixture();
    const a = f.assignment();
    const d = Object.assign(new D(), { id: 2, guildId: ids.guild, applicantId: ids.other, status: 'candidate', channelId: ids.ticket });
    f.requests.push(d); const b = f.assignment(ids.parrain, d);
    const i = f.interaction(ids.parrain, 'selection');
    i.deferred = false; i.message = { id: 'relay-panel' }; i.isButton = () => false; i.isStringSelectMenu = () => true;
    i.values = [String(a.id), String(b.id)]; i.showModal = async modal => { i.modal = modal; };
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, mode: 'relay_list' });
    assert.equal(i.modal.data.custom_id, 'parrain_save_relays');
    const ctx = f.contexts.find(c => c.customId === 'parrain_save_relays');
    assert.deepEqual(ctx.data.attributionIds, [a.id, b.id]);
    const submit = f.interaction(ids.parrain, 'save_relays');
    submit.isButton = () => false; submit.isModalSubmit = () => true; submit.fields = { getTextInputValue: () => 'Absence' };
    await f.manager.handler(submit, ctx.data);
    assert.ok(a.details.relay && b.details.relay);
    assert.equal(f.prefs[0].paused, true);
    assert.ok(!a.endedAt && !b.endedAt);
});

test('nouvelle instance après échec : reprise du suivi persisté', async () => {
    const f = fixture(); f.failMessage(true);
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 0));
    f.failMessage(false);
    await new ParrainageManager(f.bot).check();
    assert.equal(f.assignments.length, 1);
    assert.equal(f.requests[0].mentorship.needsSync, false);
    assert.equal(f.assignments[0].details.announced, true);
});

test('rôle officiel présent avant le contrôle : pas de nouvelle attribution', async () => {
    const f = fixture(); f.members.get(ids.applicant).roles.cache.set(ids.official, { id: ids.official });
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 0), /déjà membre officiel/);
    assert.equal(f.assignments.length, 0);
});

test('avis favorable : formulaire puis sauvegarde sans récupération Gateway globale', async () => {
    const f = fixture();
    const fetchMember = f.bot.guild.members.fetch;
    f.bot.guild.members.fetch = async query => {
        assert.ok(query, 'Ne pas demander tous les membres par la Gateway');
        return fetchMember(query);
    };
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const a = f.assignments[0];
    const i = f.interaction(ids.parrain, 'review');
    i.deferred = false; i.message = { id: 'review-panel' };
    i.isButton = () => false; i.isStringSelectMenu = () => true; i.values = ['favorable'];
    i.showModal = async modal => { i.modal = modal; };
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, attributionId: a.id });
    assert.equal(i.modal.data.custom_id, 'parrain_save_review');
    const context = f.contexts.find(c => c.customId === 'parrain_save_review');
    const submit = f.interaction(ids.parrain, 'save_review');
    submit.isButton = () => false; submit.isModalSubmit = () => true;
    submit.fields = { getTextInputValue: () => 'Bonne intégration au corps' };
    await f.manager.handler(submit, context.data);
    assert.equal(a.details.reviews.at(-1).avis, 'favorable');
    assert.equal(a.details.reviews.at(-1).comment, 'Bonne intégration au corps');
    assert.match(submit.replies.at(-1).content, /Favorable/);
    await f.manager.listing(f.interaction(ids.staff), 'choose', { demandeId: 1, expectedId: a.id });
});

const DAY = 86400_000;
const periodNotices = f => f.operations.filter(([kind, payload]) => kind === 'rh' && /Période Candidat de \d+ jours? terminée/.test(payload.content));
const mentorDMs = f => f.operations.filter(([kind]) => kind === 'mentor-dm');
const reviewNotices = f => f.operations.filter(([kind, payload]) => kind === 'rh' && /Bilan (déposé|mis à jour)/.test(payload.content));

test('période : 30 jours par défaut, frontière exacte depuis candidateAt et aucune date inventée', () => {
    const now = Date.now(), delay = 30 * DAY;
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(now - delay + 1) }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(now - delay) }, now), true);
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(now - 14 * DAY) }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'candidate' }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'postulant', candidateAt: new Date(0) }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(0), mentorship: { closedAt: 'closed' } }, now), false);
});

test('période : durée paramétrable, prolongations cumulées et « le mois repart »', () => {
    const now = Date.now(), candidateAt = new Date(now - 20 * DAY), base = { status: 'candidate', candidateAt };
    assert.equal(candidatePeriodEnded(base, now, 20), true);
    assert.equal(candidatePeriodEnded(base, now, 21), false);
    assert.equal(candidatePeriodEnd(base, 30).getTime(), candidateAt.getTime() + 30 * DAY);
    const extended = { ...base, mentorship: { periodExtraDays: 14 + 7 } };
    assert.equal(candidatePeriodEnd(extended, 30).getTime(), candidateAt.getTime() + 51 * DAY);
    const restarted = { ...base, mentorship: { periodStartAt: new Date(now - 5 * DAY).toISOString(), periodExtraDays: 14 } };
    assert.equal(candidatePeriodEnd(restarted, 30).getTime(), now - 5 * DAY + 44 * DAY);
    assert.equal(candidatePeriodEnded(restarted, now, 1), false);
    assert.equal(candidatePeriodEnd({ mentorship: { periodStartAt: 'illisible' } }, 30), null);
    assert.equal(candidatePeriodEnd({}, 30), null);
});

test('relance due : première fois, après l’intervalle, jamais avant, et pas sur une relance antérieure à la période', () => {
    const now = Date.now(), end = new Date(now - 10 * DAY);
    assert.equal(reminderDue(undefined, end, now, 3), true);
    assert.equal(reminderDue(new Date(now - 3 * DAY + 1).toISOString(), end, now, 3), false);
    assert.equal(reminderDue(new Date(now - 3 * DAY).toISOString(), end, now, 3), true);
    assert.equal(reminderDue(new Date(now - 11 * DAY).toISOString(), end, now, 30), true);
});

test('paramètres de période : lus depuis les réglages, défaut si invalides', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 15 * DAY);
    config['bot.recrutement.candidate_period_days'] = 10; await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
    assert.match(periodNotices(f)[0][1].content, /10 jours/);
    for (const bad of [0, -3, 'abc']) {
        const g = fixture(); g.requests[0].candidateAt = new Date(Date.now() - 15 * DAY);
        config['bot.recrutement.candidate_period_days'] = bad; await g.manager.check();
        assert.equal(periodNotices(g).length, 0, `valeur ${bad} : défaut de 30 jours`);
    }
});

test('échéance : le mentor reçoit un MP avec bouton et les RH sont prévenus avec son absence d’avis', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
    assert.match(periodNotices(f)[0][1].content, new RegExp(`<@${ids.parrain}> n’a pas encore donné sa décision`));
    assert.equal(mentorDMs(f).length, 1);
    const [, mentorId, options] = mentorDMs(f)[0];
    assert.equal(mentorId, ids.parrain);
    assert.equal(options.components[0].components[0].data.custom_id, 'parrain_candidate');
    assert.ok(f.requests[0].mentorship.mentorRemindedAt);
});

test('relances répétées tous les 3 jours (paramètre), pas avant', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 45 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.check(); await f.manager.check();
    assert.equal(periodNotices(f).length, 1); assert.equal(mentorDMs(f).length, 1);
    const back = days => { const m = f.requests[0].mentorship; for (const key of ['periodRemindedAt', 'mentorRemindedAt']) m[key] = new Date(Date.parse(m[key]) - days * DAY).toISOString(); };
    back(2); await f.manager.check();
    assert.equal(periodNotices(f).length, 1); assert.equal(mentorDMs(f).length, 1);
    back(1); await f.manager.check();
    assert.equal(periodNotices(f).length, 2); assert.equal(mentorDMs(f).length, 2);
    config['bot.recrutement.mentor_reminder_days'] = 5; back(3); await f.manager.check();
    assert.equal(periodNotices(f).length, 2, 'intervalle de 5 jours');
    back(2); await f.manager.check();
    assert.equal(periodNotices(f).length, 3); assert.equal(mentorDMs(f).length, 3);
});

test('après le bilan du mentor : plus de MP, les RH reçoivent son avis', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.reviewOrRelay(f.assignments[0].id, ids.parrain, 'Très bien intégré', 'favorable');
    await f.manager.check();
    assert.equal(mentorDMs(f).length, 0);
    assert.match(periodNotices(f)[0][1].content, /Avis du mentor : \*\*Favorable\*\* — Très bien intégré/);
});

test('un avis déposé avant l’échéance ne compte pas comme décision', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    f.assignments[0].details.reviews = [{ avis: 'favorable', comment: 'Tôt', actorId: ids.parrain, at: new Date(Date.now() - 40 * DAY).toISOString(), notified: true }];
    await f.manager.check();
    assert.equal(mentorDMs(f).length, 1);
});

test('prolongation : plus de relance tant que la nouvelle échéance n’est pas atteinte', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.check();
    f.requests[0].mentorship = { ...f.requests[0].mentorship, periodExtraDays: 14 };
    for (const key of ['periodRemindedAt', 'mentorRemindedAt']) f.requests[0].mentorship[key] = new Date(Date.now() - 10 * DAY).toISOString();
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1); assert.equal(mentorDMs(f).length, 1);
});

test('échéance sans parrain, reprise si la notification RH échoue', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    f.failRH(true); await f.manager.check();
    assert.equal(f.requests[0].mentorship?.periodRemindedAt, undefined);
    f.failRH(false); await f.manager.check(); await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
    assert.match(periodNotices(f)[0][1].content, /Aucun mentor n’est affecté/);
    assert.equal(mentorDMs(f).length, 0);
});

test('MP du mentor fermés : repli dans le canal RH, puis nouvel essai de MP à l’intervalle', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    f.closedDMs.add(ids.parrain);
    await f.manager.check();
    assert.equal(mentorDMs(f).length, 0);
    const fallbacks = f.operations.filter(([kind, payload]) => kind === 'rh' && payload.content.includes('messages privés fermés'));
    assert.equal(fallbacks.length, 1);
    assert.equal(periodNotices(f).length, 1);
});

test('mentorship conserve ses clés de période après assign() et finish()', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date();
    const extra = { periodStartAt: new Date().toISOString(), periodExtraDays: 14, mentorRemindedAt: 'x', periodRemindedAt: 'y' };
    f.requests[0].mentorship = { ...extra };
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.reviewOrRelay(f.assignments[0].id, ids.parrain, 'Bilan', 'favorable');
    await f.manager.assign(1, ids.other, ids.staff, f.assignments[0].id);
    await f.manager.finish(1, ids.staff, 'Retrait', false, f.assignments[1].id);
    await f.manager.finish(1, ids.staff, 'Clôture', true);
    for (const [key, value] of Object.entries(extra)) assert.equal(f.requests[0].mentorship[key], value, key);
});

test('le mentor ne se voit proposer que favorable et défavorable', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const i = f.interaction(ids.parrain, 'candidate');
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, attributionId: f.assignments[0].id, userId: ids.parrain });
    const select = i.replies.at(-1).components.flatMap(row => row.components).find(c => c.data.custom_id === 'parrain_review');
    assert.deepEqual(select.options.map(o => o.data.value), ['favorable', 'defavorable']);
});

test('aucun rappel de période pour un citoyen ou un dossier clôturé', async () => {
    for (const closed of [true, false]) {
        const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 40 * DAY);
        if (closed) f.requests[0].mentorship = { closedAt: new Date().toISOString() };
        else f.members.get(ids.applicant).roles.cache.set(ids.official, { id: ids.official });
        await f.manager.check(); assert.equal(periodNotices(f).length, 0);
    }
});

test('bilan déposé puis modifié : une notification RH par version, jamais dans le ticket', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const a = f.assignments[0];
    await f.manager.reviewOrRelay(a.id, ids.parrain, 'Premier bilan confidentiel', 'prolonger');
    await f.manager.reviewOrRelay(a.id, ids.parrain, 'Bilan modifié confidentiel', 'favorable');
    await new ParrainageManager(f.bot).check(); await f.manager.sync(1);
    const notices = reviewNotices(f);
    assert.equal(notices.length, 2);
    assert.match(notices[0][1].content, /Bilan déposé/);
    assert.match(notices[1][1].content, /Bilan mis à jour/);
    assert.deepEqual(notices[1][1].allowedMentions.roles, [ids.rh]);
    assert.equal(f.operations.some(([kind, payload]) => kind === 'message' && payload.content.includes('confidentiel')), false);
    assert.ok(a.details.reviews.every(r => r.notified));
});

test('notification de bilan échouée : bilan conservé et renvoi au prochain contrôle', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const a = f.assignments[0]; f.failRH(true);
    await assert.rejects(f.manager.reviewOrRelay(a.id, ids.parrain, 'À notifier', 'favorable'), /RH indisponible/);
    assert.equal(a.details.reviews.length, 1); assert.equal(a.details.reviews[0].notified, false);
    f.failRH(false); await new ParrainageManager(f.bot).check(); await f.manager.check();
    assert.equal(reviewNotices(f).length, 1);
    assert.equal(a.details.reviews[0].notified, true);
});

test('les anciens bilans ne déclenchent pas de notifications rétroactives', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const a = f.assignments[0];
    a.details.reviews = [{ avis: 'favorable', comment: 'Historique', actorId: ids.parrain, at: new Date().toISOString() }];
    await f.manager.sync(1); assert.equal(reviewNotices(f).length, 0);
    await f.manager.reviewOrRelay(a.id, ids.parrain, 'Actualisation', 'favorable');
    assert.match(reviewNotices(f)[0][1].content, /Bilan mis à jour/);
});

test('navigation dans un panneau privé : deferUpdate et édition du même message', async () => {
    for (const dm of [false, true]) {
        const f = fixture(); const i = f.interaction(); i.deferred = false;
        i.guildId = dm ? null : ids.guild; i.inGuild = () => !dm;
        i.message = { id: 'same-panel', flags: { has: () => !dm } };
        let updates = 0;
        i.deferUpdate = async () => { updates++; i.deferred = true; };
        i.deferReply = async () => assert.fail('Pas de nouveau message privé');
        i.editReply = async options => { i.replies.push(options); return { id: 'same-panel', channelId: ids.ticket }; };
        await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, privatePanel: true });
        assert.equal(updates, 1);
        assert.match(i.replies[0].content, /Espace parrain/);
        assert.ok(f.contexts.every(c => c.messageId === 'same-panel' && c.data.privatePanel));
    }
});

test('fiche RH publique : réponse privée, aucune édition de la fiche partagée', async () => {
    const f = fixture(); const i = f.interaction(ids.staff, 'staff'); i.deferred = false;
    i.message = { id: 'public-card', flags: { has: () => false } };
    let replies = 0;
    i.deferUpdate = async () => assert.fail('Ne pas éditer la fiche publique');
    i.deferReply = async options => { replies++; assert.ok(options.flags); i.deferred = true; };
    await f.manager.handler(i, { guildId: ids.guild, demandeId: 1 });
    assert.equal(replies, 1); assert.match(i.replies[0].content, /Parrainage/);
});

test('soumission de bilan depuis un panneau privé : même message après formulaire', async () => {
    const f = fixture(); await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const i = f.interaction(ids.parrain, 'save_review'); i.deferred = false;
    i.isButton = () => false; i.isModalSubmit = () => true; i.isFromMessage = () => true;
    i.message = { id: 'same-panel', flags: { has: () => true } };
    let updates = 0;
    i.deferUpdate = async () => { updates++; i.deferred = true; };
    i.fields = { getTextInputValue: () => 'Bilan depuis le formulaire privé' };
    await f.manager.handler(i, { guildId: ids.guild, actorId: ids.parrain, privatePanel: true, attributionId: f.assignments[0].id, avis: 'favorable' });
    assert.equal(updates, 1); assert.match(i.replies.at(-1).content, /Favorable/);
    assert.ok(i.replies.at(-1).components.flatMap(row => row.components).some(c => c.data.custom_id === 'parrain_mine'));
});

test('/parrain ouvre directement le panneau complet en MP', async () => {
    const f = fixture(); const i = f.interaction(); i.isChatInputCommand = () => true;
    const sent = [];
    i.user.createDM = async () => ({ id: 'dm-channel', async send(options) { sent.push(options); return { id: 'dm-panel', channelId: 'dm-channel' }; } });
    await f.manager.getSlashHandlers().parrain(i);
    assert.equal(sent.length, 1); assert.match(sent[0].content, /Espace parrain/);
    assert.ok(sent[0].components.flatMap(row => row.components).some(c => c.data.custom_id === 'parrain_mine'));
    assert.match(i.replies[0].content, /envoyé en MP/);
    assert.ok(f.contexts.some(c => c.messageId === 'dm-panel' && c.data.privatePanel));
});

function awaitingFixture() {
    const f = fixture();
    Object.assign(f.requests[0], { status: 'awaiting_mentor', mentorship: { cleInconnue: 'conservee', mentoraChannelId: ids.mentora, mentoraMessageId: 'welcome', waitingSince: new Date().toISOString() } });
    f.mentoraOverwrites.set(ids.role, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField(0n) });
    f.resumed = [];
    f.bot.recrutementManager = { async resume(id) {
        f.resumed.push(id);
        const d = f.requests[0];
        if (d.pendingStatus) { d.status = d.pendingStatus; d.pendingStatus = undefined; d.candidateAt = new Date(); }
    } };
    return f;
}
const mentoraMessages = f => f.operations.filter(([kind]) => kind === 'mentora-message');

test('affectation RH depuis awaiting_mentor : candidate, décision, reprise des rôles et clés conservées', async () => {
    const f = awaitingFixture();
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    const d = f.requests[0];
    assert.equal(d.status, 'candidate');
    assert.deepEqual(f.resumed, [1]);
    assert.equal(f.assignments.length, 1);
    const decision = d.decisions.at(-1);
    assert.deepEqual({ from: decision.from, to: decision.to, actorId: decision.actorId, reason: decision.reason }, { from: 'awaiting_mentor', to: 'candidate', actorId: ids.staff, reason: 'Mentor affecté' });
    assert.equal(d.mentorship.cleInconnue, 'conservee');
    assert.equal(d.mentorship.mentoraChannelId, ids.mentora);
    assert.equal(d.mentorship.needsSync, false);
});

test('ticket Mentora après engagement : rôle Parrain retiré, mentor seul autorisé, annonce unique', async () => {
    const f = awaitingFixture();
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    assert.equal(f.mentoraOverwrites.has(ids.role), false);
    assert.equal(f.mentoraOverwrites.get(ids.parrain).allow.has(P.ViewChannel), true);
    assert.equal(f.mentoraOverwrites.get(ids.parrain).allow.has(P.SendMessages), true);
    assert.equal(f.mentoraOverwrites.get(ids.parrain).allow.has(P.ReadMessageHistory), true);
    assert.equal(mentoraMessages(f).length, 1);
    assert.match(mentoraMessages(f)[0][1].content, new RegExp(`<@${ids.parrain}>`));
    assert.deepEqual(mentoraMessages(f)[0][1].allowedMentions, { users: [ids.parrain], parse: [] });
    await f.manager.sync(1);
    assert.equal(mentoraMessages(f).length, 1);
});

test('ticket Mentora : le remplacement du mentor retire l’ancien et autorise le nouveau', async () => {
    const f = awaitingFixture();
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.assign(1, ids.other, ids.staff, f.assignments[0].id, 'Indisponibilité');
    assert.equal(f.mentoraOverwrites.has(ids.parrain), false);
    assert.equal(f.mentoraOverwrites.get(ids.other).allow.has(P.ViewChannel), true);
    assert.equal(mentoraMessages(f).length, 2);
    assert.equal(f.requests[0].status, 'candidate');
    assert.deepEqual(f.resumed, [1]);
});

test('affectation refusée hors candidate / awaiting_mentor', async () => {
    const f = awaitingFixture();
    f.requests[0].status = 'postulant';
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.staff, 0), /ne permet plus/);
    assert.equal(f.assignments.length, 0);
});

test('panneau RH awaiting_mentor : texte exact, retrait et clôture désactivés', async () => {
    const f = awaitingFixture();
    const i = f.interaction(ids.staff);
    await f.manager.staffPanel(i, 1, true);
    assert.match(i.replies[0].content, /^Entretien validé : choisissez un parrain pour ouvrir la période de candidat\./);
    const buttons = i.replies[0].components.flatMap(row => row.components).map(c => c.data);
    assert.equal(buttons.find(b => b.custom_id === 'parrain_close').disabled, true);
    assert.ok(!buttons.find(b => b.custom_id === 'parrain_choose').disabled);
    assert.ok(!buttons.some(b => b.custom_id === 'parrain_remove' && !b.disabled));
    await assert.rejects(f.manager.finish(1, ids.staff, 'Test', true), /attend un mentor/);
});

test('rappel RH d’attente de mentor : après mentorWaitDays, une seule fois, sans période de 14 jours', async () => {
    const f = awaitingFixture(); config['bot.recrutement.mentor_wait_days'] = 3;
    const rh = () => f.operations.filter(([kind]) => kind === 'rh');
    f.requests[0].mentorship.waitingSince = new Date(Date.now() - 49 * 3600000).toISOString();
    await f.manager.check(); assert.equal(rh().length, 0);
    f.requests[0].mentorship.waitingSince = new Date(Date.now() - 73 * 3600000).toISOString();
    await f.manager.check(); await f.manager.check();
    assert.equal(rh().length, 1);
    assert.match(rh()[0][1].content, /attend un mentor depuis plus de 3 jours/);
    assert.equal(periodNotices(f).length, 0);
    assert.equal(f.requests[0].status, 'awaiting_mentor');
    assert.equal(f.requests[0].mentorship.cleInconnue, 'conservee');
});

test('assign() conserve les clés inconnues de mentorship', async () => {
    const f = fixture();
    f.requests[0].mentorship = { cleInconnue: 'conservee', interviewRemindedAt: '2026-10-02T00:00:00.000Z', periodRemindedAt: '2026-10-03T00:00:00.000Z' };
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    assert.equal(f.requests[0].mentorship.cleInconnue, 'conservee');
    assert.equal(f.requests[0].mentorship.interviewRemindedAt, '2026-10-02T00:00:00.000Z');
    assert.equal(f.requests[0].mentorship.periodRemindedAt, '2026-10-03T00:00:00.000Z');
});

test('finish() conserve les clés inconnues de mentorship (retrait du parrain puis clôture)', async () => {
    const f = fixture();
    f.requests[0].mentorship = { cleInconnue: 'conservee', interviewRemindedAt: '2026-10-02T00:00:00.000Z', periodRemindedAt: '2026-10-03T00:00:00.000Z' };
    const a = f.assignment();
    await f.manager.finish(1, ids.staff, 'Retrait', false, a.id);
    assert.equal(f.requests[0].mentorship.cleInconnue, 'conservee');
    assert.equal(f.requests[0].mentorship.interviewRemindedAt, '2026-10-02T00:00:00.000Z');
    assert.equal(f.requests[0].mentorship.periodRemindedAt, '2026-10-03T00:00:00.000Z');
    assert.ok(f.requests[0].mentorship.waitingSince);
    await f.manager.closeForRequest(1, ids.staff, 'Fin');
    assert.equal(f.requests[0].mentorship.cleInconnue, 'conservee');
    assert.equal(f.requests[0].mentorship.interviewRemindedAt, '2026-10-02T00:00:00.000Z');
    assert.ok(f.requests[0].mentorship.closedAt);
});

// --- Bouton « Je m'affecte » du ticket Mentora ---
async function selfClick(f, userId = ids.parrain) {
    const i = f.interaction(userId, 'self_assign');
    i.channelId = ids.mentora;
    await f.manager.handler(i, { guildId: ids.guild, demandeId: 1 });
    return i;
}
const mentoraEdits = f => f.operations.filter(([kind]) => kind === 'mentora-edit');

test('Je m’affecte : mentor valide → candidate, RH prévenus, bouton désactivé, mentor indiqué, accès réservé', async () => {
    const f = awaitingFixture();
    const i = await selfClick(f);
    const d = f.requests[0];
    assert.equal(d.status, 'candidate');
    assert.equal(f.assignments.length, 1);
    assert.equal(f.assignments[0].parrainId, ids.parrain);
    assert.equal(d.decisions.at(-1).actorId, ids.parrain);
    assert.deepEqual(f.resumed, [1]);
    assert.match(i.replies.at(-1).content, /engagé comme mentor/);
    assert.equal(f.mentoraOverwrites.has(ids.role), false);
    assert.equal(f.mentoraOverwrites.get(ids.parrain).allow.has(P.ViewChannel), true);
    assert.equal(mentoraEdits(f).length, 1);
    const edit = mentoraEdits(f)[0][1];
    assert.equal(edit.components[0].components[0].data.disabled, true);
    assert.match(edit.embeds[0].data.description, new RegExp(`Mentor engagé : <@${ids.parrain}>`));
    const rh = f.operations.filter(([kind]) => kind === 'rh');
    assert.equal(rh.length, 1);
    assert.match(rh[0][1].content, new RegExp(`<@${ids.parrain}> s’est affecté comme mentor de <@${ids.applicant}>`));
});

test('Je m’affecte : membre sans le rôle Parrain refusé', async () => {
    const f = awaitingFixture();
    const i = await selfClick(f, ids.staff);
    assert.equal(f.requests[0].status, 'awaiting_mentor');
    assert.equal(f.assignments.length, 0);
    assert.match(i.replies.at(-1).content, /Parrain/);
});

test('Je m’affecte : mentor en pause refusé', async () => {
    const f = awaitingFixture();
    f.pref(ids.parrain, { paused: true, capacity: 2 });
    const i = await selfClick(f);
    assert.equal(f.assignments.length, 0);
    assert.equal(f.requests[0].status, 'awaiting_mentor');
    assert.match(i.replies.at(-1).content, /pause/);
});

test('Je m’affecte : mentor à pleine capacité refusé', async () => {
    const f = awaitingFixture();
    f.pref(ids.parrain, { capacity: 1 });
    f.requests.push(Object.assign(new D(), { id: 2, guildId: ids.guild, applicantId: '100000000000000099', status: 'candidate' }));
    f.assignment(ids.parrain, f.requests[1]);
    const i = await selfClick(f);
    assert.equal(f.assignments.length, 1);
    assert.equal(f.requests[0].status, 'awaiting_mentor');
    assert.match(i.replies.at(-1).content, /capacité/);
});

test('Je m’affecte : dossier plus en awaiting_mentor refusé', async () => {
    const f = awaitingFixture();
    f.requests[0].status = 'candidate';
    const i = await selfClick(f);
    assert.equal(f.assignments.length, 0);
    assert.match(i.replies.at(-1).content, /n’attend plus de mentor/);
});

test('Je m’affecte : deux mentors simultanés, un seul gagne et l’autre est refusé proprement', async () => {
    const f = awaitingFixture();
    const [a, b] = await Promise.all([selfClick(f, ids.parrain), selfClick(f, ids.other)]);
    assert.equal(f.assignments.filter(x => !x.endedAt).length, 1);
    const contents = [a, b].map(i => i.replies.at(-1).content);
    assert.equal(contents.filter(c => /engagé comme mentor/.test(c)).length, 1);
    assert.equal(contents.filter(c => /n’attend plus de mentor/.test(c)).length, 1);
    assert.equal(mentoraEdits(f).length, 1);
});

test('Je m’affecte : un second clic du mentor déjà engagé est refusé', async () => {
    const f = awaitingFixture();
    await selfClick(f);
    const i = await selfClick(f);
    assert.equal(f.assignments.length, 1);
    assert.match(i.replies.at(-1).content, /Affectation impossible/);
});

test('Je m’affecte : ticket Mentora supprimé, l’engagement aboutit sans erreur', async () => {
    const f = awaitingFixture();
    const fetch = f.bot.guild.channels.fetch;
    f.bot.guild.channels.fetch = async id => id === ids.mentora ? null : fetch(id);
    const i = await selfClick(f);
    assert.equal(f.requests[0].status, 'candidate');
    assert.equal(f.assignments.length, 1);
    assert.match(i.replies.at(-1).content, /engagé comme mentor/);
    assert.equal(mentoraEdits(f).length, 0);
});

test('Je m’affecte : message d’accueil supprimé, l’engagement aboutit', async () => {
    const f = awaitingFixture();
    f.requests[0].mentorship.mentoraMessageId = 'supprime';
    await selfClick(f);
    assert.equal(f.requests[0].status, 'candidate');
    assert.equal(mentoraEdits(f).length, 0);
    assert.equal(f.mentoraOverwrites.get(ids.parrain).allow.has(P.ViewChannel), true);
});

test('assign : l’auto-affectation ne vaut que pour soi-même et « Gérer le parrainage » reste réservé aux RH', async () => {
    const f = awaitingFixture();
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.other, 0, '', true), /lui-même/);
    await assert.rejects(f.manager.assign(1, ids.parrain, ids.other, 0), /RH/);
    assert.equal(f.assignments.length, 0);
});

// Lot 2 du ticket #43 : Prolonger et Réaffecter.
const endedFixture = async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 31 * DAY);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    return f;
};
const buttonIds = view => view.rows.flatMap(row => row.components).map(c => c.data.custom_id ?? c.data.customId);

test('fiche RH : Prolonger et Réaffecter seulement pour un candidat dont la période est terminée', () => {
    const d = Object.assign(new D(), { id: 1, guildId: ids.guild, status: 'candidate' });
    assert.equal(buttonIds(RecruitmentView.staff({}, d)).includes('parrain_extend'), false);
    const ended = buttonIds(RecruitmentView.staff({}, d, true));
    assert.ok(ended.includes('parrain_extend') && ended.includes('parrain_reassign'));
    assert.equal(buttonIds(RecruitmentView.staff({}, { ...d, status: 'refused' }, true)).includes('parrain_extend'), false);
});

test('durée de prolongation : entier de 1 à 365', () => {
    assert.equal(parseExtensionDays(' 14 '), 14);
    for (const bad of ['0', '-3', '1.5', 'abc', '', '366']) assert.throws(() => parseExtensionDays(bad), /1 et 365/, bad);
});

test('prolonger : cumul sans limite, relances réinitialisées, décision enregistrée, autres clés conservées', async () => {
    const f = await endedFixture();
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
    f.requests[0].mentorship.rhNotice = undefined;
    assert.equal(await f.manager.extendPeriod(1, 14, ids.staff), 14);
    assert.equal(await f.manager.extendPeriod(1, 30, ids.staff), 44);
    assert.equal(await f.manager.extendPeriod(1, 14, ids.staff), 58);
    const m = f.requests[0].mentorship;
    assert.equal(m.periodExtraDays, 58); assert.equal(m.periodRemindedAt, undefined); assert.equal(m.mentorRemindedAt, undefined);
    assert.equal(m.needsSync, false);
    const reasons = f.requests[0].decisions.map(x => x.reason);
    assert.deepEqual(reasons, ['Période prolongée de 14 jours', 'Période prolongée de 30 jours', 'Période prolongée de 14 jours']);
    assert.equal(f.requests[0].decisions[0].actorId, ids.staff);
    // Nouvelle échéance non atteinte : plus de relance.
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
});

test('prolonger : après la nouvelle échéance, les relances reprennent', async () => {
    const f = await endedFixture();
    f.requests[0].candidateAt = new Date(Date.now() - 50 * DAY);
    await f.manager.extendPeriod(1, 14, ids.staff);
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1); assert.match(periodNotices(f)[0][1].content, /44 jours/);
});

test('prolonger : refusé hors RH, dossier clôturé, hors candidat ou opération en cours', async () => {
    const f = await endedFixture();
    await assert.rejects(f.manager.extendPeriod(1, 14, ids.parrain), /RH/);
    f.requests[0].pendingStatus = 'integrated';
    await assert.rejects(f.manager.extendPeriod(1, 14, ids.staff), /plus cette action/);
    f.requests[0].pendingStatus = undefined; f.requests[0].mentorship.closedAt = 'x';
    await assert.rejects(f.manager.extendPeriod(1, 14, ids.staff), /plus cette action/);
    f.requests[0].mentorship.closedAt = undefined; f.requests[0].status = 'refused';
    await assert.rejects(f.manager.extendPeriod(1, 14, ids.staff), /plus cette action/);
    assert.equal(f.requests[0].decisions.length, 0);
    assert.equal(f.requests[0].mentorship.periodExtraDays, undefined);
});

test('prolonger : le formulaire est pré-rempli avec extension_days et réservé aux RH', async () => {
    for (const [setting, expected] of [[undefined, '14'], [21, '21'], [0, '14']]) {
        const f = await endedFixture(); if (setting !== undefined) config['bot.recrutement.extension_days'] = setting;
        const i = f.interaction(ids.staff, 'extend'); i.deferred = false; i.message = { id: 'fiche' };
        i.deferReply = async () => { throw new Error('Ne pas différer un formulaire'); };
        i.showModal = async modal => { i.modal = modal; };
        await f.manager.handler(i, { demandeId: 1, guildId: ids.guild });
        assert.equal(i.modal.data.custom_id, 'parrain_save_extend');
        assert.equal(i.modal.components[0].components[0].data.value, expected);
    }
    const f = await endedFixture(); const i = f.interaction(ids.parrain, 'extend'); i.deferred = false; i.message = { id: 'fiche' };
    i.showModal = async () => { throw new Error('Formulaire interdit'); }; i.reply = async options => { i.replies.push(options); };
    await f.manager.handler(i, { demandeId: 1, guildId: ids.guild });
    assert.match(i.replies.at(-1).content, /réservée aux RH/);
});

test('réaffecter : l’ancien parrain est conservé dans l’historique, « le mois continue » ne change que les relances', async () => {
    const f = await endedFixture(); await f.manager.check();
    const first = f.assignments[0];
    await f.manager.assign(1, ids.other, ids.staff, first.id, 'Réaffectation');
    assert.ok(first.endedAt); assert.equal(f.assignments.length, 2);
    const second = f.assignments[1];
    const before = f.requests[0].mentorship;
    await f.manager.choosePeriod(1, second.id, false, ids.staff);
    const m = f.requests[0].mentorship;
    assert.equal(m.periodStartAt, undefined); assert.equal(m.periodRemindedAt, undefined); assert.equal(m.mentorRemindedAt, undefined);
    assert.equal(m.closedAt, before.closedAt);
    assert.match(f.requests[0].decisions.at(-1).reason, new RegExp(`<@${ids.other}>.*le mois continue`));
    // Le nouveau mentor est relancé tout de suite : la période est toujours terminée.
    await f.manager.check();
    assert.equal(mentorDMs(f).filter(([, id]) => id === ids.other).length, 1);
});

test('réaffecter : « le mois repart » fixe le début à maintenant, sans prolongation héritée', async () => {
    const f = await endedFixture();
    await f.manager.extendPeriod(1, 14, ids.staff);
    f.requests[0].candidateAt = new Date(Date.now() - 60 * DAY);
    await f.manager.assign(1, ids.other, ids.staff, f.assignments[0].id);
    const t0 = Date.now();
    await f.manager.choosePeriod(1, f.assignments[1].id, true, ids.staff);
    const m = f.requests[0].mentorship;
    assert.ok(Date.parse(m.periodStartAt) >= t0 && Date.parse(m.periodStartAt) <= Date.now());
    assert.equal(m.periodExtraDays, undefined);
    assert.equal(candidatePeriodEnded(f.requests[0], Date.now(), 30), false);
    assert.match(f.requests[0].decisions.at(-1).reason, /le mois repart/);
    await f.manager.check();
    assert.equal(periodNotices(f).length, 0);
});

test('réaffecter : choix refusé hors RH, enregistré une seule fois et lié à l’attribution courante', async () => {
    const f = await endedFixture();
    await f.manager.assign(1, ids.other, ids.staff, f.assignments[0].id);
    const [old, current] = f.assignments;
    await assert.rejects(f.manager.choosePeriod(1, current.id, true, ids.parrain), /RH/);
    await assert.rejects(f.manager.choosePeriod(1, old.id, true, ids.staff), /a changé/);
    await f.manager.choosePeriod(1, current.id, false, ids.staff);
    await assert.rejects(f.manager.choosePeriod(1, current.id, true, ids.staff), /déjà/);
    assert.equal(f.requests[0].decisions.length, 1);
    f.requests[0].pendingStatus = 'integrated';
    await assert.rejects(f.manager.choosePeriod(1, current.id, true, ids.staff), /plus cette action/);
});

test('réaffecter : le bouton de la fiche ouvre le choix du parrain, puis propose continue / repart', async () => {
    const f = await endedFixture();
    const i = f.interaction(ids.staff, 'reassign'); i.message = { flags: { has: () => false } };
    await f.manager.handler(i, { demandeId: 1, guildId: ids.guild });
    const ids1 = i.replies.at(-1).components.flatMap(row => row.components).map(c => c.data.custom_id);
    assert.ok(ids1.includes('parrain_selection'));
    const stored = f.contexts.map(c => c.data).find(c => c?.reassign === true);
    assert.equal(stored.expectedId, f.assignments[0].id);
    const submit = f.interaction(ids.staff, 'save_assign');
    submit.isButton = () => false; submit.isModalSubmit = () => true; submit.isFromMessage = () => false;
    submit.fields = { getTextInputValue: () => 'Mentor injoignable' };
    await f.manager.handler(submit, { demandeId: 1, guildId: ids.guild, actorId: ids.staff, reassign: true, selectedId: ids.other, expectedId: f.assignments[0].id });
    assert.equal(f.assignments[1].parrainId, ids.other);
    const choice = submit.replies.at(-1).components.flatMap(row => row.components).map(c => c.data.custom_id);
    assert.deepEqual(choice, ['parrain_period_continue', 'parrain_period_restart']);
    const click = f.interaction(ids.staff, 'period_restart');
    await f.manager.handler(click, { demandeId: 1, guildId: ids.guild, actorId: ids.staff, attributionId: f.assignments[1].id });
    assert.ok(f.requests[0].mentorship.periodStartAt);
    assert.match(click.replies.at(-1).content, /repart/);
});

test('réaffecter sans reassign : le remplacement classique retourne à la fiche, sans question sur le mois', async () => {
    const f = await endedFixture();
    const submit = f.interaction(ids.staff, 'save_assign');
    submit.isButton = () => false; submit.isModalSubmit = () => true; submit.isFromMessage = () => false;
    submit.fields = { getTextInputValue: () => '' };
    await f.manager.handler(submit, { demandeId: 1, guildId: ids.guild, actorId: ids.staff, selectedId: ids.other, expectedId: f.assignments[0].id });
    const all = submit.replies.flatMap(r => r.components ?? []).flatMap(row => row.components).map(c => c.data.custom_id);
    assert.equal(all.includes('parrain_period_continue'), false);
});

// Lot 3 du ticket #43 : bouton « Valider », acceptation déléguée au site.
async function withSite(respond, run) {
    const saved = { fetch: globalThis.fetch, url: process.env.URL_SITE, token: process.env.BOT_TOKEN };
    process.env.URL_SITE = 'https://site.test/'; process.env.BOT_TOKEN = 'jeton-de-test';
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url, init }); return respond(); };
    try { await run(calls); }
    finally {
        globalThis.fetch = saved.fetch;
        for (const [key, value] of [['URL_SITE', saved.url], ['BOT_TOKEN', saved.token]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
}
const siteReply = status => () => ({ ok: status >= 200 && status < 300, status });

test('fiche RH : bouton Valider seulement pour un dossier candidate', () => {
    const d = Object.assign(new D(), { id: 1, guildId: ids.guild, status: 'candidate' });
    assert.ok(buttonIds(RecruitmentView.staff({}, d)).includes('parrain_validate'));
    for (const status of ['review', 'awaiting_mentor', 'refused', 'integrated']) {
        assert.equal(buttonIds(RecruitmentView.staff({}, { ...d, status })).includes('parrain_validate'), false, status);
    }
});

test('valider : appel du site avec le jeton, décision enregistrée avec l’avis du mentor, statut inchangé', async () => {
    const f = await endedFixture();
    await f.manager.reviewOrRelay(f.assignments[0].id, ids.parrain, 'Très bonne intégration', 'favorable');
    await withSite(siteReply(200), async calls => {
        assert.deepEqual(await f.manager.validateCandidate(1, ids.staff), { ok: true });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, 'https://site.test/api/internal/bot/candidatures/accept');
        assert.equal(calls[0].init.method, 'POST');
        assert.equal(calls[0].init.headers['X-BOT-TOKEN'], 'jeton-de-test');
        assert.deepEqual(JSON.parse(calls[0].init.body), { discordId: ids.applicant, actorId: ids.staff });
        assert.ok(calls[0].init.signal);
    });
    const d = f.requests[0];
    assert.equal(d.status, 'candidate'); assert.equal(d.pendingStatus, undefined);
    assert.equal(d.decisions.length, 1);
    assert.equal(d.decisions[0].actorId, ids.staff);
    assert.match(d.decisions[0].reason, /Acceptation envoyée.*Favorable.*Très bonne intégration/);
});

test('valider sans bilan du mentor : le motif le dit', async () => {
    const f = await endedFixture();
    await withSite(siteReply(200), async () => { await f.manager.validateCandidate(1, ids.staff); });
    assert.match(f.requests[0].decisions[0].reason, /aucun bilan déposé/);
});

test('valider : échecs du site (403, 404, 409, 500, injoignable) = message clair et rien d’enregistré', async () => {
    const expected = { 403: /autorisation/, 404: /404/, 409: /pas de compte sur le site/, 500: /HTTP 500/ };
    for (const [status, pattern] of Object.entries(expected)) {
        const f = await endedFixture();
        await withSite(siteReply(Number(status)), async calls => {
            const result = await f.manager.validateCandidate(1, ids.staff);
            assert.equal(result.ok, false); assert.match(result.message, pattern); assert.match(result.message, /depuis le site/);
            assert.equal(calls.length, 1, 'aucune relance automatique');
        });
        assert.equal(f.requests[0].decisions.length, 0, status);
    }
    const f = await endedFixture();
    await withSite(() => { throw new Error('ECONNREFUSED'); }, async calls => {
        const result = await f.manager.validateCandidate(1, ids.staff);
        assert.equal(result.ok, false); assert.match(result.message, /injoignable/);
        assert.equal(calls.length, 1);
    });
    assert.equal(f.requests[0].decisions.length, 0);
});

test('valider : réservé aux RH, dossier candidate sans opération en cours, aucun appel sinon', async () => {
    const f = await endedFixture();
    await withSite(siteReply(200), async calls => {
        await assert.rejects(f.manager.validateCandidate(1, ids.parrain), /RH/);
        f.requests[0].pendingStatus = 'integrated';
        await assert.rejects(f.manager.validateCandidate(1, ids.staff), /plus cette action/);
        f.requests[0].pendingStatus = undefined; f.requests[0].status = 'refused';
        await assert.rejects(f.manager.validateCandidate(1, ids.staff), /plus cette action/);
        assert.equal(calls.length, 0);
    });
    assert.equal(f.requests[0].decisions.length, 0);
});

test('valider : bouton de la fiche RH, message de succès puis d’échec, statut jamais modifié par le bot', async () => {
    for (const [status, pattern] of [[200, /Acceptation envoyée/], [409, /Acceptation non envoyée.*compte/]]) {
        const f = await endedFixture();
        const i = f.interaction(ids.staff, 'validate'); i.deferred = false; i.message = { id: 'fiche', flags: { has: () => false } };
        i.deferReply = async () => { i.deferred = true; };
        await withSite(siteReply(status), async () => { await f.manager.handler(i, { demandeId: 1, guildId: ids.guild }); });
        assert.match(i.replies.at(-1).content, pattern);
        assert.equal(f.requests[0].status, 'candidate');
    }
});

test('valider : variables du site absentes = message clair, aucun appel', async () => {
    const saved = { url: process.env.URL_SITE, token: process.env.BOT_TOKEN };
    delete process.env.URL_SITE; delete process.env.BOT_TOKEN;
    try {
        let called = false;
        const result = await requestSiteAcceptance(ids.applicant, ids.staff, async () => { called = true; return { ok: true, status: 200 }; });
        assert.equal(result.ok, false); assert.equal(called, false);
    } finally {
        if (saved.url !== undefined) process.env.URL_SITE = saved.url;
        if (saved.token !== undefined) process.env.BOT_TOKEN = saved.token;
    }
});

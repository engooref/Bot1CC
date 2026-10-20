import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection, ChannelType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { ParrainageManager, candidatePeriodEnded, parseParrainReturn, parrainAvailability, parrainCapacity } = await import('../dist/src/managers/ParrainageManager.js');
const { RecrutementDemande: D } = await import('../dist/src/entities/recrutement/RecrutementDemande.js');
const { RecrutementParrainage: A } = await import('../dist/src/entities/recrutement/RecrutementParrainage.js');
const { ParrainPreference: Pref } = await import('../dist/src/entities/recrutement/ParrainPreference.js');
const { InteractionContext } = await import('../dist/src/entities/ui/ViewContext.js');
const { settingsService } = await import('../dist/src/services/SettingsService.js');
const { default: View, parrainButton, parrainSelect } = await import('../dist/src/view/ParrainageView.js');
const { default: RecruitmentView } = await import('../dist/src/view/RecrutementView.js');
const { JSONTypeComponent: T } = await import('../dist/src/utils/Type.js');
const ids = { guild: '100000000000000001', staff: '100000000000000002', parrain: '100000000000000003', other: '100000000000000004', applicant: '100000000000000005', role: '100000000000000006', rh: '100000000000000007', official: '100000000000000008', bot: '100000000000000009', ticket: '100000000000000010', channelRh: '100000000000000011' };
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
    const members = new Collection();
    function member(id, roles = []) {
        const m = { id, displayName: `Membre ${id}`, user: { id, bot: false }, roles: { cache: new Collection(roles.map(r => [r, { id: r }])) }, permissions: new PermissionsBitField(0n), async send(content) { operations.push(['dm', id, content]); } };
        members.set(id, m); return m;
    }
    member(ids.parrain, [ids.role]); member(ids.other, [ids.role]); member(ids.staff, [ids.rh]); member(ids.applicant);
    const overwrites = new Collection();
    const channel = {
        id: ids.ticket, type: ChannelType.GuildText,
        isThread: () => false,
        permissionOverwrites: {
            cache: overwrites,
            async edit(id, values) {
                const old = overwrites.get(id); let allow = old?.allow.bitfield ?? 0n, deny = old?.deny.bitfield ?? 0n;
                for (const [name, value] of Object.entries(values)) { allow &= ~P[name]; deny &= ~P[name]; if (value === true) allow |= P[name]; if (value === false) deny |= P[name]; }
                overwrites.set(id, { allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
                operations.push(['permissions', id, values]);
            },
            async delete(id) { overwrites.delete(id); operations.push(['delete-permissions', id]); },
        },
        async send(options) {
            if (failMessage) throw new Error('Discord unavailable');
            operations.push(['message', options]); return { id: String(++serial), channelId: ids.ticket };
        },
    };
    const rh = { ...channel, id: ids.channelRh, async send(options) { if (failRH) throw new Error('RH indisponible'); operations.push(['rh', options]); } };
    const bot = {
        user: { id: ids.bot }, roleMember: { id: ids.official }, db: { getEm: () => em },
        guild: {
            id: ids.guild, roles: { fetch: async id => id === ids.role ? { id } : null },
            members: { list: async () => members, fetch: async query => { if (!query) return members; const m = members.get(typeof query === 'string' ? query : query.user); if (!m) throw Object.assign(new Error('Unknown member'), { code: 10007 }); return m; } },
            channels: { fetch: async id => id === ids.ticket ? channel : id === ids.channelRh ? rh : null },
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
    return { bot, manager, em, requests, assignments, prefs, contexts, members, channel, operations, pref, assignment, interaction, failMessage: value => { failMessage = value; }, failRH: value => { failRH = value; } };
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

const periodNotices = f => f.operations.filter(([kind, payload]) => kind === 'rh' && payload.content.includes('Période Candidat de 14 jours terminée'));
const reviewNotices = f => f.operations.filter(([kind, payload]) => kind === 'rh' && /Bilan (déposé|mis à jour)/.test(payload.content));

test('14 jours : frontière exacte depuis candidateAt et aucune date inventée', () => {
    const now = Date.now(), delay = 14 * 86400_000;
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(now - delay + 1) }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(now - delay) }, now), true);
    assert.equal(candidatePeriodEnded({ status: 'candidate' }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'postulant', candidateAt: new Date(0) }, now), false);
    assert.equal(candidatePeriodEnded({ status: 'candidate', candidateAt: new Date(0), mentorship: { closedAt: 'closed' } }, now), false);
});

test('rappel 14 jours unique malgré redémarrage, remplacement et retrait du parrain', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 15 * 86400_000);
    await f.manager.assign(1, ids.parrain, ids.staff, 0);
    await f.manager.check();
    const remembered = f.requests[0].mentorship.periodRemindedAt;
    assert.ok(remembered);
    await new ParrainageManager(f.bot).check();
    await f.manager.assign(1, ids.other, ids.staff, f.assignments[0].id);
    await f.manager.check();
    await f.manager.finish(1, ids.staff, 'Attente de remplacement', false, f.assignments[1].id);
    await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
    assert.equal(f.requests[0].mentorship.periodRemindedAt, remembered);
    assert.equal(f.requests[0].status, 'candidate');
    assert.equal(f.members.get(ids.applicant).roles.cache.has(ids.official), false);
});

test('rappel 14 jours sans parrain, reprise si notification RH échoue', async () => {
    const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 15 * 86400_000);
    f.failRH(true); await f.manager.check();
    assert.equal(f.requests[0].mentorship?.periodRemindedAt, undefined);
    f.failRH(false); await f.manager.check(); await f.manager.check();
    assert.equal(periodNotices(f).length, 1);
});

test('aucun rappel de période pour un citoyen ou un dossier clôturé', async () => {
    for (const closed of [true, false]) {
        const f = fixture(); f.requests[0].candidateAt = new Date(Date.now() - 20 * 86400_000);
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

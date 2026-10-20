import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, Collection, PermissionsBitField } from 'discord.js';
import { LockMode } from '@mikro-orm/core';

// Aucun appel au site, à Discord ou à MySQL pendant ces tests.
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { DiploManager } = await import('../dist/src/managers/DiploManager.js');
const { settingsService } = await import('../dist/src/services/SettingsService.js');
const { default: DiploView, DiploActions } = await import('../dist/src/view/DiploView.js');
const { DiplomatieDemande, DiplomatieCorporation } = await import('../dist/src/entities/diplomatie/index.js');
const ids = { guild: '100000000000000001', role: '100000000000000002', applicant: '100000000000000003', actor: '100000000000000004', bot: '100000000000000005', channel: '100000000000000006', category: '100000000000000007' };
settingsService.getString = async key => ({
    'bot.diplomatie.role': ids.role,
    'bot.diplomatie.category_corporations': ids.category,
}[key] ?? '');

function fixture({ publicChannel = false, failGrant = false, failCommit = false, authorized = true } = {}) {
    const operations = [];
    const request = Object.assign(new DiplomatieDemande(), { id: 1, guildId: ids.guild, applicantId: ids.applicant, threadId: 'thread', notificationChannelId: 'staff', notificationMessageId: 'notice' });
    const corporation = Object.assign(new DiplomatieCorporation(), { id: 2, guildId: ids.guild, name: 'Test Corp', channelId: ids.channel });
    const corporations = [corporation];
    const contexts = [];
    const makeChannel = id => ({
        id, type: ChannelType.GuildText,
        permissionsFor: () => ({ has: () => publicChannel }),
        permissionOverwrites: {
            cache: new Collection(),
            async edit(target, permissions) {
                operations.push(['grant', target]);
                if (failGrant && target === ids.applicant) throw new Error('Missing permissions');
                this.cache.set(target, { allow: new PermissionsBitField(Object.keys(permissions).filter(key => permissions[key] === true)), deny: new PermissionsBitField() });
            },
            async delete(target) { operations.push(['undo', target]); this.cache.delete(target); },
        },
        async delete() { operations.push(['delete-channel', id]); },
    });
    const channel = makeChannel(ids.channel);
    const channels = new Map([[ids.channel, channel], [ids.category, { id: ids.category, type: ChannelType.GuildCategory }]]);
    const em = {
        async findOne(entity, where, options) {
            if (entity === DiplomatieDemande) {
                if (options?.lockMode) operations.push(['lock', options.lockMode]);
                return request.guildId === where.guildId && (!where.id || where.id === request.id) ? request : null;
            }
            if (entity === DiplomatieCorporation) return corporations.find(c => Object.entries(where).every(([key, value]) => c[key] === value)) ?? null;
            return contexts.find(c => Object.entries(where).every(([key, value]) => c[key] === value)) ?? null;
        },
        async count() { return corporations.length; },
        async find(_entity, _where, options) { return corporations.slice(options.offset, options.offset + options.limit); },
        create(entity, data) { return Object.assign(new entity(), data, { id: data.id ?? 10 }); },
        persist(entity) { if (!(entity instanceof DiplomatieDemande) && !(entity instanceof DiplomatieCorporation) && !contexts.includes(entity)) contexts.push(entity); return this; },
        async persistAndFlush(entity) { if (entity instanceof DiplomatieCorporation) corporations.push(entity); },
        async flush() { operations.push(['flush']); },
        async transactional(fn) {
            const snapshot = { ...request };
            const count = corporations.length;
            try {
                const result = await fn(this);
                if (failCommit) throw new Error('Commit failed');
                operations.push(['commit']);
                return result;
            } catch (err) {
                for (const key of Object.keys(request)) delete request[key];
                Object.assign(request, snapshot);
                corporations.length = count;
                throw err;
            }
        },
    };
    const bot = {
        user: { id: ids.bot }, db: { getEm: () => em },
        guild: {
            id: ids.guild,
            roles: { everyone: {}, fetch: async () => ({ id: ids.role }) },
            members: { fetch: async () => ({ id: ids.actor, roles: { cache: new Collection(authorized ? [[ids.role, {}]] : []) } }) },
            channels: {
                fetch: async id => channels.get(id) ?? null,
                create: async options => {
                    operations.push(['create-channel', options]);
                    const created = makeChannel('100000000000000099');
                    channels.set(created.id, created);
                    return created;
                },
            },
        },
    };
    bot.channels = bot.guild.channels;
    const manager = new DiploManager(bot);
    manager.logger = { error() {}, warn() {} };
    return { manager, request, corporation, corporations, operations, channel, channels, contexts, bot };
}

function interaction(customId, kind = 'button') {
    const replies = [];
    return {
        customId, guildId: ids.guild, user: { id: ids.actor }, channelId: 'staff', replies,
        message: { id: 'notice' },
        isButton: () => kind === 'button', isModalSubmit: () => kind === 'modal', isStringSelectMenu: () => kind === 'select',
        async deferReply() { this.deferred = true; },
        async editReply(options) { replies.push(options); return { id: 'ephemeral', channelId: 'staff' }; },
        async reply(options) { replies.push(options); this.replied = true; },
        async showModal(modal) { this.modal = modal; },
    };
}
const context = { demandeId: 1, guildId: ids.guild, actorId: ids.actor };

test('acceptation : accès accordé avant validation et responsable conservé', async () => {
    const f = fixture();
    const result = await f.manager.acceptDiplomacy(1, ids.actor, { id: 2 });
    assert.equal(result.status, 'accepted');
    assert.equal(result.corporation, f.corporation);
    assert.equal(result.processedById, ids.actor);
    assert.ok(result.processedAt instanceof Date);
    assert.ok(f.operations.findIndex(op => op[0] === 'grant' && op[1] === ids.applicant) < f.operations.findIndex(op => op[0] === 'commit'));
    assert.deepEqual(f.operations[0], ['lock', LockMode.PESSIMISTIC_WRITE]);
});

test('double décision concurrente : une seule décision et un seul accès', async () => {
    const f = fixture();
    const results = await Promise.allSettled([f.manager.acceptDiplomacy(1, ids.actor, { id: 2 }), f.manager.refuseDiplomacy(1, ids.actor)]);
    assert.deepEqual(results.map(r => r.status), ['fulfilled', 'rejected']);
    assert.equal(f.request.status, 'accepted');
    assert.equal(f.operations.filter(op => op[0] === 'grant' && op[1] === ids.applicant).length, 1);
});

test('permissions refusées : demande en attente et restauration des droits ajoutés', async () => {
    const f = fixture({ failGrant: true });
    await assert.rejects(f.manager.acceptDiplomacy(1, ids.actor, { id: 2 }), /Missing permissions/);
    assert.equal(f.request.status, 'pending');
    assert.equal(f.channel.permissionOverwrites.cache.size, 0);
});

test('échec SQL après attribution : restauration des droits Discord', async () => {
    const f = fixture({ failCommit: true });
    await assert.rejects(f.manager.acceptDiplomacy(1, ids.actor, { id: 2 }), /Commit failed/);
    assert.equal(f.request.status, 'pending');
    assert.equal(f.channel.permissionOverwrites.cache.size, 0);
});

test('création de corporation : salon privé dans la catégorie configurée', async () => {
    const f = fixture();
    const result = await f.manager.acceptDiplomacy(1, ids.actor, { name: 'Nouvelle corporation' });
    const options = f.operations.find(op => op[0] === 'create-channel')[1];
    assert.equal(options.parent, ids.category);
    assert.equal(options.permissionOverwrites[0].id, ids.guild);
    assert.ok(options.permissionOverwrites[0].deny.length);
    assert.equal(result.corporation.name, 'Nouvelle corporation');
    assert.equal(f.corporations.length, 2);
});

test('nouveau salon supprimé si l’acceptation échoue', async () => {
    const f = fixture({ failGrant: true });
    await assert.rejects(f.manager.acceptDiplomacy(1, ids.actor, { name: 'Nouvelle corporation' }));
    assert.equal(f.request.status, 'pending');
    assert.equal(f.corporations.length, 1);
    assert.equal(f.operations.filter(op => op[0] === 'delete-channel').length, 1);
});

test('salon existant associé sans recréation ni perte des représentants', async () => {
    const f = fixture();
    f.corporations.length = 0;
    f.channel.permissionOverwrites.cache.set('existing-representative', { allow: new PermissionsBitField(), deny: new PermissionsBitField() });
    await f.manager.acceptDiplomacy(1, ids.actor, { name: 'Importée', channelId: ids.channel });
    assert.equal(f.operations.filter(op => op[0] === 'create-channel').length, 0);
    assert.ok(f.channel.permissionOverwrites.cache.has('existing-representative'));
    assert.equal(f.request.corporation.channelId, ids.channel);
});

test('salon public et corporation d’un autre serveur refusés', async () => {
    const f = fixture({ publicChannel: true });
    await assert.rejects(f.manager.acceptDiplomacy(1, ids.actor, { id: 2 }), /public/);
    f.corporation.guildId = 'another-guild';
    await assert.rejects(f.manager.acceptDiplomacy(1, ids.actor, { id: 2 }), /introuvable/);
    assert.equal(f.request.status, 'pending');
    assert.equal(f.operations.filter(op => op[0] === 'grant').length, 0);
});

test('refus : décision enregistrée sans attribution d’accès', async () => {
    const f = fixture();
    await f.manager.refuseDiplomacy(1, ids.actor);
    assert.equal(f.request.status, 'refused');
    assert.equal(f.request.processedById, ids.actor);
    assert.equal(f.operations.filter(op => op[0] === 'grant').length, 0);
});

test('un non-diplomate ne peut pas ouvrir le choix ni accepter', async () => {
    const f = fixture({ authorized: false });
    const i = interaction(DiploActions.ConfirmAccept);
    await f.manager.handlerResponse(i, { ...context, corporationId: 2 });
    assert.match(typeof i.replies[0] === 'string' ? i.replies[0] : i.replies[0].content, /réservée aux diplomates/);
    assert.equal(f.request.status, 'pending');
});

test('choix de corporation : composants et contexte de formulaire persistés', async () => {
    const f = fixture();
    const i = interaction(DiploActions.Accept);
    await f.manager.handlerResponse(i, context);
    assert.equal(i.replies[0].components[0].components[0].data.custom_id, DiploActions.Select);
    const modalContext = f.contexts.find(c => c.customId === DiploActions.CorporationForm);
    assert.equal(modalContext.data.demandeId, 1);
    assert.equal(modalContext.data.actorId, ids.actor);
});

test('sélection : confirmation nécessaire avant attribution', async () => {
    const f = fixture();
    const i = interaction(DiploActions.Select, 'select');
    i.values = ['2'];
    await f.manager.handlerResponse(i, context);
    assert.equal(f.request.status, 'pending');
    assert.equal(f.contexts.find(c => c.customId === DiploActions.ConfirmAccept).data.corporationId, 2);
});

test('formulaire : pas de defer avant showModal et contrôle du propriétaire', async () => {
    const f = fixture();
    const i = interaction(DiploActions.Create);
    await f.manager.handlerResponse(i, context);
    assert.equal(i.deferred, undefined);
    assert.equal(i.modal.data.custom_id, DiploActions.CorporationForm);
    const other = interaction(DiploActions.Create);
    await f.manager.handlerResponse(other, { ...context, actorId: 'someone-else' });
    assert.equal(other.modal, undefined);
});

test('pagination : 25 options maximum et navigation des pages', () => {
    const f = fixture();
    const corporations = Array.from({ length: 25 }, (_, id) => ({ id, name: `Corporation ${id}` }));
    const view = DiploView.corporations(f.bot, { ...context, page: 1 }, corporations, 60);
    assert.equal(view.rows[0].components[0].options.length, 25);
    assert.equal(Boolean(view.rows[1].components[0].data.disabled), false);
    assert.equal(Boolean(view.rows[1].components[1].data.disabled), false);
});

function attachClosure(f, failArchive = false) {
    const sent = new Collection();
    const edits = [];
    const thread = {
        id: 'thread', archived: false, locked: false, isThread: () => true,
        messages: { fetch: async () => sent },
        async send(options) {
            sent.set(String(sent.size), { author: { id: ids.bot }, embeds: options.embeds.map(embed => embed.toJSON()) });
        },
        async setArchived(value) {
            if (failArchive) throw new Error('Missing ManageThreads');
            this.archived = value;
        },
        async setLocked(value) { this.locked = value; },
    };
    const message = { id: 'notice', channelId: 'staff', async edit(options) { edits.push(options); return this; } };
    const staff = { id: 'staff', isTextBased: () => true, isThread: () => false, messages: { fetch: async () => message } };
    message.channel = staff;
    f.channels.set('thread', thread);
    f.channels.set('staff', staff);
    return { thread, sent, edits, recover: () => { failArchive = false; } };
}

test('acceptation complète : notification finale sans boutons et fil clôturé une seule fois', async () => {
    const f = fixture();
    const closure = attachClosure(f);
    const i = interaction(DiploActions.ConfirmAccept);
    await f.manager.handlerResponse(i, { ...context, corporationId: 2 });
    assert.equal(f.request.status, 'accepted');
    assert.equal(closure.thread.archived, true);
    assert.equal(closure.thread.locked, true);
    assert.equal(closure.sent.size, 1);
    assert.deepEqual(closure.edits[0].components, []);
    await f.manager.handlerResponse(interaction(DiploActions.Accept), context);
    assert.equal(closure.sent.size, 1);
    assert.equal(f.operations.filter(op => op[0] === 'grant' && op[1] === ids.applicant).length, 1);
});

test('échec de clôture : décision conservée, bouton de reprise puis clôture sans doublon', async () => {
    const f = fixture();
    const closure = attachClosure(f, true);
    const i = interaction(DiploActions.ConfirmRefuse);
    await f.manager.handlerResponse(i, context);
    assert.equal(f.request.status, 'refused');
    assert.match(i.replies[0], /Décision enregistrée/);
    assert.equal(closure.edits[0].components[0].components[0].data.custom_id, DiploActions.Retry);
    assert.ok(f.contexts.some(c => c.customId === DiploActions.Retry));
    closure.recover();
    await f.manager.handlerResponse(interaction(DiploActions.Retry), context);
    assert.equal(closure.thread.archived, true);
    assert.equal(closure.sent.size, 1);
    assert.deepEqual(closure.edits.at(-1).components, []);
});

test('soumission du formulaire : création et acceptation raccordées', async () => {
    const f = fixture();
    attachClosure(f);
    const i = interaction(DiploActions.CorporationForm, 'modal');
    i.fields = { getTextInputValue: key => key === 'name' ? '  Nouvelle   Corporation  ' : '' };
    await f.manager.handlerResponse(i, context);
    assert.equal(f.request.status, 'accepted');
    assert.equal(f.request.corporation.name, 'Nouvelle Corporation');
    assert.match(i.replies[0], /Demande acceptée/);
});

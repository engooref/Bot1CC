import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelType, Collection, PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
process.env.URL_SITE = 'https://example.invalid';
process.env.BOT_TOKEN = 'test-only';
const { RecrutementManager, recruitmentNickname, siteDecisionTarget } = await import('../dist/src/managers/RecrutementManager.js');
const { SchedulerRH, recruitmentExpired } = await import('../dist/src/managers/schedulers/SchedulerRH.js');
const { RecrutementDemande: Demande } = await import('../dist/src/entities/recrutement/RecrutementDemande.js');
const { RHMember } = await import('../dist/src/entities/rh/RHMember.js');
const { InteractionContext } = await import('../dist/src/entities/ui/ViewContext.js');
const { RecruitmentActions: A, default: View } = await import('../dist/src/view/RecrutementView.js');
const { settingsService } = await import('../dist/src/services/SettingsService.js');
const id = n => String(100000000000000000n + BigInt(n));
const ids = { guild: id(1), applicant: id(2), rh: id(3), outsider: id(4), bot: id(5), trigger: id(6), postulant: id(7), candidate: id(8), staff: id(9), official: id(10), ticket: id(11), category: id(12), channelRh: id(13), engagement: id(14), unrelated: id(15) };
let settings;
settingsService.getBool = async (key, fallback) => settings[key] ?? fallback;
settingsService.getString = async key => settings[key] ?? '';
settingsService.get = async key => settings[key];

function fixture({ status = 'waiting_rsi', legacy = false, noRequest = false } = {}) {
    settings = {
        'bot.recrutement.enabled': true,
        'bot.roles.postulant': ids.postulant, 'bot.recrutement.role_candidat': ids.candidate,
        'site.roles.rh': ids.staff, 'bot.recrutement.category_admission': ids.category,
        'bot.channels.rh': ids.channelRh, 'bot.channels.enga': ids.engagement,
    };
    const operations = [], contexts = [], requests = [];
    const d = Object.assign(new Demande(), { id: 1, guildId: ids.guild, applicantId: ids.applicant, channelId: ids.ticket, status, arrivalTaggedAt: new Date(), needsSync: false });
    if (!noRequest) requests.push(d);
    let serial = 100;
    const roles = new Collection();
    for (const roleId of [ids.guild, ids.trigger, ids.postulant, ids.candidate, ids.staff, ids.official, ids.unrelated]) roles.set(roleId, { id: roleId, editable: true, managed: false });
    let failNickname = false, failChannelCreation = false, failMessage = false;
    const members = new Collection();
    const member = (memberId, memberRoles = []) => {
        const roleCache = new Collection(memberRoles.map(key => [key, roles.get(key)]));
        const m = {
            id: memberId, user: { id: memberId, username: 'Alice', displayAvatarURL: () => 'https://example.invalid/avatar.png', bot: memberId === ids.bot }, displayName: '[A] Alice',
            permissions: new PermissionsBitField(memberId === ids.bot ? P.Administrator : 0n),
            roles: {
                cache: roleCache,
                async add(value) { for (const key of Array.isArray(value) ? value : [value]) roleCache.set(key, roles.get(key)); operations.push(['add-role', value]); },
                async remove(value) { for (const key of Array.isArray(value) ? value : [value]) roleCache.delete(key); operations.push(['remove-role', value]); },
            },
            async setNickname(value) { if (failNickname) throw new Error('nickname failure'); this.displayName = value; operations.push(['nickname', value]); },
        };
        members.set(memberId, m); return m;
    };
    const applicant = member(ids.applicant, [ids.guild, ids.postulant, ids.unrelated]);
    member(ids.rh, [ids.staff]); member(ids.outsider); member(ids.bot);
    const channels = new Collection();
    const makeChannel = (channelId, type = ChannelType.GuildText) => {
        const messages = new Collection();
        const channel = {
            id: channelId, type, guildId: ids.guild, archived: false,
            permissionsFor: target => new PermissionsBitField(target.id === ids.guild ? 0n : target.id === ids.postulant ? (channel.permissionOverwrites.cache.get(target.id)?.allow.bitfield ?? 0n) : P.Administrator),
            permissionOverwrites: {
                cache: new Collection(),
                async edit(target, permissions) {
                    const old = this.cache.get(target);
                    let allow = old?.allow.bitfield ?? 0n, deny = old?.deny.bitfield ?? 0n;
                    for (const [permission, value] of Object.entries(permissions)) {
                        const bit = P[permission];
                        allow &= ~bit; deny &= ~bit;
                        if (value === true) allow |= bit;
                        if (value === false) deny |= bit;
                    }
                    this.cache.set(target, { allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
                    operations.push(['overwrite', target, permissions]);
                    return channel;
                },
                async delete(target) { this.cache.delete(target); operations.push(['delete-overwrite', target]); },
            },
            isTextBased: () => true,
            isThread: () => type === ChannelType.PublicThread,
            async setArchived(v) { channel.archived = v; },
            messages: { async fetch(key) { if (typeof key === 'object') return messages; const m = messages.get(key); if (!m) throw Object.assign(new Error('missing'), { code: 10008 }); return m; } },
            async send(options) {
                if (failMessage) throw new Error('message failure');
                const mid = id(++serial);
                const m = { id: mid, channelId, channel, author: { id: ids.bot }, components: options.components ?? [], pinned: false, url: `https://discord.com/channels/${ids.guild}/${channelId}/${mid}`, ...options,
                    async edit(next) { Object.assign(m, next); operations.push(['edit', mid]); return m; },
                    async pin() { m.pinned = true; },
                };
                messages.set(mid, m); operations.push(['send', channelId, options]); return m;
            },
            threads: { cache: new Collection(), async fetchActive() {}, async create() { const c = makeChannel(id(++serial), ChannelType.PublicThread); c.name = 'Candidatures'; channel.threads.cache.set(c.id, c); return c; } },
        };
        channels.set(channelId, channel); return channel;
    };
    makeChannel(ids.ticket); makeChannel(ids.category, ChannelType.GuildCategory); makeChannel(ids.channelRh); makeChannel(ids.engagement);
    const match = (entity, query) => typeof query === 'number' ? entity.id === query : Object.entries(query).every(([k, v]) => entity[k] === v);
    let transaction = Promise.resolve();
    const em = {
        async findOne(entity, query, opts) {
            if (opts?.lockMode) operations.push(['lock']);
            if (entity === Demande) return requests.find(x => match(x, query)) ?? null;
            if (entity === RHMember) return legacy ? {} : null;
            return contexts.find(x => match(x, query)) ?? null;
        },
        async findOneOrFail(entity, query, opts) { const v = await this.findOne(entity, query, opts); if (!v) throw new Error('missing row'); return v; },
        async find(entity, query) { return requests.filter(x => match(x, query)); },
        create(entity, values) { return Object.assign(new entity(), values); },
        persist(entity) {
            if (entity instanceof InteractionContext && !contexts.includes(entity)) contexts.push(entity);
            if (entity instanceof Demande && !requests.includes(entity)) {
                if (requests.some(d => d.guildId === entity.guildId && d.applicantId === entity.applicantId)) throw new Error('unique constraint');
                entity.id = 1;
                requests.push(entity);
            }
            return this;
        },
        async persistAndFlush(entity) { this.persist(entity); await this.flush(); },
        async flush() {
            for (const context of contexts) {
                assert.equal(typeof context.customId, 'string', 'InteractionContext.customId est obligatoire');
                assert.ok(context.customId.length > 0);
            }
            operations.push(['flush']);
        },
        async transactional(fn) { operations.push(['transaction']); const next = transaction.then(() => fn(this)); transaction = next.catch(() => {}); return next; },
    };
    const guild = {
        id: ids.guild, roles: { everyone: roles.get(ids.guild), async fetch(key) { return roles.get(key) ?? null; } },
        members: { async list() { return members; }, async fetch(key) { return key ? members.get(typeof key === 'object' ? key.user : key) : members; }, async fetchMe() { return members.get(ids.bot); } },
        channels: { async fetch(key) { return key ? channels.get(key) ?? null : channels; }, async create(options) {
            if (failChannelCreation) throw new Error('channel failure');
            const c = makeChannel(id(++serial)); c.topic = options.topic; operations.push(['create-channel', options]); return c;
        } },
    };
    members.forEach(m => m.guild = guild);
    const profile = {};
    const bot = { guild, user: { id: ids.bot }, roleMember: roles.get(ids.official), db: { getEm: () => em },
        userManager: { em, async initMemberRh() { operations.push(['profile']); return profile; } },
    };
    const manager = new RecrutementManager(bot);
    bot.recrutementManager = manager;
    const scheduler = Object.assign(Object.create(SchedulerRH.prototype), { bot, checking: false, logger: { async error() {} } });
    manager.logger = { async error() {}, async warn() {} };
    function interaction(action, actor = ids.rh, modal = false) {
        const i = { guildId: ids.guild, channelId: ids.ticket, user: { id: actor }, customId: action, deferred: false, replied: false,
            fields: { getTextInputValue: () => 'Dossier non retenu' }, isButton: () => !modal, isModalSubmit: () => modal,
            async deferReply() { i.deferred = true; }, async editReply(value) { i.response = value; },
            async reply(value) { i.replied = true; i.response = value; },
            async fetchReply() { return { id: id(++serial), channelId: ids.ticket }; },
            async showModal(modal) { i.modal = modal; },
        };
        return i;
    }
    const run = async (action, actor, modal = false, extra = {}) => {
        const i = interaction(action, actor, modal); await manager.handler(i, { demandeId: 1, guildId: ids.guild, ...extra }); return i;
    };
    return { d, bot, em, manager, scheduler, applicant, operations, contexts, requests, run, interaction, profile, channels, makeChannel,
        failNickname: v => failNickname = v, failChannelCreation: v => failChannelCreation = v, failMessage: v => failMessage = v };
}

test('declaration RSI puis deux validations RH : rôles, dates, profil et boutons persistants', async () => {
    const f = fixture();
    await f.run(A.Submit, ids.applicant);
    assert.equal(f.d.status, 'review'); assert.equal(f.applicant.roles.cache.has(ids.postulant), true);
    assert.equal(f.operations.some(x => x[0] === 'add-role'), false);
    assert.equal(f.profile.status, 'Candidatures');
    assert.equal(f.operations.filter(x => x[0] === 'send' && x[2].allowedMentions?.roles).length, 1);
    await f.run(A.Validate, ids.rh);
    assert.equal(f.d.status, 'postulant'); assert.equal(f.applicant.displayName, '[P] Alice');
    await f.run(A.Interview, ids.rh);
    assert.equal(f.d.status, 'candidate'); assert.ok(f.d.candidateAt);
    assert.equal(f.applicant.displayName, '[C-1CC] Alice');
    assert.equal(f.applicant.roles.cache.has(ids.unrelated), true);
    assert.equal(f.applicant.roles.cache.has(ids.official), false);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.ok(f.contexts.some(c => c.customId === A.Submit && c.data.demandeId === 1));
    assert.ok(f.contexts.some(c => c.customId === A.Interview));
});

test('confirmation RSI réservée au demandeur dans son ticket', async () => {
    const f = fixture(); await f.run(A.Submit, ids.outsider); assert.equal(f.d.status, 'waiting_rsi');
    const i = f.interaction(A.Submit, ids.applicant); i.channelId = ids.engagement;
    await f.manager.handler(i, { demandeId: 1, guildId: ids.guild }); assert.equal(f.d.status, 'waiting_rsi');
});

test('validation interdite au demandeur et aux personnes hors RH', async () => {
    const f = fixture({ status: 'review' });
    await f.run(A.Validate, ids.applicant); await f.run(A.Validate, ids.outsider);
    assert.equal(f.d.status, 'review'); assert.equal(f.operations.some(x => x[0] === 'add-role'), false);
});

test('administrateur autorisé sans rôle RH', async () => {
    const f = fixture({ status: 'review' }); await f.run(A.Validate, ids.bot); assert.equal(f.d.status, 'postulant');
});

test('deux validations concurrentes produisent une seule décision', async () => {
    const f = fixture({ status: 'review' });
    await Promise.all([f.run(A.Validate, ids.rh), f.run(A.Validate, ids.rh)]);
    assert.equal(f.d.status, 'postulant'); assert.equal(f.d.decisions.length, 1);
});

test('échec de pseudo : validation conservée et préfixe repris par une nouvelle instance', async () => {
    const f = fixture({ status: 'review' }); f.failNickname(true);
    const response = await f.run(A.Validate, ids.rh);
    assert.equal(f.d.status, 'postulant'); assert.equal(f.d.pendingStatus, undefined);
    assert.equal(response.response, 'Demande mise à jour.');
    f.failNickname(false);
    const restarted = new RecrutementManager(f.bot); await restarted.resume(f.d.id);
    assert.equal(f.applicant.displayName, '[P] Alice');
    assert.equal(f.d.status, 'postulant'); assert.equal(f.d.pendingStatus, undefined);
    assert.equal(f.d.decisions.length, 1);
});

test('erreur de notification : décision conservée et rendu repris sans réattribuer les rôles', async () => {
    const f = fixture({ status: 'review' }); f.failMessage(true); await f.run(A.Validate, ids.rh);
    assert.equal(f.d.status, 'postulant'); assert.equal(f.d.needsSync, true);
    const count = f.operations.filter(x => x[0] === 'add-role').length;
    f.failMessage(false); await f.manager.resume(f.d.id);
    assert.equal(f.d.needsSync, false); assert.equal(f.operations.filter(x => x[0] === 'add-role').length, count);
});

test('refus confirmé retire les rôles attribuables et conserve le ticket', async () => {
    const f = fixture({ status: 'postulant' });
    await f.run(A.ConfirmRefuse, ids.rh, true, { actorId: ids.rh, expectedStatus: 'postulant' });
    assert.equal(f.d.status, 'refused'); assert.equal(f.applicant.roles.cache.size, 1);
    assert.equal(f.applicant.displayName, 'Alice'); assert.ok(f.channels.has(ids.ticket));
    assert.equal(f.d.decisions[0].reason, 'Dossier non retenu');
});

test('confirmation de refus liée à son auteur et à l’état initial', async () => {
    const f = fixture({ status: 'postulant' });
    await f.run(A.ConfirmRefuse, ids.rh, true, { actorId: ids.outsider, expectedStatus: 'postulant' });
    await f.run(A.ConfirmRefuse, ids.rh, true, { actorId: ids.rh, expectedStatus: 'review' });
    assert.equal(f.d.status, 'postulant');
});

test('ouverture issue du rôle d’intégration, privée et sans doublon', async () => {
    const f = fixture({ noRequest: true });
    await Promise.all([f.manager.onMember(f.applicant), f.manager.onMember(f.applicant)]);
    assert.equal(f.requests.length, 1);
    assert.equal(f.operations.filter(x => x[0] === 'create-channel').length, 1);
    const options = f.operations.find(x => x[0] === 'create-channel')[1];
    assert.equal(options.parent, ids.category);
    assert.equal(options.permissionOverwrites[0].deny[0], P.ViewChannel);
});

test('une ancienne candidature ne reçoit pas un deuxième ticket', async () => {
    const f = fixture({ legacy: true, noRequest: true }); await f.manager.onMember(f.applicant);
    assert.equal(f.requests.length, 0); assert.equal(f.operations.some(x => x[0] === 'create-channel'), false);
});

test('reprise d’un salon créé avant perte du commit par marqueur, jamais par pseudo', async () => {
    const f = fixture(); f.d.channelId = undefined;
    f.channels.get(ids.ticket).topic = `recrutement:${ids.guild}:1`;
    await f.manager.resume(1);
    assert.equal(f.d.channelId, ids.ticket); assert.equal(f.operations.some(x => x[0] === 'create-channel'), false);
});

test('expiration conserve le salon en retirant son accès individuel', async () => {
    const f = fixture(); f.d.pendingStatus = 'expired';
    await f.manager.resume(1);
    assert.equal(f.d.status, 'expired'); assert.ok(f.channels.has(ids.ticket));
    assert.ok(f.operations.some(x => x[0] === 'overwrite' && x[1] === ids.applicant && x[2].ViewChannel === false));
});

test('messages du candidat et du staff relancent le délai jusqu’à validation RH', async () => {
    const f = fixture(); const initial = f.d.lastActivityAt.getTime(), later = initial + 60_000;
    await f.manager.onMessage({ author: { id: ids.rh, bot: false }, guildId: ids.guild, channelId: ids.ticket, createdTimestamp: later });
    assert.equal(f.d.lastActivityAt.getTime(), later);
    await f.manager.onMessage({ author: { id: ids.applicant, bot: false }, guildId: ids.guild, channelId: ids.ticket, createdTimestamp: later });
    assert.equal(f.d.lastActivityAt.getTime(), later);
    f.d.status = 'review';
    await f.manager.onMessage({ author: { id: ids.applicant, bot: false }, guildId: ids.guild, channelId: ids.ticket, createdTimestamp: later + 60_000 });
    assert.equal(f.d.lastActivityAt.getTime(), later + 60_000);
});

test('expiration arrêtée à la validation RH, pas à la déclaration du candidat', () => {
    const f = fixture(); const now = f.d.lastActivityAt.getTime() + 7 * 86400_000;
    assert.equal(recruitmentExpired(f.d, now - 1), false); assert.equal(recruitmentExpired(f.d, now), true);
    f.d.pendingStatus = 'review'; assert.equal(recruitmentExpired(f.d, now), true);
    f.d.pendingStatus = undefined; f.d.status = 'review'; assert.equal(recruitmentExpired(f.d, now), true);
    f.d.pendingStatus = 'postulant'; assert.equal(recruitmentExpired(f.d, now), false);
    f.d.pendingStatus = undefined; f.d.status = 'postulant'; assert.equal(recruitmentExpired(f.d, now), false);
});

test('retrait de A après 7 jours ne retire pas P', async () => {
    const f = fixture({ status: 'postulant' }); f.applicant.displayName = '[P] Alice';
    f.d.arrivalTaggedAt = new Date(Date.now() - 8 * 86400_000);
    await f.scheduler.checkRH(); assert.equal(f.applicant.displayName, '[P] Alice'); assert.ok(f.d.arrivalRemovedAt);
});

test('configuration rechargée : autorisation vérifiée à chaque action', async () => {
    const f = fixture({ status: 'review' }); settings['site.roles.rh'] = ids.unrelated;
    await f.run(A.Validate, ids.rh); assert.equal(f.d.status, 'review');
    settings['site.roles.rh'] = ids.staff; await f.run(A.Validate, ids.rh); assert.equal(f.d.status, 'postulant');
});

test('rôle Candidat identique au rôle Postulant refusé sans droits nouveaux', async () => {
    const f = fixture({ status: 'postulant' }); settings['bot.recrutement.role_candidat'] = ids.postulant;
    await f.run(A.Interview, ids.rh); assert.equal(f.d.status, 'postulant');
    assert.equal(f.operations.some(x => x[0] === 'add-role'), false);
});

test('changement de catégorie ne déplace pas le ticket existant', async () => {
    const f = fixture(); settings['bot.recrutement.category_admission'] = '';
    await f.manager.resume(1); assert.equal(f.d.channelId, ids.ticket);
});

test('vues de fin sans décisions, préfixes connus uniquement et longueur Discord', () => {
    const f = fixture({ status: 'candidate' });
    const actions = View.staff(f.bot, f.d).rows.flatMap(row => row.components).map(c => c.data.custom_id);
    assert.ok(actions.includes('parrain_staff'));
    assert.ok(!actions.includes(A.Interview) && !actions.includes(A.Refuse));
    assert.equal(recruitmentNickname('[P] [A] Alice', '[C-1CC]'), '[C-1CC] Alice');
    assert.equal(recruitmentNickname('[Autre] Alice', '[P]'), '[P] [Autre] Alice');
    assert.equal(recruitmentNickname('x'.repeat(50), '[P]').length, 32);
});

test('pseudo à l\'acceptation : préfixes de recrutement retirés, [1CC] unique, 32 caractères', () => {
    assert.equal(recruitmentNickname('[C-1CC] Alice', '[1CC]'), '[1CC] Alice');
    assert.equal(recruitmentNickname('[P] [A] Alice', '[1CC]'), '[1CC] Alice');
    assert.equal(recruitmentNickname('[1CC] Alice', '[1CC]'), '[1CC] Alice');
    const long = recruitmentNickname('x'.repeat(50), '[1CC]');
    assert.equal(long.length, 32);
    assert.ok(long.startsWith('[1CC] '));
});


test('bouton Refuser puis formulaire : contexte persistant lié au RH', async () => {
    const f = fixture({ status: 'review' });
    await f.run(A.Refuse, ids.rh);
    const context = f.contexts.find(c => c.customId === A.ConfirmRefuse);
    assert.equal(context.data.actorId, ids.rh);
    assert.equal(context.data.expectedStatus, 'review');
    const button = f.interaction(A.ConfirmRefuse, ids.rh);
    await f.manager.handler(button, context.data);
    assert.equal(button.modal.data.custom_id, A.ConfirmRefuse);
    const modal = f.interaction(A.ConfirmRefuse, ids.rh, true);
    await f.manager.handler(modal, context.data);
    assert.equal(f.d.status, 'refused');
});

test('le scheduler expire un ticket inactif et reprend après redémarrage', async () => {
    const f = fixture();
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    f.manager.publishEngagement = async () => {};
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'expired');
    assert.equal(f.d.pendingStatus, undefined);
});

for (const status of ['waiting_rsi', 'review']) {
    test(`le scheduler clôt en « integrated » une demande ${status} dont le demandeur est déjà Membre`, async () => {
        const f = fixture();
        f.d.status = status;
        f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
        f.applicant.roles.cache.set(ids.official, f.bot.roleMember);
        f.manager.publishEngagement = async () => {};
        f.operations.length = 0;
        await f.scheduler.checkRH();
        assert.equal(f.d.status, 'integrated');
        assert.equal(f.d.pendingStatus, undefined);
        assert.ok(!f.operations.some(([name, value]) => name === 'remove-role' && value === ids.postulant));
        assert.ok(f.applicant.roles.cache.has(ids.postulant));
        assert.ok(!f.d.decisions.some(d => d.to === 'expired'));
    });
}

test('le scheduler clôt aussi une demande récente dont le demandeur est déjà Membre', async () => {
    const f = fixture();
    f.applicant.roles.cache.set(ids.official, f.bot.roleMember);
    f.manager.publishEngagement = async () => {};
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'integrated');
});

test('un demandeur parti du serveur ne bloque pas le scheduler (code 10007)', async () => {
    const f = fixture();
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    const fetch = f.bot.guild.members.fetch;
    f.bot.guild.members.fetch = async key => {
        if (key && typeof key === 'object' && key.user === ids.applicant) throw Object.assign(new Error('Unknown Member'), { code: 10007 });
        return fetch(key);
    };
    f.manager.publishEngagement = async () => {};
    await f.scheduler.checkRH();
    assert.notEqual(f.d.status, 'integrated');
});

test('un message envoyé pendant un arrêt du bot empêche une expiration erronée', async () => {
    const f = fixture();
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    const ticket = f.channels.get(ids.ticket);
    const recent = await ticket.send({ content: 'Ma candidature arrive' });
    recent.author.id = ids.applicant; recent.createdTimestamp = Date.now();
    f.manager.publishEngagement = async () => {};
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'waiting_rsi');
    assert.equal(f.d.lastActivityAt.getTime(), recent.createdTimestamp);
});


test('transition fiable même si le cache Discord ne reflète pas encore le rôle ajouté', async () => {
    const f = fixture({ status: 'postulant' });
    let remoteRoles = new Set(f.applicant.roles.cache.keys());
    f.applicant.roles.add = async value => { remoteRoles.add(value); }; // discord.js returns a clone, not an updated cache.
    f.applicant.roles.remove = async value => {
        if (Array.isArray(value)) remoteRoles = new Set([...f.applicant.roles.cache.keys()].filter(id => !value.includes(id)));
        else remoteRoles.delete(value);
    };
    await f.run(A.Interview, ids.rh);
    assert.equal(f.d.status, 'candidate');
    assert.ok(remoteRoles.has(ids.candidate));
    assert.ok(remoteRoles.has(ids.unrelated));
    assert.equal(remoteRoles.has(ids.postulant), false);
});


const { applyArrivalPrefix, expireArrivalPrefix } = await import('../dist/src/utils/ArrivalPrefix.js');
test('A attribué dès l’arrivée sans rôle Postulant et même recrutement désactivé', async () => {
    const f = fixture({ noRequest: true }); settings['bot.recrutement.enabled'] = false;
    f.applicant.roles.cache.delete(ids.postulant); f.applicant.displayName = 'Alice';
    await applyArrivalPrefix(f.applicant);
    assert.equal(f.applicant.displayName, '[A] Alice');
    await f.manager.onMember(f.applicant); assert.equal(f.requests.length, 0);
});

test('Postulant seul déclenche le ticket sans ancien rôle Demande', async () => {
    const f = fixture({ noRequest: true });
    assert.equal(settings['bot.recrutement.role_demande'], undefined);
    await f.manager.onMember(f.applicant);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].status, 'waiting_rsi');
    assert.equal(f.operations.some(x => x[0] === 'add-role'), false);
});

test('ouvrir un ticket tardivement ne réattribue pas A et ne redémarre pas sa durée', async () => {
    const f = fixture({ noRequest: true });
    f.applicant.joinedTimestamp = Date.now() - 10 * 86400_000; f.applicant.displayName = 'Alice';
    await f.manager.onMember(f.applicant);
    assert.equal(f.applicant.displayName, 'Alice');
    assert.equal(f.requests[0].arrivalTaggedAt.getTime(), f.applicant.joinedTimestamp);
});

test('délais en jours : formatage, validation et lecture des paramètres', async () => {
    const { formatDays, validDays, daysToMs, readDelayDays, ticketInactivityDays, arrivalDelayMs } = await import('../dist/src/utils/RecruitmentDelays.js');
    assert.equal(formatDays(1), '1 jour'); assert.equal(formatDays(7), '7 jours');
    assert.equal(daysToMs(3), 3 * 86400_000);
    for (const bad of [0, -2, 1.5, NaN, '3', null, undefined]) assert.equal(validDays(bad, 7), 7);
    assert.equal(validDays(3, 7), 3);
    fixture();
    assert.equal(await ticketInactivityDays(), 7); assert.equal(await arrivalDelayMs(), 7 * 86400_000);
    settings['bot.recrutement.ticket_inactivity_days'] = 3; settings['bot.recrutement.arrival_days'] = '2';
    assert.equal(await ticketInactivityDays(), 3); assert.equal(await arrivalDelayMs(), 2 * 86400_000);
    for (const bad of [0, -4, 'abc', null]) {
        settings['bot.recrutement.ticket_inactivity_days'] = bad;
        assert.equal(await ticketInactivityDays(), 7, String(bad));
    }
    settingsService.getInt = async () => { throw new Error('indisponible'); };
    assert.equal(await readDelayDays('bot.recrutement.mentor_wait_days', 2), 2);
    delete settingsService.getInt;
});

test('expiration du ticket : 7 jours par défaut, durée personnalisée prise en compte', () => {
    const f = fixture(); const t = f.d.lastActivityAt.getTime();
    assert.equal(recruitmentExpired(f.d, t + 7 * 86400_000 - 1), false);
    assert.equal(recruitmentExpired(f.d, t + 7 * 86400_000), true);
    assert.equal(recruitmentExpired(f.d, t + 3 * 86400_000 - 1, 3 * 86400_000), false);
    assert.equal(recruitmentExpired(f.d, t + 3 * 86400_000, 3 * 86400_000), true);
    assert.equal(recruitmentExpired(f.d, t + 3 * 86400_000), false);
});

test('préfixe A : 7 jours par défaut, durée personnalisée indépendante de l’inactivité du ticket', async () => {
    const f = fixture({ noRequest: true }); settings['bot.recrutement.enabled'] = false;
    f.applicant.roles.cache.delete(ids.postulant);
    f.applicant.displayName = '[A] Alice'; f.applicant.joinedTimestamp = Date.now() - 4 * 86400_000;
    await expireArrivalPrefix(f.applicant); assert.equal(f.applicant.displayName, '[A] Alice');
    await expireArrivalPrefix(f.applicant, Date.now(), 3 * 86400_000); assert.equal(f.applicant.displayName, 'Alice');
    f.applicant.displayName = '[A] Alice';
    settings['bot.recrutement.arrival_days'] = 3; settings['bot.recrutement.ticket_inactivity_days'] = 30;
    await f.scheduler.checkRH(); assert.equal(f.applicant.displayName, 'Alice');
    f.applicant.displayName = '[A] Alice'; settings['bot.recrutement.arrival_days'] = 'abc';
    await f.scheduler.checkRH(); assert.equal(f.applicant.displayName, '[A] Alice');
});

test('expiration de A indépendante du recrutement et préservation des préfixes suivants', async () => {
    const f = fixture({ noRequest: true }); settings['bot.recrutement.enabled'] = false;
    f.applicant.roles.cache.delete(ids.postulant);
    f.applicant.joinedTimestamp = Date.now() - 8 * 86400_000;
    await f.scheduler.checkRH(); assert.equal(f.applicant.displayName, 'Alice');
    f.applicant.displayName = '[P] Alice'; await expireArrivalPrefix(f.applicant);
    assert.equal(f.applicant.displayName, '[P] Alice');
});

test('un passage RH en cours empêche le chevauchement du suivant', async () => {
    const f = fixture();
    let release, reachedList;
    const blocked = new Promise(resolve => { release = resolve; });
    const listReached = new Promise(resolve => { reachedList = resolve; });
    const listMembers = f.bot.guild.members.list;
    let calls = 0;
    f.bot.guild.members.list = async () => {
        calls++; reachedList(); await blocked;
        return listMembers();
    };
    const first = f.scheduler.checkRH();
    await Promise.race([listReached, new Promise((_, reject) => setTimeout(() => reject(new Error('le premier passage n’atteint pas la liste des membres')), 2000).unref())]);
    await f.scheduler.checkRH();
    assert.equal(calls, 1);
    release();
    await first;
    await f.scheduler.checkRH();
    assert.equal(calls, 2);
});

test('suivi par dossier : [A] retiré à la durée configurée, sans lien avec l’inactivité du ticket', async () => {
    const f = fixture({ status: 'postulant' }); f.applicant.displayName = '[A] Alice';
    f.d.arrivalTaggedAt = new Date(Date.now() - 4 * 86400_000);
    await f.scheduler.checkRH(); assert.equal(f.d.arrivalRemovedAt, undefined);
    settings['bot.recrutement.arrival_days'] = 3;
    await f.scheduler.checkRH(); assert.ok(f.d.arrivalRemovedAt);
});

test('textes du ticket : durée configurée, « 1 jour » au singulier', async () => {
    for (const [days, text] of [[undefined, '7 jours'], [3, '3 jours'], [1, '1 jour']]) {
        const f = fixture({ noRequest: true });
        if (days !== undefined) settings['bot.recrutement.ticket_inactivity_days'] = days;
        await f.manager.onMember(f.applicant);
        const d = f.requests[0];
        const welcome = await f.channels.get(d.channelId).messages.fetch(d.welcomeMessageId);
        const description = welcome.embeds[0].data.description;
        assert.match(description, new RegExp(`Vous avez ${text} pour déposer`));
        assert.match(description, new RegExp(`relance le délai de ${text}\\.`));
        if (days !== undefined) assert.doesNotMatch(description, /7 jours/);
    }
});

test('parcours direct : ouverture, notification RH, validation RSI puis entretien sur la même fiche', async () => {
    const f = fixture({ noRequest: true });
    await applyArrivalPrefix(f.applicant);
    assert.equal(f.applicant.displayName, '[A] Alice');
    await f.manager.onMember(f.applicant);
    const d = f.requests[0];
    assert.equal(f.applicant.displayName, '[A] Alice');
    const ticket = f.channels.get(d.channelId);
    const welcome = await ticket.messages.fetch(d.welcomeMessageId);
    assert.match(welcome.embeds[0].data.description, /7 jours/);
    assert.match(welcome.embeds[0].data.description, /https:\/\/robertsspaceindustries.com\/orgs\/1CC/);
    const rh = f.channels.get(d.notificationChannelId);
    assert.equal(rh.isThread(), true);
    const notificationId = d.notificationMessageId;
    const notification = await rh.messages.fetch(notificationId);
    assert.equal(notification.embeds[0].data.title, 'Annonce Candidature');
    assert.equal(notification.embeds[0].data.color, 0x00AE86);
    assert.equal(notification.embeds[0].data.thumbnail.url, 'https://example.invalid/avatar.png');
    assert.ok(f.contexts.some(c => c.customId === A.Validate));
    assert.ok(f.contexts.some(c => c.customId === A.Refuse));
    assert.deepEqual(notification.allowedMentions.roles, []);
    await f.run(A.Validate, ids.rh);
    assert.equal(d.status, 'postulant');
    assert.equal(f.applicant.displayName, '[P] Alice');
    assert.equal(recruitmentExpired(d, Date.now() + 8 * 86400_000), false);
    assert.equal(d.notificationMessageId, notificationId);
    assert.ok(f.contexts.some(c => c.customId === A.Interview));
    await f.run(A.Interview, ids.rh);
    assert.equal(d.status, 'candidate');
    assert.equal(f.applicant.displayName, '[C-1CC] Alice');
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.equal(f.applicant.roles.cache.has(ids.candidate), true);
    assert.equal(d.notificationMessageId, notificationId);
});

test('expiration retire Postulant, ferme l’accès au ticket et conserve l’historique RH', async () => {
    const f = fixture({ status: 'review' });
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'expired');
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.ok(f.channels.has(ids.ticket));
    assert.ok(f.operations.some(x => x[0] === 'overwrite' && x[2].ViewChannel === false));
});

test('activité d’un tiers ou d’un bot ignorée, activité après validation RH ignorée', async () => {
    const f = fixture();
    const initial = f.d.lastActivityAt.getTime();
    for (const [actor, bot] of [[ids.outsider, false], [ids.bot, true]]) {
        await f.manager.onMessage({ author: { id: actor, bot }, guildId: ids.guild, channelId: ids.ticket, createdTimestamp: initial + 60_000 });
    }
    assert.equal(f.d.lastActivityAt.getTime(), initial);
    f.d.status = 'postulant';
    await f.manager.onMessage({ author: { id: ids.rh, bot: false }, guildId: ids.guild, channelId: ids.ticket, createdTimestamp: initial + 60_000 });
    assert.equal(f.d.lastActivityAt.getTime(), initial);
});

test('message du staff pendant un arrêt du bot empêche une expiration erronée', async () => {
    const f = fixture();
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    const message = await f.channels.get(ids.ticket).send({ content: 'Entretien en préparation' });
    message.author = { id: ids.rh, bot: false };
    message.createdTimestamp = Date.now();
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'waiting_rsi');
    assert.equal(f.d.lastActivityAt.getTime(), message.createdTimestamp);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), true);
});

test('refus possible dès l’ouverture sans déclaration RSI', async () => {
    const f = fixture();
    await f.run(A.ConfirmRefuse, ids.rh, true, { actorId: ids.rh, expectedStatus: 'waiting_rsi' });
    assert.equal(f.d.status, 'refused');
});

test('un membre en attente d’admission reçoit son ticket après validation des règles', async () => {
    const f = fixture({ noRequest: true });
    f.applicant.pending = true;
    await f.manager.onMember(f.applicant);
    assert.equal(f.requests.length, 0);
    f.applicant.pending = false;
    await f.manager.onMember(f.applicant);
    assert.equal(f.requests.length, 1);
});

test('le rôle RH unique a accès au ticket et peut valider', async () => {
    const f = fixture({ noRequest: true });
    await f.manager.onMember(f.applicant);
    const options = f.operations.find(x => x[0] === 'create-channel')[1];
    assert.ok(options.permissionOverwrites.some(x => x.id === ids.staff));
    assert.equal(options.permissionOverwrites.some(x => x.id === ids.unrelated), false);
    await f.run(A.Validate, ids.rh);
    assert.equal(f.requests[0].status, 'postulant');
});

test('un tableau de rôles RH est refusé : le paramètre attend un ID unique', async () => {
    const f = fixture({ noRequest: true });
    settings['site.roles.rh'] = [ids.staff, ids.unrelated];
    await assert.rejects(f.manager.onMember(f.applicant), /un seul ID de rôle RH/);
    assert.equal(f.operations.some(x => x[0] === 'create-channel'), false);
});

test('boutons lien : aucun contexte sans customId lors de l’envoi et de l’édition du ticket', async () => {
    const f = fixture();
    const view = View.ticket(f.bot, f.d);
    const ticket = f.channels.get(ids.ticket);
    const message = await view.send(ticket, { content: 'Votre candidature' });
    await view.edit(message, { content: 'Candidature mise à jour' });
    assert.equal(message.components[0].components[0].data.url, 'https://robertsspaceindustries.com/orgs/1CC');
    const contexts = f.contexts.filter(c => c.messageId === message.id);
    assert.deepEqual(contexts.map(c => c.customId), [A.Submit]);
});

test('fiche RH Candidat : accès au parrainage et lien sans contexte invalide', async () => {
    const f = fixture({ status: 'candidate' });
    const message = await View.staff(f.bot, f.d).send(f.channels.get(ids.channelRh), { content: 'Candidature validée' });
    const components = message.components.flatMap(row => row.components);
    assert.ok(components.some(c => c.data.url));
    assert.deepEqual(f.contexts.map(c => c.customId).sort(), ['parrain_directory', 'parrain_staff']);
    assert.ok(f.contexts.every(c => typeof c.customId === 'string'));
});

test('reprise : le pseudo n\'est pas modifié en waiting_rsi et review', async () => {
    for (const status of ['waiting_rsi', 'review']) {
        const f = fixture({ status }); f.applicant.displayName = '[A] Alice';
        await f.manager.resume(1);
        assert.equal(f.applicant.displayName, '[A] Alice');
        assert.equal(f.operations.filter(x => x[0] === 'nickname').length, 0);
    }
});

test('reprise de demande : P appliqué une seule fois et Candidat préservé', async () => {
    const f = fixture({ status: 'postulant' });
    await f.manager.resume(1);
    assert.equal(f.applicant.displayName, '[P] Alice');
    const count = f.operations.filter(x => x[0] === 'nickname').length;
    await f.manager.resume(1);
    assert.equal(f.operations.filter(x => x[0] === 'nickname').length, count);
    f.d.status = 'candidate';
    f.applicant.displayName = '[C-1CC] Alice';
    await f.manager.resume(1);
    assert.equal(f.applicant.displayName, '[C-1CC] Alice');
});

test('dépôt RSI et validations RH : annonces visibles dans le ticket sans doublon à la reprise', async () => {
    const f = fixture();
    for (const [action, actor, expected] of [
        [A.Submit, ids.applicant, /Merci de patienter/],
        [A.Validate, ids.rh, /entretien vocal/],
        [A.Interview, ids.rh, /désormais Candidat/],
    ]) {
        await f.run(action, actor);
        const decision = f.d.decisions.at(-1);
        assert.ok(decision.ticketMessageId);
        const message = await f.channels.get(ids.ticket).messages.fetch(decision.ticketMessageId);
        assert.match(message.content, expected);
        assert.equal(message.flags, undefined);
        const count = f.operations.filter(x => x[0] === 'send' && x[1] === ids.ticket).length;
        f.d.needsSync = true;
        await f.manager.resume(1);
        assert.equal(f.operations.filter(x => x[0] === 'send' && x[1] === ids.ticket).length, count);
    }
});

test('refus RH : annonce du refus et du motif dans le ticket', async () => {
    const f = fixture({ status: 'postulant' });
    await f.run(A.ConfirmRefuse, ids.rh, true, { actorId: ids.rh, expectedStatus: 'postulant' });
    const message = await f.channels.get(ids.ticket).messages.fetch(f.d.decisions.at(-1).ticketMessageId);
    assert.match(message.content, /refusé votre candidature/);
    assert.match(message.content, /Dossier non retenu/);
    const welcome = await f.channels.get(ids.ticket).messages.fetch(f.d.welcomeMessageId);
    assert.match(welcome.embeds[0].data.description, /parcours de recrutement est terminé/);
});

test('actions RH : la réponse différée est terminée après validation ou refus', async () => {
    for (const [status, action, modal] of [
        ['waiting_rsi', A.Validate, false],
        ['postulant', A.Interview, false],
        ['postulant', A.ConfirmRefuse, true],
    ]) {
        const f = fixture({ status });
        const response = await f.run(action, ids.rh, modal);
        assert.equal(response.deferred, true);
        assert.equal(response.response, 'Demande mise à jour.');
        assert.ok(f.d.decisions.at(-1).ticketMessageId);
    }
});

test('salons Postulant masqués jusqu’à validation RSI, ticket accessible et restauration après redémarrage', async () => {
    const f = fixture();
    const channel = f.channels.get(ids.engagement);
    channel.permissionOverwrites.cache.set(ids.postulant, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() });
    await f.manager.onMember(f.applicant);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), true);
    assert.equal(channel.permissionOverwrites.cache.get(ids.applicant).deny.has(P.ViewChannel), true);
    assert.equal(f.channels.get(ids.ticket).permissionOverwrites.cache.get(ids.applicant)?.deny.has(P.ViewChannel) ?? false, false);
    await f.run(A.Submit, ids.applicant);
    assert.equal(channel.permissionOverwrites.cache.get(ids.applicant).deny.has(P.ViewChannel), true);
    f.bot.recrutementManager = new RecrutementManager(f.bot);
    await f.bot.recrutementManager.resume(1);
    assert.equal(f.d.postulantChannelAccess[ids.engagement].viewChannel, null);
    await f.run(A.Validate, ids.rh);
    assert.equal(f.d.status, 'postulant');
    assert.equal(channel.permissionOverwrites.cache.has(ids.applicant), false);
    assert.deepEqual(f.d.postulantChannelAccess, {});
});

test('déblocage Postulant restaure ViewChannel sans effacer les autres permissions individuelles', async () => {
    const f = fixture();
    const channel = f.channels.get(ids.engagement);
    channel.permissionOverwrites.cache.set(ids.postulant, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() });
    channel.permissionOverwrites.cache.set(ids.applicant, { allow: new PermissionsBitField([P.ViewChannel, P.SendMessages]), deny: new PermissionsBitField(P.AttachFiles) });
    await f.manager.onMember(f.applicant);
    assert.equal(channel.permissionOverwrites.cache.get(ids.applicant).deny.has(P.ViewChannel), true);
    await f.run(A.Validate, ids.rh);
    const restored = channel.permissionOverwrites.cache.get(ids.applicant);
    assert.equal(restored.allow.has(P.ViewChannel), true);
    assert.equal(restored.allow.has(P.SendMessages), true);
    assert.equal(restored.deny.has(P.AttachFiles), true);
});

test('expiration retire Postulant puis nettoie ses blocages individuels de visibilité', async () => {
    const f = fixture();
    const channel = f.channels.get(ids.engagement);
    channel.permissionOverwrites.cache.set(ids.postulant, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() });
    await f.manager.onMember(f.applicant);
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    await f.scheduler.checkRH();
    assert.equal(f.d.status, 'expired');
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.equal(channel.permissionOverwrites.cache.has(ids.applicant), false);
});

test('les restrictions Postulant couvrent les vocaux, forums et catégories', async () => {
    const f = fixture();
    const channels = [
        f.makeChannel(id(901), ChannelType.GuildVoice),
        f.makeChannel(id(902), ChannelType.GuildForum),
        f.makeChannel(id(903), ChannelType.GuildCategory),
    ];
    for (const channel of channels) {
        channel.permissionOverwrites.cache.set(ids.postulant, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() });
    }
    await f.manager.onMember(f.applicant);
    for (const channel of channels) assert.equal(channel.permissionOverwrites.cache.get(ids.applicant).deny.has(P.ViewChannel), true);
    await f.run(A.Validate, ids.rh);
    for (const channel of channels) assert.equal(channel.permissionOverwrites.cache.has(ids.applicant), false);
});

test('une erreur Discord conserve la sauvegarde pour reprendre le blocage sans perdre les droits initiaux', async () => {
    const f = fixture();
    const channel = f.channels.get(ids.engagement);
    channel.permissionOverwrites.cache.set(ids.postulant, { allow: new PermissionsBitField(P.ViewChannel), deny: new PermissionsBitField() });
    const edit = channel.permissionOverwrites.edit.bind(channel.permissionOverwrites);
    channel.permissionOverwrites.edit = async () => { throw new Error('Permissions indisponibles'); };
    await assert.rejects(f.manager.onMember(f.applicant), /Permissions indisponibles/);
    assert.equal(f.d.postulantChannelAccess[ids.engagement].viewChannel, null);
    assert.equal(f.d.needsSync, true);
    channel.permissionOverwrites.edit = edit;
    await f.manager.resume(1);
    assert.equal(channel.permissionOverwrites.cache.get(ids.applicant).deny.has(P.ViewChannel), true);
    await f.run(A.Validate, ids.rh);
    assert.equal(channel.permissionOverwrites.cache.has(ids.applicant), false);
});

test('entretien accepté ouvre le panneau de parrainage sans attendre une attribution', async () => {
    const f = fixture({ status: 'postulant' });
    const panels = [];
    f.bot.parrainageManager = {
        summary: async () => 'Parrain à attribuer',
        async staffPanel(interaction, demandeId, accepted) {
            panels.push({ demandeId, accepted });
            await interaction.editReply('Choisir un parrain ou attribuer plus tard');
        },
    };
    const response = await f.run(A.Interview, ids.rh);
    assert.equal(f.d.status, 'candidate');
    assert.equal(f.d.mentorship.waitingSince, f.d.candidateAt.toISOString());
    assert.deepEqual(panels, [{ demandeId: f.d.id, accepted: true }]);
    assert.match(response.response, /plus tard/);
    assert.equal(f.applicant.roles.cache.has(ids.official), false);
});

test('échec de la liste REST : les dossiers RH et les parrainages restent traités', async () => {
    const f = fixture();
    f.bot.guild.members.list = async () => { throw new Error('REST indisponible'); };
    let parrainageChecks = 0;
    f.bot.parrainageManager = { async check() { parrainageChecks++; } };
    f.d.lastActivityAt = new Date(Date.now() - 8 * 86400_000);
    await f.scheduler.checkRH();
    assert.equal(parrainageChecks, 1);
    assert.equal(f.d.status, 'expired');
    assert.equal(f.scheduler.checking, false);
});

test('bouton « Je postule » : rôle Postulant ajouté, ticket créé, clic répété sans doublon', async () => {
    const f = fixture({ noRequest: true });
    f.applicant.roles.cache.delete(ids.postulant); f.applicant.pending = false;
    const first = f.interaction(A.Apply, ids.applicant);
    await f.manager.applyFromButton(first);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), true);
    assert.equal(f.requests.length, 1);
    assert.match(first.response, /Votre ticket de candidature/);
    await f.manager.applyFromButton(f.interaction(A.Apply, ids.applicant));
    assert.equal(f.requests.length, 1);
    assert.equal(f.operations.filter(x => x[0] === 'create-channel').length, 1);
});

test('bouton « Je postule » : membre officiel refusé sans demande ni rôle', async () => {
    const f = fixture({ noRequest: true });
    f.applicant.roles.cache.delete(ids.postulant); f.applicant.roles.cache.set(ids.official, { id: ids.official });
    const i = f.interaction(A.Apply, ids.applicant);
    await f.manager.applyFromButton(i);
    assert.equal(f.requests.length, 0);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.match(i.response, /déjà partie/);
});

test('bouton « Je postule » : demande refusée, expirée, intégrée ou Candidat sans nouveau ticket ni rôle Postulant', async () => {
    for (const status of ['refused', 'expired', 'integrated', 'candidate']) {
        const f = fixture({ status });
        f.applicant.roles.cache.delete(ids.postulant);
        f.operations.length = 0;
        const i = f.interaction(A.Apply, ids.applicant);
        await f.manager.applyFromButton(i);
        assert.equal(f.requests.length, 1, status);
        assert.equal(f.operations.some(x => x[0] === 'create-channel'), false, status);
        assert.equal(f.operations.some(x => x[0] === 'add-role'), false, status);
        assert.equal(f.applicant.roles.cache.has(ids.postulant), false, status);
        if (status === 'candidate') assert.match(i.response, /Votre ticket de candidature/);
        else assert.match(i.response, /terminée/, status);
    }
});

test('bouton « Je postule » : demande encore en phase Postulant, le rôle manquant est redonné', async () => {
    for (const status of ['waiting_rsi', 'review', 'postulant']) {
        const f = fixture({ status });
        f.applicant.roles.cache.delete(ids.postulant); f.applicant.pending = false;
        await f.manager.applyFromButton(f.interaction(A.Apply, ids.applicant));
        assert.equal(f.applicant.roles.cache.has(ids.postulant), true, status);
        assert.equal(f.requests.length, 1, status);
    }
});

test('bouton « Je postule » : ancienne candidature RH conservée, aucun rôle ni ticket', async () => {
    const f = fixture({ legacy: true, noRequest: true });
    f.applicant.roles.cache.delete(ids.postulant);
    const i = f.interaction(A.Apply, ids.applicant);
    await f.manager.applyFromButton(i);
    assert.equal(f.requests.length, 0);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
    assert.match(i.response, /demande en cours/);
});

test('l’annonce publique contient « Je postule » et « Accéder à mon ticket »', () => {
    const f = fixture();
    const view = View.public(f.bot);
    const customIds = view.rows.flatMap(row => row.components.map(c => c.data.custom_id));
    assert.deepEqual(customIds, [A.Apply, A.Ticket]);
});

test('décision du site : statut cible selon la décision et l\'étape', () => {
    for (const status of ['waiting_rsi', 'review', 'postulant']) {
        assert.equal(siteDecisionTarget('accepted', status), 'integrated', status);
        assert.equal(siteDecisionTarget('rejected', status), 'refused', status);
    }
    assert.equal(siteDecisionTarget('accepted', 'candidate'), null);
    assert.equal(siteDecisionTarget('rejected', 'candidate'), 'refused');
    for (const status of ['refused', 'expired', 'integrated']) {
        assert.equal(siteDecisionTarget('accepted', status), null, status);
        assert.equal(siteDecisionTarget('rejected', status), null, status);
    }
});

test('décision du site : rejet d\'une demande en cours = refus avec rôles retirés et acteur enregistré', async () => {
    const f = fixture({ status: 'review' });
    const result = await f.manager.applySiteDecision(ids.applicant, 'rejected', ids.rh);
    assert.deepEqual(result, { found: true, changed: true, status: 'refused' });
    assert.equal(f.d.status, 'refused'); assert.equal(f.d.pendingStatus, undefined);
    assert.equal(f.d.decisions.at(-1).actorId, ids.rh);
    assert.equal(f.applicant.roles.cache.has(ids.postulant), false);
});

test('décision du site : acceptation d\'une demande Postulant = intégrée, sans retrait de rôle', async () => {
    const f = fixture({ status: 'postulant' });
    f.operations.length = 0;
    const result = await f.manager.applySiteDecision(ids.applicant, 'accepted', ids.rh);
    assert.deepEqual(result, { found: true, changed: true, status: 'integrated' });
    assert.equal(f.d.status, 'integrated');
    assert.equal(f.operations.some(x => x[0] === 'remove-role'), false);
});

test('décision du site : acceptation d\'un Candidat laissée au suivi de parrainage, rejet = parrainage clôturé puis refus', async () => {
    const accepted = fixture({ status: 'candidate' });
    assert.deepEqual(await accepted.manager.applySiteDecision(ids.applicant, 'accepted', ids.rh), { found: true, changed: false, status: 'candidate' });
    const rejected = fixture({ status: 'candidate' });
    const closed = [];
    rejected.bot.parrainageManager = { async closeForRequest(...args) { closed.push(args); } };
    const result = await rejected.manager.applySiteDecision(ids.applicant, 'rejected', ids.rh);
    assert.equal(result.status, 'refused');
    assert.deepEqual(closed, [[1, ids.rh, 'Candidature rejetée depuis le site']]);
});

test('décision du site : demande inconnue ou déjà terminée sans erreur ni changement', async () => {
    const unknown = fixture({ noRequest: true });
    assert.deepEqual(await unknown.manager.applySiteDecision(ids.applicant, 'rejected', ids.rh), { found: false, changed: false });
    const done = fixture({ status: 'expired' });
    assert.deepEqual(await done.manager.applySiteDecision(ids.applicant, 'rejected', ids.rh), { found: true, changed: false, status: 'expired' });
});

test('décision du site : refusée tant qu\'une opération est en reprise', async () => {
    const f = fixture({ status: 'review' });
    f.d.pendingStatus = 'review';
    await assert.rejects(() => f.manager.applySiteDecision(ids.applicant, 'rejected', ids.rh), /déjà en cours/);
    assert.equal(f.d.status, 'review');
});

const { interviewReminderDue } = await import('../dist/src/managers/schedulers/SchedulerRH.js');
const DAY = 24 * 3600 * 1000;
const since = Date.parse('2026-10-01T10:00:00.000Z');
const postulant = (extra = {}) => ({ status: 'postulant', decisions: [{ from: 'review', to: 'postulant', actorId: ids.rh, at: new Date(since).toISOString() }], ...extra });

test("rappel d'entretien : échéance, nouveau rappel après le dernier, statut et opération en attente", () => {
    assert.equal(interviewReminderDue(postulant(), since + 3 * DAY - 1, 3), false);
    assert.equal(interviewReminderDue(postulant(), since + 3 * DAY, 3), true);
    const reminded = postulant({ mentorship: { interviewRemindedAt: new Date(since + 3 * DAY).toISOString() } });
    assert.equal(interviewReminderDue(reminded, since + 5 * DAY, 3), false);
    assert.equal(interviewReminderDue(reminded, since + 6 * DAY, 3), true);
    assert.equal(interviewReminderDue(postulant({ status: 'candidate' }), since + 30 * DAY, 3), false);
    assert.equal(interviewReminderDue(postulant({ pendingStatus: 'candidate' }), since + 30 * DAY, 3), false);
    assert.equal(interviewReminderDue(postulant({ decisions: [] }), since + 30 * DAY, 3), false);
});

test("rappel d'entretien : un passage du scheduler envoie un seul rappel, mentionne le rôle RH seul, puis attend", async () => {
    const f = fixture({ status: 'postulant' });
    settingsService.getInt = async (key, fallback) => settings[key] ?? fallback;
    f.d.decisions = [{ from: 'review', to: 'postulant', actorId: ids.rh, at: new Date(Date.now() - 4 * DAY).toISOString() }];
    const reminders = () => f.operations.filter(o => o[0] === 'send' && o[2].content?.includes('attend un entretien'));
    await f.scheduler.checkRH();
    assert.equal(reminders().length, 1);
    const options = reminders()[0][2];
    assert.deepEqual(options.allowedMentions, { roles: [ids.staff], users: [], parse: [] });
    assert.match(options.content, new RegExp(`^<@&${ids.staff}> Le dossier de <@${ids.applicant}> attend un entretien depuis 4 jours`));
    assert.ok(f.d.mentorship.interviewRemindedAt);
    await f.scheduler.checkRH();
    assert.equal(reminders().length, 1);
});

test("rappel d'entretien : un échec d'envoi n'enregistre rien et le rappel est retenté", async () => {
    const f = fixture({ status: 'postulant' });
    settingsService.getInt = async (key, fallback) => settings[key] ?? fallback;
    f.d.decisions = [{ from: 'review', to: 'postulant', actorId: ids.rh, at: new Date(Date.now() - 4 * DAY).toISOString() }];
    f.failMessage(true);
    await f.scheduler.checkRH();
    assert.equal(f.d.mentorship?.interviewRemindedAt, undefined);
    f.failMessage(false);
    await f.scheduler.checkRH();
    assert.ok(f.d.mentorship.interviewRemindedAt);
});

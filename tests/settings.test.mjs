import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.URL_SITE = 'https://example.invalid/';
process.env.BOT_TOKEN = 'settings-test';
const { SettingsService, settingsService } = await import('../dist/src/services/SettingsService.js');
const { EventManager } = await import('../dist/src/managers/EventManager.js');

test('API native, cache et rechargement du rôle RH unique', async t => {
    let calls = 0;
    let data = { 'site.roles.rh': '123456789012345678', 'bot.contracts.fidelis_responsibles': ['123456789012345678', '987654321098765432', '123456789012345678'] };
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls++;
        assert.equal(url, 'https://example.invalid/api/internal/bot/settings');
        assert.equal(options.headers['X-BOT-TOKEN'], 'settings-test');
        return { ok: true, json: async () => data };
    });
    const service = new SettingsService();
    assert.equal(await service.getString('site.roles.rh'), data['site.roles.rh']);
    await service.getString('site.roles.rh');
    assert.deepEqual(await service.getList('bot.contracts.fidelis_responsibles'), ['123456789012345678', '987654321098765432']);
    assert.equal(calls, 1);
    data = { 'site.roles.rh': '987654321098765432' };
    await service.reload();
    assert.equal(await service.getString('site.roles.rh'), data['site.roles.rh']);
    assert.equal(calls, 2);
});

test('salons événements : jours, entraînement et gros événement via SettingsService', async t => {
    const keys = [];
    t.mock.method(settingsService, 'getString', async key => { keys.push(key); return key; });
    const manager = new EventManager({ guild: { channels: { cache: { get: id => ({ id }) } } } });
    for (let day = 0; day < 7; day++) {
        const start = new Date(2026, 8, 14 + day, 12);
        const name = start.toLocaleDateString('fr-FR', { weekday: 'long' });
        assert.equal((await manager.getChannel({ start })).id, `bot.channels.${name}`);
    }
    for (const [name, key] of [['ENTRAINEMENT COMPÉTITION', 'training'], ['GROS EVENT', 'gros_event']]) {
        assert.equal((await manager.getChannel({ type: { name } })).id, `bot.channels.${key}`);
    }
    assert.equal(keys.length, 9);
});

test('publication hebdomadaire : réglages actualisés et valeurs invalides refusées', async t => {
    const { SchedulerAppEvent } = await import('../dist/src/managers/schedulers/SchedulerAppEvent.js');
    const scheduler = Object.create(SchedulerAppEvent.prototype);
    let sent = 0;
    scheduler.sendEventsWeek = async () => { sent++; };
    const now = new Date();
    let day = String(now.getDay());
    let time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    t.mock.method(settingsService, 'getString', async key => key.endsWith('_day') ? day : time);
    await scheduler.checkDate();
    assert.equal(sent, 1);
    day = String((now.getDay() + 1) % 7);
    await scheduler.checkDate();
    assert.equal(sent, 1);
    day = '7';
    await assert.rejects(scheduler.checkDate(), /publication_day/);
    day = String(now.getDay());
    time = '24:00';
    await assert.rejects(scheduler.checkDate(), /publication_time/);
});

test('transcription : paramètres du site et options explicites prioritaires', async t => {
    const { TranscriptionService } = await import('../dist/src/services/TranscriptionService.js');
    const service = new TranscriptionService();
    let model = 'small';
    t.mock.method(settingsService, 'getString', async key => key.endsWith('_model') ? model : 'en');
    const calls = [];
    t.mock.method(service, 'runProcess', async (_command, args) => {
        calls.push(args);
        return '{"text":"transcription"}';
    });
    await service.transcribeAudioFile('/tmp/test.wav');
    assert.equal(calls[0][3], 'small');
    assert.equal(calls[0][6], 'en');
    model = 'medium';
    await service.transcribeAudioFile('/tmp/test.wav');
    assert.equal(calls[1][3], 'medium');
    await service.transcribeAudioFile('/tmp/test.wav', { model: 'base', language: 'fr' });
    assert.equal(calls[2][3], 'base');
    assert.equal(calls[2][6], 'fr');
});

test('Fidelis : la sélection multiple du site produit les mentions des responsables', async t => {
    const { ContractManager } = await import('../dist/src/managers/ContractManager.js');
    const ids = ['216305802296688640', '399051916996247582'];
    t.mock.method(settingsService, 'getList', async key => {
        assert.equal(key, 'bot.contracts.fidelis_responsibles');
        return ids;
    });
    let sent, response;
    const thread = { async send(message) { sent = message; } };
    const channel = { threads: { cache: { find: () => thread } } };
    const manager = new ContractManager({ db: { getEm: () => ({}) }, guild: { channels: { cache: { get: () => channel } } } });
    manager.getContractTitle = async () => 'Matériel';
    await manager.handlerResponse({ async deferUpdate() {}, user: { username: 'Alice' }, async followUp(value) { response = value; } }, { contractId: 1 });
    assert.equal(sent.content, ids.map(id => `<@${id}>`).join(' '));
    assert.deepEqual(sent.allowedMentions.users, ids);
    assert.ok(response.content.includes('envoyée'));
});

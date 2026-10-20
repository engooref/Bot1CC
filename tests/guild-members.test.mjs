import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { listGuildMembers } from '../dist/src/utils/GuildMembers.js';
const page = (start, size) => new Collection(Array.from({ length: size }, (_, i) => { const id = String(BigInt(start) + BigInt(i)); return [id, { id }]; }));

test('liste REST complète, pagination après 1000 membres et absence de Gateway', async () => {
    const calls = [];
    const guild = { members: {
        async fetch() { assert.fail('Opcode 8 interdit'); },
        async list(options) { calls.push(options); return options.after ? page(1001, 3) : page(1, 1000); },
    } };
    const members = await listGuildMembers(guild);
    assert.equal(members.size, 1003);
    assert.deepEqual(calls, [{ limit: 1000 }, { limit: 1000, after: '1000' }]);
});

test('appels concurrents partagés, puis nouvelle lecture fraîche', async () => {
    let calls = 0, release;
    const blocked = new Promise(resolve => { release = resolve; });
    const guild = { members: { async list() { calls++; await blocked; return page(1, 2); } } };
    const first = listGuildMembers(guild), second = listGuildMembers(guild);
    assert.equal(calls, 1); release();
    assert.equal(await first, await second);
    await listGuildMembers(guild); assert.equal(calls, 2);
});

test('échec de pagination : aucune liste partielle retournée, prochaine tentative possible', async () => {
    let fail = true;
    const guild = { members: { async list({ after }) { if (!after) return page(1, 1000); if (fail) throw new Error('Réseau'); return new Collection(); } } };
    await assert.rejects(listGuildMembers(guild), /Réseau/);
    fail = false;
    assert.equal((await listGuildMembers(guild)).size, 1000);
});

test('pagination sans progression refusée', async () => {
    const guild = { members: { async list() { return page(1, 1000); } } };
    await assert.rejects(listGuildMembers(guild), /bloquée/);
});

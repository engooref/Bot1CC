import { Collection, type Guild, type GuildMember } from 'discord.js';

const pending = new WeakMap<Guild, Promise<Collection<string, GuildMember>>>();

/** Liste complète via REST : pas de Request Guild Members (opcode 8).
 * Les appels simultanés partagent la même pagination. Aucun cache de rôles
 * supplémentaire : les contrôles individuels continuent à relire Discord.
 */
export function listGuildMembers(guild: Guild): Promise<Collection<string, GuildMember>> {
    const existing = pending.get(guild);
    if (existing) return existing;
    const request = readPages(guild).finally(() => pending.delete(guild));
    pending.set(guild, request);
    return request;
}

async function readPages(guild: Guild): Promise<Collection<string, GuildMember>> {
    const members = new Collection<string, GuildMember>();
    let after: string | undefined;
    for (;;) {
        const page = await guild.members.list({ limit: 1000, ...(after ? { after } : {}) });
        for (const [id, member] of page) members.set(id, member);
        if (page.size < 1000) return members;
        // Ne pas dépendre de l’ordre de la collection retournée.
        const next = [...page.keys()].reduce((max, id) => BigInt(id) > BigInt(max) ? id : max);
        if (after && BigInt(next) <= BigInt(after)) throw new Error('Pagination des membres Discord bloquée');
        after = next;
    }
}

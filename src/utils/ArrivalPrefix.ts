import type { GuildMember } from 'discord.js';

export const ARRIVAL_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export function recruitmentNickname(name: string, prefix: string): string {
    const base = name.replace(/^(?:\[(?:A|P|C-1cc|1CC)\]\s*)+/i, '').trim();
    return `${prefix}${prefix ? ' ' : ''}${base}`.slice(0, 32);
}

/** Arrival is independent of the recruitment feature and the onboarding choice. */
export async function applyArrivalPrefix(member: GuildMember): Promise<void> {
    if (member.user.bot) return;
    await member.setNickname(recruitmentNickname(member.displayName, '[A]'), 'Arrivée sur Discord');
}

export async function expireArrivalPrefix(member: GuildMember, now = Date.now()): Promise<void> {
    if (member.user.bot || member.joinedTimestamp == null || now - member.joinedTimestamp < ARRIVAL_DURATION_MS) return;
    if (/^\[A\]\s*/.test(member.displayName))
        await member.setNickname(member.displayName.replace(/^\[A\]\s*/, ''), 'Fin du préfixe Arrivant');
}

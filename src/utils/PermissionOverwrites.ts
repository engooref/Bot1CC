import type { GuildChannel, PermissionOverwriteOptions } from 'discord.js';

/**
 * discord.js refuse de créer un droit individuel pour un identifiant qui n'est ni un rôle ni un utilisateur
 * connu de son cache (cas d'un candidat parti du serveur) : « Supplied parameter is not a User nor a Role. »
 */
export function isUnresolvableOverwriteTarget(error: unknown): boolean {
    return error instanceof Error && error.message.includes('not a User nor a Role');
}

/**
 * Modifie le droit individuel d'un membre sur un salon. Renvoie `null` (sans erreur) si le membre est
 * introuvable (parti du serveur) : il n'y a alors plus d'accès à régler. Les autres erreurs sont relancées.
 */
export async function editMemberOverwrite(
    channel: GuildChannel,
    memberId: string,
    options: PermissionOverwriteOptions,
    reason?: string,
): Promise<GuildChannel | null> {
    try {
        return await channel.permissionOverwrites.edit(memberId, options, { reason });
    } catch (error) {
        if (isUnresolvableOverwriteTarget(error)) return null;
        throw error;
    }
}

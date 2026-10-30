import { ChannelType, type Guild } from 'discord.js';
import type { RecrutementDemande } from '../entities/recrutement/RecrutementDemande.js';
import { SettingKeys } from '../constants/SettingKeys.js';
import { settingsService } from '../services/SettingsService.js';

type Fiche = Pick<RecrutementDemande, 'guildId' | 'channelId' | 'notificationChannelId' | 'notificationMessageId'>;

export function staffLink(d: Fiche): string {
    return d.notificationChannelId && d.notificationMessageId
        ? `[Ouvrir la fiche RH](https://discord.com/channels/${d.guildId}/${d.notificationChannelId}/${d.notificationMessageId})`
        : d.channelId ? `[Ouvrir le ticket](https://discord.com/channels/${d.guildId}/${d.channelId})` : '';
}

/** Écrit dans le fil RH du dossier (repli : salon RH), en mentionnant uniquement le rôle RH. */
export async function notifyRH(guild: Guild, d: Pick<RecrutementDemande, 'notificationChannelId'>, content: string): Promise<void> {
    const channelId = d.notificationChannelId || await settingsService.getString(SettingKeys.bot.channels.rh);
    const channel = await guild.channels.fetch(channelId);
    if (!channel || (!channel.isThread() && channel.type !== ChannelType.GuildText)) throw new Error('Salon RH inaccessible');
    if (channel.isThread() && channel.archived) await channel.setArchived(false);
    const roleId = await settingsService.getString(SettingKeys.site.roles.rh);
    await channel.send({ content: `<@&${roleId}> ${content}`, allowedMentions: { roles: [roleId], users: [], parse: [] } });
}

import type { BotManager } from '../BotManager.js';
import { BaseComponentView, ViewHandlers } from './BaseView.js';
import { ComponentType } from '../entities/ui/ViewContext.js';
import { EmbedBuilder } from 'discord.js';
import type { RecrutementDemande } from '../entities/recrutement/RecrutementDemande.js';
import { staffLink } from '../utils/NotifyRH.js';
import { JSONTypeComponent as T, type JSONComponent, type ModalField } from '../utils/Type.js';

export const parrainButton = (action: string, label: string, disabled = false): JSONComponent => ({
    type: T.Button, customId: `parrain_${action}`, label, style: 'Secondary', disabled,
});
export const parrainSelect = (action: string, options: { label: string; value: string }[], maxValues = 1): JSONComponent => ({
    type: T.StringSelectMenu, customId: `parrain_${action}`, options, minValues: 1, maxValues,
});
export const MENTORA_SELF_ASSIGN = 'parrain_self_assign';
/** Message d'accueil du ticket Mentora ; `mentorId` renseigné = un mentor est engagé. */
export function mentoraEmbed(d: RecrutementDemande, mentorId?: string) {
    return new EmbedBuilder().setTitle('Ticket Mentora').setDescription([
        `<@${d.applicantId}> a validé son entretien et attend un mentor.`,
        mentorId
            ? `Mentor engagé : <@${mentorId}>. Les autres parrains n’ont plus accès à ce ticket.`
            : 'Un membre du rôle Parrain peut s’engager avec « Je m’affecte » ; les RH peuvent aussi affecter un parrain depuis la fiche RH. Tant qu’aucun mentor n’est engagé, le candidat reste Postulant [P].',
        staffLink(d),
    ].filter(Boolean).join('\n\n'));
}
export default class ParrainageView extends BaseComponentView {
    constructor(bot: BotManager, private context: Record<string, unknown>, definitions: JSONComponent[]) {
        super(bot, ViewHandlers.ParrainageHandler, ComponentType.Button, definitions);
    }
    protected getData() { return this.context; }
    async remember(messageId: string, channelId: string) { await this.persistContexts(messageId, channelId); }
    static mentora(bot: BotManager, d: RecrutementDemande, mentorId?: string) {
        return new ParrainageView(bot, { guildId: d.guildId, demandeId: d.id }, [
            { type: T.Button, customId: MENTORA_SELF_ASSIGN, label: 'Je m’affecte', style: 'Success', disabled: !!mentorId || d.status !== 'awaiting_mentor' },
        ]);
    }
    static form(bot: BotManager, context: Record<string, unknown>, action: string, title: string, fields: ModalField[]) {
        return new ParrainageView(bot, context, [{ type: T.Modal, customId: `parrain_${action}`, title, fields }]);
    }
}

import type { BotManager } from '../BotManager.js';
import { BaseComponentView, ViewHandlers } from './BaseView.js';
import { ComponentType } from '../entities/ui/ViewContext.js';
import { RecrutementDemande } from '../entities/recrutement/RecrutementDemande.js';
import { JSONTypeComponent as T, type JSONComponent } from '../utils/Type.js';

export const RecruitmentActions = {
    Ticket: 'recrutement_ticket', Submit: 'recrutement_submit', Validate: 'recrutement_validate_rsi',
    Interview: 'recrutement_validate_interview', Refuse: 'recrutement_refuse', ConfirmRefuse: 'recrutement_confirm_refuse',
} as const;
export const recruitmentLabels = {
    waiting_rsi: 'En attente du dépôt RSI', review: 'Dépôt déclaré — vérification RH en attente',
    postulant: 'Postulant — entretien à réaliser', candidate: 'Candidat', refused: 'Candidature refusée', expired: 'Demande expirée',
};
export default class RecrutementView extends BaseComponentView {
    constructor(bot: BotManager, private context: Record<string, unknown>, definitions: JSONComponent[]) {
        super(bot, ViewHandlers.RecrutementHandler, ComponentType.Button, definitions);
    }
    protected getData() { return this.context; }
    static public(bot: BotManager) {
        return new RecrutementView(bot, {}, [{ type: T.Button, customId: RecruitmentActions.Ticket, label: 'Accéder à mon ticket', style: 'Primary' }]);
    }
    static ticket(bot: BotManager, d: RecrutementDemande) {
        return new RecrutementView(bot, { demandeId: d.id, guildId: d.guildId }, [
            { type: T.Button, customId: 'recrutement_rsi_link', label: 'Ouvrir la page RSI', style: 'Link', url: 'https://robertsspaceindustries.com/orgs/1CC' },
            { type: T.Button, customId: RecruitmentActions.Submit, label: 'J’ai déposé ma candidature RSI', style: 'Success', disabled: d.status !== 'waiting_rsi' || !!d.pendingStatus },
        ]);
    }
    static staff(bot: BotManager, d: RecrutementDemande) {
        const definitions: JSONComponent[] = [];
        if (d.status === 'waiting_rsi' || d.status === 'review' || d.status === 'postulant') {
            definitions.push({ type: T.Button, customId: d.status === 'postulant' ? RecruitmentActions.Interview : RecruitmentActions.Validate,
                label: d.status === 'postulant' ? 'Valider l’entretien → Candidat' : 'Candidature RSI vérifiée et validée', style: 'Success', disabled: !!d.pendingStatus },
                { type: T.Button, customId: RecruitmentActions.Refuse, label: 'Refuser', style: 'Danger', disabled: !!d.pendingStatus });
        }
        if (d.status === 'candidate') definitions.push({ type: T.Button, customId: 'parrain_staff', label: 'Gérer le parrainage', style: 'Primary' });
        definitions.push({ type: T.Button, customId: 'parrain_directory', label: 'Gérer les parrains', style: 'Secondary' });
        if (d.channelId) definitions.push({ type: T.Button, customId: 'recrutement_ticket_link', label: 'Ouvrir le ticket', style: 'Link', url: `https://discord.com/channels/${d.guildId}/${d.channelId}` });
        return new RecrutementView(bot, { demandeId: d.id, guildId: d.guildId }, definitions);
    }
    static refusal(bot: BotManager, d: RecrutementDemande, actorId: string) {
        return new RecrutementView(bot, { demandeId: d.id, guildId: d.guildId, actorId, expectedStatus: d.status }, [
            { type: T.Button, customId: RecruitmentActions.ConfirmRefuse, label: 'Confirmer le refus', style: 'Danger' },
            { type: T.Modal, customId: RecruitmentActions.ConfirmRefuse, title: 'Confirmer le refus', fields: [
                { customId: 'reason', label: 'Motif du refus (facultatif)', style: 'Paragraph', required: false, maxLength: 1000 },
            ] },
        ]);
    }
}

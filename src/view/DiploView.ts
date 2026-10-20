import { BotManager } from '../BotManager.js';
import { BaseComponentView, ViewHandlers } from './BaseView.js';
import { ComponentType } from '../entities/ui/ViewContext.js';
import { JSONTypeComponent as Type, type JSONComponent } from '../utils/Type.js';
import type { DiplomatieCorporation } from '../entities/diplomatie/DiplomatieCorporation.js';

export enum DiploActions {
    Accept = 'button_valid_diplo',
    Refuse = 'button_refus_diplo',
    Select = 'diplo_select_corporation',
    Previous = 'diplo_previous',
    Next = 'diplo_next',
    Create = 'diplo_create_corporation',
    CorporationForm = 'diplo_corporation_form',
    ConfirmAccept = 'diplo_confirm_accept',
    ConfirmRefuse = 'diplo_confirm_refuse',
    Cancel = 'diplo_cancel',
    Retry = 'diplo_retry_finalize',
}

export interface DiploContext extends Record<string, unknown> {
    demandeId: number;
    guildId: string;
    actorId?: string;
    corporationId?: number;
    page?: number;
}

export default class DiploView extends BaseComponentView {
    constructor(bot: BotManager, private readonly context: DiploContext, definitions?: JSONComponent[]) {
        super(bot, ViewHandlers.DiploHandler, ComponentType.Button, definitions ?? './src/view/definitions/diplo.json');
    }

    protected getData(_customId: string): DiploContext {
        return { ...this.context };
    }

    static corporations(bot: BotManager, context: DiploContext, corporations: DiplomatieCorporation[], total: number): DiploView {
        const page = context.page ?? 0;
        const definitions: JSONComponent[] = [];
        if (corporations.length) definitions.push({
            type: Type.StringSelectMenu, customId: DiploActions.Select,
            placeholder: 'Choisir une corporation',
            options: corporations.map(c => ({ label: c.name, value: String(c.id) })),
        });
        definitions.push(
            { type: Type.Button, customId: DiploActions.Previous, label: 'Précédent', style: 'Secondary', disabled: page === 0 },
            { type: Type.Button, customId: DiploActions.Next, label: 'Suivant', style: 'Secondary', disabled: (page + 1) * 25 >= total },
            { type: Type.Button, customId: DiploActions.Create, label: 'Créer / associer une corporation', style: 'Primary' },
            { type: Type.Button, customId: DiploActions.Cancel, label: 'Annuler', style: 'Secondary' },
            // Le contexte du formulaire est persisté avec celui du message qui l’ouvre.
            ...DiploView.corporationForm(),
        );
        return new DiploView(bot, context, definitions);
    }

    static corporationForm(): JSONComponent[] {
        return [{
            type: Type.Modal, customId: DiploActions.CorporationForm, title: 'Créer / associer et accepter',
            fields: [
                { customId: 'name', label: 'Nom de la corporation', style: 'Short', required: true, maxLength: 100 },
                { customId: 'channelId', label: 'ID du salon existant (sinon : nouveau salon)', style: 'Short', required: false, maxLength: 22 },
            ],
        }];
    }

    static confirmation(bot: BotManager, context: DiploContext, accept: boolean): DiploView {
        return new DiploView(bot, context, [
            { type: Type.Button, customId: accept ? DiploActions.ConfirmAccept : DiploActions.ConfirmRefuse,
                label: accept ? 'Confirmer l’acceptation' : 'Confirmer le refus', style: accept ? 'Success' : 'Danger' },
            { type: Type.Button, customId: DiploActions.Cancel, label: 'Annuler', style: 'Secondary' },
        ]);
    }
}

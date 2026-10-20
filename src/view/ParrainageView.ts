import type { BotManager } from '../BotManager.js';
import { BaseComponentView, ViewHandlers } from './BaseView.js';
import { ComponentType } from '../entities/ui/ViewContext.js';
import { JSONTypeComponent as T, type JSONComponent, type ModalField } from '../utils/Type.js';

export const parrainButton = (action: string, label: string, disabled = false): JSONComponent => ({
    type: T.Button, customId: `parrain_${action}`, label, style: 'Secondary', disabled,
});
export const parrainSelect = (action: string, options: { label: string; value: string }[], maxValues = 1): JSONComponent => ({
    type: T.StringSelectMenu, customId: `parrain_${action}`, options, minValues: 1, maxValues,
});
export default class ParrainageView extends BaseComponentView {
    constructor(bot: BotManager, private context: Record<string, unknown>, definitions: JSONComponent[]) {
        super(bot, ViewHandlers.ParrainageHandler, ComponentType.Button, definitions);
    }
    protected getData() { return this.context; }
    async remember(messageId: string, channelId: string) { await this.persistContexts(messageId, channelId); }
    static form(bot: BotManager, context: Record<string, unknown>, action: string, title: string, fields: ModalField[]) {
        return new ParrainageView(bot, context, [{ type: T.Modal, customId: `parrain_${action}`, title, fields }]);
    }
}

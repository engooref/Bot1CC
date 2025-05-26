import { ActionRowBuilder, StringSelectMenuBuilder, ButtonInteraction, TextInputBuilder, TextInputStyle, ModalBuilder, MessageActionRowComponentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import BotManager from "../BotManager.js";
import { TicketType } from "../entities/TicketType.js";
import { BaseComponentView, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";

export enum Handlers {
  OpenTicket = 'open_ticket',
  SelectType = 'select_ticket_type',
  CloseTicket = 'closeTicket',
  SubmitClose = 'submitCloseModal',
}

/** View for selecting ticket type **/
export default class TicketTypeSelectView extends BaseComponentView {
  private types: TicketType[];

  constructor(bot: BotManager, types: TicketType[]) {
    const menu = new ActionRowBuilder<MessageActionRowComponentBuilder>()
      .addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(Handlers.SelectType)
          .setPlaceholder('Selectionnez le service')
          .addOptions(types.map(t => ({ label: t.name, value: String(t.id) })))
      );
    super(bot, [Handlers.SelectType], ViewHandlers.TicketsHandler, ComponentType.Select, [menu]);
    this.types = types;
  }

  protected getData(customId: string) {
    return { types: this.types.map(t => t.id) };
  }
  
}

export class OpenTicketView extends BaseComponentView {
  constructor(bot: BotManager) {
    const btn = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder().setCustomId(Handlers.OpenTicket).setLabel('Créer un Ticket').setStyle(ButtonStyle.Success)
      );
    super(bot, [Handlers.OpenTicket], ViewHandlers.TicketsHandler, ComponentType.Button, [btn]);
  }

  protected getData(customId: string) {
    return {};
  }

}

export class CloseTicketView extends BaseComponentView {
  private id: number;

  constructor(bot: BotManager, id: number) {
    
    const btn = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(
        new ButtonBuilder().setCustomId(Handlers.CloseTicket).setLabel('Cloturer').setStyle(ButtonStyle.Danger)
      );
    super(bot, [Handlers.CloseTicket], ViewHandlers.TicketsHandler, ComponentType.Button, [btn]);
    this.id = id;
  }

  protected getData(customId: string) {
    return {'id': this.id};
  }

}






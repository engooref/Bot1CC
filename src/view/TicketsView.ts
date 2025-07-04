import { ActionRowBuilder, StringSelectMenuBuilder, ButtonInteraction, TextInputBuilder, TextInputStyle, ModalBuilder, MessageActionRowComponentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import BotManager from "../BotManager.js";
import { TicketType } from "../entities/TicketType.js";
import { BaseComponentView, getDefinitions, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";
import { JSONComponent, JSONTypeComponent } from "../utils/Type.js";

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
    const json: JSONComponent[] = 
    [
      {
        type: JSONTypeComponent.StringSelectMenu,
        customId: Handlers.SelectType,
        placeholder: 'Sélectionnez le service',
        options: types.map(t => ({ label: t.name, value: String(t.id) }))
      },
    ]
    super(bot, ViewHandlers.TicketsHandler, ComponentType.Select, json);
    this.types = types;
  }

  protected getData(customId: string) {
    return { types: this.types.map(t => t.id) };
  }
  
}

export class OpenTicketView extends BaseComponentView {
  constructor(bot: BotManager) {
    const json: JSONComponent[] = 
      [
        {
          type: JSONTypeComponent.Button,
          customId: Handlers.OpenTicket,
          label: 'Créer un Ticket',
          style: "Success"
        },
      ]

    super(bot, ViewHandlers.TicketsHandler, ComponentType.Button, json);
  }

  protected getData(customId: string) {
    return {};
  }

}

export class CloseTicketView extends BaseComponentView {
  private id: number;

  constructor(bot: BotManager, id: number) {
    const json: JSONComponent[] = 
      [
        {
          type: JSONTypeComponent.Button,
          customId: Handlers.CloseTicket,
          label: 'Clôturer',
          style: "Danger"
        },
      ]

    super(bot, ViewHandlers.TicketsHandler, ComponentType.Button, json);
    this.id = id;
  }

  protected getData(customId: string) {
    return {'id': this.id};
  }

}






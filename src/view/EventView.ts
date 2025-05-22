// src/views/EventView.ts
import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,

  } from 'discord.js';
  import BotManager from '../BotManager.js';
  import { BaseComponentView, ViewHandlers } from './BaseView.js';
  import { ComponentType } from '../entities/ViewContext.js';

  interface OptionData {
    value: string;
    select: boolean;
  }
  
  export class EventView extends BaseComponentView {
    private respId: number;
    private selectMenu: StringSelectMenuBuilder;
  
    constructor(
      bot: BotManager,
  
      optionsData: OptionData[],
      respId: number,
    ) {
      // on construit deux customIds : un pour le select, un pour le bouton
      const selectId = `select_${respId}`;
      const buttonId = `send_btn_${respId}`;
      const customIds = [selectId, buttonId];
      const handlerKey = ViewHandlers.SelectRoleHandler;
  
      // 1️⃣ menu déroulant
      const select = new StringSelectMenuBuilder()
        .setCustomId(selectId)
        .setPlaceholder('Choisissez un rôle…')
        .setMinValues(1)
        .setMaxValues(optionsData.length)
        .addOptions(
          optionsData.map(o =>
            new StringSelectMenuOptionBuilder()
              .setLabel(o.value)
              .setValue(o.value)
              .setDefault(o.select),
          ),
        );
  
      // 2️⃣ bouton de validation
      const disabled = !optionsData.some(o => o.select);
      const button = new ButtonBuilder()
        .setCustomId(buttonId)
        .setLabel('Valider')
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled);
  
      // 3️⃣ on crée les rows
      const rows = [
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
        new ActionRowBuilder<ButtonBuilder>().addComponents(button),
      ];
  
      // on stocke le menu pour récupérer ses valeurs dans getData()
      super(bot, customIds, handlerKey, ComponentType.Select, rows);
      this.selectMenu = select;
      this.respId = respId;
    }
  
    /** 
     * getData est appelé pour chaque customId au moment de persist 
     * et permet de fournir les données dynamiques selon le composant. 
     */
    protected getData(customId: string): Record<string, any> {
        if (customId.startsWith('select_')) {
            const rawOptions = this.selectMenu.options.map(o => o.toJSON());
            const defaultValues = rawOptions
                .filter(o => o.default)
                .map(o => o.value);
            return { respId: this.respId, selected: defaultValues };
        }
  
      return {
        respId: this.respId,
      };
    }
  }
  
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Message,
  StringSelectMenuInteraction,
  ButtonInteraction,
  MessageComponentInteraction,
} from 'discord.js';
import { BotManager } from '../BotManager.js';
import { Response } from '../entities/event/Response.js';

interface OptionData {
  value: string;
  select: boolean;
}

/**
 * Vue complète gérant select + bouton et persistance BDD automatiquement
 */
export class EventView {
  private selectId: string;
  private buttonId: string;
  private selectMenu: StringSelectMenuBuilder;
  private button: ButtonBuilder;
  public rows: ActionRowBuilder<any>[];
  private bot: BotManager;
  private respId: number;

  constructor(
    bot: BotManager,
    optionsData: OptionData[],
    respId: number,
  ) {
    this.bot = bot;
    this.respId = respId;
    const ts = Date.now();
    this.selectId = `select_${respId}_${ts}`;
    this.buttonId = `btn_${respId}_${ts}`;

    // Initialiser menu et bouton
    this.selectMenu = new StringSelectMenuBuilder()
      .setCustomId(this.selectId)
      .setPlaceholder('Choisissez un rôle…')
      .setMinValues(1)
      .setMaxValues(optionsData.length)
      .addOptions(
        optionsData.map(o =>
          new StringSelectMenuOptionBuilder()
            .setLabel(o.value)
            .setValue(o.value)
            .setDefault(o.select)
        ),
      );

    this.button = new ButtonBuilder()
      .setCustomId(this.buttonId)
      .setLabel('Valider')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!optionsData.some(o => o.select));

    this.rows = [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(this.selectMenu),
      new ActionRowBuilder<ButtonBuilder>().addComponents(this.button),
    ];
  }

  /**
   * Installe le collector pour gérer select & button
   */
  public collectInteractions(message: Message) {
    const collector = message.createMessageComponentCollector({ time: 0 });
    collector.on('collect', async (interaction: MessageComponentInteraction) => {
      if (interaction.customId === this.selectId && interaction.isStringSelectMenu()) {
        await this.handleSelect(interaction);
      }
      if (interaction.customId === this.buttonId && interaction.isButton()) {
        await this.handleButton(interaction);
      }
    });
  }

  private async handleSelect(interaction: StringSelectMenuInteraction) {

    const selected = interaction.values;
    const raw = this.selectMenu.options.map(o => o.toJSON());
    const first = raw[0].value;
    if (selected.includes(first)) {
      this.selectMenu.options.forEach((opt, i) => opt.setDefault(i === 0));
    } else if (!selected.length) {
      this.selectMenu.options.forEach((opt, i) => opt.setDefault(i === 0));
    } else {
      this.selectMenu.options.forEach(opt => {
        const o = opt.toJSON();
        const isFirst = o.value === first;
        opt.setDefault(!isFirst && selected.includes(o.value));
      });
    }
    this.button.setDisabled(false);

    // Mise à jour directe via message API
    await interaction.update({ components: this.rows });
  }

  /**
   * Callback pour le bouton, met à jour la BDD et nettoie
   */
  private async handleButton(interaction: ButtonInteraction) {

    // Mise à jour du message sans interaction.update
    
    const em = this.bot.db.getEm();
    const raw = this.selectMenu.options.map(o => o.toJSON());
    const selected = raw.filter(o => o.default).map(o => o.value);

    const response = await em.findOne(Response, { id: this.respId }, { populate: ['event'] });
    if (!response) {
      await interaction.followUp({ content: 'Réponse introuvable', ephemeral: true });
      return;
    }
    response.roleDemand = selected;
    await interaction.update({
      content: `✅ Choix enregistrés pour l'événement "${response.event.name}"`,
      components: [],
    });
    await em.persist(response).flush();

    
  }
}

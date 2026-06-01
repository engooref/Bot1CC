import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  Colors,
  EmbedBuilder,
  LabelBuilder,
  MessageActionRowComponentBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import type { ScheduledMessageConfig, ScheduledResponseButton } from '../managers/schedulers/ScheduledMessage.js';

// ─── CustomIds ─────────────────────────────────────────────────────────────────
export const AM_IDS = {
  SELECT_MSG:     'am_select_msg',
  SELECT_CHANNEL: 'am_select_channel',
  SELECT_DAY:     'am_select_day',
  SELECT_HOUR:    'am_select_hour',
  SELECT_MINUTE:  'am_select_minute',
  BTN_NEW:        'am_btn_new',
  BTN_CLOSE:      'am_btn_close',
  BTN_MSG:        'am_btn_msg',
  BTN_TOGGLE:     'am_btn_toggle',
  BTN_DELETE:     'am_btn_delete',
  BTN_BACK:       'am_btn_back',
  BTN_PREVIEW:    'am_btn_preview',
  MODAL_MSG:      'am_modal_msg',
} as const;

export type AmId = typeof AM_IDS[keyof typeof AM_IDS];
export const ALL_AM_IDS: AmId[] = Object.values(AM_IDS);

// ─── Static data ────────────────────────────────────────────────────────────────
const DAYS = [
  { label: 'Dimanche', value: '0' },
  { label: 'Lundi',    value: '1' },
  { label: 'Mardi',    value: '2' },
  { label: 'Mercredi', value: '3' },
  { label: 'Jeudi',    value: '4' },
  { label: 'Vendredi', value: '5' },
  { label: 'Samedi',   value: '6' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({
  label: `${String(i).padStart(2, '0')}h`,
  value: String(i),
}));

const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map(m => ({
  label: String(m).padStart(2, '0'),
  value: String(m),
}));

type Rows = ActionRowBuilder<MessageActionRowComponentBuilder>[];

// ─── View (pure rendering, no state) ───────────────────────────────────────────
export class AutoMessageView {

  static buildListView(messages: ScheduledMessageConfig[]): { embed: EmbedBuilder; rows: Rows } {
    const embed = new EmbedBuilder()
      .setTitle('📅 Messages automatiques')
      .setColor(Colors.Blue);

    const rows: Rows = [];

    if (messages.length === 0) {
      embed.setDescription('Aucun message automatique configuré.\nCliquez sur **Nouveau** pour en créer un.');
    } else {
      const lines = messages.map(m => {
        const icon    = m.enabled ? '✅' : '⏸️';
        const day     = DAYS[m.dayOfWeek]?.label ?? `Jour ${m.dayOfWeek}`;
        const time    = `${String(m.hour).padStart(2, '0')}:${String(m.minute).padStart(2, '0')}`;
        const channel = m.channelId ? `<#${m.channelId}>` : '_Aucun salon_';
        return `${icon} **${m.label}** — ${day} à ${time} → ${channel}`;
      });
      embed.setDescription(lines.join('\n'));

      rows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(AM_IDS.SELECT_MSG)
            .setPlaceholder('Sélectionner un message à modifier…')
            .addOptions(
              messages.map(m => {
                const day  = DAYS[m.dayOfWeek]?.label ?? `Jour ${m.dayOfWeek}`;
                const time = `${String(m.hour).padStart(2,'0')}:${String(m.minute).padStart(2,'0')}`;
                return new StringSelectMenuOptionBuilder()
                  .setLabel(m.label)
                  .setDescription(`${m.enabled ? '✅' : '⏸️'}  ${day} ${time}`)
                  .setValue(m.id);
              })
            )
        )
      );
    }

    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId(AM_IDS.BTN_NEW).setLabel('➕ Nouveau').setStyle(ButtonStyle.Success),
      )
    );

    return { embed, rows };
  }

  static buildEditView(cfg: ScheduledMessageConfig, warning?: string): { embed: EmbedBuilder; rows: Rows } {
    const day     = DAYS[cfg.dayOfWeek]?.label ?? `Jour ${cfg.dayOfWeek}`;
    const time    = `${String(cfg.hour).padStart(2,'0')}:${String(cfg.minute).padStart(2,'0')}`;
    const channel = cfg.channelId ? `<#${cfg.channelId}>` : '_Aucun salon sélectionné_';
    const status  = cfg.enabled ? '✅ Actif' : '⏸️ Inactif';

    const embedStatus  = cfg.embed ? '[✅ Configuré](https://discohook.org/)' : '[➕ Créer un embed](https://discohook.org/)';
    const msgPreview   = cfg.message?.trim()
      ? `> ${cfg.message.slice(0, 150)}${cfg.message.length > 150 ? '…' : ''}`
      : '_Aucun_';
    const buttonsValue = cfg.buttons?.length
      ? cfg.buttons.map(b => `${b.label} (${b.style})`).join('\n')
      : '_Aucun_';
    const threadValue  = cfg.threadMessage?.trim()
      ? `🧵 Actif\n> ${cfg.threadMessage.slice(0, 80)}`
      : '_Désactivé_';

    const embed = new EmbedBuilder()
      .setTitle(`📝 ${cfg.label}`)
      .setColor(cfg.enabled ? Colors.Green : Colors.Grey)
      .addFields(
        { name: 'Statut',        value: status,                                  inline: true },
        { name: 'Salon',         value: channel,                                 inline: true },
        { name: 'Planification', value: `${day} à ${time} (${cfg.timezone})`,   inline: true },
        { name: 'Texte',         value: msgPreview,                              inline: false },
        { name: 'Embed',         value: embedStatus,                             inline: true },
        { name: 'Boutons RSVP',  value: buttonsValue,                            inline: true },
        { name: 'Thread',        value: threadValue,                             inline: true },
      );

    if (warning) embed.addFields({ name: '⚠️ Attention', value: warning, inline: false });

    const rows: Rows = [];

    // Row 1: salon
    const channelMenu = new ChannelSelectMenuBuilder()
      .setCustomId(AM_IDS.SELECT_CHANNEL)
      .setPlaceholder('Choisir le salon de destination…')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (cfg.channelId) channelMenu.setDefaultChannels([cfg.channelId]);
    rows.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(channelMenu));

    // Row 2: jour
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AM_IDS.SELECT_DAY)
          .setPlaceholder('Choisir le jour…')
          .addOptions(
            DAYS.map(d => new StringSelectMenuOptionBuilder()
              .setLabel(d.label).setValue(d.value)
              .setDefault(String(cfg.dayOfWeek) === d.value)
            )
          )
      )
    );

    // Row 3: heure
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AM_IDS.SELECT_HOUR)
          .setPlaceholder("Choisir l'heure…")
          .addOptions(
            HOURS.map(h => new StringSelectMenuOptionBuilder()
              .setLabel(h.label).setValue(h.value)
              .setDefault(String(cfg.hour) === h.value)
            )
          )
      )
    );

    // Row 4: minutes
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(AM_IDS.SELECT_MINUTE)
          .setPlaceholder('Choisir les minutes…')
          .addOptions(
            MINUTES.map(m => new StringSelectMenuOptionBuilder()
              .setLabel(m.label).setValue(m.value)
              .setDefault(String(cfg.minute) === m.value)
            )
          )
      )
    );

    // Row 5: actions
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder().setCustomId(AM_IDS.BTN_MSG).setLabel('✏️ Message').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(AM_IDS.BTN_PREVIEW).setLabel('👁️ Aperçu').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(AM_IDS.BTN_TOGGLE)
          .setLabel(cfg.enabled ? '⏸️ Désactiver' : '✅ Activer')
          .setStyle(cfg.enabled ? ButtonStyle.Secondary : ButtonStyle.Success),
        new ButtonBuilder().setCustomId(AM_IDS.BTN_DELETE).setLabel('🗑️ Supprimer').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(AM_IDS.BTN_BACK).setLabel('← Retour').setStyle(ButtonStyle.Secondary),
      )
    );

    return { embed, rows };
  }

  /** Serialize buttons back to the simple `label|style` format for the modal pre-fill. */
  static serializeButtons(buttons: ScheduledResponseButton[]): string {
    return buttons.map(b => `${b.label}|${b.style}`).join('\n');
  }

  static buildMessageModal(cfg: ScheduledMessageConfig): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(AM_IDS.MODAL_MSG)
      .setTitle('Modifier le message');

    modal
      .addLabelComponents(new LabelBuilder()
        .setLabel('Nom du message (identification)')
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('am_input_label')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(cfg.label)
          .setMaxLength(50)))
      .addLabelComponents(new LabelBuilder()
        .setLabel('Texte du message (optionnel si embed)')
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('am_input_message')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(cfg.message)
          .setMaxLength(2000)))
      .addLabelComponents(new LabelBuilder()
        .setLabel('Embed JSON (optionnel)')
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('am_input_embed')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(cfg.embed ?? '')
          .setPlaceholder('{ "title": "Mon titre", "description": "...", "color": 5763719 }')
          .setMaxLength(4000)))
      .addLabelComponents(new LabelBuilder()
        .setLabel('Boutons RSVP (vide = aucun bouton)')
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('am_input_buttons')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(cfg.buttons ? AutoMessageView.serializeButtons(cfg.buttons) : '')
          .setPlaceholder('label|Style (une ligne par bouton) ou JSON [{"label":"...","style":"Success"}]')
          .setMaxLength(1000)))
      .addLabelComponents(new LabelBuilder()
        .setLabel('Thread — premier message')
        .setTextInputComponent(new TextInputBuilder()
          .setCustomId('am_input_thread')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setValue(cfg.threadMessage ?? '')
          .setPlaceholder('Ex : Répondez ici ! (laissez vide pour ne pas créer de thread)')
          .setMaxLength(2000)));

    return modal;
  }
}

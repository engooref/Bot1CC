
// src/views/OperationView.ts
import {
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Colors,
  EmbedBuilder,
  ButtonStyle,
  MessageActionRowComponentBuilder,
  TextChannel,
  Message,
  ModalSubmitInteraction,
  MessageCreateOptions,
  MessageEditOptions,
  TextBasedChannel,
  ButtonInteraction,
  Interaction,
  StringSelectMenuInteraction,
} from 'discord.js';
import { BaseComponentView, ViewHandlers } from './BaseView.js';
import BotManager from '../BotManager.js';
import { ComponentType, InteractionContext } from '../entities/ViewContext.js';
import { EntityManager } from '@mikro-orm/core';
import { SCLocations } from '../entities/SCLocations.js';
import logger from '../logger.js';
import { JSONComponent, JSONTypeComponent } from '../utils/Type.js';
import { SafeMethod } from '../exception/Safe.js';

// Décris la forme interne de l’état de l’opération
export interface OperationState {
  type?: string;
  minutes: string;
  location: string;
  games?: string;
  description?: string;
  equip?: string;
  reward?: string;
  url?: string;
  typeSpe? : string;
}

export class OperationView extends BaseComponentView {
  public state: OperationState;
  private em: EntityManager;

  constructor(bot: BotManager) {
    const customIds = [
      'select_type', 'select_heure',
      'select_star', 'select_planet', 'select_moon', 'search_btn',
      'select_game', 'details_btn', 'send_btn', 'cancel_btn',
      'details_modal', 'recherche_modal', 'select_typespe'
    ];

    super(
      bot,
      ViewHandlers.OperationHandler,
      ComponentType.Button,
      []
    );

    this.em = bot.dbMgr.getEm();
    this.state = { minutes: '0', location: '0.0.0' };
    this.customIds = customIds
  }

  public isSupp(val: string): boolean {
    const supp = [this.customIds[9], this.customIds[8]];
    return supp.includes(val);
  }

  @SafeMethod
  private async buildRowsSplit(
    roleEmojis: Record<string, string>,
    listGames: Record<string, string>
  ): Promise<{
    headerRows: ActionRowBuilder<MessageActionRowComponentBuilder>[];
    detailRows:  ActionRowBuilder<MessageActionRowComponentBuilder>[];
  }> {
    const allRows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
    
    let data: Record<string, string> | undefined = this.bot.opMgr.opeConfig.get(this.state.type ?? 'def') as Record<string, string> | undefined
    
    // 1️⃣ TYPE
    allRows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(this.customIds[0])
          .setPlaceholder("Choisissez le type d'opération")
          .addOptions(
            ...Object.entries(roleEmojis).map(([emoji, rId]) => ({
              label: this.bot.guild?.roles.cache.get(rId)?.name ?? emoji,
              value: rId,
              default: this.state.type === rId
            }))
          )
      )
    );

    if (data) {
      data = { GE: 'Non Défini', ...data };
      allRows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
          .setCustomId(this.customIds[12])
          .setPlaceholder("Choisissez l'opération")
          .addOptions(
            ...Object.entries(data).map(([key, val]: [string, string]) => ({
              label: val,
              value: key,
              default: (this.state.typeSpe ?? "GE") === key
            }))
          )
        )
      );
    }

    // 2️⃣ HEURE
    const hourValues = [0,15,30,45,60,90,120,150,180];
    allRows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(this.customIds[1])
          .setPlaceholder('Délai avant début')
          .addOptions(
            ...hourValues.map(m => {
              let label: string;
              if (m === 0) {
                label = 'Immédiat';
              } else if (m < 60) {
                label = `Dans ${m} min`;
              } else {
                const hours = Math.floor(m / 60);
                const remainder = m % 60;
                // Si pas de reste, on affiche “Dans 1 h”, sinon “Dans 1 h30”
                label = remainder === 0
                  ? `Dans ${hours} h`
                  : `Dans ${hours} h${remainder}`;
              }

              return {
                label,
                value: String(m),
                default: this.state.minutes === String(m)
              };
            })
          )
      )
    );

    // --- Les selects étoile/planète/lune vont dans detailRows, on les build ici ---
    if (this.state.type !== String(roleEmojis['🎮'])) {
      // Galaxie : étoile
      const stars = await this.em.find(SCLocations,{parent:null},{populate:['*']});
      const [starId,planetId,moonId] = this.state.location.split('.');

      allRows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(this.customIds[2])
            .setPlaceholder('Choisissez une étoile')
            .addOptions(
              ...stars.map(s=>({
                label: s.name,
                value: s.id.toString(),
                default: starId===s.id.toString()
              }))
            )
        )
      );

      // planète si étoile
      if (starId!=='0') {
        const starBdd=stars.find(s=>s.id.toString()===starId)!;
        const planets=await this.em.find(SCLocations,{parent:starBdd},{populate:['*']});
        allRows.push(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(this.customIds[3])
              .setPlaceholder('Choisissez une planète')
              .addOptions(
                { label:'Aucun', value:'0', default:planetId==='0' },
                ...planets.map(p=>({
                  label:p.name,
                  value:p.id.toString(),
                  default:planetId===p.id.toString()
                }))
              )
          )
        );
      }

      // lune si planète
      if (starId!=='0' && planetId!=='0') {
        const starBdd=stars.find(s=>s.id.toString()===starId)!;
        const planets=await this.em.find(SCLocations,{parent:starBdd},{populate:['*']});
        const planetBdd=planets.find(p=>p.id.toString()===planetId)!;
        const moons=await this.em.find(SCLocations,{parent:planetBdd},{populate:['*']});
        allRows.push(
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId(this.customIds[4])
              .setPlaceholder('Choisissez une lune')
              .addOptions(
                { label:'Aucun', value:'0', default:moonId==='0' },
                ...moons.map(m=>({
                  label:m.name,
                  value:m.id.toString(),
                  default:moonId===m.id.toString()
                }))
              )
          )
        );
      }
    } else {
      // Cas “Jeu”, on remettra select_game dans detailRows
      allRows.push(
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(this.customIds[6])
            .setPlaceholder('Sélectionner un jeu')
            .addOptions(
              ...Object.entries(listGames).map(([key, val]) => ({
                label: val,
                value: key,
                default: this.state.games===key
              }))
            )
        )
      );
    }

    // 3️⃣ Boutons communs -> restent dans detailRows
    allRows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(this.customIds[5])
          .setLabel('Recherche')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(this.customIds[7])
          .setLabel('Ajouter détails')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(this.customIds[8])
          .setLabel('Valider')
          .setStyle(ButtonStyle.Success)
          .setDisabled(!this.canValidate()),
        new ButtonBuilder()
          .setCustomId(this.customIds[9])
          .setLabel('Annuler')
          .setStyle(ButtonStyle.Danger),
      )
    );

    // ** Split en deux messages **
    const headerRows = allRows.slice(0, 2 + (data ? 1 : 0));        // TYPE + HEURE
    const detailRows = allRows.slice(2 + (data ? 1 : 0));           // tout le reste

    return { headerRows, detailRows };
  }

  private canValidate(): boolean {
    // 1️⃣ Type et délai sont toujours requis
    if (!this.state.type || !this.state.minutes || !this.state.description) {
      return false;
    }

    // 2️⃣ Selon le type de l’opération
    if (this.state.type === String(this.bot.opMgr.roleConfig.get('🎮'))) {
      return !!this.state.games;
    } else {
      // Cas “Galaxie” : au moins l’étoile (location.split('.')[0] !== '0')
      const [starId] = this.state.location.split('.');
      if (starId === '0')
        return false;
    }

    return true;
  }

  public async renderHeader(
    channel: TextBasedChannel,
    existingMessage: Message | null
  ): Promise<void> {
    const roleEmojis = this.bot.opMgr.roleConfig.getAll();
    const listGames  = this.bot.opMgr.gameConfig.getAll();
    const { headerRows } = await this.buildRowsSplit(roleEmojis, listGames);

    // Embed d’en-tête
    const embed = new EmbedBuilder()
      .setTitle("Création Opération")
      .setColor(Colors.Blue)
      .setDescription("Remplissez le formulaire suivant pour l'opération");

    // Prépare l’embed (no components)
    const opts: Omit<MessageCreateOptions,'components'> &
                Omit<MessageEditOptions,'components'> = { embeds: [embed] };

    this.rows = headerRows;
    await this.sendOrEdit(
      channel as TextChannel,
      existingMessage,
      opts
    );

  }

  /** Envoie/édite uniquement le message DETAIL */
  public async renderDetail(
    channel: TextBasedChannel,
    existingMessage: Message | null
  ): Promise<void> {
    const roleEmojis = this.bot.opMgr.roleConfig.getAll();
    const listGames  = this.bot.opMgr.gameConfig.getAll();
    const { detailRows } = await this.buildRowsSplit(roleEmojis, listGames);

    // Pas d’embed ici, juste les components
    const opts: Omit<MessageCreateOptions,'components'> &
                Omit<MessageEditOptions,'components'> = {};

    this.rows = detailRows;
    await this.sendOrEdit(
      channel as TextChannel,
      existingMessage,
      opts
    );
  }

  public async render(
    channel: TextBasedChannel,
    existingMessage: Message | null,
    cid: string 
  ): Promise<void> {

    if (!existingMessage) {
       // 0️⃣ Recherche des deux anciens messages à supprimer
      try {
        const fetched = await channel.messages.fetch({ limit: 50 });
        // On cherche le message contenant l'embed "Création Opération"
        const msgs = Array.from(fetched.values())
          .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        const idx = msgs.findIndex(msg =>
          msg.embeds.some(e => e.title === "Création Opération")
        );

        if (idx !== -1) {
          // on a trouvé le header, et potentiellement celui juste après
          const toDelete = [msgs[idx]];
          if (idx + 1 < msgs.length) toDelete.push(msgs[idx + 1]);

          await Promise.all(toDelete.map(async msg => {
            // supprime le message Discord
            try { await msg.delete(); } catch { /* ignore */ }
            // supprime les contexts associés
            await this.em.nativeDelete(InteractionContext, { messageId: msg.id });
          }));
        }
      } catch (err) {
  logger.warn({ msg: "Impossible de nettoyer anciens messages :", err });
      }

      await this.renderHeader(channel, null);
      await this.renderDetail(channel, null);
    } else {
      const headerCIDs = [ this.customIds[0], this.customIds[1], this.customIds[12] ];
      if (headerCIDs.includes(cid)) {
        const ctx = await this.em.findOne(InteractionContext, {
          handlerKey: this.handlerKey,
          channelId: channel.id,
          customId: this.customIds[2], // on prend la première customId de détail
        });

        if (ctx) {
          try {
            const detailMsg = await channel.messages.fetch(ctx.messageId);
            await this.renderDetail(channel, detailMsg);
          } catch {} 
        }
        
        await this.renderHeader(channel, existingMessage);
      } else {
        await this.renderDetail(channel, existingMessage);
      }
    }
  }

  protected getData(customId:string) { return { customId,state:this.state }; }

  public async handleInteraction(
        interaction: Interaction,
        data: InteractionContext['data'][]
    ): Promise<void> {
        
        if ((data as any).state) {
            this.state = { ...this.state, ...(data as any).state };
        }
      
        // 2) Dispatch selon le type
        if (interaction.isButton() || interaction.isStringSelectMenu()) {
          // Ack le clic (on édite le message plus tard via render/edit)
          
          await this.onSelectOrButtonMenuInteraction(interaction);

        } else if (interaction.isModalSubmit()) {
          const modal = interaction as ModalSubmitInteraction;

          // Pour les modals, pas de deferUpdate : on répond normalement
          await modal.deferReply();

  
          try {
            await interaction.deleteReply();
          } catch {
            /* si jamais ça a déjà disparu, on s’en fout */
          }
          // Handler du submit
          await this.onModalSubmit(modal);

          

        // On peut editReply ou followUp dans le handler si besoin
        } else {
        // Non géré : on ignore
          return;
        }

        await this.em.nativeUpdate(InteractionContext, {
          channelId: interaction.channel?.id
        }, {
          data: this.getData(interaction.customId)
        })
    }

    

     /** Gère tous les selects ET les boutons (hors modal) */
    protected async onSelectOrButtonMenuInteraction(
      interaction: StringSelectMenuInteraction | ButtonInteraction
    ): Promise<void> {
      const cid = interaction.customId;

      const skip = [ this.customIds[7], this.customIds[5] ];
      if (!skip.includes(cid)) await interaction.deferUpdate();

      switch (cid) {
        // 1️⃣ Type
        case this.customIds[0]:
          this.state.type = (interaction as StringSelectMenuInteraction).values[0];
          // si on change de type, on réinitialise la localisation et le jeu
          delete this.state.games;
          break;

        // 2️⃣ Heure
        case this.customIds[1]:
          this.state.minutes = (interaction as StringSelectMenuInteraction).values[0];
          break;

        // 3️⃣ Étoile
        case this.customIds[2]:
          {
            const starId = (interaction as StringSelectMenuInteraction).values[0];
            // on met à jour la location en conservant minute et reset planet/moon
            this.state.location = `${starId}.0.0`;
          }
          break;

        // 4️⃣ Planète
        case this.customIds[3]:
          {
            const [, planetId] = this.state.location.split('.');
            const starId = this.state.location.split('.')[0];
            const newPlanet = (interaction as StringSelectMenuInteraction).values[0];
            this.state.location = `${starId}.${newPlanet}.0`;
          }
          break;

        // 5️⃣ Lune
        case this.customIds[4]:
          {
            const [starId, planetId] = this.state.location.split('.');
            const moonId = (interaction as StringSelectMenuInteraction).values[0];
            this.state.location = `${starId}.${planetId}.${moonId}`;
          }
          break;

        // 6️⃣ Bouton Recherche (pour débloquer le select_planet)
        case this.customIds[5]:
            return interaction.showModal((await this.buildRechercheModal(interaction)));

        // 7️⃣ Jeu
        case this.customIds[6]:
          this.state.games = (interaction as StringSelectMenuInteraction).values[0];
          break;

        // 8️⃣ Ajouter détails → ouvrir le modal
        case this.customIds[7]:
          return interaction.showModal((await this.buildDetailModal(interaction)));

        // 9️⃣ Valider → appeler ton manager pour créer l’opération
        case this.customIds[8]:
          await this.bot.opMgr.createOperation(interaction,this.state);

        // 🔟 Annuler → supprimer le message et ses contexts
        case this.customIds[9]:
          let channel = interaction.channel as TextBasedChannel | null;
          if (!channel) {
            channel = await this.bot.channels.fetch(interaction.channelId) as TextBasedChannel;
          }

          // 2️⃣ Fetch des derniers messages pour retrouver header & detail
          let msgs: Message[];
          try {
            const fetched = await channel.messages.fetch({ limit: 50 });
            // on trie par date ascendante
            msgs = Array.from(fetched.values()).sort((a, b) => a.createdTimestamp - b.createdTimestamp);
          } catch (err) {
            logger.warn({ msg: "Impossible de fetcher les messages pour suppression :", err });
            return;
          }

          // 3️⃣ Trouver l'index du message de détail (celui qu'on supprime via le bouton)
          const detailIdx = msgs.findIndex(m => m.id === interaction.message.id);
          if (detailIdx === -1) return; // on ne le retrouve pas : on stoppe

          // 4️⃣ Collecter à supprimer : detail + header juste avant
          const toDelete = [msgs[detailIdx]];
          if (detailIdx > 0) {
            toDelete.push(msgs[detailIdx - 1]);
          }

          // 5️⃣ Supprimer chaque message et nettoyer la DB
          await Promise.all(toDelete.map(async msg => {
            try {
              await msg.delete();
            } catch (delErr) {
              logger.warn({ msg: `Impossible de supprimer le message ${msg.id}`, err: delErr });
            }
            try {
              await this.em.nativeDelete(InteractionContext, { messageId: msg.id });
            } catch (dbErr) {
              logger.warn({ msg: `Impossible de supprimer les contexts pour ${msg.id}`, err: dbErr });
            }
          }));

          return;

        case this.customIds[12]:
          this.state.typeSpe = (interaction as StringSelectMenuInteraction).values[0];
          break;  
        default:
          // customId inconnu
          await logger.warn(`Unhandled customId in OperationView: ${cid}`);
          break;
      }
    }

    /** À surcharger pour gérer le submit du modal */
    protected async onModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
      if (interaction.customId == this.customIds[10]) {
        this.state.description = interaction.fields.getTextInputValue('description');
        if (this.state.type !== this.bot.opMgr.roleConfig.get('🎮')) {
          this.state.equip       = interaction.fields.getTextInputValue('equip');
          this.state.reward      = interaction.fields.getTextInputValue('reward');
        }
        this.state.url         = interaction.fields.getTextInputValue('url');

      } else {
        const query = interaction.fields.getTextInputValue('research').trim();
        // 2️⃣ Cherche l’entité en base
        const found = await this.em.findOne(SCLocations, { name: query }, { populate: ['parent'] });
        if (found) {
          // 3️⃣ Détermine le type et met à jour state.location
          // Si pas de parent → c’est une étoile
          if (!found.parent) {
            this.state.location = `${found.id}.0.0`;

          // Si parent existe, et que son parent est null → planète
          } else if (!found.parent.parent) {
            const starId = found.parent.id;
            const planetId = found.id;
            this.state.location = `${starId}.${planetId}.0`;

          // Sinon → c’est une lune
          } else {
            const planet = found.parent;
            const star   = planet.parent!;
            this.state.location = `${star.id}.${planet.id}.${found.id}`;
          }
        }
      }

      await this.em.nativeDelete(InteractionContext,  {
        messageId:   interaction.message!.id,       // ou interaction.channel.messages.fetch…
        channelId:   interaction.channelId,
        customId:    interaction.customId,          // 'details_modal'
        handlerKey:  this.handlerKey,
      });
      
    }

    private async buildRechercheModal(interaction: StringSelectMenuInteraction | ButtonInteraction): Promise<ModalBuilder> {
      const modal = new ModalBuilder()
        .setCustomId(this.customIds[11])  
        .setTitle('Recherche');

      const rechercheInput = new TextInputBuilder()
        .setCustomId('research')
        .setLabel('Recherchez un Corps')
        .setRequired(true)
        .setPlaceholder('Entrez un texte ici..')
        .setStyle(TextInputStyle.Short);

     
      // Chaque TextInput doit être encapsulé dans un ActionRow
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(rechercheInput),
      );

      const existing = await this.em.findOne(InteractionContext, {
        messageId:   interaction.message.id,      
        channelId:   interaction.channelId,
        customId:    this.customIds[11],          
        handlerKey:  this.handlerKey,
      });

      if (existing) {
        existing.data = this.getData(this.customIds[11]);
        await this.em.persistAndFlush(existing);     
      } else {
        const ctx = this.em.create(InteractionContext, {
          messageId:   interaction.message.id,       
          channelId:   interaction.channelId,
          customId:    this.customIds[11],         
          handlerKey:  this.handlerKey,
          componentType: this.componentType,
          data:        this.getData(this.customIds[11]),
        });
        await this.em.persistAndFlush(ctx);
      }

      return modal;
    }

    private async buildDetailModal(interaction: StringSelectMenuInteraction | ButtonInteraction): Promise<ModalBuilder> {
      const modal = new ModalBuilder()
        .setCustomId(this.customIds[10])  // 'details_modal'
        .setTitle('Ajouter des détails');

      // 1️⃣ Description (paragraphe)
      const descriptionInput = new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Description')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setPlaceholder('Entrez un texte ici..')
        .setValue(this.state.description ?? '')
        .setStyle(TextInputStyle.Short)
        .setMaxLength(200);

      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput));

      if (this.state.type !== this.bot.opMgr.roleConfig.get('🎮') as string) {

        // 2️⃣ Équipement (court)
        const equipInput = new TextInputBuilder()
          .setCustomId('equip')
          .setLabel('Equipement à prévoir')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Entrez un texte ici...')
          .setValue(this.state.equip ?? '');
          

        // 3️⃣ Récompense (court)
        const rewardInput = new TextInputBuilder()
          .setCustomId('reward')
          .setLabel('Récompense proposée')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Entrez la Récompense ici...')
          .setValue(this.state.reward ?? '');

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(equipInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(rewardInput)
        );
    }

      // 4️⃣ URL (court)
      const urlInput = new TextInputBuilder()
        .setCustomId('url')
        .setLabel("Url pour l'opération")
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder("Entrez l'url pour l'opération (Regolith ou autre)")
        .setValue(this.state.url ?? '');


      // Chaque TextInput doit être encapsulé dans un ActionRow
      modal.addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput)
      );


      const existing = await this.em.findOne(InteractionContext, {
        messageId:   interaction.message.id,       // ou interaction.channel.messages.fetch…
        channelId:   interaction.channelId,
        customId:    this.customIds[10],          // 'details_modal'
        handlerKey:  this.handlerKey,
      });

      if (existing) {
        existing.data = this.getData(this.customIds[10]);
        await this.em.persistAndFlush(existing);      // seulement persist, pas flush
      } else {
        const ctx = this.em.create(InteractionContext, {
          messageId:   interaction.message.id,       // ou interaction.channel.messages.fetch…
          channelId:   interaction.channelId,
          customId:    this.customIds[10],          // 'details_modal'
          handlerKey:  this.handlerKey,
          componentType: this.componentType,
          data:        this.getData(this.customIds[10]),
        });
        await this.em.persistAndFlush(ctx);
      }

      return modal;
    }
}

export class CreationOperationView extends BaseComponentView {
  constructor(bot: BotManager) {
    // ① On déclare le customId et le handlerKey
    const handlerKey = ViewHandlers.OperationHandler;
    const componentType = ComponentType.Button;

    const json: JSONComponent[] = [
      {
        type: JSONTypeComponent.Button,
        customId: 'op_btn',
        label: 'Créer une Opération',
        style: 'Success'
      }
    ] 
   
    super(bot, handlerKey, componentType, json);
  }

  /**
   * Envoie ou édite le message “Cliquez pour créer” dans le channel spécifié.
   */
  public async render(channel: TextChannel, existingMessage: Message | null): Promise<Message> {


    const embed = new EmbedBuilder()
      .setTitle("Création Opération")
      .setColor(Colors.Blue)
      .setDescription("Pour créer une opération, cliquez sur le bouton ci-dessous.")

    const options = {
      embeds : [ embed ]
    };

    // Utilise sendOrEdit de BaseComponentView
    return this.sendOrEdit(channel, existingMessage, options);
  }

  protected getData(customId: string): Record<string, any> {
    // Cette vue ne porte pas d’état supplémentaire
    return {};
  }

  
}
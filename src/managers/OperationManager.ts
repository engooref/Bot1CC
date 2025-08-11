// src/managers/OperationRoleManager.ts
import {
  ChannelType,
  PermissionFlagsBits,
  CategoryChannel,
  TextChannel,
  EmbedBuilder,
  ButtonInteraction,
  TextBasedChannel,
  Message,
  AttachmentBuilder,
  MessageReaction,
  User,
  MessageFlags,
} from 'discord.js';
import fs from 'fs';
import path from 'path';
import BotManager from '../BotManager.js';
import { CreationOperationView, OperationState, OperationView } from '../view/OperationView.js';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';
import logger from '../logger.js';
import { SCLocations } from '../entities/SCLocations.js';
import { SVGManager } from '../utils/SVGManager.js';
import mime from 'mime';

const CATEGORY_NAME = 'Opérations';
const FOLDER_NAME = "Operations";
const BASE = path.resolve('config');
const PENDING_LINKS_PATH = path.join(BASE, 'pendingLinks.json');

export class OperationModule {
  public roleConfig: JSONConfigManager<Record<string,string>>;
  public gameConfig: JSONConfigManager<Record<string,string>>;
  public opeConfig: JSONConfigManager<Record<string,string>>;
  public roleManager: OperationRoleManager;
  private creationView: CreationOperationView;
  private fcategory: CategoryChannel | undefined;

  constructor(private bot: BotManager) {
    // on instancie les config managers
    this.roleConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'roles.json'));
    this.gameConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'games.json'));
    this.opeConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'typeOp.json'));

    // on passe les managers à RoleManager
    this.roleManager   = new OperationRoleManager(bot, this);
    this.creationView  = new CreationOperationView(bot);

    // quand le JSON change (via slash ou FS), on met à jour Discord
    this.roleConfig.on('change', () => this.roleManager.updateRoles());
    this.bot.excludeCategory.push(CATEGORY_NAME);
  }

  public async init(): Promise<void> {
    await logger.debug('Initialisation des opérations')
    const channel = await this.ensureCreationChannel();
    const fetched = await channel.messages.fetch({ limit: 50 });
    const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.components.length > 0) || null;
    await this.creationView.render(channel, existing);

    await this.roleManager.updateRoles();
    this.roleConfig.watch();

    await this.ensureCreationOperationsChannels();
    this.resumePendingLinks(); // Ajout de la reprise des liens en attente
  }

  public async ensureCategory(): Promise<CategoryChannel> {
    if (!this.fcategory) {
        const guild = this.bot.guild;
        this.fcategory = guild.channels.cache.find(
            c => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME
        ) as CategoryChannel | undefined;

        if (!this.fcategory) {
            this.fcategory = await guild.channels.create({
              name: CATEGORY_NAME,
              type: ChannelType.GuildCategory,
              permissionOverwrites: [{
                  id: guild.roles.everyone.id,
                  deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
              },
              {
                id: this.bot.roleMember!.id,
                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]
              }],
            });
        }
    }
    
    return this.fcategory;
  }


  /** Crée ou récupère la catégorie "Opérations" et le salon "création-opération" */
  private async ensureCreationChannel(): Promise<TextChannel> {
    const guild = this.bot.guild;
    const category = await this.ensureCategory();

    // Salon création-opération
    let creationChannel = guild.channels.cache.find(
      c => 
        c.parentId === category.id &&
        c.type === ChannelType.GuildText &&
        c.name === 'création-opération'
    ) as TextChannel;
    if (!creationChannel) {
      creationChannel = await guild.channels.create({
        name: 'création-opération',
        type: ChannelType.GuildText,
        parent: category.id,
      });
    }
    return creationChannel;
  }

  private async ensureCreationOperationsChannels(): Promise<void> {
    const category = await this.ensureCategory();
    const guild = this.bot.guild;

    for (const [key, val] of Object.entries(this.roleConfig.getAll())) {
      const role = guild.roles.cache.get(val);
      if(!role) continue;

      const channel = guild.channels.cache.find(
        c => 
          c.parentId === category.id &&
          c.type === ChannelType.GuildText &&
          c.name === role.name.replace(' ', '-').toLowerCase()
      ) as TextChannel;
      if (!channel) {
        await guild.channels.create({
          name: role.name.replace(' ', '-').toLowerCase(),
          type: ChannelType.GuildText,
          parent: category.id,
        });
      }
    }
  }

  public async sendForm(interaction: ButtonInteraction): Promise<void> {
    const user = interaction.user;
    const dmChannel = await user.createDM();

    await interaction.deferUpdate();

    // 2️⃣ Instancie ta vue et envoie-la dans le DM
    const view = new OperationView(this.bot);
    await view.render(dmChannel as TextBasedChannel, null, '');

    // 3️⃣ Acknowledge de la commande en public ou en éphémère
    await interaction.followUp({
      content: "Formulaire Opération envoyé en DM.",
      ephemeral: true,
    });

    await logger.debug("Envoi du formulaire Opération à " + user.displayName);

  }

  public async handlerForm(interaction: any, data: any) {
    
    const em = this.bot.dbMgr.getEm();

    const view = new OperationView(this.bot);

    await view.handleInteraction(interaction, data);

    let dmChannel = interaction.channel; // c’est déjà le DMChannel
    if (!dmChannel) {
      // retombe sur le client pour récupérer le channel
      dmChannel = await this.bot.channels.fetch(
        interaction.channelId
      ) as TextBasedChannel;
    }
    const existingMessage = interaction.message;


    if(!view.isSupp(interaction.customId))
      await view.render(dmChannel as TextBasedChannel, existingMessage as Message, interaction.customId);
    
  }

  public async createOperation(interaction: any, state: OperationState) {
    const role = this.bot.guild.roles.cache.get(state.type!);
    if (!role) return;

    const name = (state.typeSpe && state.typeSpe !== 'GE') ? (path.join('MP', state.typeSpe)) : role.name;
    const config = {
      svgTemplatePath: path.join('Data', FOLDER_NAME, `${name}.svg`),
      xsltPath: path.join('Data', FOLDER_NAME, 'template.xslt'),
      outputSvgPath: path.join('Data', FOLDER_NAME, 'operation.svg'),
      outputPngPath: path.join('Data', FOLDER_NAME, `${interaction.user.username}_${role.name}.png`),
      baseDir: path.join('Data', FOLDER_NAME)
    };

    const mins = Number(state.minutes) || 0;
    const futureDate = new Date(Date.now() + mins * 60_000);
    const timeString = new Intl.DateTimeFormat('fr-FR', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris'
    }).format(futureDate);
    let dateString = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day:     '2-digit',
      month:   '2-digit',
      year:    'numeric',
      timeZone: 'Europe/Paris'
    }).format(futureDate).toUpperCase();

    const indices = state.location.split('.').map((n: string) => parseInt(n, 10));
    const names: string[] = [];
    for (const idx of indices) {
      if (idx == 0) break;
      const entity: SCLocations | null = await this.bot.dbMgr.getEm().findOne(SCLocations, { id: idx });
      if(!entity) break;
      names.push(entity.name);
    }
    const entete = `[${timeString}] OPÉRATION ${role.name.toUpperCase().split('-')[1]} - RESPONSABLE: ${interaction.user.displayName}`;

    let dataUri = null;
    if (state.type === this.bot.opMgr.roleConfig.get('🎮')) {
      const imgPath = path.join(config.baseDir, 'MG', state.games + '.png');
      const fileBuffer = fs.readFileSync(imgPath);
      const contentType = mime.lookup(imgPath) || 'application/octet-stream';
      const base64    = fileBuffer.toString('base64');
      dataUri   = `data:${contentType};base64,${base64}`;
    }

    const materiel = (state.type === this.bot.opMgr.roleConfig.get('🎮')) ? (this.gameConfig.get(state.games!)) : (state.equip ? `Equipement: ${state.equip}` : '');
    const data = {
      description: state.description ? state.description : '',
      materiel: materiel,
      prime: state.reward ? `Prime: ${state.reward}` : '',
      localisation: names.join(' >> '),
      info: entete,
      date: dateString,
      imgMG: (state.type === this.bot.opMgr.roleConfig.get('🎮')) ? dataUri : ''
    };

    const SVGMgr = new SVGManager(data, config);
    await SVGMgr.generateImage();

    let channel = this.bot.guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === role.name.replace(' ', '-').toLowerCase()
    ) as TextChannel | undefined;
    if (!channel) {
      await this.ensureCreationOperationsChannels();       
      const allChannels = await this.bot.guild.channels.fetch(); // récupère depuis l’API
      channel = allChannels.find(
        (c) => c!.type === ChannelType.GuildText && c!.name === role.name.replace(' ', '-').toLowerCase()
      ) as TextChannel | undefined;
    }

    const attachment = new AttachmentBuilder(config.outputPngPath);
    const emoji = this.bot.guild.emojis.cache.get('1213915551210930306') ?? "👍";

    // --- Envoi du message Discord ---
    const message = await channel!.send({
      content: `\nPour valider votre présence interagissez avec l'emoji ${emoji}`,
      files: [attachment]
    });
    await message.react(emoji);
    const thread = await message.startThread({
      name: `Discussion - ${role.name.toUpperCase().split('-')[1]}`,
      autoArchiveDuration: 1440,
    });
    await thread.send({
      content: "👋 **Bienvenue dans le fil de discussion de cette opération !**\n📌 Discutez des stratégies, rôles et détails ici.\n" + (state.url ? `Une URL a été partagé: ${state.url}` : '') 
    });

        // --- Ajout de la requête HTTP vers le site Symfony pour générer le lien temporaire ---
    let tempUrl = null;
    let tempUrlExpires = null;

    // Ajoute ce bloc pour ignorer la génération du lien si c'est une opération multigaming
    if (state.type !== this.bot.opMgr.roleConfig.get('🎮')) {
      try {
        // Remplace l'URL par celle de ton site
        const siteUrl = 'https://www.1ercorpscolonial.fr/bot/operation/generate-temp-url';
        // Prépare les paramètres
        const params = new URLSearchParams({
          user_id: interaction.user.id,
          operation_id: message.id,
          responsable: interaction.user.displayName,
          start_at: futureDate.toISOString(),
          channel_id: channel!.id,
          thread_id: thread.id,
        });

        const response = await fetch(`${siteUrl}?${params.toString()}`);
        if (response.ok) {
          let json;
          try {
            json = await response.json();
          } catch (jsonErr) {
            const text = await response.text();
            await logger.error('Réponse non JSON du site:', text);
            throw jsonErr;
          }
          tempUrl = json.temp_url;
          tempUrlExpires = json.expires_at;
        } else {
          const text = await response.text();
          await logger.warn('Erreur lors de la génération du lien temporaire: ' + response.statusText + ' Body: ' + text);
        }
      } catch (err) {
        await logger.error('Erreur lors de la requête vers le site Symfony:', err);
      }
    }


    await logger.debug("Envoi de l'opération créer par " + interaction.user.displayName);
    await interaction.followUp({
      content: '✅ Opération créée ! Vous pouvez la retrouver dans le salon ' + channel!.toString() + '.',
      ephemeral: true,
    });

    if (tempUrl) {
      const now = Date.now();
      const startAt = futureDate.getTime();
      const delay = Math.max(0, startAt + 60 * 60 * 1000 - now);

      // Ajoute à la file d'attente persistante
      this.addPendingLink({
        id: message.id,
        userId: interaction.user.id,
        tempUrl,
        sendAt: now + delay
      });

      setTimeout(async () => {
        try {
          const dm = await interaction.user.createDM();
          await dm.send(`Le rapport d'opération est prêt, voici le lien temporaire valable 2 jours :\n${tempUrl}`);
          this.removePendingLink(message.id);
        } catch (err) {
          await logger.warn('Impossible d\'envoyer le lien temporaire en DM:', err);
        }
      }, delay);
    }
  }

  /** Gestion des liens temporaires en attente */
  public loadPendingLinks(): any[] {
    try {
      return JSON.parse(fs.readFileSync(PENDING_LINKS_PATH, 'utf-8'));
    } catch {
      return [];
    }
  }

  public savePendingLinks(links: any[]) {
    fs.writeFileSync(PENDING_LINKS_PATH, JSON.stringify(links, null, 2));
  }

  public addPendingLink(link: any) {
    const links = this.loadPendingLinks();
    links.push(link);
    this.savePendingLinks(links);
  }

  public removePendingLink(id: string) {
    let links = this.loadPendingLinks();
    links = links.filter(l => l.id !== id);
    this.savePendingLinks(links);
  }

  public resumePendingLinks() {
    const links = this.loadPendingLinks();
    for (const link of links) {
      const delay = Math.max(0, link.sendAt - Date.now());
      setTimeout(async () => {
        try {
          const user = await this.bot.guild.members.fetch(link.userId);
          const dm = await user.createDM();
          await dm.send(`Voici ton lien temporaire d'accès au rapport d'opération :\n${link.tempUrl}`);
          this.removePendingLink(link.id);
        } catch (err) {
          await logger.warn('Impossible d\'envoyer le lien temporaire en DM:', err);
        }
      }, delay);
    }
  }
}

export class OperationRoleManager {
    constructor(
        private bot: BotManager,
        private module: OperationModule,
    ) {}
    /** Crée (ou récupère) la catégorie “Opérations” et le salon “role-opération”. */
    public async ensureRoleChannel(): Promise<TextChannel> {
        const guild = this.bot.guild;

        // Catégorie
        const category = await this.module.ensureCategory();

        // Salon role-opération
        let roleChannel = guild.channels.cache.find(
        c =>
            c.parentId === category.id &&
            c.type === ChannelType.GuildText &&
            c.name === 'role-opération'
        ) as TextChannel;
        if (!roleChannel) {
        roleChannel = await guild.channels.create({
            name: 'role-opération',
            type: ChannelType.GuildText,
            parent: category.id,
        });
        }

        return roleChannel;
    }

    public async updateRoles(): Promise<void> {
        const roleMap = this.module.roleConfig.getAll();

        const roleChannel = await this.ensureRoleChannel();
        const embed = new EmbedBuilder()
        .setTitle('Rôle Opération')
        .setDescription('Réagissez aux emojis suivants pour les pings opérations:')
        .setColor(0xff0000);

        for (const [emoji, roleId] of Object.entries(roleMap)) {
            const role = this.bot.guild.roles.cache.get(roleId);
            if (role) 
                embed.addFields({ name: '', value: `${emoji} : ${role.name}` , inline: false });
        }

        const fetched = await roleChannel.messages.fetch({ limit: 50 });
        const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.embeds.length);

        let msg = existing!;
        if (msg) await msg.edit({ embeds: [embed] });
        else    msg = await roleChannel.send({ embeds: [embed] });

        for (const emoji of Object.keys(roleMap)) {
            await msg.react(emoji).catch(() => null);
        }

        const filter = (reaction: MessageReaction, user: User) =>
          roleMap.hasOwnProperty(reaction.emoji.name!)  && !user.bot;

      const collector = msg.createReactionCollector({ filter, dispose:true }); // 1h

      collector.on('collect', async (reaction, user) => {
        // Ignore les bots
        if (user.bot) return;

        // Récupère l’émoji comme clé
        const emoji = reaction.emoji.name!;
        // roleEmoji est ton mapping emoji → roleId
        const roleId = roleMap[emoji];
        if (!roleId) return;  // pas de rôle associé à cet émoji

        // Récupère le membre de la guilde
        const guild = reaction.message.guild;
        if (!guild) return;

        let member = guild.members.cache.get(user.id);
        // Si pas en cache, fetch le membre
        if (!member) {
          try {
            member = await guild.members.fetch(user.id);
          } catch {
            await logger.warn(`Membre ${user.id} introuvable.`);
            return;
          }
        }

        // Ajoute le rôle
        try {
          await member.roles.add(roleId);
          await logger.debug(`Ajout du rôle ${roleId} à ${user.tag} pour l'émoji ${emoji}.`);
        } catch (err) {
          await logger.error(`Impossible d'ajouter le rôle ${roleId} à ${user.tag}:`, err);
        }
      });

      collector.on('remove', async (reaction, user) => {
        if (user.bot) return;
        const emoji = reaction.emoji.name!;
        const roleId = roleMap[emoji];
        if (!roleId) return;
        
        const guild = reaction.message.guild;
        if (!guild) return;
        let member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id);
        
        try {
          await member.roles.remove(roleId);
          await logger.debug(`Retrait du rôle ${roleId} pour ${user.tag} suite au retrait de ${emoji}`);
        } catch (err) {
          await logger.error(`Impossible de retirer le rôle :`, err);
        }
      });
    }
}

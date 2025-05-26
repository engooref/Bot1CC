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
} from 'discord.js';
import path from 'path';
import BotManager from '../BotManager.js';
import { CreationOperationView, OperationView } from '../view/OperationView.js';
import { JSONConfigManager } from '../utils/JSONConfigManager.js';
import logger from '../logger.js';
import fs from 'fs';
import { SCLocations } from '../entities/SCLocations.js';
import { SVGManager } from '../utils/SVGManager.js';
import mime from 'mime';
import { channel } from 'diagnostics_channel';

const CATEGORY_NAME = 'Opérations';
const FOLDER_NAME = "Operations";
const BASE = path.resolve('config');

export class OperationModule {
  public roleConfig: JSONConfigManager<Record<string,string>>;
  public gameConfig: JSONConfigManager<Record<string,string>>;
  public roleManager: OperationRoleManager;
  private creationView: CreationOperationView;
  private fcategory: CategoryChannel | undefined;

  constructor(private bot: BotManager) {
    // on instancie les config managers
    this.roleConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'roles.json'));
    this.gameConfig = new JSONConfigManager<Record<string,string>>(path.join(BASE, 'games.json'));

    // on passe les managers à RoleManager
    this.roleManager   = new OperationRoleManager(bot, this);
    this.creationView  = new CreationOperationView(bot);

    // quand le JSON change (via slash ou FS), on met à jour Discord
    this.roleConfig.on('change', () => this.roleManager.updateRoles());
    this.bot.excludeCategory.push(CATEGORY_NAME);
  }

  public async init(): Promise<void> {
    logger.info('Initialisation des opérations')
    const channel = await this.ensureCreationChannel();
    const fetched = await channel.messages.fetch({ limit: 50 });
    const existing = fetched.find(m => m.author.id === this.bot.user!.id && m.components.length > 0) || null;
    await this.creationView.render(channel, existing);

    await this.roleManager.updateRoles();
    this.roleConfig.watch();

    await this.ensureCreationOperationsChannels();
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

    logger.info("Envoi du formulaire Opération à " + user.displayName);

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

  public async createOperation(interaction: any, state: any) {
    const role = this.bot.guild.roles.cache.get(state.type);
    if (!role) return;

    const config = {
      svgTemplatePath: path.join('Data', FOLDER_NAME, `${role.name}.svg`),
      xsltPath: path.join('Data', FOLDER_NAME, 'template.xslt'),
      outputSvgPath: path.join('Data', FOLDER_NAME, 'operation.svg'),
      outputPngPath: path.join('Data', FOLDER_NAME, `${interaction.user.username}_${role.name}.png`),
      baseDir: path.join('Data', FOLDER_NAME)
    };
    
   const mins = Number(state.minutes) || 0;

    // 2. Construire directement un timestamp ms dans le futur
    const futureDate = new Date(Date.now() + mins * 60_000);

    // 3) On formate l’heure pour Paris
    const timeString = new Intl.DateTimeFormat('fr-FR', {
      hour12: false,
      hour:   '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Paris'
    }).format(futureDate);

    // formattage date “DIMANCHE 25/05/2025”
    let dateString = new Intl.DateTimeFormat('fr-FR', {
      weekday: 'long',
      day:     '2-digit',
      month:   '2-digit',
      year:    'numeric',
      timeZone: 'Europe/Paris'
    }).format(futureDate).toUpperCase();

    const indices = state.location.split('.').map((n: string) => parseInt(n, 10));

    const names: string[] = [];

    // 2) Pour chaque indice, on récupère la liste des enfants triés, puis on prend l’enfant à l’index donné
    for (const idx of indices) {
      if (idx == 0) break;
      // Récupère tous les enfants du parent courant, triés par id (ou un autre champ souhaité)
      const entity: SCLocations | null = await this.bot.dbMgr.getEm().findOne(SCLocations, { id: idx });

      if(!entity) break;
      names.push(entity.name);
    }
    
    const entete = `[${timeString}] OPÉRATION ${role.name.toUpperCase().split('-')[1]} - RESPONSABLE: ${interaction.user.displayName}`;

    let dataUri = null
    if (state.type === this.bot.opMgr.roleConfig.get('🎮')) {
      // 1) Chemin vers l'image
      const imgPath = path.join(config.baseDir, 'MG', state.games + '.png');

      // 2) Lecture du fichier en Buffer
      const fileBuffer = fs.readFileSync(imgPath);

      // 3) Détection du mime-type à partir de l'extension
      const contentType = mime.lookup(imgPath) || 'application/octet-stream';

      // 4) Conversion en base64
      const base64    = fileBuffer.toString('base64');
      dataUri   = `data:${contentType};base64,${base64}`;
    }

    const materiel = (state.type === this.bot.opMgr.roleConfig.get('🎮')) ? (this.gameConfig.get(state.games)) : (state.equip ? `Equipement: ${state.equip}` : '');
    
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

    const message = await channel!.send({
      content: `${role}\nPour valider votre présence interagissez avec l'emoji ${emoji}`,
      files: [attachment]
    })

    await message.react(emoji);
  
    const thread = await message.startThread({
      name: `Discussion - ${role.name.toUpperCase().split('-')[1]}`,               // nom du thread
      autoArchiveDuration: 1440,        // auto-archivage après 60 minutes d’inactivité
    });

    await thread.send({
      content: "👋 **Bienvenue dans le fil de discussion de cette opération !**\n📌 Discutez des stratégies, rôles et détails ici.\n" + (state.url ? `Une URL a été partagé: ${state.url}` : '') 
    });

    logger.info("Envoi de l'opération créer par " + interaction.user.displayName);
    await interaction.followUp({
      content: '✅ Opération créée !',
      ephemeral: true,
    });

    
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
            logger.warn(`Membre ${user.id} introuvable.`);
            return;
          }
        }

        // Ajoute le rôle
        try {
          await member.roles.add(roleId);
          logger.info(`Ajout du rôle ${roleId} à ${user.tag} pour l'émoji ${emoji}.`);
        } catch (err) {
          logger.error(`Impossible d'ajouter le rôle ${roleId} à ${user.tag}:`, err);
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
          logger.info(`Retrait du rôle ${roleId} pour ${user.tag} suite au retrait de ${emoji}`);
        } catch (err) {
          logger.error(`Impossible de retirer le rôle :`, err);
        }
      });
    }
}

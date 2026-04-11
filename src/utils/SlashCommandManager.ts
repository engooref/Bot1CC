import { REST, Routes, SlashCommandBuilder, Collection, Interaction, SlashCommandSubcommandBuilder, RESTPostAPIApplicationCommandsJSONBody, ChatInputCommandInteraction, MessageFlags } from "discord.js";
import fs from "fs";
import path from "path";
import BotManager from "../BotManager.js";
import { getManagerLogger } from "../logger.js";


interface SimpleOption {
  type: "STRING" | "USER" | "INTEGER"; 
  name: string;
  description: string;
  required?: boolean;
}

interface SubCommandOption {
  type: "SUB_COMMAND";
  name: string;
  description: string;
  options?: SimpleOption[];
}

// Définissez un type ou une interface pour chaque entrée
interface CommandEntry {
  data: SlashCommandBuilder;
  execute: CommandHandler;
}

export interface CommandDefinition {
  name: string;
  description: string;
  options?: Array<SubCommandOption | SimpleOption>;
  handler: string; // clé pour retrouver la fonction dans handlersMap
}

export type CommandHandler = (interaction: Interaction) => Promise<void>;


export default class SlashCommandManager {
  private commands: Map<string, CommandEntry> = new Map();
  private commandsJSON: RESTPostAPIApplicationCommandsJSONBody[] = [];
  private commandsDefinition: CommandDefinition[] = [];
  private logger = getManagerLogger('SlashCommandManager');
  
  constructor(private bot: BotManager, private handlersMap: Record<string, CommandHandler>) 
  {}

  private loadDefinitions() {
    for (const cmdDef of this.commandsDefinition) {
      // 1) Validation de base
      if (!cmdDef.name || !cmdDef.description || !cmdDef.handler) {
        this.logger.warn({ msg: `[SlashCommandManager] Commande mal définie :`, cmdDef });
        continue;
      }

      // 2) Création du SlashCommandBuilder pour la commande “racine”
      const builder = new SlashCommandBuilder()
        .setName(cmdDef.name)
        .setDescription(cmdDef.description);

      // 3) Parcours des options si elles existent
      if (Array.isArray(cmdDef.options)) {
        for (const opt of cmdDef.options) {
          // Cas : sous-commande (SUB_COMMAND)
          if (opt.type === "SUB_COMMAND") {
            builder.addSubcommand((sub: SlashCommandSubcommandBuilder) => {
              sub.setName(opt.name).setDescription(opt.description);

              // Si la sous-commande contient ses propres options (type SimpleOption)
              if (Array.isArray(opt.options)) {
                for (const subOpt of opt.options) {
                  if (subOpt.type === "STRING") {
                    sub.addStringOption(o =>
                      o.setName(subOpt.name)
                       .setDescription(subOpt.description)
                       .setRequired(!!subOpt.required)
                    );
                  } else if (subOpt.type === "USER") {
                    sub.addUserOption(o =>
                      o.setName(subOpt.name)
                       .setDescription(subOpt.description)
                       .setRequired(!!subOpt.required)
                    );
                  } else if (subOpt.type === "INTEGER") {
                    sub.addIntegerOption(o =>
                      o.setName(subOpt.name)
                       .setDescription(subOpt.description)
                       .setRequired(!!subOpt.required)
                    );
                  } else {
                    // Si on ajoute d'autres types (BOOLEAN, ROLE, etc.), on gère ici
                    sub.addStringOption(o =>
                      o.setName(subOpt.name)
                       .setDescription(subOpt.description)
                       .setRequired(!!subOpt.required)
                    );
                  }
                }
              }

              return sub;
            });

          // Cas : option “simple” directement sur la commande (pas de sub-command)
          } else if (opt.type === "STRING") {
            builder.addStringOption(o =>
              o.setName(opt.name)
               .setDescription(opt.description)
               .setRequired(!!opt.required)
            );
          } else if (opt.type === "USER") {
            builder.addUserOption(o =>
              o.setName(opt.name)
               .setDescription(opt.description)
               .setRequired(!!opt.required)
            );
          } else if (opt.type === "INTEGER") {
            builder.addIntegerOption(o =>
              o.setName(opt.name)
               .setDescription(opt.description)
               .setRequired(!!opt.required)
            );
          } else {
            // Pour d’autres types (BOOLEAN, CHANNEL, etc.), on pourrait ajouter un bloc analogous
          }
        }
      }

      // 4) Récupérer la fonction de handler dans handlersMap
      const handlerFn = this.handlersMap[cmdDef.handler];
      if (typeof handlerFn !== "function") {
        this.logger.warn({ msg: `[SlashCommandManager] Handler introuvable pour '${cmdDef.name}'` });
        continue;
      }

      // 5) Stockage dans la map interne
      this.commands.set(cmdDef.name, { data: builder, execute: handlerFn });
      this.commandsJSON.push(builder.toJSON());
    }
  }

  /**
   * Enregistre toutes les commandes auprès de Discord (guild ou global selon config).
   */
  public async registerAll() {
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
      await rest.put(
        Routes.applicationCommands(this.bot.user!.id),
        { body: this.commandsJSON }
      );
      await this.logger.debug({ msg: "SlashCommandManager → Commandes enregistrées en global." });
    } catch (err) {
      await this.logger.error({ msg: "SlashCommandManager → Erreur enregistrement global :", err });
    }
  }

  /**
   * À appeler dans le listener `interactionCreate`. 
   * Si c’est une ChatInputCommand, on récupère le handler et on l’exécute.
   */
  public async handleInteraction(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    

    const name = interaction.commandName; // ex. "ping" ou "user"
    const entry = this.commands.get(name);
    if (!entry) {
      await this.logger.error({ msg: `[SlashCommandManager] Commande non trouvée : ${name}` });
      return;
    }

    try {
      // L’exécution du handler (pingHandler ou userHandler)
      await entry.execute(interaction as ChatInputCommandInteraction);
    } catch (err: Error | any) {
      await this.logger.error({ msg: `[SlashCommandManager] Erreur exécution '${name}' :`, err });
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ content: "⚠️ Une erreur est survenue.", ephemeral: true });
      } else {
        await interaction.reply({ content: "⚠️ Une erreur est survenue.", ephemeral: true });
      }
    }
  }

  public async loadAllCommandDefinitions(): Promise<void> {
    const fullPath: string = path.resolve('./commands');
    
    const files = fs.readdirSync(fullPath).filter(f => f.endsWith(".json"));

    for (const file of files) {
      const filePath = path.join(fullPath, file);
      // Lire le contenu brut du fichier
      const raw = fs.readFileSync(filePath, "utf-8");
      try {
        const jsonContent = JSON.parse(raw) as CommandDefinition[];
        if (Array.isArray(jsonContent)) {
          this.commandsDefinition.push(...jsonContent);
        } else {
          await this.logger.warn({ msg: `[loadJSONCommands] Le fichier ${file} n’exporte pas un tableau.` });
        }
      } catch (err) {
        await this.logger.error({ msg: `[loadJSONCommands] Erreur parsing ${file} :`, err });
        throw err;
      }
    }

    this.loadDefinitions();
    await this.registerAll();
  }
}
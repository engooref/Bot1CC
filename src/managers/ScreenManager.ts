import { Channel, ChatInputCommandInteraction, ComponentType, DMChannel, GuildMemberRoleManager, Message, MessageFlags, ModalSubmitInteraction, PermissionFlagsBits, StringSelectMenuInteraction, TextBasedChannel, TextChannel } from "discord.js";
import { BotManager } from "../BotManager";
import { CommandHandler } from "../utils/SlashCommandManager.js";
import ScreenConfigView, { Handlers, ScreenConfig2View } from "../view/ScreenView.js";
import { ComponentInteraction, ViewHandlers } from "../view/BaseView.js";
import { JSONConfigManager } from "../utils/JSONConfigManager.js";
import path from "path";
import { SafeMethod } from "../exception/Safe.js";
import { InteractionContext } from "../entities/ui/ViewContext.js";



export const defaultConfig: Record<string, string> = {
  category_screen:     'defaultScreenCatId',
  channel_screen:      'defaultScreenChanId',
  category_result:     'defaultResultCatId',
  channel_result:      'defaultResultChanId',
  schedule_day:        'MONDAY',
  schedule_hour:       '10:00',
  reminder_hours_before: '24',
  reminder_text_before:  'N’oubliez pas : le concours se termine bientôt !',
  thread_name_template: '📸 Concours hebdo du {date}',
  welcome_message:     'Envoyez vos plus belles captures PNG/JPEG ! 🎉',
  theme_default:       '',
  emoji_vote:          '👍',
};

const BASE = path.resolve('config');
export class ScreenManager {

    public configFile: JSONConfigManager<Record<string,string>>;

    private currentCategory?: string;

    public scheduleState: boolean = false;
    
    constructor(private bot: BotManager) {
        this.configFile = new JSONConfigManager(path.join(BASE, 'screen.json'))
        this.configFile.watch();
        this.scheduleState = this.configFile.get('start_schedule') === 'O';
    }

    @SafeMethod
    private async screenHandler(interaction: ChatInputCommandInteraction) {
        const member = interaction.member;

        // Vérifie que c'est un GuildMember (pas DM)
        if (!interaction.inGuild() || !member || !('roles' in member)) {
            return interaction.reply({ content: "Cette commande ne peut être utilisée que dans un serveur.", ephemeral: true });
        }

        const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
        const hasRole = (member.roles as GuildMemberRoleManager).cache.has("1153222537128460288");

        if (!isAdmin && !hasRole) {
            return interaction.reply({
            content: "❌ Tu n’as pas la permission d’utiliser cette commande.",
            ephemeral: true
            });
        }
        
        switch(interaction.options.getSubcommand()) {
        case "config":
            const view = new ScreenConfigView(this.bot)

            const channel = await interaction.user.createDM() as TextBasedChannel
            const message = await view.sendOrEdit(channel as TextChannel, null,  {
                embeds: [view.embed],
            })

            await this.bot.db.getEm().nativeUpdate(InteractionContext,  {
                messageId: message.id,
                channelId: message.channelId,
                handlerKey: ViewHandlers.ScreenHandler
            }, {
                data: {"config": JSON.stringify(this.configFile.getAll(), null, 2), "message1Id": message.id}
            })

            await interaction.editReply({content: "Configuration envoyé en DM"})
            break;
        case "start":
        case "stop":
            this.scheduleState = interaction.options.getSubcommand() === "start";
            this.configFile.add('start_schedule', this.scheduleState ? 'O' : 'N');
            await interaction.editReply({
                content: `Le mode planification est maintenant ${this.scheduleState ? 'activé' : 'désactivé'}.`
            });
            break;
        case "theme":
            this.configFile.add('theme_default', interaction.options.getString('texte') ?? defaultConfig.theme_default);
            await interaction.editReply({
                content: `Le thème a été mis à jour avec succès.`   
            });
            break;
        default:
            return interaction.reply({ content: "Commande non reconnue.", ephemeral: true });
        }

    }

    @SafeMethod
    public async handlerForm(interaction: ComponentInteraction, data: any) {
        
        const config = new JSONConfigManager(data.config, true)
        const channel: DMChannel = interaction.user.dmChannel ?? await interaction.user.createDM();
        let message: null | Message = ('message2Id' in data) ? await channel.messages.fetch(data.message2Id) : null;

        let view: null | ScreenConfig2View = null;

        if(interaction.isButton()) {            
            const view = new ScreenConfig2View(this.bot, this.currentCategory!, config);
            if (interaction.customId.includes('_modal') && view.buttonTarget[interaction.customId]) { 
                const modal = view.modal?.find(mod => mod.data.custom_id === view.buttonTarget[interaction.customId]);
                await interaction.showModal(modal!)
                message = await view.sendOrEdit(interaction.channel as TextChannel, message, {content: ""})
                this.bot.db.getEm().nativeUpdate(InteractionContext, {
                    channelId: channel.id,
                    handlerKey: ViewHandlers.ScreenHandler
                }, {
                    data: {"config":  JSON.stringify(config.getAll(), null, 2), "message1Id": data.message1Id, "message2Id": message.id}
                })
                return;
            }

            await interaction.deferUpdate();
            if (["config_validate", "config_cancel"].includes(interaction.customId)) {
                if (interaction.customId === "config_validate")
                    await this.configFile.copy(config);
                
                await this.bot.db.getEm().nativeDelete(InteractionContext, {
                    channelId: interaction.channelId,
                    messageId: [data.message2Id, data.message1Id],
                    handlerKey: ViewHandlers.ScreenHandler
                })

                await channel.messages.delete(message!);
                await channel.messages.delete(await channel.messages.fetch(data.message1Id))

                if (interaction.customId === "config_validate")
                    await channel.send({content: "Configuration Sauvegardée avec success"});
                else 
                    await channel.send({content: "Annulation faite avec success"});
            }
        }
            // 1️⃣ On ne gère que les sélecteurs et les modals ici
        if (interaction.isStringSelectMenu() || interaction.isModalSubmit()) {        
            if (interaction.customId === Handlers.SelectCategory) {
                this.currentCategory = (interaction as StringSelectMenuInteraction).values[0];
                
                view = new ScreenConfig2View(this.bot, this.currentCategory!, config);
                
                if (view.onlyModal()) {
                    await (interaction as StringSelectMenuInteraction).showModal(view.modal![0]!);
                    message = await view.sendOrEdit(interaction.channel as TextChannel, message, {content: ""})
                    this.bot.db.getEm().nativeUpdate(InteractionContext, {
                        channelId: channel.id,
                        handlerKey: ViewHandlers.ScreenHandler
                    }, {
                        data: {"config":  JSON.stringify(config.getAll(), null, 2), "message1Id": data.message1Id, "message2Id": message.id}
                    })
                    this.bot.db.getEm().nativeUpdate(InteractionContext, {
                        messageId: message.id,
                        channelId: channel.id,
                        customId: view.modal![0].data.custom_id!,
                        handlerKey: ViewHandlers.ScreenHandler
                    }, {
                        messageId: interaction.message?.id
                    })
                    
                    return;
                }
                
                await interaction.deferUpdate();

            } else {

                // 2️⃣ On récupère le customId et on derivé la clé de config
                const customId = interaction.customId; // ex. "select_schedule_day" ou "modal_timezone"
                // On enlève les préfixes pour obtenir par ex. "schedule_day" ou "timezone"
                const key = customId.replace(/^(select_|modal_|input_)/, '');

                if (interaction.isStringSelectMenu()) {
                    await interaction.deferUpdate();

                    // pour un StringSelect, on prend la première valeur
                    const newValue = interaction.values[0];
                    config.add(key, newValue);
                } else {
                    await (interaction as ModalSubmitInteraction).deferReply();
                    await (interaction as ModalSubmitInteraction).deleteReply();

                    (interaction as ModalSubmitInteraction).fields.fields.forEach((_inputComponent, customId) => {
                        // On ne s’intéresse qu’aux champs dont l’ID commence par "input_"
                        if (customId.startsWith('input_')) {
                            const key = customId.replace(/^input_/, '');

                        // 2) On récupère la valeur saisie
                        const value = (interaction as ModalSubmitInteraction).fields.getTextInputValue(customId);

                        // 3) On stocke dans notre objet
                        config.add(key, value)
                        }
                    });
                }

                view = new ScreenConfig2View(this.bot, this.currentCategory!, config);
            }


            if(message) {
                this.bot.db.getEm().nativeDelete(InteractionContext, {
                    channelId: message.channel!.id,
                    messageId: message.id,
                    handlerKey: ViewHandlers.ScreenHandler
                })
            }

            message = await view.sendOrEdit(interaction.channel as TextChannel, message, {content: ""})
            this.bot.db.getEm().nativeUpdate(InteractionContext, {
                channelId: channel.id,
                handlerKey: ViewHandlers.ScreenHandler
            }, {
                data: {"config":  JSON.stringify(config.getAll(), null, 2), "message1Id": data.message1Id, "message2Id": message.id}
            })
            return
        }

        
    }

    public getSlashHandlers(): Record<string, CommandHandler> {
    return {
        screenHandler: this.screenHandler.bind(this) as CommandHandler, 
    };
  }
}
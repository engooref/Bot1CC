from discord.ext import commands
from Cogs.EventManager import EventManager
from Cogs.DatabaseManager import DatabaseManager
from Cogs.SchedulerManager import SchedulerManager
from Cogs.UserManager import UserManager
from ORM import User, Event, ConditionField, Response, Role, Parameter, Channel, RHMember
from Utils import Log
import locale, discord, os
from View.OperationView import Operation, category_name
from View.TicketView import Ticket
import datetime

class BotManager(commands.Bot):
    def __init__(self, intents, guildId):
        super().__init__(command_prefix='!', intents=intents)
        locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
        
        # Initialisation des variables
        self.guildId = int(guildId)
        self.guild = None
        self.userTrace = None
        self.role_member: discord.Role = None
        self.parameter: dict[str, Parameter.Parameter] = {}

        self.has_started = False
        self.exclude_category =  ['Cimetière des canaux']

        # Initialisation des Cogs
        self.event_manager: EventManager = EventManager(self)
        self.database_manager: DatabaseManager = DatabaseManager(self)
        self.user_manager: UserManager = UserManager(self)
        self.operation: Operation = Operation(self)
        self.scheduler_manager: SchedulerManager = SchedulerManager(self)
        self.ticket: Ticket = Ticket(self)

        self.voice_processes = {}

    async def on_ready(self):
        try:
            if self.has_started:
                return  # Empêche une exécution multiple.

            self.has_started = True

            await self.tree.sync(guild=self.guild)
            cmds = await self.tree.fetch_commands()
            Log.PrintLog(f"Commandes enregistrées : {[cmd.name for cmd in cmds]}")

            # Récupération du serveur Discord
            self.guild: discord.Guild = self.get_guild(self.guildId)
            if not self.guild:
                raise Exception("Serveur non trouvé")

            self.role_member: discord.Role = self.guild.get_role(int(os.getenv('ROLE_ID')))

            # Récupération ou ajout de l'utilisateur utilisé pour le Bot
            self.userTrace = await self.database_manager.insert_and_get_user(self.guild.me)

            Log.PrintLog('Création des Tickets')
            await self.ticket.ticket_command()

            Log.PrintLog('Création des Opérations')
            await self.operation.ensure_channel_and_category()

            Log.PrintLog('Récupération Roles')
            await self.database_manager.insert_and_get_new_roles(self.guild.roles)
            Log.PrintLog('Fin Récupération Roles')

            Log.PrintLog('Récupération Channels')
            await self.database_manager.insert_and_get_new_channels(self.guild.channels)
            Log.PrintLog('Fin Récupération Channels')

            self.parameter = await self.database_manager.select_all(Parameter.Parameter)

            
            # Démarrage des tâches asyncio pour le scheduler
            self.loop.create_task(self.scheduler_manager.scheduler_appEvent.run_scheduler())
            self.loop.create_task(self.scheduler_manager.scheduler_event.check_events())
            self.loop.create_task(self.scheduler_manager.scheduler_lockThread.run_scheduler())

            Log.PrintLog(f"Bot {self.user.display_name} est prêt.")

        except Exception as e:
            Log.PrintError(f"on_ready - {e}")
            self.loop.stop()

    async def on_disconnect(self):
        """Événement déclenché quand le bot principal se déconnecte."""
        for channel_id, (process, queue, token) in list(self.voice_processes.items()):
            await queue.put(("disconnect", None))
        self.voice_processes.clear()

    async def on_message(self, message):
        if message.author == self.user:
            return

        try:
            if message.content.startswith('!'):
                user = await self.database_manager.insert_and_get_user(message.author)

                command, parameter = (message.content.split(' ', 1) + [None])[:2]

                await self.add_traces(f"Exécution de la commande - {command}", user, parameter)
                await self.process_commands(message)

        except Exception as e:
            Log.PrintError(f"on_message - {e}")

    async def on_command_error(self, ctx, error):
        if isinstance(error, commands.MissingRole):
            await ctx.reply("Vous n'avez pas le rôle requis pour cette commande.")
        elif isinstance(error, commands.CommandNotFound):
            await ctx.reply("Commande inconnue.")
        elif isinstance(error, commands.MissingRequiredArgument):
            await ctx.reply("Argument manquant.")
        else:
            await ctx.reply(f"Erreur : {str(error)}")

    async def on_guild_role_create(self, role):
        try:
            Log.PrintLog(f"Création du rôle : {role.name}")
            new_role = Role.Role(role.name, role.id, role.hoist)
            await self.database_manager.insert_entity(new_role)
        except Exception as e:
            Log.PrintError(f"on_guild_role_create - {e}")

    async def on_guild_role_delete(self, role):
        try:
            Log.PrintLog(f"Suppression du rôle : {role.name}")
            await self.database_manager.delete_entity(
                Role.Role, ConditionField('discord_id', '==', role.id)
            )
        except Exception as e:
            Log.PrintError(f"on_guild_role_delete - {e}")

    async def on_guild_role_update(self, before, after):
        try:
            role: Role.Role = await self.database_manager.select_entity(Role.Role, ConditionField('discord_id', '==', after.id), True)
            if role:
                role.name = after.name
                role.is_grade = after.hoist
                await self.database_manager.insert_entity(role)
                Log.PrintLog(f'Modification du role {after.id} : {before.name} -> {after.name}')
                
        except Exception as e:
            Log.PrintError(f"on_guild_role_update - {e}")


    async def on_guild_channel_create(self, channel: discord.guild.abc.GuildChannel):
        try:
            await self.database_manager.insert_and_get_new_channels([channel,])
        except Exception as e:
            Log.PrintError(f"on_guild_channel_create - {e}")

    async def on_guild_channel_delete(self, channel: discord.guild.abc.GuildChannel):
        try:
            channel_bdd = await self.database_manager.select_entity(Channel.Channel, ConditionField('discord_id', '==', channel.id), True)
            if channel_bdd:
                await self.database_manager.insert_entity(channel_bdd)
                Log.PrintLog(f'Suppression du canal: {channel.name}')
        except Exception as e:
            Log.PrintError(f"on_guild_channel_delete - {e}")

    async def on_guild_channel_update(self, before: discord.guild.abc.GuildChannel, after: discord.guild.abc.GuildChannel):
        try:
           if before.name == after.name:
               return
           
           channel_bdd = await self.database_manager.select_entity(Channel.Channel, ConditionField('discord_id', '==', after.id), True)
           if channel_bdd:
                channel_bdd.name = after.name
                await self.database_manager.insert_entity(channel_bdd)
                Log.PrintLog(f'Modification du canal: {before.name} -> {after.name}')


        except Exception as e:
            Log.PrintError(f"on_guild_channel_update - {e}")

    async def on_member_update(self, before, after):
        try:
            # Récupération Utilisateur
            user: User.User = await self.database_manager.get_user_by_discordid(after.id)

            # Check des rôles
            new_roles = set(after.roles) - set(before.roles)
            removed_roles = set(before.roles) - set(after.roles)

            if (user is None) :
                if (self.role_member not in new_roles):
                    return
                else:
                    user: User.User = await self.database_manager.insert_and_get_user(after)

            if new_roles or removed_roles:

                if self.role_member in removed_roles:
                    await self.user_manager.delete_user(user)
                    return
                
                await self.database_manager.insert_and_get_new_roles(list(new_roles))

                change_grade = False
                
                for new_role in new_roles:
                    role: Role.Role = await self.database_manager.select_entity(
                        Role.Role, ConditionField('discord_id', '==', new_role.id), one_result=True
                    )
                    if role and (role not in user.rolesDiscord):
                        change_grade = change_grade or role.is_grade 
                        user.rolesDiscord.append(role)

                    
                for removed_role in removed_roles:
                    role: Role.Role = await self.database_manager.select_entity(
                        Role.Role, ConditionField('discord_id', '==', removed_role.id), one_result=True
                    )
                    if role and (role in user.rolesDiscord):
                        change_grade = change_grade or role.is_grade 
                        user.rolesDiscord.remove(role)


                await self.add_traces(f'Modification des rôles de {user.username}', user)
                await self.database_manager.insert_entity(user)
                if self.role_member in new_roles or change_grade:
                    try:
                        userRoles: list[Role.Role] = user.rolesDiscord 
                        memberRH = await self.database_manager.select_entity(RHMember.RHMember, ConditionField('user_id', '==', user.id), True)
                        
                        if not memberRH:
                            
                            memberRH = RHMember.RHMember(user)

                        for role in userRoles: 
                            if role.is_grade and (role.discord_id != self.role_member.id):
                                memberRH.grade = role
                                break
                        else:
                            memberRH.grade = next(role for role in userRoles if self.role_member.id == role.discord_id)

                        if not change_grade:
                            memberRH.date_entree = datetime.datetime.now()

                        await self.database_manager.insert_entity(memberRH)
                    except Exception as e:
                        Log.PrintError(f"Erreur lors de la récuperatin/création du profil RH de l'utilisateur : {user.username} -> {e}")
                        raise

            # Check des surnoms
            if before.display_name != after.display_name:
                user.username = after.display_name
                await self.database_manager.insert_entity(user)

                events = await self.database_manager.select_entity(
                    Event.Event, ConditionField('users_id', '==', user.id), order_by_desc=False
                )
                for event in events:
                    await self.event_manager.update_event(event)

        except Exception as e:
            Log.PrintError(f"on_member_update - {e}")

    async def on_interaction(self, interaction: discord.Interaction):
        # Vérifier si l'interaction est dans une guilde spécifique
        if interaction.guild and interaction.guild.id == self.guildId:
            try:
                if 'custom_id' in interaction.data:

                    custom_id = interaction.data['custom_id']
                        
                    if "_" in custom_id \
                    and not custom_id.endswith('btn') \
                    and not custom_id.endswith('_loc') \
                    and not custom_id.startswith('closeTicket'):
                        try:
                            await interaction.response.defer()
                        except:
                            pass

                        if custom_id.startswith("select_"):
                            return
                        
                        response_type = custom_id.split('_')[0]  # Exemple: 'accept', 'decline', 'tentative'
                        event_id = int(custom_id.split('_')[1])

                        # Traiter la réponse du bouton de sélection (accept, decline, etc.)
                        user = await self.database_manager.insert_and_get_user(interaction.user)
                        if user is None:
                            return

                        response_type = interaction.data['custom_id'].split('_')[0]
                        conditionList = [
                            ConditionField("users_id", "==", user.id),
                            ConditionField("event_id", "==", event_id)
                        ]

                        response: Response.Response = await self.database_manager.select_entity(Response.Response, conditionList, True)
                        
                        if response_type != 'role':
                            
                            if response:
                                response.type_rep = response_type  # Met à jour la réponse
                            else:
                                response = Response.Response(user.id, event_id, response_type)

                            await self.database_manager.insert_entity(response)

                        # Mise à jour de l'affichage de l'événement
                        event = await self.database_manager.select_entity_by_id(Event.Event, event_id)
                        
                        if (
                            event.role_dispo != '[]'
                            and (((response_type == 'role') and (response.type_rep == 'accepted')) 
                            or response_type == 'accepted') 
                            and response
                        ) :
                            message_content = (
                                "Afin de mieux répartir les équipes, merci de sélectionner le ou les rôles"
                                f"que vous souhaitez obtenir lors de l'événement {event.name}.\n"
                                "**Attention** : ces rôles ne seront pas définitifs."
                            )

                            all_roles = [{"value" : "Pas de préférence", "select" : "Pas de préférence" in ast.literal_eval(response.role_demand)}]
                            for role in ast.literal_eval(event.role_dispo):
                                role_js = dict()
                                role_js["value"] = role
                                role_js["select"] = role in ast.literal_eval(response.role_demand)
                                all_roles.append(role_js)

                            await interaction.followup.send(content=message_content, view=EventView(all_roles, response.id, self), ephemeral=True)
                        
                        await self.event_manager.update_event(event)

                    if custom_id.startswith('closeTicket'):
                        close_button_id = interaction.data.get("custom_id").split('_')[1]
                        await interaction.response.send_modal(Ticket.CloseTicketModal(close_button_id, interaction.channel, self))

            except Exception as e:
                Log.PrintError(f"on_interaction - {e}")

    async def on_raw_reaction_add(self, payload):
        try:
            if (payload.user_id == self.user.id):
                return

            emoji = self.guild.get_emoji(1213915551210930306)
            if emoji is None:
                emoji = "👍"

            channel = self.get_channel(payload.channel_id)
            message = await channel.fetch_message(payload.message_id)
            user = channel.guild.get_member(payload.user_id)
            
            if channel.category.name != category_name:
                return
            
            if emoji != payload.emoji.name:
                emoji = payload.emoji
                if not message or message != self.operation.message_role or emoji.name not in self.operation.role_emojis:
                    return

                role = message.guild.get_role(self.operation.role_emojis[emoji.name])
                await user.add_roles(role)
                Log.PrintLog(f'Ajout du rôle "{role}" à {user}')
            elif message.thread:
                await message.thread.add_user(user)
                Log.PrintLog(f'Ajout de {user} dans le thread {message.thread.name}')

        except Exception as e:
            Log.PrintError(f"on_raw_reaction_add - {e}")

    async def on_raw_reaction_remove(self, payload):
        try:
            if self.user.id == payload.user_id:
                return
            
            emoji = self.guild.get_emoji(1213915551210930306)
            if emoji is None:
                emoji = "👍"

            channel = self.get_channel(payload.channel_id)
            user = channel.guild.get_member(payload.user_id)
            message = await channel.fetch_message(payload.message_id)

            if emoji != payload.emoji.name:
                emoji = payload.emoji 
                if not message or message != self.operation.message_role or emoji.name not in self.operation.role_emojis:
                    return

                role = message.guild.get_role(self.operation.role_emojis[emoji.name])
                await user.remove_roles(role)
                Log.PrintLog(f'Retrait du rôle "{role}" à {user}')
            elif message.thread:
                await message.thread.remove_user(user)
                Log.PrintLog(f'Retrait de {user} dans le thread {message.thread.name}')            

        except Exception as e:
            Log.PrintError(f"on_raw_reaction_remove - {e}")

    async def add_traces(self, message: str, user: User.User = None, parameter=None):
        if user:
            await self.database_manager.add_traces(message, user, parameter)
        elif self.userTrace:
            await self.database_manager.add_traces(message, self.userTrace, parameter)

    def get_parameter(self, nameParam: str) -> str:
        try:
            return self.parameter[nameParam].getValue()
        except KeyError:
            raise Exception(f"Le paramètre {nameParam} n'existe pas !")

    async def update_param(self):
        self.parameter = await self.database_manager.select_all(Parameter.Parameter)
        self.scheduler_manager.scheduler_appEvent.reset_scheduler()

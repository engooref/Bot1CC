# CBot.py
from discord.ext import commands
from Cogs.EventManager import EventManager
from Cogs.DatabaseManager import DatabaseManager
from Cogs.SchedulerManager import SchedulerManager
from Cogs.UserManager import UserManager
from Cogs.StarCitizenManager import StarCitizenManager
from ORM import User, Event, ConditionField, Response, Role, Parameter
from Utils import Log
import locale, discord, os
from View.OperationView import Operation
from discord.ui import Select, Button

class BotManager(commands.Bot):
    def __init__(self, intents, guildId):
        super().__init__(command_prefix='!', intents=intents)
        locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
        
        #Initialisation des variables
        self.guildId = int(guildId)
        self.guild = None
        self.userTrace = None
        self.parameter : dict[str, Parameter.Parameter] = None
        self.has_started = False

        #Initialisation des Cogs
        self.event_manager: EventManager = EventManager(self)
        self.database_manager: DatabaseManager = DatabaseManager(self)
        self.user_manager: UserManager = UserManager(self)
        self.operation: Operation = Operation(self)
        self.star_citizen_manager: StarCitizenManager = StarCitizenManager(self)
        self.scheduler_manager: SchedulerManager = SchedulerManager(self)
        

    async def on_ready(self):
        try:
            if self.has_started:
                return  # Évite une exécution multiple
            self.has_started = True

            #Récuperation du serveur Discord
            self.guild = self.get_guild(self.guildId)
            
            #Récupration ou ajout de l'utilisateur utilisé pour le Bot
            self.userTrace = self.database_manager.insert_and_get_user(self.guild.me)
            if self.guild is None:
                raise Exception("Serveur non trouvé")
            
            Log.PrintLog('Récupération Roles')
            self.database_manager.insert_and_get_new_roles(self.guild.roles)
            Log.PrintLog('Fin Récupération Roles')

            Log.PrintLog('Récupération Channels')
            self.database_manager.insert_and_get_new_channels(self.guild.channels)
            Log.PrintLog('Fin Récupération Channels')
            
            if os.getenv('EDIT_SC_LAUNCH') == "True":
                self.star_citizen_manager.insert_and_get_locations_sc()

            self.parameter = self.database_manager.select_all(Parameter.Parameter)

            await self.operation.ensure_channel_and_category()
            self.loop.create_task(self.scheduler_manager.scheduler_weekly.run_scheduler())  # Démarre la tâche asyncio pour le scheduler
            self.loop.create_task(self.scheduler_manager.scheduler_today.check_events())

            Log.PrintLog(f"Bot {self.user.display_name} est pret.")
            
        except Exception as e:
            Log.PrintError(f"on_ready - {e}")
            self.loop.stop()

    async def on_message(self, message):
        if message.author == self.user:
            return 
        
        try:
            if message.content.startswith('!'):
                user = self.database_manager.insert_and_get_user(message.author)

                if message.content.find(' ') != -1:
                    command = message.content[0:message.content.find(' ')]
                    parameter = message.content[message.content.find(' '):]
                else:
                    command = message.content[0:]
                    parameter = ''

                self.add_traces(f"Execution de la commande - {command}", user, parameter)
            
            await self.process_commands(message)
        except Exception as e:
            Log.PrintError(f"on_message - {e}")

    async def on_command_error(self, ctx, error):
        if isinstance(error, commands.MissingRole):
            await ctx.reply("Vous n'avez le rôle requis pour cette commande.")
        
    async def on_member_update(self, before, after):
        try:
            #Récupération Utilisateur
            user: User.User = self.database_manager.get_user_by_discordid(after.id)
            if user is None:
                return
            
            #Check des roles
            new_roles = set(after.roles) - set(before.roles)
            removed_roles = set(before.roles) - set(after.roles)

            if ((len(new_roles) + len(removed_roles)) != 0):

                self.database_manager.insert_and_get_new_roles(new_roles)


                for new_role in new_roles:
                    role = self.database_manager.select_entity(Role.Role, ConditionField('discord_id', '==', new_role.id))
                    if role and (role not in user.rolesDiscord):
                        user.rolesDiscord.extend(role)
                
                for remove_role in removed_roles:
                    role = self.database_manager.select_entity(Role.Role, ConditionField('discord_id', '==', remove_role.id))

                    if role and (role in user.rolesDiscord):
                        user.rolesDiscord.remove(role)
                    
                self.add_traces(f'Modification des roles de {user.username}')
                self.database_manager.insert_entity(user)

            #Check des Surnoms        
            if before.display_name != after.display_name:
                user.username = after.display_name
                self.database_manager.insert_entity(user)

                events = self.database_manager.select_entity(Event.Event, ConditionField('users_id', '==', user.id, Response.Response))
                for event in events:
                    await self.event_manager.update_event(event)
                    
        except Exception as e:
            Log.PrintError(f"on_member_update - {e}")

    async def on_guild_role_create(self, role):
        self.add_traces(f'Ajout du role: {role.name}')
        self.database_manager.insert_entity(Role.Role(role.name, role.id))

    async def on_guild_role_delete(self, role):
        self.add_traces(f'Retrait du role: {role.name}')
        self.database_manager.delete_entity(Role, ConditionField('discordId', '==', role.id))
         
    async def on_interaction(self, interaction: discord.Interaction):
        # Vérifier si l'interaction est dans une guilde spécifique
        if interaction.guild and interaction.guild.id == self.guildId:
            try:
                if 'custom_id' in interaction.data:
                    custom_id = interaction.data['custom_id']
                        
                    if "_" in custom_id and not custom_id.endswith('btn') and not custom_id.endswith('_loc'):
                        await interaction.response.defer()
                        if custom_id.startswith("select_"):
                            return
                        response_type = custom_id.split('_')[0]  # Exemple: 'accept', 'decline', 'tentative'
                        event_id = int(custom_id.split('_')[1])

                        # Traiter la réponse du bouton de sélection (accept, decline, etc.)
                        user = self.database_manager.insert_and_get_user(interaction.user)
                        if user is None:
                            return

                        response_type = interaction.data['custom_id'].split('_')[0]
                        conditionList = [
                            ConditionField("users_id", "==", user.id),
                            ConditionField("event_id", "==", event_id)
                        ]

                        response = self.database_manager.select_entity(Response.Response, conditionList, True)
                        if response:
                            response.type_rep = response_type  # Met à jour la réponse
                        else:
                            response = Response.Response(user.id, event_id, response_type)

                        self.database_manager.insert_entity(response)

                        # Mise à jour de l'affichage de l'événement
                        event = self.database_manager.select_entity_by_id(Event.Event, event_id)
                        await self.event_manager.update_event(event)

            except Exception as e:
                Log.PrintError(f"on_interaction - {e}")

    async def on_raw_reaction_add(self, payload):
        try:
            channel = self.get_channel(payload.channel_id)
            user = channel.guild.get_member(payload.user_id)
            emoji = payload.emoji
            message = await channel.fetch_message(payload.message_id)
            if user.id == self.user.id or message != self.operation.message_role or not emoji.name in self.operation.role_emojis:
                return

            role = message.guild.get_role(self.operation.role_emojis[str(emoji)])
            await user.add_roles(role)
            Log.PrintLog(f'Ajout du role "{role}" à {user}')
        except Exception as e:
            Log.PrintError(e)


    async def on_raw_reaction_remove(self, payload):
        try:
            channel = self.get_channel(payload.channel_id)
            user = channel.guild.get_member(payload.user_id)
            emoji = payload.emoji
            message = await channel.fetch_message(payload.message_id)

            if user.id == self.user.id or message != self.operation.message_role or not emoji.name in self.operation.role_emojis:
                return

            role = message.guild.get_role(self.operation.role_emojis[str(emoji)])
            await user.remove_roles(role)
            Log.PrintLog(f'Retrait du role "{role}" à {user}')
        except Exception as e:
            Log.PrintError(e)

    def add_traces(self, message: str, user: User.User = None, parameter = None):
        if user is not None:
            self.database_manager.add_traces(message, user, parameter)
        elif (self.userTrace is not None) and (user is None):
            self.database_manager.add_traces(message, self.userTrace, parameter)

    def get_parameter(self, nameParam : str) -> str:
        try:
            return self.parameter[nameParam].getValue()
        except Exception as e:
            raise Exception(f"Le paramètre {nameParam} n'existe pas !")
        
    def update_param(self):
        self.parameter = self.database_manager.select_all(Parameter.Parameter)
        self.scheduler_manager.scheduler_weekly.reset_scheduler()
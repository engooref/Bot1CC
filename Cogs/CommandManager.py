import discord
from discord import app_commands
from discord.ext import commands
import os
import BotManager, Utils.Log as Log
from ORM import Role, Channel, User, ConditionField, Parameter, TicketBots, Event, EventType, RHMember
from Utils.Git import github
from Utils import Log
from collections import defaultdict
from gtts import gTTS
import asyncio

class CommandManager(commands.Cog):
    def __init__(self, bot: BotManager.BotManager):
        self.bot = bot

    
    @app_commands.command(name="purge_all", description="Purge la BDD")
    async def purge_all(self, interaction: discord.Interaction):
        """Commande slash réservée à l'owner."""
        Log.PrintLog(f"📌 Commande /purge_all exécutée par {interaction.user.name}")
        await interaction.response.defer()  # Réponse différée si l'opération prend du temps
        if interaction.user.id != int(os.getenv('ENGOO_ID')):
            await interaction.followup.send("❌ Tu n'as pas la permission d'utiliser cette commande.", ephemeral=True)
            return

        error_str = ''
        #Tri des Users
        try:
            all_users: list[User.User] = await self.bot.database_manager.select_all(User.User, True)

            # Regrouper les utilisateurs par discord_id
            users_by_discord = defaultdict(list)
            for user in all_users:
                users_by_discord[user.discord_id].append(user)

            for user in users_by_discord[0]:
                try:
                    discord_id = next((discord_id for discord_id, user_discord in users_by_discord.items() if user_discord[0].username == user.username))
                    users_by_discord[discord_id].append(user)
                    users_by_discord[0].remove(user)
                except StopIteration as e:
                    pass

            users_by_discord.pop(0)
            canonical_user = None
            # Pour chaque groupe d'utilisateurs ayant le même discord_id (doublons potentiels)
            for discord_id, user_group in users_by_discord.items():
                canonical_user: User.User = user_group[0]
                Log.PrintLog(f"Traitement de l'utilisateur: {canonical_user.username}")
                if (not canonical_user.discord_id) or (not self.bot.guild.get_member(int(canonical_user.discord_id))):
                    await self.bot.database_manager.delete_entity(canonical_user)
                    continue

                valid_role_ids = [role.id for role in self.bot.guild.get_member(int(canonical_user.discord_id)).roles]
                # Choisir l'utilisateur canonique (ici le premier)
                if len(user_group) > 1: 
                    Log.PrintLog(f"Suppression des doublons")
                    # Pour chaque doublon, fusionner les informations dans le canonical_user
                    for duplicate in user_group[1:]:
                        # Fusionner les rôles : ajouter ceux du duplicate s'ils sont valides et pas déjà présents
                        for role in duplicate.rolesDiscord:
                            if role.id in valid_role_ids and role not in canonical_user.rolesDiscord:
                                canonical_user.rolesDiscord.append(role)
                        
                         
                        duplicate.rolesDiscord.clear()

                        # Si le duplicate a un RHMember attaché...
                        if duplicate.rh_profile:
                            # Si le canonical_user n'a pas encore de RHMember, on peut lui attribuer celui du duplicate
                            await self.bot.database_manager.delete_entity(duplicate.rh_profile)
                        
                        # Réaffecter les autres relations/clés liées au duplicate vers le canonical_user
                        for trace in duplicate.traces:
                            trace.user = canonical_user
                        for response in duplicate.responses:
                            response.user = canonical_user
                        for event in duplicate.events:
                            # Pour une relation Many-to-Many, s'assurer que le canonical_user soit associé
                            if canonical_user not in event.users:
                                event.users.append(canonical_user)
                            if duplicate in event.users:
                                event.users.remove(duplicate)
                        
                        await self.bot.database_manager.delete_entity(duplicate)
 
                role_id_user = [role.discord_id for role in canonical_user.rolesDiscord]
                role_to_add = list(set(valid_role_ids) - set(role_id_user))
                role_to_remove = list(set(role_id_user) - set(valid_role_ids))

                if role_to_add:
                    Log.PrintLog(f"Ajout des rôles discord")
                    roles = [role for role in self.bot.guild.roles if (role.id in role_to_add) and (role.name not in ["@everyone", self.bot.user.name])]
                    if roles:
                        await self.bot.database_manager.insert_and_get_new_roles(roles, True)
                        roles_bdd = await self.bot.database_manager.select_entity(Role.Role, ConditionField('discord_id', 'in', [role.id for role in roles]))
                        canonical_user.rolesDiscord.extend(roles_bdd)

                if role_to_remove:
                    Log.PrintLog(f"Retrait des rôles obsolètes")
                    for role_id in role_to_remove:
                        role_bdd = await self.bot.database_manager.select_entity(Role.Role, ConditionField('discord_id', '==', role_id), True)
                        if role_bdd and (role_bdd in canonical_user.rolesDiscord):
                            canonical_user.rolesDiscord.remove(role_bdd)
          
                Log.PrintLog(f"Actualisation de l'utilisateur")
                await self.bot.database_manager.insert_entity(canonical_user)

        except Exception as e:
            Log.PrintError(e)
            error_str += f"❌ Erreur User : {e}\n"


        #Tri des Roles
        try:
            # Récupérer tous les rôles stockés en base
            stored_roles: list[Role.Role] = await self.bot.database_manager.select_all(Role.Role, True)


            # Regrouper les utilisateurs par discord_id
            roles_by_discord = defaultdict(list)
            for role in stored_roles:
                roles_by_discord[role.discord_id].append(role)

            role_def = await self.bot.database_manager.select_entity(Role.Role, ConditionField('discord_id', '==', self.bot.role_member.id), True)

            for discord_id, role_group in roles_by_discord.items():
                canonical_role: Role.Role = role_group[0]
                Log.PrintLog(f"Traitement du rôle: {canonical_role.name}")
                if (not canonical_role.discord_id):
                    await self.bot.database_manager.delete_entity(canonical_role)
                    continue

                if not self.bot.guild.get_role(discord_id):
                    for role in role_group:
                        await self.supp_role(role, role_def)
                else:
                            # Le rôle existe dans Discord, on fusionne les doublons
                    for duplicate in role_group[1:]:
                        Log.PrintLog(f"Fusion du rôle doublon: {duplicate.name} dans {canonical_role.name}")

                        # Réaffecter les utilisateurs
                        users_role = await self.bot.database_manager.select_entity(
                            User.User, ConditionField('rolesDiscord.id', '==', duplicate.id)
                        )
                        for user in users_role:
                            if duplicate in user.rolesDiscord:
                                user.rolesDiscord.remove(duplicate)
                            if canonical_role not in user.rolesDiscord:
                                user.rolesDiscord.append(canonical_role)
                            await self.bot.database_manager.insert_entity(user)

                        # Réaffecter les paramètres liés
                        params_role = await self.bot.database_manager.select_entity(
                            Parameter.Parameter, ConditionField('roles.id', '==', duplicate.id)
                        )
                        for param in params_role:
                            if duplicate in param.roles:
                                param.roles.remove(duplicate)
                            if canonical_role not in param.roles:
                                param.roles.append(canonical_role)
                            await self.bot.database_manager.insert_entity(param)

                        try:
                            # Ici, si d'autres associations existent, il faudra les réassigner de la même manière
                            users_grade = await self.bot.database_manager.select_entity(
                                RHMember.RHMember, ConditionField('grade.id', '==', role.id)
                            )

                            for rh in users_grade:
                                rh.grade = canonical_role
                                await self.bot.database_manager.insert_entity(rh)
                        except:
                            pass

                        # Finalement, supprimer le rôle doublon
                        await self.bot.database_manager.delete_entity(duplicate)
                    
                    await self.bot.database_manager.insert_entity(canonical_role)

                        
            
        except Exception as e:
            Log.PrintError(e)
            error_str += f"❌ Erreur Rôle : {e}\n"

        #Tri des channels
        try:
            
            # Récupérer tous les channels stockés en base
            stored_channels: list[Channel.Channel] = await self.bot.database_manager.select_all(Channel.Channel, True)

            # Regrouper les channels par discord_id
            channels_by_discord = defaultdict(list)
            for channel in stored_channels:
                channels_by_discord[channel.discord_id].append(channel)

            # Récupérer les channels du serveur Discord
            discord_channels_ids = {channel.id for channel in self.bot.guild.channels}

            # Parcourir chaque groupe de channels ayant le même discord_id
            for discord_id, channel_group in channels_by_discord.items():
                # Si le channel n'existe plus dans Discord, supprimer tous les enregistrements pour ce discord_id
                Log.PrintLog(f"Traitement du channel: {channel_group[0].name}")
                if discord_id not in discord_channels_ids:
                    Log.PrintLog(f"Suppression du channel: {channel_group[0].name}")
                    for channel in channel_group:
                        # Récupérer les paramètres liés à ce channel
                        params_channel = await self.bot.database_manager.select_entity(
                            Parameter.Parameter, ConditionField('channel.id', '==', channel.discord_id)
                        )
                        # Détacher le channel des paramètres
                        for param in params_channel:
                            param.channel = None
                            await self.bot.database_manager.insert_entity(params_channel)
                            
                        await self.bot.database_manager.delete_entity(channel)
                else:
                    # Le channel existe sur Discord
                    # S'il y a plusieurs enregistrements pour le même discord_id, on fusionne les doublons
                    canonical_channel: Channel.Channel = channel_group[0]
                    if len(channel_group) > 1:
                        for duplicate in channel_group[1:]:
                            Log.PrintLog(f"Fusion du channel doublon: {duplicate.name} dans {canonical_channel.name}")
                            # Pour chaque paramètre lié au duplicate, réaffecter le channel canonique
                            params_channel = await self.bot.database_manager.select_entity(
                                Parameter.Parameter, ConditionField('channel.id', '==', duplicate.discord_id)
                            )
                            for param in params_channel:
                                param.channel = canonical_channel
                                await self.bot.database_manager.insert_entity(params_channel)
                                
                            # Supprimer le duplicate
                            await self.bot.database_manager.delete_entity(duplicate)
        except Exception as e:
            Log.PrintError(e)
            error_str += f"❌ Erreur Channel : {e}\n"

        #Purge des types event
        try:
            all_type_events: list[EventType.EventType] = await self.bot.database_manager.select_all(EventType.EventType, True)
            type_events_by_name = defaultdict(list)
            for te in all_type_events:
                type_events_by_name[te.name].append(te)

            for name, group in type_events_by_name.items():
                Log.PrintLog(f"Traitement de l'event type: {group[0].name}")
                canonical_type_event = group[0]
                if len(group) > 1:
                    # Choisit le premier comme canonique (ou un autre critère si tu préfères)
                    duplicates = group[1:]
                    
                    # Réassigner tous les events pointant vers ces doublons
                    for dup in duplicates:
                        Log.PrintLog(f"Fusion de l'event type doublon: {dup.name} dans {canonical_type_event.name}")
                        for ev in dup.events:
                            ev.type = canonical_type_event
                            await self.bot.database_manager.insert_entity(ev)

                        # Ensuite on supprime le type_event en trop
                        await self.bot.database_manager.delete_entity(dup)

                if not canonical_type_event.events:
                    await self.bot.database_manager.delete_entity(canonical_type_event)
                else:
                    await self.bot.database_manager.insert_entity(canonical_type_event)
                    
        except Exception as e:
            Log.PrintError(e)
            error_str += f"❌ Erreur Type Event : {e}\n"

        if error_str:
            Log.PrintError(e)
            await interaction.response.send_message(f'Erreur dans la purge : \n{error_str}', ephemeral=True)
        else:
            Log.PrintLog('Purge terminée')
            await interaction.response.send_message('Purge de la BDD terminée', ephemeral=True)

    async def supp_role(self, role: Role.Role, role_def: Role.Role) :
        if not role:
            return
        
        Log.PrintLog(f'Suppression du role: {role.name}')
        users_role = await self.bot.database_manager.select_entity(User.User, ConditionField('rolesDiscord.id', '==', role.id))
        users_grade = await self.bot.database_manager.select_entity(RHMember.RHMember, ConditionField('grade.id', '==', role.id))
        params_role = await self.bot.database_manager.select_entity(Parameter.Parameter, ConditionField('roles.id', '==', role.id))
        
        for user in users_role:
            user.rolesDiscord.remove(role)
            
        for rh in users_grade:
            user = await self.bot.database_manager.select_entity_by_id(User.User, rh.user.id, ['traces'])
            try:
                rh.grade = next((role for role in user.rolesDiscord if role.is_grade))
            except:
                rh.grade = role_def
            await self.bot.database_manager.insert_entity(rh)

        for param in params_role:
            param.roles.remove(role)

        await self.bot.database_manager.insert_entity(users_role)
        await self.bot.database_manager.insert_entity(params_role)
        await self.bot.database_manager.delete_entity(role)

    # Commande pour créer une issue de développement
    @app_commands.command(name="create_dev_issue", description="Créer une issue pour une demande de développement")
    async def create_dev_issue(self, interaction: discord.Interaction, title:str = '', repo_name: str = ''):
        try:
        
            ticket : TicketBots.TicketBots = await self.bot.database_manager.select_entity(TicketBots.TicketBots, ConditionField('channel_id', '==', interaction.channel_id), True)
        
            if not ticket:
                interaction.response.send_message('Channel de ticket non reconnu', ephemeral=True)

            if ticket.type.name.lower().startswith('dev'):
                await interaction.response.send_message("Cette commande doit être utilisée dans un ticket de développement", ephemeral=True)
                return
            
            if ticket.issue != '':
                await interaction.response.send_message('Une issue est déjà présente pour ce ticket', ephemeral=True)
                return 
            
            # Construire le contenu de l'issue
            issue_body = f"**Ticket Discord : {interaction.channel.name}**\n\n"
            message_body = ''
            is_first_message = True
            async for msg in interaction.channel.history(limit=None, oldest_first=True):
                if is_first_message:
                    is_first_message = False
                    continue
                
                attachments = ""
                if msg.attachments:
                    attachments = "\n".join([f"[Image]({attachment.url})" for attachment in msg.attachments])
                message_body += f"- **{msg.author.display_name}** : {msg.content} {attachments}\n"

            if message_body != '':
                issue_body += "### Historique des messages :\n"
                issue_body += message_body
            
            repo = f'{os.getenv('GIT_NAME')}/' + (os.getenv('REPO_SITE') if repo_name == 'site' else os.getenv('REPO_BOT') if repo_name == 'bot' else os.getenv('REPO_SITE'))
            if repo_name not in ['bot', 'site']:
                issue_body += f" Référence: {os.getenv('GIT_NAME')}/{os.getenv('REPO_BOT')}"

            await interaction.response.send_message(f"Issue GitHub pour le développement créée, Tous les messages suivants seront envoyés à l'Issue")
            issue_id, issue_url = github.add_issue_with_field(repo, f"Bug trouvé : {title or interaction.channel.name}", 'Type', 'Dev', issue_body)

            ticket.issue = f'{repo}:{issue_id}'

            self.bot.database_manager.insert_entity(ticket, False)
        except Exception as e:
            Log.PrintError(e)
            await interaction.response.send_message(f'Erreur: {e}', ephemeral=True)

    # Commande pour créer une issue de bug
    @app_commands.command(name="create_bug_issue", description="Créer une issue pour signaler un bug")
    async def create_bug_issue(self, interaction: discord.Interaction, title: str = '', repo_name: str =''):
        try:
            ticket : TicketBots.TicketBots = await self.bot.database_manager.select_entity(TicketBots.TicketBots, ConditionField('channel_id', '==', interaction.channel_id), True)
        
            if not ticket:
                interaction.response.send_message('Channel de ticket non reconnu', ephemeral=True)

            if ticket.type.name.lower().startswith('dev'):
                await interaction.response.send_message("Cette commande doit être utilisée dans un ticket de développement", ephemeral=True)
                return
            
            if ticket.issue != '':
                await interaction.response.send_message('Une issue est déjà présente pour ce ticket', ephemeral=True)
                return 

            # Récupérer les messages du channel
            messages = await interaction.channel.history(limit=None).flatten()
            messages.reverse()

            # Construire le contenu de l'issue
            issue_body = f"**Ticket Discord : {interaction.channel.name}**\n\n"
            issue_body += "### Historique des messages :\n"
            for msg in messages:
                attachments = ""
                if msg.attachments:
                    attachments = "\n".join([f"[Image]({attachment.url})" for attachment in msg.attachments])
                issue_body += f"- **{msg.author.display_name}** : {msg.content} {attachments}\n"

            repo = f'{os.getenv('GIT_NAME')}/' + (os.getenv('REPO_SITE') if repo_name == 'site' else os.getenv('REPO_BOT') if repo_name == 'bot' else os.getenv('REPO_SITE'))
            if repo_name not in ['bot', 'site']:
                issue_body += f" Référence: {os.getenv('GIT_NAME')}/{os.getenv('REPO_BOT')}"

            issue = github.add_issue_with_field(repo, f"Bug trouvé : {title or interaction.channel.name}", 'Type', 'Bug', issue_body)
            ticket.issue = f'{repo}:{issue['issue_id']}'
            
            await interaction.response.send_message(f"Issue GitHub pour le bug créée: {issue['issue_url']}, Tous les messages suivants seront envoyés à l'Issue")
            self.bot.database_manager.insert_entity(ticket, False)
        except Exception as e:
            Log.PrintError(e)
            await interaction.response.send_message(f'Erreur: {e}', ephemeral=True)

# Fonction obligatoire pour charger le Cog
async def setup(bot):
    await bot.add_cog(CommandManager(bot))
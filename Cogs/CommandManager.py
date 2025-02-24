import discord
from discord import app_commands
from discord.ext import commands
import os
import BotManager, Utils.Log as Log
from ORM import Role, Channel, User, ConditionField, Parameter, TicketBots
from Utils.Git import github
from Utils import Log

class CommandManager(commands.Cog):
    def __init__(self, bot: BotManager.BotManager):
        self.bot = bot

    @app_commands.command(name="sync_roles", description="Supprime les rôles inexistantes de la BDD")
    async def role_bdd_pur(self, interaction: discord.Interaction):
        """Commande slash réservée à l'owner."""
        print(f"📌 Commande /sync_roles exécutée par {interaction.user}")
        await interaction.response.defer()  # Réponse différée si l'opération prend du temps

        if interaction.user.id != os.getenv('ENGOO_ID'):
            await interaction.response.send_message("❌ Tu n'as pas la permission d'utiliser cette commande.", ephemeral=True)
            return

        try:
            # Récupérer tous les rôles stockés en base
            stored_roles = await self.bot.database_manager.select_all(Role.Role, True)
            stored_role_ids = {role.discord_id for role in stored_roles}

            # Récupérer tous les rôles du serveur depuis Discord
            discord_role_ids = {role.id for role in self.bot.guild.roles}

            # Identifier les rôles qui n'existent plus
            roles_to_delete = stored_role_ids - discord_role_ids

            if roles_to_delete:
                for role_id in roles_to_delete:
                    users_role = await self.bot.database_manager.select_entity(User.User, ConditionField('rolesDiscord.role_id', '==', role_id))
                    params_role = await self.bot.database_manager.select_entity(Parameter.Parameter, ConditionField('roles.role_id', '==', role_id))
                    role = next((stored_role for stored_role in stored_roles if stored_role.discord_id == role_id))
                    if not role:
                        continue

                    for user in users_role:
                        user.rolesDiscord.remove(role)

                    for param in params_role:
                        param.roles.remove(role)

                    await self.bot.database_manager.delete_entity(role)

                await interaction.response.send_message(f"✅ {len(roles_to_delete)} rôles obsolètes supprimés.", ephemeral=True)
            else:
                await interaction.response.send_message("✅ Aucun rôle obsolète trouvé.", ephemeral=True)
            
        except Exception as e:
            await interaction.response.send_message(f"❌ Erreur SQL : {e}", ephemeral=True)
            Log.PrintError(e)

    @app_commands.command(name="sync_channels", description="Supprime les channels inexistants de la BDD")
    async def sync_channels(self, interaction: discord.Interaction):
        print(f"📌 Commande /sync_channels exécutée par {interaction.user}")
        await interaction.response.defer()  # Réponse différée si l'opération prend du temps
        if interaction.user.id != os.getenv('ENGOO_ID'):
            await interaction.response.send_message("❌ Tu n'as pas la permission d'utiliser cette commande.", ephemeral=True)
            return
        
        # Récupérer la liste des channels Discord actuels
        guild = interaction.guild
        channels_excludes = list()

        for category in self.bot.exclude_category:  
            try:
                cat: discord.CategoryChannel = discord.utils.get(self.bot.guild.categories, name=category)
                channels_excludes.extend(channel.id for channel in cat.channels)
            except:
                pass

        discord_channels = {channel.id for channel in guild.channels if channel.id not in channels_excludes}

        # Ouvrir une session avec la base de données
        try:
            # Récupérer tous les channels stockés en base
            db_channels = await self.bot.database_manager.select_all(Channel.Channel)

            deleted_count = 0
            for db_channel in db_channels:
                if db_channel.discord_id not in discord_channels:
                    await self.bot.database_manager.delete_entity(db_channel)
                    deleted_count += 1
            
            # Appliquer les suppressions
            await interaction.followup.send(f"✅ {deleted_count} channels supprimés de la base de données.")
        except Exception as e:
            await interaction.followup.send(f"❌ Erreur : {e}")


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
            messages = await interaction.channel.history(limit=(interaction.channel.message_count - 1)).flatten()
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
import discord
from discord.ext import commands
from discord import app_commands
from ORM import TicketBots, ConditionField
import os, BotManager
from Utils.Git import github
from Utils import Log

# Classe principale contenant les commandes
class TicketCommands(commands.Cog):
    def __init__(self, bot):

        self.bot: BotManager.BotManager = bot

    # Commande pour créer une issue de développement
    @app_commands.command(name="create_dev_issue", description="Créer une issue pour une demande de développement")
    async def create_dev_issue(self, interaction: discord.Interaction, title:str = '', repo_name: str = ''):
        try:
            ticket : TicketBots.TicketBots = self.bot.database_manager.select_entity(TicketBots.TicketBots, ConditionField('channel_id', '==', interaction.channel_id), True)
        
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
            ticket : TicketBots.TicketBots = self.bot.database_manager.select_entity(TicketBots.TicketBots, ConditionField('channel_id', '==', interaction.channel_id), True)
        
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
    await bot.add_cog(TicketCommands(bot))
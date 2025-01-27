import discord, os
from discord.ui import Button, View, Select, TextInput, Modal
import BotManager
from Utils import Log
import datetime
from ORM import TicketType, TicketBots
from Utils.Git import github


class Ticket():
    def __init__(self, bot_val):
        self.bot: BotManager.BotManager = bot_val

    class CloseTicketModal(Modal):
        def __init__(self, ticket_id, channel: discord.TextChannel, bot):
            super().__init__(title="Clôture du Ticket")

            self.channel: discord.TextChannel = channel
            self.ticket_id = ticket_id
            self.bot: BotManager.BotManager = bot

            # Champ pour le message de clôture
            self.add_item(TextInput(label="Message de Clôture", placeholder="Indiquez un message de clôture (optionnel)", required=False))

        async def on_submit(self, interaction: discord.Interaction):
            try:
                await interaction.response.defer()

                ticket: TicketBots.TicketBots = await self.bot.database_manager.select_entity_by_id(TicketBots.TicketBots, int(self.ticket_id))
                ticket.closed = datetime.datetime.now()
                ticket.closed_user_id = interaction.user.id
                # Récupérer le message de clôture saisi
                close_message = self.children[0].value
                ticket.closed_message = (close_message if close_message != "" else "Aucune raison indiquée")
                user_open = self.bot.guild.get_member(ticket.user_id)

                embed = discord.Embed(
                    title="Clôture Ticket",
                    description="Récapitulatif Ticket",
                    color=discord.Color.random()
                )

                # Numéro de ticket (ligne indépendante)
                embed.add_field(name="Numéro de ticket : ", value=str(self.ticket_id), inline=False)

                # Ligne 2 : Informations d'ouverture (alignées sur la même ligne)
                embed.add_field(name="Ouverture le :", value=f"```{ticket.open.strftime('%d/%m/%Y %H:%M')}```", inline=True)
                embed.add_field(name="Ouvert par :", value=f"\n{user_open.mention}", inline=True)

                embed.add_field(name="", value="", inline=False)

                # Ligne 3 : Informations de clôture (alignées sur la même ligne)
                embed.add_field(name="Clôturé le :", value=f"```{ticket.closed.strftime('%d/%m/%Y %H:%M')}```", inline=True)
                embed.add_field(name="Clôturé par :", value=f"\n{interaction.user.mention}", inline=True)

                # Raison de la clôture (ligne indépendante)
                embed.add_field(name="Raison Clôture :", value=ticket.closed_message, inline=False)
                channel_recap: discord.TextChannel = discord.utils.get(self.channel.category.channels, name="recap-tickets")
                
                if channel_recap:
                    await channel_recap.send(embed=embed)

                # Supprimer le canal et marquer le ticket comme fermé
                await self.channel.delete()

                dm_channel = await user_open.create_dm()
                # Envoyer une confirmation de clôture
                await dm_channel.send(embed=embed)
                await self.bot.database_manager.insert_entity(ticket)
            except Exception as e:
                Log.PrintError(e)

    class TicketView(View):
        def __init__(self, bot):
            super().__init__(timeout=None)
            self.bot: BotManager.BotManager = bot
            self.options = []

        async def initialize(self):
            self.options = await self.bot.database_manager.select_all(TicketType.TicketType, True)
            
            select = Select(
                placeholder="Selectionnez le service",
                options=[discord.SelectOption(label=option.name, value=str(option.id)) for option in self.options],
            )
            select.callback = self.create_ticket
            self.add_item(select)

        async def create_ticket(self, interaction: discord.Interaction):
            try:
                ticket_type: TicketType.TicketType = next(option for option in self.options if str(option.id) == interaction.data["values"][0])

                # Utiliser le nom de l'utilisateur pour nommer le canal avec des tirets à la place des espaces
                user_name = interaction.user.name.replace(" ", "-").lower()

                category: discord.CategoryChannel = await get_or_create_category_tickets(ticket_type, self.bot)

                role_auth = self.bot.guild.get_role(int(ticket_type.role_auth))
                overwrites = {
                    interaction.guild.default_role: discord.PermissionOverwrite(view_channel=False),
                    interaction.user: discord.PermissionOverwrite(view_channel=True, send_messages=True),
                    interaction.guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
                    self.bot.role_member: discord.PermissionOverwrite(view_channel=False)
                }

                if role_auth:
                    overwrites[role_auth] = discord.PermissionOverwrite(view_channel=True, send_messages=True)

                ticket: TicketBots.TicketBots = TicketBots.TicketBots(ticket_type, interaction.user.id, datetime.datetime.now())
                await self.bot.database_manager.insert_entity(ticket)
                ticket_id = ticket.id
                channel: discord.TextChannel = await category.create_text_channel(name=f"ticket-{user_name}", overwrites=overwrites)
                ticket.channel_id = channel.id
                await self.bot.database_manager.insert_entity(ticket)

                embed = discord.Embed(
                    title=f"Ticket n°{ticket_id} Créé" + (f'- {role_auth.mention}' if role_auth else '')  ,
                    description="Votre ticket a été créé avec succès. Utilisez les options ci-dessous pour le gérer.",
                    color=discord.Color.random()
                )

                close_button = Button(label="Clôturer", style=discord.ButtonStyle.red)
                close_button.custom_id = 'closeTicket_' + str(ticket_id)

                view = View(timeout=None)
                view.add_item(close_button)

                await channel.send(embed=embed, view=view)
                await interaction.response.send_message(f"Votre ticket a été créé dans {channel.mention}", ephemeral=True)
            except Exception as e:
                Log.PrintError(e)

    class OpenTicketButton(View):
        def __init__(self, bot):
            super().__init__(timeout=None)
            button = Button(label="Créer un Ticket", style=discord.ButtonStyle.green)
            button.callback = self.create_ticket
            self.add_item(button)
            self.bot: BotManager.BotManager = bot

        async def create_ticket(self, interaction: discord.Interaction):
            try:
                ticket = Ticket.TicketView(self.bot)
                await ticket.initialize()
                await interaction.response.send_message("Quel service souhaitez-vous contacter ?", view=ticket, ephemeral=True)
            except Exception as e:
                Log.PrintLog(e) 

    async def ticket_command(self):
        try:
            category: discord.CategoryChannel = discord.utils.get(self.bot.guild.categories, name='assistance')
            if not category:
                self.bot.add_traces(f"Création de la catégorie 'assistance'")
                overwrites = {
                    self.bot.guild.default_role: discord.PermissionOverwrite(view_channel=False), 
                    self.bot.role_member: discord.PermissionOverwrite(view_channel=True, send_messages=False) # Bloque la lecture et l'écriture pour tout le monde
                }
                category = await self.bot.guild.create_category('assistance', overwrites=overwrites)


            channel = discord.utils.get(category.channels, name="creation-tickets")
            if not channel:
                self.bot.add_traces(f"Création du canal 'creation-tickets' dans la catégorie '{category.name}'")            
                channel = await self.bot.guild.create_text_channel('creation-tickets', category=category)
            
            messageSend = None
            embed = discord.Embed(
                title="Tickets",
                description="Pour créer un ticket, cliquer sur le bouton ci-dessous.",
                color=discord.Color.blurple()
            )

            async for message in channel.history(limit=100):
                if (
                    message.author == channel.guild.me 
                    and message.embeds 
                    and message.components 
                ):
                    embedTest = message.embeds[0] 
                    if embedTest.title == embed.title and embedTest.description == embed.description:
                        messageSend = message
                        break

            if messageSend:
                await messageSend.edit(embed=embed, view=Ticket.OpenTicketButton(self.bot))
            else:
                await channel.send(embed=embed, view=Ticket.OpenTicketButton(self.bot))


            channel = discord.utils.get(category.channels, name="recap-tickets")
            if not channel:
                overwrites = {
                    self.bot.guild.default_role: discord.PermissionOverwrite(view_channel=False),
                    self.bot.guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
                    self.bot.role_member: discord.PermissionOverwrite(view_channel=False) # Bloque la lecture et l'écriture pour tout le monde
                }
        
                ticketType = await self.bot.database_manager.select_all(TicketType.TicketType, True)
                for type in ticketType:
                    role_type = self.bot.guild.get_role(type.role_auth)
                    if role_type:
                        overwrites[role_type] = discord.PermissionOverwrite(view_channel=True, send_messages=True)
        

                self.bot.add_traces(f"Création du canal 'recap-tickets' dans la catégorie '{category.name}'")     
                channel = await self.bot.guild.create_text_channel('recap-tickets', category=category, overwrites=overwrites)

        except Exception as e:
            Log.PrintError(e)


async def get_or_create_category_tickets(type: TicketType.TicketType, bot) -> discord.CategoryChannel: 
    try:
        role_auth: discord.Role = bot.guild.get_role(int(type.role_auth))
        category: discord.CategoryChannel = discord.utils.get(bot.guild.categories, name='assistance')
            
        channel = discord.utils.get(category.channels, name="recap-tickets")
        if not channel:
            overwrites = {
                bot.guild.default_role: discord.PermissionOverwrite(view_channel=False),
                bot.guild.me: discord.PermissionOverwrite(view_channel=True, send_messages=True),
                bot.role_member: discord.PermissionOverwrite(view_channel=False) # Bloque la lecture et l'écriture pour tout le monde
            }

            if role_auth:
                overwrites[role_auth] = discord.PermissionOverwrite(view_channel=True, send_messages=True)

            bot.add_traces(f"Création du canal 'recap-tickets' dans la catégorie '{category.name}'")     
            channel = await bot.guild.create_text_channel('recap-tickets', category=category, overwrites=overwrites)

        return category
    except Exception as e:
        Log.PrintError(e)





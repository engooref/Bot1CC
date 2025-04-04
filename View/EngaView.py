import discord, datetime, re, requests
from ORM import RHMember

class EngaView(discord.ui.View):
    
    @discord.ui.button(label="Confirmer ma candidature", style=discord.ButtonStyle.green, custom_id="candidature_button")
    async def candidature_button_callback(self, interaction: discord.Interaction):
        await interaction.response.defer

        discord_roles = [role.id for role in interaction.user.roles]

        if discord_roles in self.bot.role_member.id:
            return
        
        memberId = await self.bot.user_manager.init_member_rh(interaction.user.id)
        
        member_rh : RHMember.RHMember = await self.bot.database_manager.elect_entity_by_id(memberId)

        if (member_rh.date_entree != datetime(1970, 1, 1, 0, 0, 0)):
            return 
           
        member_rh.date_entree = datetime.datetime.now()

        await self.bot.database_manager.insert_entity(member_rh)
        await interaction.followup.send(content=f"Bravo, tu viens de franchir la première étape de ta candidature !\n On va jeter un coup d'œil à ton dossier et on te tient au courant.\n Reste sur le qui-vive 😉.", ephemeral=True)        

        channel_rh = await self.bot.guild.get_channel(self.bot.get_parameter('CHANNEL_RH'))
        
        if not channel_rh:
            return
    
         # Création de l'embed
        embed = discord.Embed(
            title="Candidature Reçue",
            description="Une nouvelle candidature est arrivée",
            color=discord.Color.random()  # Vous pouvez choisir la couleur que vous voulez
        )
        
        # Ajout de l'auteur avec le pseudo et l'avatar
        embed.set_author(name=interaction.user.display_name, icon_url=interaction.user.display_avatar.url)
        
        # Ajout d'un champ contenant le lien en dur
        lien = "https://robertsspaceindustries.com/en/citizens/" + re.sub(r'\[[^\]]*\]', '', interaction.user.display_name).strip()   
        req = requests.get(lien)
        if req.status_code == 200:
            embed.add_field(name="Lien Citoyen RSI", value=f"[{interaction.user.display_name}]({lien})", inline=False)
        
        # Envoi de l'embed en réponse à l'interaction
        await interaction.response.send_message(embed=embed)

    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

async def send_message_channels_enga(bot):
    channel: discord.guild.GuildChannel = bot.guild.get_channel(bot.get_parameter('CHANNEL_ENGA'))

    if not channel:
        return
    

    message_text = (
        "##Vous désirez rejoindre le 1er Corps Colonial ?\n\n"
        "Rien de plus simple :\n\n"
        "1) Déposez votre candidature sur notre page RSI (onglet Join us now): https://robertsspaceindustries.com/orgs/1CC\n\n"
        '  ⚠️ La lecture du règlement dans l\'onglet "Charter" sur RSI est très fortement conseillée ... \n\n'
        '2) Indiquez via ce canal le dépôt de votre candidature d\'un simple "candidature envoyée".\n\n'
        '3) Un officier prendra très rapidement contact avec vous pour finaliser la démarche.\n\n'
        'Au plaisir de vous accueillir très bientôt dans le Corps !'
    )
    async for message in channel.history(limit=100):
        if (message.author == channel.guild.me):
            await message.edit(content=message_text, view=EngaView(bot))
    else:
        await channel.send(content=message_text, view=EngaView(bot))


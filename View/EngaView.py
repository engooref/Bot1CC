import discord, datetime, re, requests
from ORM import RHMember
from Utils import Log

class EngaView(discord.ui.View):
    
    @discord.ui.button(label="Confirmer ma candidature", style=discord.ButtonStyle.green, custom_id="candidature_btn")
    async def candidature_button_callback(self, interaction: discord.Interaction, button):
        try:
            await interaction.response.defer()

            discord_roles = [role.id for role in interaction.user.roles]

            if self.bot.role_member.id in discord_roles:
                return
            
            member_rh = await self.bot.user_manager.init_member_rh(interaction.user.id)
        
            if (member_rh.date_demand != datetime.datetime(1970, 1, 1, 0, 0, 0)):
                return 
            
            member_rh.date_demand = datetime.datetime.now()
            member_rh.status = 'Candidatures'

            await self.bot.database_manager.insert_entity(member_rh)
            await interaction.followup.send(content=f"Bravo, tu viens de franchir la première étape de ta candidature !\n On va jeter un coup d'œil à ton dossier et on te tient au courant.\n Reste sur le qui-vive 😉.", ephemeral=True)        

            channel_rh: discord.guild.GuildChannel = self.bot.guild.get_channel(self.bot.get_parameter('CHANNEL_RH'))
            
            if not channel_rh:
                return
        
            rh_role: discord.Role = self.bot.guild.get_role(int(self.bot.get_parameter('ROLE_RH')[0]))

            now = datetime.datetime.now().strftime("%d/%m/%Y à %H:%M:%S")
            embed = discord.Embed(
                title="Annonce Candidature",
                description=f"{rh_role.mention}\nUn nouveau dossier vient d'être déposé par **{interaction.user.display_name}** le **{now}**.\n Merci de bien vouloir prendre en charge cette candidature dès que possible.",
                color=rh_role.color
            )

            # Ajout de l'auteur avec le pseudo et l'avatar
            embed.set_thumbnail(url=interaction.user.display_avatar.url)

            # Ajout d'un champ contenant le lien en dur
            lien = "https://robertsspaceindustries.com/en/citizens/" + re.sub(r'\[[^\]]*\]', '', interaction.user.display_name).strip()   
            req = requests.get(lien)
            if req.status_code == 200:
                embed.add_field(name="Lien Citoyen RSI", value=f"[Profil {interaction.user.display_name}]({lien})", inline=True)
            
            embed.add_field(name="Lien vers la liste des candidatures", value="[Candidatures 1CC](https://robertsspaceindustries.com/en/orgs/1CC/admin/applications)", inline=True)
            # Envoi de l'embed en réponse à l'interaction
            await channel_rh.send(embed=embed)
        except Exception as e:
            Log.PrintLog(interaction.user.id)
            Log.PrintError(f'Erreur lors de la confirmation de la candidature: {e}')
            await interaction.followup.send(f'Erreur lors de la confirmation de la candidature: {e}', ephemeral=True) 


    def __init__(self, bot):
        super().__init__(timeout=None)
        self.bot = bot

async def send_message_channels_enga(bot):
    channel: discord.guild.GuildChannel = bot.guild.get_channel(bot.get_parameter('CHANNEL_ENGA'))

    if not channel:
        return
    

    message_text = (
        "### Vous désirez rejoindre le 1er Corps Colonial ?\n\n"
        "Rien de plus simple :\n\n"
        "1) Déposez votre candidature sur notre page RSI (onglet Join us now): https://robertsspaceindustries.com/orgs/1CC\n"
        '  ⚠️ La lecture du règlement dans l\'onglet "Charter" sur RSI est très fortement conseillée ... \n\n'
        '2) Cliquez ensuite sur le bouton ci-dessous pour confirmer votre candidature.\n\n'
        '3) Un officier prendra très rapidement contact avec vous pour finaliser la démarche.\n\n'
        'Au plaisir de vous accueillir très bientôt dans le Corps !'
    )

    file = discord.File('res/AFFICHE-1CC.png')
    async for message in channel.history(limit=100):
        if (message.author == channel.guild.me):
            await message.edit(content=message_text, view=EngaView(bot))
            break
    else:
        await channel.send(content=message_text, view=EngaView(bot), file=file)


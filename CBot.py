
from discord.ext import commands
from ORM import select_by_id, select_by_fields, select_by_field, insertOrUpdate_data, delete_by_field
from ORM import select_by_discordId, select_all, insert_multiLigne
from ORM import Traces, User, Role, Channel, Event, Parameter, Response
from discord.message import Message
import discord, locale, asyncio, Log
from InviteView import InviteView

class CBot(commands.Bot):
    def __init__(self, intents, guildId):
        super().__init__(command_prefix='!', intents=intents)
        self.userTrace = None
        self.guildId = int(guildId)
        self.guild : discord.Guild = None

#-------------------------------------------------------
#Parti Event du bot
#-------------------------------------------------------  
    async def on_ready(self):
        print(f'We have logged in as {self.user}')

        try:
            self.userTrace = select_by_discordId(User.User, self.user.id)
            locale.setlocale(locale.LC_TIME,'')
            if self.userTrace is None:
                role = select_by_discordId(Role.Role, 1)
                if role is None:
                    role = insertOrUpdate_data(Role.Role("adminBot", 1))
                
                self.userTrace = insertOrUpdate_data(User.User(None, self.user.name, self.user.id, self.user.avatar.key, ' ', [role]))
                insertOrUpdate_data(Traces.Traces(self.userTrace.id, f"Ajout de l'utilisateur: {self.user.name}"))

            self.guild = self.get_guild(self.guildId)
            if self.guild is None:
                raise Exception("Serveur non trouvé")
        
            self.Roles()
            self.Channels()
            
            
            Log.PrintLog("Le bot est pret.")
        except Exception as e:
            Log.PrintLog(e)
            self.loop.stop()
            
    async def Stop(self):
        Log.PrintLog("Arret du bot")

    async def on_command_error(self, ctx, error) -> None:
        if isinstance(error, commands.MissingRole):
            await ctx.reply("Vous n'avez le rôle requis pour lancer cette commande")
            
    async def on_message(self, message: Message) -> None:
        if message.author == self.user:
            return 
        
        user = self.InsertAndGetUser(message.author)
        insertOrUpdate_data(Traces.Traces(user.id, message.content))
        
        try:
            await self.process_commands(message)
        except Exception as e:
            Log.PrintLog(e)
            
    async def on_member_update(self, before, after):
        new_roles = set(after.roles) - set(before.roles)
        removed_roles = set(before.roles) - set(after.roles)

        self.InsertandGetNewRoles(new_roles)
        user = select_by_id(User, after.id)
        if user is None: 
            return
        
        user.roles.append(new_roles)
        user.roles.remove(removed_roles)
                
        insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Modification des roles de {user.username}'))
        insertOrUpdate_data(user)

    async def on_guild_role_create(self, role):
        insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du role: {role.name}'))
        insertOrUpdate_data(Role.Role(role.name, role.id))

    async def on_guild_role_delete(self, role):
        insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Retrait du role: {role.name}'))
        delete_by_field(Role, 'discordId', role.id)

    async def on_button_click(self, interaction: discord.Interaction):
        if isinstance(interaction, discord.ButtonInteraction):
            await interaction.response.defer()  # Indique à Discord que l'interaction a été reçue et est en cours de traitement
            
            # Récupérer la vue associée à cet événement
            event_id = int(interaction.data['custom_id'].split('_')[1])
            event_view = self.event_views.get(event_id)
            if event_view:
                # Gérer l'interaction avec la vue
                await event_view.interaction_check(interaction)
                
    async def on_interaction(self, interaction: discord.Interaction):
        # Vérifier si l'interaction est dans une guilde spécifique
        if interaction.guild and interaction.guild.id == self.guildId and 'custom_id' in interaction.data:
            try:
                custom_id = interaction.data['custom_id']
                response_type = custom_id.split('_')[0]  # 'accept', 'decline', 'tentative'
                event_id = int(custom_id.split('_')[1])

                user = self.InsertAndGetUser(interaction.user)
                if user is None:
                    return
                
                response = select_by_fields(Response.Response, {"users_id" : user.id, "event_id": event_id}, True)
                if response:
                    response.type_rep = response_type
                else:
                    response = Response.Response(user.id, event_id, response_type)
                
                insertOrUpdate_data(response)

                event = select_by_id(Event.Event, event_id)
                responses = select_by_field(Response.Response, "event_id", event_id)
                parameter = select_all(Parameter.Parameter)

                nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
                channel: discord.TextChannel = self.get_channel(parameter[nameParam].getValue())
                if channel is None:
                    raise(f'Paramètrage incorrect: {nameParam}')
                
                accepted_list = list()
                declined_list = list()
                tentative_list = list()
                await interaction.response.defer()
                for response in responses:
                    userbdd = select_by_id(User.User, response.users_id)
                    if userbdd is None:
                        continue
                    
                    user: discord.Member = self.guild.get_member(userbdd.discord_Id)
                    if response.type_rep == 'accepted':
                       accepted_list.append(user.nick)
                    
                    if response.type_rep == 'declined':
                       declined_list.append(user.nick)

                    if response.type_rep == 'tentative':
                       tentative_list.append(user.nick)

                message = await channel.fetch_message(event.discord_id)
                embed = message.embeds[0]
                for field in embed.fields:
                    if field.name.startswith("Accepted"):
                        embed.set_field_at(embed.fields.index(field), name=f"Accepted ({len(accepted_list)})" , value="\n".join(accepted_list) or "Aucun", inline=field.inline)
                        
                    elif field.name.startswith("Declined"):
                        embed.set_field_at(embed.fields.index(field), name=f"Declined ({len(declined_list)})" , value="\n".join(declined_list) or "Aucun", inline=field.inline)
                    
                    elif field.name.startswith("Tentative"):
                        embed.set_field_at(embed.fields.index(field), name=f"Tentative ({len(tentative_list)})" , value="\n".join(tentative_list)  or "Aucun", inline=field.inline)

                await message.edit(embed=embed)   
                
            except Exception as e:
                Log.PrintLog(e)
                
#-------------------------------------------------------
#Parti insertion et recuperation des entités via la BDD
#-------------------------------------------------------  
    def Roles(self):
        Log.PrintLog('Récupération Roles')
        
        self.InsertandGetNewRoles(self.guild.roles)
            
        Log.PrintLog('Fin Récupération Roles')
            
    def Channels(self):
        Log.PrintLog('Récupération Channels')
        
        self.InsertandGetNewChannels(self.guild.channels)
            
        Log.PrintLog('Fin Récupération Channels')
        

    def InsertandGetNewRoles(self, roles : list):
        try:
            if len(roles) == 0:
                return list()
            
            rolesbdd = select_all(Role.Role)
            
            newRolesBdd = list()
            for role in roles:
                if role.name in ["@everyone", self.user.name]:
                    continue
                
                rolebdd = next((key for key, obj in rolesbdd.items() if obj.discord_Id == role.id), None)
                if rolebdd is None:
                    newRolesBdd.append(Role.Role(role.name, role.id))
                    insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du role: {role.name}'))
                    
            insert_multiLigne(newRolesBdd)    
        except Exception as e:
            Log.PrintLog(e)
            return None
        
        for key, obj in rolesbdd.items():
            if obj.discord_Id != 1:
                newRolesBdd.append(obj)
        
        return newRolesBdd 
      
    def InsertandGetNewChannels(self, channels : list):
        try:
            if len(channels) == 0:
                return list()
            
            channelsBdd = select_all(Channel.Channel)
            newchannelsBdd = list()
            for channel in channels:
                if isinstance(channel, discord.CategoryChannel):
                    continue
                
                channelbdd = next((key for key, obj in channelsBdd.items() if obj.discord_Id == channel.id), None)
                if channelbdd is None:
                    newchannelsBdd.append(Channel.Channel(channel.name, channel.id))
                    insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du channel: {channel.name}'))
                
            insert_multiLigne(newchannelsBdd)
        except Exception as e:
            Log.PrintLog(e)
            return None
        
        for key, obj in channelsBdd.items():
            if obj.discord_Id != 1:
                newchannelsBdd.append(obj)
        
        return newchannelsBdd  
        
    def InsertAndGetUser(self, author):
        try:
            user = select_by_discordId(User.User, author.id)
        
            if user is None:
                allRole = author.roles
                allRole = self.InsertandGetNewRoles(allRole)
                
                user = insertOrUpdate_data(User.User(None, author.name, author.id, author.avatar.key, ' ', allRole))
                insertOrUpdate_data(Traces.Traces(self.userTrace.id, f"Ajout de l'utilisateur: {author.name}"))

            return user
        except Exception as e:
            Log.PrintLog(e)
            return None
            
#------------------------------
#Parti intéraction avec le site
#------------------------------

    def AddUserFlask(self, userId):
        member = self.guild.get_member(userId)
        
        if member is None:
            raise(f"Membre non trouvé dans le serveur: {self.guild.name}")
        
        role = self.InsertandGetNewRoles(member.roles)
        memberbdd = self.InsertAndGetUser(member)
        
        if role is None:
            raise(f"Erreur d'implementation des roles")
        if memberbdd is None:
            raise(f"Erreur d'implementation du membre")
    
        memberbdd.rolesDiscord = [obj for obj in role if obj.name != '@everyone' and any(rolem.id == obj.discord_Id for rolem in member.roles) and not any(roled.discord_Id == obj.discord_Id for roled in memberbdd.rolesDiscord)]
          
        memberbdd = insertOrUpdate_data(memberbdd)
        
        return {"discordId": memberbdd.discord_Id }

    async def async_set_event_flask(self, eventId):
        try:
            event = select_by_id(Event.Event, eventId)
            # if event is None:
            #     raise(f"Event avec l'id {eventId} n'existe pas")

            parameter = select_all(Parameter.Parameter)
            
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel: discord.TextChannel = self.get_channel(int(parameter[nameParam].getValue()))
            if channel is None:
                raise(f'Paramètrage incorrect: {nameParam}')
            
            embedEvent = discord.Embed(
                colour = discord.Colour.orange(),
                title = event.name
            )

            if event.picture:
                directory: str = parameter['DIRECTORY_IMGEVENT'].getValue()
                if not directory :
                    raise(f'Paramètrage incorrect: DIRECTORY_IMGEVENT')
                embedEvent.set_image(url=f"http://127.0.0.1:8000/imgupload/{event.picture}")
                
            embedEvent.add_field(name=f"Regroupement: " , value=f"```{event.start.strftime("%A %d %B %Y  %H:%M")}```\n", inline=False)
            embedEvent.add_field(name="Spawn: " , value=f"{parameter['EVENT_REGROUPEMENT'].getValue()}\n", inline=False)
            embedEvent.add_field(name="Type event: " , value=f"{event.type}", inline=False)
            embedEvent.add_field(name="Description: ", value=f"\n{event.description}\n", inline=False)

            embedEvent.add_field(name="Accepted (0)", value="Aucun\n", inline=True)
            embedEvent.add_field(name="Declined (0)", value="Aucun\n", inline=True)
            embedEvent.add_field(name="Tentative (0)", value="Aucun\n", inline=True)
            
            view = InviteView(event.id)
            message = await channel.send(embed=embedEvent, view=view)
            event.discord_id = message.id
            insertOrUpdate_data(event)
        except Exception as e:
            Log.PrintLog(e)
        
    def setEvent(self, eventID):
        asyncio.run_coroutine_threadsafe(self.async_set_event_flask(eventID), self.loop)

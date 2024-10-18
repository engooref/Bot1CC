
from discord.ext import commands
from ORM import select_by_id, select_by_fields, select_by_field, insertOrUpdate_data, delete_by_field
from ORM import select_by_discordId, select_all, insert_multiLigne
from ORM import Traces, User, Role, Channel, Event, Parameter, Response, ConditionField
from discord.message import Message
import discord, locale, asyncio, Log, threading, schedule, time,requests, os, tempfile
from InviteView import InviteView
from urllib.parse import quote
from datetime import datetime, timedelta
from itertools import zip_longest
import re, sys

JourName = [
    'lundi',
    'mardi',
    'mercredi',
    'jeudi',
    'vendredi',
    'samedi',
    'dimanche'
]

class CBot(commands.Bot):
    def __init__(self, intents, guildId):
        super().__init__(command_prefix='!', intents=intents)
        locale.setlocale(locale.LC_TIME, 'fr_FR.UTF-8')
        self.userTrace = None
        self.guildId = int(guildId)
        self.guild : discord.Guild = None
        self.eventThread = None
        self.parameter : dict[str, Parameter.Parameter] = None
        self.urlSite = os.getenv('URL_SITE')
        
#-------------------------------------------------------
#Parti Event du bot
#-------------------------------------------------------  
    async def on_ready(self):
        print(f'We have logged in as {self.user}')

        try:
            self.userTrace = select_by_discordId(User.User, self.user.id)
            if self.userTrace is None:
                role = select_by_discordId(Role.Role, 1)
                if role is None:
                    role = insertOrUpdate_data(Role.Role("adminBot", 1))
                
                self.userTrace = insertOrUpdate_data(User.User(None, self.user.name, self.user.id, self.user.avatar.key, ' ', [role], 0, 0))
                insertOrUpdate_data(Traces.Traces(self.userTrace.id, f"Ajout de l'utilisateur: {self.user.name}"))

            self.guild = self.get_guild(self.guildId)
            if self.guild is None:
                raise Exception("Serveur non trouvé")
        
            self.Roles()
            self.Channels()

            self.parameter = select_all(Parameter.Parameter)
            self.eventThread = threading.Thread(target=self.run_scheduler)
            self.eventThread.daemon = True  # Définit le thread comme un daemon
            self.eventThread.start()
            self.start_scheduler()
            self.loop.create_task(self.check_events())
            
            Log.PrintLog("Le bot est pret.")
        except Exception as e:
            Log.PrintError(f"on_ready - {e}")
            self.loop.stop()

    async def on_command_error(self, ctx, error) -> None:
        if isinstance(error, commands.MissingRole):
            await ctx.reply("Vous n'avez le rôle requis pour lancer cette commande")
            
    async def on_message(self, message: Message) -> None:
        if message.author == self.user:
            return 
        
        if message.content.startswith('!'):
            user = self.InsertAndGetUser(message.author)
            insertOrUpdate_data(Traces.Traces(user.id, message.content))
        
        try:
            await self.process_commands(message)
        except Exception as e:
            Log.PrintError(f"on_message - {e}")
            
    async def on_member_update(self, before: discord.Member, after: discord.Member):
        try:
            user: User.User = select_by_discordId(User.User, after.id)
            if user is None: 
                return
            
            #Check des roles
            new_roles = set(after.roles) - set(before.roles)
            removed_roles = set(before.roles) - set(after.roles)
            if ((len(new_roles) + len(removed_roles)) != 0):

                self.InsertandGetNewRoles(new_roles)

                user.rolesDiscord.append(new_roles)
                user.rolesDiscord.remove(removed_roles)
                    
                insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Modification des roles de {user.username}'))
                insertOrUpdate_data(user)

            #Check des Surnoms        
            if before.display_name != after.display_name:
                user.username = after.global_name
                insertOrUpdate_data(user)

                joins = [
                    (Response.Response, Event.Event.id == Response.Response.event_id)  # Exemple de jointure
                ]
                events = select_by_field(Event.Event, ConditionField('users_id', '==', user.id, Response.Response), joins=joins)
                for event in events:
                    await self.updateEvent(event)
                    
        except Exception as e:
            Log.PrintError(f"on_member_update - {e}")
        

    async def on_guild_role_create(self, role):
        insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du role: {role.name}'))
        insertOrUpdate_data(Role.Role(role.name, role.id))

    async def on_guild_role_delete(self, role):
        insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Retrait du role: {role.name}'))
        delete_by_field(Role, 'discordId', role.id)
                
    async def on_interaction(self, interaction: discord.Interaction):
        # Vérifier si l'interaction est dans une guilde spécifique
        if interaction.guild and interaction.guild.id == self.guildId and 'custom_id' in interaction.data:
            try:
                await interaction.response.defer()
                custom_id = interaction.data['custom_id']
                response_type = custom_id.split('_')[0]  # 'accept', 'decline', 'tentative'
                event_id = int(custom_id.split('_')[1])

                user = self.InsertAndGetUser(interaction.user)
                if user is None:
                    return
                
                conditionList = [
                    ConditionField("users_id", "==", user.id), 
                    ConditionField("event_id", "==", event_id)
                ]

                response = select_by_fields(Response.Response, conditionList, True)
                if response:
                    response.type_rep = response_type
                else:
                    response = Response.Response(user.id, event_id, response_type)
                
                insertOrUpdate_data(response)

                event = select_by_id(Event.Event, event_id)
                await self.updateEvent(event)
                
            except Exception as e:
                Log.PrintError(f"on_interaction - {e}")
                
    async def updateEvent(self, event: Event.Event):
        try:
            responses: list[Response.Response] = select_by_field(Response.Response, ConditionField("event_id", "==", event.id))
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel: discord.TextChannel = self.get_channel(int(self.getParameter(nameParam)))
            if channel is None:
                raise(f'Paramètrage incorrect: {nameParam}')
        
            accepted_list = list()
            declined_list = list()
            tentative_list = list()
            for response in responses[:]:
                userbdd: User.User = select_by_id(User.User, response.users_id)
                if userbdd is None:
                    continue
                
                user: discord.Member = self.guild.get_member(userbdd.discord_id)
                if user is None:
                    responses.remove(response)
                    continue
                if response.type_rep == 'accepted':
                    accepted_list.append(user.display_name)
                
                if response.type_rep == 'declined':
                    declined_list.append(user.display_name)

                if response.type_rep == 'tentative':
                    tentative_list.append(user.display_name)

            insert_multiLigne(responses)
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
            Log.PrintError(f"updateEvent - {e}")
            raise Exception(e)


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
        

    def InsertandGetNewRoles(self, roles : list) -> list:
        try:
            if len(roles) == 0:
                return list()
            
            rolesbdd = select_all(Role.Role)
            
            newRolesBdd = list()
            for role in roles:
                if role.name in ["@everyone", self.user.name]:
                    continue
                
                rolebdd = next((key for key, obj in rolesbdd.items() if obj.discord_id == role.id), None)
                if rolebdd is None:
                    newRolesBdd.append(Role.Role(role.name, role.id))
                    insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du role: {role.name}'))
                    
            insert_multiLigne(newRolesBdd)    
        except Exception as e:
            Log.PrintError(f"InsertandGetNewRoles - {e}")
            return None
        
        return select_all(Role.Role)
      
    def InsertandGetNewChannels(self, channels : list) -> list:
        try:
            if len(channels) == 0:
                return list()
            
            channelsBdd = select_all(Channel.Channel)
            newchannelsBdd = list()
            for channel in channels:
                if isinstance(channel, discord.VoiceChannel) or isinstance(channel, discord.CategoryChannel):
                    continue
                
                channelbdd = next((key for key, obj in channelsBdd.items() if obj.discord_id == channel.id), None)
                if channelbdd is None:
                    newchannelsBdd.append(Channel.Channel(channel.name, channel.id))
                    insertOrUpdate_data(Traces.Traces(self.userTrace.id, f'Ajout du channel: {channel.name}'))
                
            insert_multiLigne(newchannelsBdd)
        except Exception as e:
            Log.PrintError(f"InsertandGetNewChannels - {e}")
            return None
        
        for key, obj in channelsBdd.items():
            if obj.discord_id != 1:
                newchannelsBdd.append(obj)
        
        return newchannelsBdd  
        
    def InsertAndGetUser(self, author):
        try:
            user = select_by_discordId(User.User, author.id)
        
            if user is None:
                allRoleDiscord = author.roles
                allRoles = self.InsertandGetNewRoles(allRoleDiscord)
                
                user = insertOrUpdate_data(User.User(None, author.display_name, author.id, author.avatar.key, ' ', list(allRoles.values()), 0, 0))
                insertOrUpdate_data(Traces.Traces(self.userTrace.id, f"Ajout de l'utilisateur: {author.display_name}"))

            return user
        except Exception as e:
            Log.PrintError(f"InsertAndGetUser - {e}")
            return None
            
#------------------------------
#Parti intéraction avec le site
#------------------------------

    def UpdateParamFlask(self):
        self.parameter = select_all(Parameter.Parameter)
        self.reset_scheduler()
        return {}

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
    
        memberbdd.rolesDiscord = [
            obj for obj in role.values() 
            if obj.name != '@everyone' 
            and any(rolem.id == obj.discord_id for rolem in member.roles) 
            and not any(roled.discord_id == obj.discord_id for roled in memberbdd.rolesDiscord)
        ]
        memberbdd.username = member.global_name

        memberbdd = insertOrUpdate_data(memberbdd)
        
        return {"discordId": memberbdd.discord_id }

    def setEvent(self, eventID):
        asyncio.run_coroutine_threadsafe(self.async_set_event_flask(eventID), self.loop)
        return {}

    
    async def async_set_event_flask(self, eventId):
        try:
            event : Event.Event = select_by_id(Event.Event, eventId)
            if event is None:
                raise Exception(f"Event avec l'id {eventId} n'existe pas")
            
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel: discord.TextChannel = self.get_channel(int(self.getParameter(nameParam)))
            if channel is None:
                raise Exception(f'Paramètrage incorrect: {nameParam}')
            
            # Encodage des paramètres pour l'URL
            title_encoded = quote(event.name)

            # Construire l'URL Google Calendar
            calendar_url = (
                f'https://calendar.google.com/calendar/render?action=TEMPLATE'
                f'&text={title_encoded}'
                f'&dates={event.start.strftime('%Y%m%dT%H%M%SZ')}/{event.start.strftime('%Y%m%dT%H%M%SZ')}'
                f'&details&location'
            ) 
            
            embedEvent = discord.Embed(
                colour = discord.Colour.orange(),
                title = f"{event.name} {event.start.date()}"
            )

            if event.picture:
                req = requests.get(url=f"{self.urlSite}/files/get?nameFile={event.picture}&typeFile=2", verify=not sys.flags.debug)
                if req.status_code == 200:
                    embedEvent.set_image(url=f"{self.urlSite}/files/get?nameFile={event.picture}&typeFile=2")
    
            embedEvent.add_field(name=f"Regroupement: " , value=f"```{event.start.strftime('%A %d %B %Y %H:%M')}```\n", inline=False)
            embedEvent.add_field(name=f"Lancement: " , value=f"```{event.lanc_serv.strftime('%H:%M')}```\n", inline=False)
            embedEvent.add_field(name="Spawn: " , value=f"{event.spawn}\n", inline=False)
            embedEvent.add_field(name="Type event: " , value=f"{event.type.name}", inline=False)
            embedEvent.add_field(name="Description: ", value=f"\n{event.description}\n", inline=False)
            
            embedEvent.add_field(name="Lien", value=f"[Ajouter au calendrier Google](<{calendar_url}>)", inline=False)

            embedEvent.add_field(name="Accepted (0)", value="Aucun\n", inline=True)
            embedEvent.add_field(name="Declined (0)", value="Aucun\n", inline=True)
            embedEvent.add_field(name="Tentative (0)", value="Aucun\n", inline=True)
            
            if(event.discord_id != None):
                message : discord.Message = await channel.fetch_message(event.discord_id)
                await message.edit(embed=embedEvent)
            else: 
                view = InviteView(event.id)
                message = await channel.send(embed=embedEvent, view=view)

            event.discord_id = message.id
            await self.updateEvent(event)
            
            if(event.briefing_file_name is not None):
                file = None
                req = requests.get(url=f"{self.urlSite}/files/get?nameFile={event.briefing_file_name}&typeFile=2", verify=not sys.flags.debug)
                if req.status_code != 200:
                    raise Exception(f"Le fichier {event.briefing_file_name} n'existe pas")
                else:
                     # Créer un fichier temporaire
                    with tempfile.NamedTemporaryFile(delete=False) as temp_file:
                        temp_file.write(req.content)  # Écrire le contenu binaire dans le fichier temporaire
                        temp_file_path = temp_file.name  # Obtenir le chemin du fichier temporaire

                    # Créer un fichier Discord à partir du fichier temporaire
                    file = discord.File(fp=temp_file_path, filename=event.briefing_file_name)
                
                channelBriefing = self.get_channel(int(self.getParameter("CHANNEL_BRIEFING")))
                if not isinstance(channelBriefing, discord.ForumChannel):
                    raise Exception(f"Le channel {channelBriefing.name} n'est pas un forum")
                        
                if(event.briefing_Discord_Id != None):                        
                    for thread in channelBriefing.threads:
                        try:
                            try:
                                message = await thread.fetch_message(event.briefing_Discord_Id)
                            except discord.NotFound as ne:
                                continue
                            if message is None:
                                continue
                            await message.delete()
                            message = await thread.send(file=file)
                            event.briefing_Discord_Id = message.id
                            break
                        except Exception as e:
                            Log.PrintLog(f"async_set_event_flask test - {e}")
                    else:
                        topic = await channelBriefing.create_thread(
                            name= event.name,  # Titre du topic
                            applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                            file=file
                        )
                        event.briefing_Discord_Id = topic.message.id

                else:
                    # Créer un topic dans le forum
                    topic = await channelBriefing.create_thread(
                        name= event.name,  # Titre du topic
                        applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                        file=file
                    )

                    event.briefing_Discord_Id = topic.message.id
        except Exception as e:
            Log.PrintError(f"async_set_event_flask - {e}")

        
        if event is not None:
            insertOrUpdate_data(event)

    def setAttributionEvent(self, eventId):
        asyncio.run_coroutine_threadsafe(self.async_attribution_event_flask(eventId), self.loop) 
        return {}

    async def async_attribution_event_flask(self, eventId):
        try:
            event : Event.Event = select_by_id(Event.Event, eventId)
            if event is None:
                raise Exception(f"Event avec l'id {eventId} n'existe pas")
            
            channelBriefing = self.get_channel(int(self.getParameter("CHANNEL_BRIEFING")))
            if not isinstance(channelBriefing, discord.ForumChannel):
                raise Exception(f"Le channel {channelBriefing.name} n'est pas un forum")

            conditionList = [
                    ConditionField("type_rep", "in", ['accepted']),
                    ConditionField("event_id", "==", eventId)
                ]
            
            responses : list[Response.Response] = select_by_fields(Response.Response, conditionList)

            # Groupement des joueurs par équipe
            equipes = dict()
            # Création de l'embed
            embed = discord.Embed(title="Tableau des joueurs", color=discord.Color.blue())

            for joueur in responses:
                if joueur.team is not None:
                    if (joueur.team.name not in equipes):
                        equipes[joueur.team.name] = list()
                    equipes[joueur.team.name].append(joueur)

            for membres in equipes.values():
                membres.sort(key=lambda membre: membre.user.username)

            sorted_equipes_keys = sorted(equipes.keys())
            valSep = ""
            for equipe in sorted_equipes_keys:
                embed.add_field(name=f"Équipe {equipe}", value="", inline=True)
                valSep += "-----------------------------------------"
            
            embed.add_field(name=valSep, value="", inline=False)     
                                    
            # Parcourir les membres de chaque équipe en alternant
            for membres in zip_longest(*(equipes[key] for key in sorted_equipes_keys), fillvalue=None):            
                for membre in membres:
                    if membre is None:
                        continue
                    vaisseau = membre.vaisseau if membre.vaisseau else "Aucun vaisseau"
                    role_vaisseau = membre.role_vaisseau if membre.role_vaisseau else "Aucun rôle vaisseau"
                    commentaire = membre.commentaire if membre.commentaire else "Aucun commentaire"
                    embed.add_field(
                        name=membre.user.username,
                        value=(
                            f"**Rôle:** {' / '.join(role.name for role in membre.roles)}\n"
                            f"**Vaisseau d'affectation:** {vaisseau}\n"
                            f"**Rôle vaisseau:** {role_vaisseau}\n"
                            f"**Commentaire:** {commentaire}"
                        ),
                        inline=True
                    )  
                embed.add_field(name="", value="", inline=False)  # Ligne vide pour la séparation  

            if(event.attribution_discord_id != None):                        
                for thread in channelBriefing.threads:
                    try:
                        try:
                            message = await thread.fetch_message(event.attribution_discord_id)
                        except discord.NotFound as ne:
                            continue
                        message = await message.edit(embed=embed)
                        event.attribution_discord_id = message.id
                        break
                    except Exception as e:
                        Log.PrintLog('async_attribution_event_flask - {e}')   
                else:
                    event.attribution_discord_id = None

            if(event.attribution_discord_id is None):
                message = None
                if (event.briefing_Discord_Id != None):
                    for thread in channelBriefing.threads:
                        try:
                            try:
                                messageBriefing = await thread.fetch_message(event.briefing_Discord_Id)
                            except discord.NotFound as ne:
                                continue
                            message = await messageBriefing.reply(embed=embed)
                            event.attribution_discord_id = message.id
                            break
                        except Exception as e:
                            Log.PrintLog('async_attribution_event_flask - {e}')
                
                if message is None:
                    # Créer un topic dans le forum
                    topic = await channelBriefing.create_thread(
                        name= event.name,  # Titre du topic
                        applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                        embed=embed
                    )    
                    event.attribution_discord_id = topic.message.id
                # Créer un topic dans le forum

            insertOrUpdate_data(event)
        except Exception as e:
            Log.PrintError(f"async_attribution_event_flask - {e}")

    def suppEvent(self, eventID):
        asyncio.run_coroutine_threadsafe(self.async_supp_event_flask(eventID), self.loop)
        return {}

    async def async_supp_event_flask(self, eventId):
        try:
            event : Event.Event = select_by_id(Event.Event, eventId)
            if event is None:
                raise Exception(f"Event avec l'id {eventId} n'existe pas")
            
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel: discord.TextChannel = self.get_channel(int(self.getParameter(nameParam)))
            if channel is None:
                raise Exception(f'Paramètrage incorrect: {nameParam}')
            
            if(event.discord_id != None):
                try:
                    message = await channel.fetch_message(event.discord_id)
                    await message.delete()
                except:
                    raise Exception(f"Appel Event non existant: {event.name}")
        except Exception as e:
            Log.PrintError(f"async_supp_event_flask - {e}")
        
    def getParameter(self, nameParam : str) -> str:
        try:
            return self.parameter[nameParam].getValue()
        except Exception as e:
            raise Exception(f"Le paramètre {nameParam} n'existe pas !")

    
    def searchUserAttribution(self, searchUser):
        members = self.guild.members
        
        matching_members = [
           member for member in members 
           if re.sub(r'\[[^\]]*\]', '', member.display_name).strip().lower().startswith(searchUser.lower())
        ]
        membersList = list()
        
        if matching_members:
            for member in matching_members:
                memberDict = {
                    'avatar' : member.avatar.url,
                    'name' : member.display_name,
                    'id' : member.id
                }
                membersList.append(memberDict)
        print(membersList)
        return membersList

#------------------------------
#Parti Automatisation
#------------------------------   

    def weekly_task(self):
        try:
            today = datetime.now().date()
            one_week_later = today + timedelta(weeks=1)
            conditionList = [ConditionField("start", "between", (today, one_week_later))]
            events: list[Event.Event] = select_by_fields(Event.Event, conditionList)
            for event in events:
                self.setEvent(event.id)
        except Exception as e:
            Log.PrintError(f"weekly_task - {e}")

    def start_scheduler(self):
        schedule.every().day.at(os.getenv('HOURS_EVENT')).do(self.checkDate)

    def checkDate(self):
        currentDate = datetime.now().strftime('%A').lower() 
        jourParam = JourName[int(os.getenv('DAY_EVENT'))]
        if currentDate == jourParam:
            threading.Thread(target=self.weekly_task).start()


    def reset_scheduler(self):
        schedule.clear()
        self.start_scheduler()

    def run_scheduler(self):
        while True:
            schedule.run_pending()
            time.sleep(1)


    async def check_events(self):
        while True:
            now = datetime.now()
            
            # Récupérer les événements du jour
            today_events = self.get_events_for_today()

            for event in today_events:
                time_until_event = event.start - now
                
                # Si l'événement est dans moins de 15 minutes
                if time_until_event > timedelta(minutes=0) and time_until_event <= timedelta(minutes=15):
                    await self.send_event_reminder(event)
                else:
                    # Planifie le rappel 15 minutes avant l'événement
                    await self.schedule_event_reminder(event)

            # Attendre 60 secondes avant de vérifier à nouveau
            await asyncio.sleep(60)

    def get_events_for_today(self):
        # Exemple d'événements récupérés depuis la base de données pour la journée actuelle
        now = datetime.now()
        today_start = datetime(now.year, now.month, now.day)
        today_end = today_start + timedelta(days=1)

        # Remplacer cela par une requête à la base de données
        events = select_by_field(Event.Event, ConditionField('start', 'between', (today_start, today_end)))
        return events
    
    async def schedule_event_reminder(self, event):
        now = datetime.now()
        time_until_reminder = event.start - timedelta(minutes=15) - now

        # Attendre jusqu'à 15 minutes avant l'événement
        await asyncio.sleep(time_until_reminder.total_seconds())

        # Envoyer le rappel
        await self.send_event_reminder(event)

    async def send_event_reminder(self, event):
        nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
        channel: discord.TextChannel = self.get_channel(int(self.getParameter(nameParam)))
        if channel is None:
            raise Exception(f'Paramètrage incorrect: {nameParam}')
        
        if(event.discord_id != None and not event.appel_msg_discord):
            message = await channel.fetch_message(event.discord_id)
            if message is not None:
                lFields = conditionList = [
                    ConditionField("type_rep", "==", 'accepted'),
                    ConditionField("event_id", "==", event.id)
                ]

                responses = select_by_fields(Response.Response, lFields)
                msgStr = event.name + "\n\n"
                for response in responses:
                    user = self.guild.get_member(response.user.discord_id)
                    if user is not None:
                        msgStr += user.mention + " " 
                
                try:
                    await message.reply(msgStr)
                    event.appel_msg_discord = True
                finally:
                    insertOrUpdate_data(event)
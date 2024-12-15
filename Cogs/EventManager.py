# EventManager.py
import discord, calendar, os, re
import BotManager


from ORM import Event, Response, ConditionField, User
from urllib.parse import quote, urlparse, urlunparse

from Utils import Log
from View import InviteView

class EventManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot
        self.urlSite = os.getenv('URL_SITE')

    async def set_event(self, event: Event.Event):
        try:
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel = self.get_channel(event)
            
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
                colour = discord.Color.from_str(event.type.color),
                title = f"{event.name} {event.start.date()}"
            )

            if event.picture:
                # Encoder uniquement le chemin et les paramètres de l'URL
                parsed_url = urlparse(f"{self.urlSite}/files/get?typeFile=3&nameFile={event.picture}")
                encoded_path = quote(parsed_url.path)
                encoded_query = quote(parsed_url.query, safe="=&")

                # Reconstruire l'URL encodée
                safe_url = urlunparse(parsed_url._replace(path=encoded_path, query=encoded_query))
                print(safe_url)
                embedEvent.set_image(url=safe_url)
    
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
                message : discord.Message = None
                try:
                    message = await channel.fetch_message(event.discord_id)
                    await message.edit(embed=embedEvent)
                except discord.NotFound as e:
                    # Boucle sur tous les jours de la semaine
                    for day in calendar.day_name:  # Renvoie les jours sous forme de noms ('Monday', 'Tuesday', ...)
                        nameParam = 'CHANNEL_' + day.upper()
                        channelTest: discord.TextChannel = self.bot.get_channel(int(self.bot.get_parameter(nameParam)))
                        try:
                            message = None
                            message = await channelTest.fetch_message(event.discord_id)
                            await message.delete()
                            break
                        except discord.NotFound as e:
                            pass

                    view = InviteView.InviteView(event.id)
                    message = await channel.send(embed=embedEvent, view=view)
            else: 
                view = InviteView.InviteView(event.id)
                message = await channel.send(embed=embedEvent, view=view)

            event.discord_id = message.id
            await self.update_event(event)
            
            if(event.briefing_file_name is not None):
                
                channelBriefing = self.bot.get_channel(int(self.bot.get_parameter("CHANNEL_BRIEFING")))
                if not isinstance(channelBriefing, discord.ForumChannel):
                    raise Exception(f"Le channel {channelBriefing.name} n'est pas un forum")
                        
                if(event.briefing_Discord_Id != None):                        
                    for thread in channelBriefing.threads:
                        try:
                            message = await thread.fetch_message(event.briefing_Discord_Id)
                        except discord.NotFound as ne:
                            continue
                        if message is None:
                            continue
                        await message.delete()
                        message = await thread.send(f"{self.urlSite}/files/get?typeFile=2&nameFile={event.briefing_file_name}")
                        event.briefing_Discord_Id = message.id
                        break 
                    else:
                        topic = await channelBriefing.create_thread(
                            name= event.name,  # Titre du topic
                            applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                            content=f"{self.urlSite}/files/get?typeFile=2&nameFile={event.briefing_file_name}"
                        )
                        event.briefing_Discord_Id = topic.message.id

                else:
                    # Créer un topic dans le forum
                    topic = await channelBriefing.create_thread(
                        name= event.name,  # Titre du topic
                        applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                        content=f"{self.urlSite}/files/get?typeFile=2&nameFile={event.briefing_file_name}"
                    )

                    event.briefing_Discord_Id = topic.message.id
        except Exception as e:
            Log.PrintError(f"set_event - {e}")

    async def update_event(self, event: Event.Event):
        try:
            responses: list[Response.Response] = self.bot.database_manager.select_entity(Response.Response, ConditionField("event_id", "==", event.id))
            channel = self.get_channel(event)
        
            accepted_list = list()
            declined_list = list()
            tentative_list = list()
            for response in responses[:]:
                userbdd: User.User = self.bot.database_manager.select_entity_by_id(User.User, response.users_id)
                if userbdd is None:
                    continue
                
                user: discord.Member = self.bot.guild.get_member(userbdd.discord_id)
                if user is None:
                    responses.remove(response)
                    continue
                if response.type_rep == 'accepted':
                    accepted_list.append(user.display_name)
                
                if response.type_rep == 'declined':
                    declined_list.append(user.display_name)

                if response.type_rep == 'tentative':
                    tentative_list.append(user.display_name)

            self.bot.database_manager.insert_entity(responses)
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
            Log.PrintError(f"update_event - {e}")
            raise Exception(e)
        finally:
            self.bot.scheduler_manager.scheduler_today.update_event(event)
        
    async def supp_event(self, event: Event.Event):
        try:
            channel: discord.TextChannel = self.get_channel(event)
            if(event.discord_id != None):
                try:
                    message = await channel.fetch_message(event.discord_id)
                    
                    if event.appel_msg_discord:
                        # Parcourir l'historique du canal pour trouver la réponse du bot
                        async for msg in channel.history():  # Limite d'exploration à 100 messages
                            if msg.author.id == self.bot.user.id and msg.reference:  # Vérifier si le bot a répondu
                                if msg.reference.message_id == message.id:  # Vérifier la relation
                                    await msg.delete()  # Supprimer la réponse du bot
                                    break

                    await message.delete()
                    self.bot.scheduler_manager.scheduler_today.update_event(event)
                except:
                    raise Exception(f"Appel Event non existant: {event.name}")
        except Exception as e:
            Log.PrintError(f"supp_event - {e}")


#------------------------------
#Fonctions pour l'attribution Event
#------------------------------

    async def attribution_event(self, event: Event.Event):
        try:
            channelBriefing = self.get_channel(int(self.bot.get_parameter("CHANNEL_BRIEFING")))
            if not isinstance(channelBriefing, discord.ForumChannel):
                raise Exception(f"Le channel {channelBriefing.name} n'est pas un forum")

            raise(f'Bouge toi le cul a le faire')
            #TODO a faire manuellement en generant le svg

            file_attrib = None

            if(event.attribution_discord_id != None):                        
                for thread in channelBriefing.threads:
                    try:
                        try:
                            message = await thread.fetch_message(event.attribution_discord_id)
                        except discord.NotFound as ne:
                            continue
                        await message.delete()
                        message = await thread.send(file=file_attrib)
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
                            message = await messageBriefing.reply(file=file_attrib)
                            event.attribution_discord_id = message.id
                            break
                        except Exception as e:
                            Log.PrintLog('async_attribution_event_flask - {e}')
                
                if message is None:
                    # Créer un topic dans le forum
                    topic = await channelBriefing.create_thread(
                        name= event.name,  # Titre du topic
                        applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                        file=file_attrib
                    )    
                    event.attribution_discord_id = topic.message.id
                # Créer un topic dans le forum

            insertOrUpdate_data(event)
        except Exception as e:
            Log.PrintError(f"attribution_event - {e}")

    def search_user_attribution(self, searchUser: str):
        members = self.bot.guild.members
        
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
        return membersList
    
#------------------------------
#Fonctions Utilitaires
#------------------------------
    def get_channel(self, event: Event.Event):
        nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
        channel: discord.TextChannel = self.bot.get_channel(int(self.bot.get_parameter(nameParam)))
        if channel is None:
            raise(f'Paramètrage incorrect: {nameParam}')
        
        return channel
    
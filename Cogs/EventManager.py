# EventManager.py
import discord, calendar, os, re
import BotManager
import svgwrite, uuid, cairosvg
import tempfile
from wand.image import Image
from wand.drawing import Drawing
from wand.color import Color
from datetime import datetime, time
import json
from lxml import etree

from ORM import Event, Response, ConditionField, EventType
from urllib.parse import quote, urlparse, urlunparse

from Utils import Log
from View import InviteView

class EventManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot
        self.urlSite = os.getenv('URL_SITE')

    async def set_event(self, event: Event.Event):
        try:
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

            view = InviteView.InviteView(event.id)
            if event.discord_id:
                try:
                    message = await channel.fetch_message(event.discord_id)
                    await message.edit(embed=embedEvent)
                except discord.NotFound as e:
                    # Boucle sur tous les jours de la semaine
                    for day in calendar.day_name:  # Renvoie les jours sous forme de noms ('Monday', 'Tuesday', ...)
                        nameParam = 'CHANNEL_' + day.upper()
                        channelTest: discord.TextChannel = self.bot.get_channel(int(self.bot.get_parameter(nameParam)))
                        if not channelTest:
                            continue
                        try:
                            message = None
                            message = await channelTest.fetch_message(event.discord_id)
                            await message.delete()
                            break
                        except discord.NotFound as e:
                            pass

                    
                    message = await channel.send(embed=embedEvent, view=view)
            else:
                message = await channel.send(embed=embedEvent, view=view)

            event.discord_id = message.id
            await self.update_event(event)
            
            if(event.briefing_template_name != ''):
                
                event.briefing_file_name = self.create_briefing(event)
                channelBriefing = self.bot.get_channel(int(self.bot.get_parameter("CHANNEL_BRIEFING")))
                if not channelBriefing:
                    raise Exception('Le channel demandé par le parametre CHANNEL_BRIEFING n\'existe pas')
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
            responses = await self.bot.database_manager.select_entity(
                Response.Response, [ConditionField("event_id", "==", event.id)]
            )
            channel = self.get_channel(event)
        
            accepted_list = []
            declined_list = []
            tentative_list = []
            for response in responses[:]:
                if not response.user:
                    await self.bot.database_manager.delete_entity(response)
                    continue

                user = self.bot.guild.get_member(response.user.discord_id)
                if not user:
                    await self.bot.database_manager.delete_entity(response)
                    continue

                if response.type_rep == 'accepted':
                    accepted_list.append(user.display_name)
                elif response.type_rep == 'declined':
                    declined_list.append(user.display_name)
                elif response.type_rep == 'tentative':
                    tentative_list.append(user.display_name)

            message = await channel.fetch_message(event.discord_id)
            embed = message.embeds[0]
            for field in embed.fields:
                if field.name.startswith("Accepted"):
                    embed.set_field_at(embed.fields.index(field), name=f"Accepted ({len(accepted_list)})", value="\n".join(accepted_list) or "Aucun", inline=field.inline)
                elif field.name.startswith("Declined"):
                    embed.set_field_at(embed.fields.index(field), name=f"Declined ({len(declined_list)})", value="\n".join(declined_list) or "Aucun", inline=field.inline)
                elif field.name.startswith("Tentative"):
                    embed.set_field_at(embed.fields.index(field), name=f"Tentative ({len(tentative_list)})", value="\n".join(tentative_list) or "Aucun", inline=field.inline)

            await message.edit(embed=embed)
        except Exception as e:
            Log.PrintError(f"update_event - {e}")
        finally:
            self.bot.scheduler_manager.scheduler_today.update_event(event)

    async def supp_event(self, event: Event.Event):
        try:
            channel = self.get_channel(event)
            if event.discord_id:
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
                    await self.bot.scheduler_manager.scheduler_today.update_event(event)
                except discord.NotFound:
                    Log.PrintError(f"Message de l'événement non trouvé : {event.name}")
        except Exception as e:
            Log.PrintError(f"supp_event - {e}")



#------------------------------
#Fonctions pour l'attribution Event
#------------------------------

    async def attribution_event(self, event: Event.Event):
        try:
            channelBriefing = self.bot.get_channel(int(self.bot.get_parameter("CHANNEL_BRIEFING")))
            if not channelBriefing:
                raise Exception(f"Le paramètre CHANNEL_BRIEFING renvoi un channel qui n'existe pas")
            if not isinstance(channelBriefing, discord.ForumChannel):
                raise Exception(f"Le channel {channelBriefing.name} n'est pas un forum")

            conditions = [
                ConditionField('event_id', '==', event.id),
                ConditionField('type_rep', 'in', ['accepted', 'added']),
            ]
            responses: list[Response.Response] = await self.bot.database_manager.select_entity(Response.Response, conditions)
            data = list()
            for response in responses:
                data.append([
                    response.user.username,
                    response.team.name if response.team else 'Aucune équipe',
                    ", ".join([f"{role.name}|{role.color}" for role in response.roles]) if response.roles else '',
                    response.vaisseau,
                    response.role_vaisseau,
                    response.commentaire
                ])

            file_attrib = self.create_svg_table(data=data, title=event.name)
            with open(file_attrib.name, 'rb') as file:
                file_attrib = discord.File(file, filename=file_attrib.name)

            if event.attribution_discord_id:
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
                if (event.briefing_Discord_Id is not None):
                    for thread in channelBriefing.threads:
                        try:
                            try:
                                messageBriefing = await thread.fetch_message(event.briefing_Discord_Id)
                            except discord.NotFound as ne:
                                continue
                            except discord.Forbidden as n:
                                Log.PrintError(n)
                            except discord.HTTPException as e:
                                Log.PrintError(e)
                                    
                            message = await messageBriefing.reply(file=file_attrib)
                            event.attribution_discord_id = message.id
                            break
                        except Exception as e:
                            Log.PrintLog('async_attribution_event_flask - {e}')

            if not event.attribution_discord_id:
                topic = await channelBriefing.create_thread(
                    name= event.name,  # Titre du topic
                    applied_tags= [channelBriefing.get_tag(int(os.getenv('EVENT_TAG'))),],
                    file=file_attrib
                )    
                event.attribution_discord_id = topic.message.id

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
        channel_id = None
        if event.type.name.upper() == 'ENTRAINEMENT COMPÉTITION':
            nameParam = 'CHANNEL_TRAINING'
            try:
                channel_id = int(self.bot.get_parameter(nameParam))
            except:
                pass

        if channel_id is None:
            nameParam = 'CHANNEL_' + event.start.strftime('%A').upper()
            channel_id = int(self.bot.get_parameter(nameParam))

        try:
            channel = self.bot.get_channel(channel_id)
            if not channel:
                raise ValueError(f"Channel non trouvé pour le paramètre : {nameParam}")
            return channel
        except Exception as e:
            Log.PrintError(f"get_channel - {e}")
            raise

    def create_svg_table(self, data, cell_height=30, padding=10, title=''):
        header_height = 60
        data.insert(0, ['Joueur', 'Équipe', 'Rôle', 'Vaisseau', 'Rôle Vaisseau', 'Commentaire'])

        def get_text_width(text, font_size=14):
            clean_text = re.sub(r'#[0-9A-Fa-f]{6}', '', text)
            return len(clean_text) * (font_size * 0.6)

        def get_text_color(background_color):
            r, g, b = tuple(int(background_color[i:i+2], 16) for i in (1, 3, 5))
            luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
            return '#000000' if luminance > 0.5 else '#FFFFFF'
        
        def adjust_brightness(color, factor=0.8):
            # Convertir la couleur hexadécimale en RGB
            r, g, b = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
            # Appliquer le facteur d'éclaircissement ou d'assombrissement
            r = min(255, int(r * factor))
            g = min(255, int(g * factor))
            b = min(255, int(b * factor))
            # Retourner la nouvelle couleur au format hexadécimal
            return f'#{r:02x}{g:02x}{b:02x}'

        data = [data[0]] + sorted(data[1:], key=lambda x: (x[1], re.sub(r'\s*\[[^\]]*\]\s*', '', x[0])))

        columns = len(data[0]) if data else 0
        col_widths = [max(get_text_width(str(row[col])) for row in data) + 2 * padding for col in range(columns)]

        rows = len(data)
        table_width = sum(col_widths)
        table_height = rows * cell_height
        svg_height = header_height + table_height + 50

        
        temp_file = tempfile.NamedTemporaryFile(suffix=".svg", delete=False)
        dwg = svgwrite.Drawing(temp_file.name, size=(table_width + 50, svg_height))

        # Ajouter un dégradé noir pour l'en-tête
        dwg.defs.add(dwg.linearGradient(id='headerGradient', x1='0%', y1='0%', x2='0%', y2='100%')
                     .add_stop_color(0, '#333333').add_stop_color(1, '#000000'))
        dwg.add(dwg.rect(insert=(0, 0), size=(table_width, header_height), fill='url(#headerGradient)', rx=10, ry=10))
        dwg.add(dwg.text(f'Affectation des Joueurs - {title}',
                         insert=(table_width / 2, 40),
                         font_size=26, fill='white', text_anchor='middle', font_family='Arial'))

        dwg.add(dwg.rect(insert=(0, header_height), size=(table_width, table_height), fill='none', stroke='black', rx=10, ry=10))

        y = header_height
        for row in range(rows):
            x = 0
            for col in range(columns):
                cell_width = col_widths[col]
                fill_color = '#f2f2f2' if row % 2 == 0 else '#ffffff'
                if row == 0:
                    fill_color = '#a4c2f4'

                dwg.add(dwg.rect(insert=(x, y), size=(cell_width, cell_height), fill=fill_color, stroke='black', rx=5, ry=5))

                cell_data = str(data[row][col])
                if col == 2 and cell_data and row > 0:
                    roles = [tuple(role.split("|")) for role in cell_data.split(", ")]
                    role_x = x + 5
                    for role_name, role_color in roles:
                        role_width = get_text_width(role_name, font_size=12) + 20
                        text_color = get_text_color(role_color)

                        end_color = adjust_brightness(role_color, 0.8)
                        idRoles = str(uuid.uuid4())

                        dwg.defs.add(dwg.linearGradient(id=idRoles, x1='0%', y1='0%', x2='0%', y2='100%')
                                    .add_stop_color(0, role_color)
                                    .add_stop_color(1, end_color))

                        dwg.add(dwg.rect(insert=(role_x, y + 5), size=(role_width, cell_height - 10),
                                         fill=f'url(#{idRoles})', stroke='black', rx=5, ry=5))
                        
                        dwg.add(dwg.text(role_name, insert=(role_x + role_width / 2, y + cell_height / 2), 
                                         text_anchor='middle', alignment_baseline='middle', font_size=12, fill=text_color, font_family='Arial'))
                        role_x += role_width + 10
                else:
                    dwg.add(dwg.text(cell_data, insert=(x + cell_width / 2, y + cell_height / 2),
                                    text_anchor='middle', alignment_baseline='middle', font_size=14, font_family='Arial'))
                x += cell_width
            y += cell_height

        dwg.save()
        temp_file_png = tempfile.NamedTemporaryFile(suffix=".png", delete=False)

        cairosvg.svg2png(url=temp_file.name, write_to=temp_file_png.name, scale=2.0)

        return temp_file_png

    def create_briefing(self, event: Event.Event):        
        template_path = os.path.join('Data', self.bot.get_parameter('DIRECTORY_TEMPLATES'), event.briefing_template_name, "template.svg")
        if not os.path.exists(template_path):
            raise Exception('Templates non trouvé')
        
        with open(template_path, "r", encoding="utf-8") as f:
            svg_content = f.read()

        root = etree.fromstring(svg_content.encode("utf-8"))

        # Parcourir dynamiquement les champs de l'événement et remplir les textes correspondants
        for text_element in root.findall(".//{http://www.w3.org/2000/svg}text"):
            data_id = text_element.attrib.get("id")
            if data_id and hasattr(event, data_id):
                # Récupérer dynamiquement la valeur de la propriété correspondante
                text_value = self.format_value(getattr(event, data_id))
                # Si c'est un commentaire, récupérer les contraintes du SVG
                if data_id == "commentaire":
                    max_width = float(text_element.attrib.get("data-end", "600"))  # Largeur max en pixels
                    max_height = float(text_element.attrib.get("data-yend", "200"))  # Hauteur max en pixels
                    font_size = float(text_element.attrib.get("font-size", "20"))  # Taille de police
                    line_height = font_size * 1.2  # Facteur pour espacer les lignes

                    # Créer une image temporaire pour mesurer le texte
                    with Image(width=1000, height=100, background=Color("white")) as img:
                        with Drawing() as draw:
                            draw.font = text_element.attrib.get("font-family", "Arial")  # Récupérer la police
                            draw.font_size = font_size

                            # Ajuster le texte en fonction des contraintes
                            text_value = self.adjust_text_to_width(draw, img, text_value, max_width, max_height, font_size, line_height)


        # Enregistrer l'image finale
        os.makedirs(f'Data\\{self.bot.get_parameter('DIRECTORY_EVENT_TEMPLATE')}', exist_ok=True)
        name_file = event.briefing_file_name if event.briefing_file_name != '' else str(uuid.uuid4()) + '.png'
        output_path = os.path.join('Data', self.bot.get_parameter('DIRECTORY_EVENT_TEMPLATE'), name_file)
        updated_svg = etree.tostring(root).decode("utf-8")
        cairosvg.svg2png(bytestring=updated_svg, write_to=output_path)
        return name_file

    def format_value(self, value):
        """Formater dynamiquement les valeurs selon leur type."""
        if isinstance(value, datetime):
            return value.strftime("%d/%m/%Y %H:%M")
        elif isinstance(value, time):
            return value.strftime("%H:%M")
        elif isinstance(value, bool):
            return "Oui" if value else "Non"
        elif isinstance(value, dict) or isinstance(value, list):
            return json.dumps(value, ensure_ascii=False, indent=2)
        elif isinstance(value, EventType.EventType):
            return value.name
        elif value is None:
            return ""
        return str(value)

    def adjust_text_to_width(self, draw, img, text, max_width, max_height, font_size, line_height):
        """Découpe dynamiquement le texte en respectant la largeur et la hauteur max."""
        words = text.split()
        current_line = ""
        lines = []
        y_offset = 0  # Suivi de la hauteur utilisée

        for word in words:
            test_line = f"{current_line} {word}".strip()
            metrics = draw.get_font_metrics(img, test_line)

            if metrics.text_width > max_width:
                # Vérifier si on dépasse la hauteur maximale
                if (y_offset + line_height) > max_height:
                    break  # Arrêt si on dépasse la hauteur max

                lines.append(current_line)
                y_offset += line_height
                current_line = word
            else:
                current_line = test_line

        # Ajouter la dernière ligne si elle existe et ne dépasse pas la hauteur max
        if current_line and (y_offset + line_height) <= max_height:
            lines.append(current_line)

        return "\n".join(lines)

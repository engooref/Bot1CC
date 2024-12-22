import discord, datetime, os, json, cairosvg, asyncio
from discord.ui import View, Select, Button, TextInput, Modal
from Utils import Log
import BotManager
from ORM import ConditionField, SCLocations, SCLocationsType
import xml.etree.ElementTree as ET


category_name: str = "Opérations"
folder_path = "./temp_op"

class Operation():
    def __init__(self, bot):
        global folder_path
        self.bot: BotManager.BotManager = bot
        
        self.role_path = f"{folder_path}/roles.json"
        self.role_emojis = {}
        
        self.message_role = None

    # Charger les données JSON dans un dictionnaire
    async def load_roles_from_file(self):
        try:
            with open(self.role_path, "r", encoding="utf-8") as file:
                return json.load(file)
        except Exception as e:
            print(f"Erreur lors du chargement du fichier JSON: {e}")
            return {}
        
    # Détecter les modifications dans le fichier
    async  def watch_file_for_changes(self, interval=1):
        last_modified_time = os.path.getmtime(self.role_path)
        while True:
            await asyncio.sleep(interval)  # Pause asynchrone
            try:
                current_modified_time = os.path.getmtime(self.role_path)
                if current_modified_time != last_modified_time:
                    last_modified_time = current_modified_time
                    await self.update_roles()  # Appel asynchrone au callback
            except Exception as e:
                print(f"Erreur lors de la surveillance du fichier: {e}")

    # Callback pour mettre à jour le dictionnaire
    async def update_roles(self):
        global category_name
        new_data = await self.load_roles_from_file()
        modified = False
        for emoji, role_id in new_data.items():
            if emoji not in self.role_emojis:
                modified = True
                Log.PrintLog(f"Ajout du nouvel emoji: {emoji} -> {role_id}")
                self.role_emojis[emoji] = role_id

        # Supprimer les anciens emojis/roles non présents dans le nouveau fichier
        for emoji in list(self.role_emojis.keys()):  # Utiliser une liste pour éviter RuntimeError
            if emoji not in new_data:
                modified = True
                removed_role_id = self.role_emojis.pop(emoji)
                Log.PrintLog(f"Suppression de l'emoji: {emoji} -> {removed_role_id}")

        if not modified:
            return
        
        category = discord.utils.get(self.bot.guild.categories, name=category_name)
        
        # Vérifie si le canal role existe dans la catégorie
        channel = discord.utils.get(category.channels, name="role-opération")
        if not channel:
            self.bot.add_traces(f"Création du canal 'role-opération' dans la catégorie '{category_name}'")
            
            channel = await self.bot.guild.create_text_channel('role-opération', category=category)
        

        async for message in channel.history(limit=100):  # Limiter à 100 messages pour les performances
            if (
                message.author == channel.guild.me  # Vérifier si c'est le bot qui a envoyé le message
                and message.embeds  # Vérifier si le message contient un embed
            ):
                embed = message.embeds[0]  # On prend le premier embed du message (s'il y en a un)
                # Vérifier le titre et la description de l'embed
                if embed.title == "Rôle Opération" and embed.description == "Réagissez aux emojis suivant pour les ping opérations:":
                    self.message_role = message

        embed = discord.Embed(
            title="Rôle Opération",
            description="Réagissez aux emojis suivant pour les ping opérations:",
            color=discord.Color.red()
        )

        for key in self.role_emojis:
            role: discord.Role = self.bot.guild.get_role(self.role_emojis[key])
            if role:
                embed.add_field(name="", value=key + " : " + role.name, inline=False)
            
        if not self.message_role:
            Log.PrintLog("Création du message pour les roles Opérations")    
            
            self.message_role = await channel.send(embed=embed)

        else:
            await self.message_role.edit(embed=embed)

        for reaction in self.message_role.reactions:
            # Vérifie si le bot a réagi
            async for user in reaction.users():
                if user == self.message_role.guild.me:  # Vérifie si l'utilisateur est le bot
                    await self.message_role.remove_reaction(reaction.emoji, user)
                    
        for value in self.role_emojis:
            await self.message_role.add_reaction(value)
        
            role = self.bot.guild.get_role(self.role_emojis[value])
            if role is None:
                continue
            
            name_channel = (role.name).lower().replace(" ", "-")

            # Vérifie si le canal role existe dans la catégorie
            channel = discord.utils.get(category.channels, name=name_channel)
            
            if not channel:
                self.bot.add_traces(f"Création du canal {name_channel} dans la catégorie '{category_name}'")
                channel = await self.bot.guild.create_text_channel(name_channel, category=category)
        

    async def ensure_channel_and_category(self):
        """
        Vérifie si la catégorie et le canal existent, sinon les crée.
        """
        try:
            
            guild = self.bot.guild
            # Vérifie si la catégorie existe
            category = discord.utils.get(guild.categories, name=category_name)
            if not category:
                self.bot.add_traces(f"Création de la catégorie '{category_name}'")
                overwrites = {
                    guild.default_role: discord.PermissionOverwrite(read_messages=False, send_messages=False),  # Bloque la lecture et l'écriture pour tout le monde
                }
                category = await guild.create_category(category_name, overwrites=overwrites)

            
            # Vérifie si le canal existe dans la catégorie
            channel = discord.utils.get(category.channels, name="création-opération")
            
            if not channel:
                self.bot.add_traces(f"Création du canal 'création-opération' dans la catégorie '{category_name}'")
                
                channel = await guild.create_text_channel('création-opération', category=category)
            
            async for message in channel.history(limit=100):  # Limiter à 100 messages pour les performances
                if (
                    message.author == channel.guild.me  # Vérifier si c'est le bot qui a envoyé le message
                    and message.embeds  # Vérifier si le message contient un embed
                    and message.components  # Vérifier s'il contient des composants (comme une vue)
                ):
                    embed = message.embeds[0]  # On prend le premier embed du message (s'il y en a un)
                    # Vérifier le titre et la description de l'embed
                    if embed.title == "Création Opération" and embed.description == "Pour créer une opération, cliquez sur le bouton ci-dessous.":
                        await message.delete()

            Log.PrintLog("Création du message pour les Opérations")    
            embed = discord.Embed(
                title="Création Opération",
                description="Pour créer une opération, cliquez sur le bouton ci-dessous.",
                color=discord.Color.blue()
            )
                
            view = View(timeout=None)
            button_view = Button(
                custom_id="op_btn", 
                label="Créer une Opération", 
                style=discord.ButtonStyle.green
            )
            button_view.callback = self.open_ticket
            view.add_item(button_view)
            # Si aucun message correspondant n'est trouvé, envoie un nouveau message
            await channel.send(embed=embed, view=view)

            await self.update_roles()
            asyncio.create_task(self.watch_file_for_changes())
            

            
            

        except Exception as e:
            Log.PrintError(f"Erreur lors de la configuration des canaux : {e}")
          
    async def open_ticket(self, interaction: discord.Interaction): 
        try:
            await interaction.response.send_message(
                f"Votre demande d'Opération va être envoyée en DM", ephemeral=True
            )
            dm_channel = await interaction.user.create_dm()
            async for message in dm_channel.history(limit=100):  # Limiter pour des performances optimales
                try:
                    if (
                        message.author == self.bot.user  # Vérifier si le message vient du bot (dans un DM, ça devrait être `None`)
                        and message.content.find('Veuillez remplir le formulaire suivant pour votre opération') != -1 # Vérifier si le message contient une vue (comme des boutons)
                    ):
                        async for message_delete in dm_channel.history(after=message):  # Parcourt les messages plus récents
                            await message_delete.delete()
                        await message.delete()
                        break
                except Exception as e:
                    print(e)


            operation = Operation.OperationForm(self.bot, self.role_emojis)
           
            await dm_channel.send(f"Bonjour {interaction.user.mention}, Veuillez remplir le formulaire suivant pour votre opération:")
            await operation.create_messages(dm_channel)
            
            
            Log.PrintLog(f"Envoi du formulaire opération à {interaction.user.name}")

        except Exception as e:
            Log.PrintError(e)
            await interaction.response.send_message(f"Erreur lors de la création de l'opération : {e}", ephemeral=True) 


    class UserModal(Modal):
        def __init__(self, view, title, update_func, label_text, placeholder_search = "", placeholder_price = "", placeholder_prev = ""):
            super().__init__(title=title)
            self.update_func = update_func
            self.view = view
            self.search_input = TextInput(
                label=label_text, 
                placeholder="Entrez un texte ici...",
                default = "" if placeholder_search == "" else placeholder_search,
                style= discord.TextStyle.long if (title == "Détails") else discord.TextStyle.short,
                max_length= 200 if (title == "Détails") else 4000,
                required=True
            )
            self.add_item(self.search_input)

            if (title == "Détails"):
                self.prev_input = TextInput(
                    label="Equipement à prévoir", 
                    placeholder="Entrez un texte ici...",
                    default = "" if placeholder_prev == "" else placeholder_prev,
                    required=True
                )
                self.add_item(self.prev_input)

                self.price_input = TextInput(
                    label="Récompense proposée", 
                    placeholder="Entrez la Récompense ici...",
                    default = "" if placeholder_price == "" else placeholder_price,
                    required=False
                )
                self.add_item(self.price_input)


        async def on_submit(self, interaction: discord.Interaction):
            try:
                # Met à jour les options basées sur l'entrée de recherche
                if not (self.title == "Détails"):
                    await self.update_func(self.search_input.value)
                else:
                    await self.update_func(self.search_input.value, self.price_input.value, self.prev_input.value)
                await interaction.response.defer()
            except Exception as e:
                Log.PrintError(e)

    class OperationForm():
        def __init__(self, bot, role_emojis):
            self.bot: BotManager.BotManager = bot
            self.val = {'location' : '0.0.0'}
            self.role_emojis = role_emojis
            self.stars_bdd: list[SCLocations.SCLocations] = self.bot.database_manager.select_entity(SCLocations.SCLocations, ConditionField('type.name', '==', 'STAR'))

            self.stars = [discord.SelectOption(label=star.name, value=str(star.id)) for star in self.stars_bdd]

            self.current_stars = self.stars[:25]
            self.current_planets = [discord.SelectOption(label="Aucun", value="aucun"),]
            self.current_moons = [discord.SelectOption(label="Aucun", value="aucun"),]

        async def create_messages(self, channel: discord.TextChannel):
            options_type = list()
            for emoji in self.role_emojis:
                role = self.bot.guild.get_role(self.role_emojis[emoji])
                options_type.append(discord.SelectOption(label=role.name, value=str(self.role_emojis[emoji])))

            view_select_type = View(timeout=None)
            select_type = Select(
                placeholder="Choisissez le type d'opération",
                options=options_type,
                custom_id="select_type"
            )

            select_type.callback = self.select_type_callback
            view_select_type.add_item(select_type)

            self.view_validate = View(timeout=None)
            validate_button = Button(
                custom_id="send_btn", 
                label="Valider", 
                style=discord.ButtonStyle.green,
                disabled=True
            )
            
            cancel_button = Button(
                custom_id="annuler_btn", 
                label="Annuler", 
                style=discord.ButtonStyle.red
            )
            
            # Lier les événements pour les boutons
            validate_button.callback = self.validate_button_callback
            cancel_button.callback = self.cancel_button_callback
            self.view_validate.add_item(validate_button)
            self.view_validate.add_item(cancel_button)

            view_details = View(timeout=None)
            details_button = Button(
                custom_id="details_btn", 
                label="Ajouter", 
                style=discord.ButtonStyle.primary
            )

            details_button.callback = self.on_details_btn

            view_details.add_item(details_button)

            view_heure = View(timeout=None)
            option_hours = [
		            discord.SelectOption(label="Immediat", value="0", default=True),
                discord.SelectOption(label="Dans 15 minutes", value="15"),
                discord.SelectOption(label="Dans 30 minutes", value="30"),
                discord.SelectOption(label="Dans 45 minutes", value="45"),
                discord.SelectOption(label="Dans 1 heure", value="60"),
                discord.SelectOption(label="Dans 1 heure 30", value="90"),
                discord.SelectOption(label="Dans 2 heures", value="120"),
                discord.SelectOption(label="Dans 2 heures 30", value="150"),
                discord.SelectOption(label="Dans 3 heures", value="180"),
            ]

            self.val["minutes"] = "15"
            heure_select = Select(
                placeholder="",
                options=option_hours,
                custom_id="select_type"
            )
            heure_select.callback = self.heure_select_callback
            view_heure.add_item(heure_select)


            await channel.send("- Type d'opération: ", view=view_select_type)
            await channel.send("- Début de l'opération dans:", view=view_heure)
            self.location_message: discord.Message = await channel.send("- Localisation: ", view=await self.update_location())
            await channel.send("- Détails Opération : ", view=view_details)
            self.validate_message: discord.Message = await channel.send("- Poster ?", view=self.view_validate)

        async def update_location(self):
            location = self.val["location"].split(".")

            view_select_location = View(timeout=None)
            self.select_star = Select(
                placeholder="Choisissez une étoile",
                options=[discord.SelectOption(label=star.label, value=star.value, default=(star.value == location[0])) for star in self.current_stars],
                custom_id="select_star_loc"
            )

            # Ajout du second select (désactivé au début)
            self.select_planet = Select(
                placeholder="Choisissez une planète",
                options=[discord.SelectOption(label=planet.label, value=planet.value, default=(planet.value == location[1])) for planet in self.current_planets],
                custom_id="select_planet_loc",
                disabled=location[0] == "0"
            )

            # Ajout du troisième select (désactivé au début)
            self.select_moon = Select(
                placeholder="Choisissez une lune",
                options=[discord.SelectOption(label=moon.label, value=moon.value, default=(moon.value == location[2])) for moon in self.current_moons],
                custom_id="select_moon_loc",
                disabled=location[1] == "0" 
            )

            self.select_star.callback = self.on_star_select
            self.select_planet.callback = self.on_planet_select
            self.select_moon.callback = self.on_moon_select

            # Ajouter les selects à la vue
            view_select_location.add_item(self.select_star)
            view_select_location.add_item(self.select_planet)
            view_select_location.add_item(self.select_moon)

            search_button = Button(
                custom_id="search_btn", 
                label="Recherche", 
                style=discord.ButtonStyle.primary
            )

            search_button.callback = self.on_search_btn
            view_select_location.add_item(search_button)

            return view_select_location

        
        async def on_star_select(self, interaction: discord.Interaction):
            try:
                # Lorsque l'utilisateur choisit une étoile, activer le select de la planète
                selected_star = self.select_star.values[0]
                
                star_bdd: SCLocations.SCLocations = [star for star in self.stars_bdd if str(star.id) == selected_star][0]
                
                # Remplir les options de la planète en fonction de l'étoile sélectionnée
                self.current_planets = [discord.SelectOption(label="Aucun", value="0")] + [discord.SelectOption(label=planet.name, value=str(planet.id)) for planet in star_bdd.children]
                
                self.val["location"] = selected_star + '.0.0'
                await interaction.response.edit_message(content= "- Localisation: ", view=await self.update_location())
                await self.confirm_operation(interaction)
            except Exception as e:
                Log.PrintError(e)
                await interaction.response.defer()
                

        async def on_planet_select(self, interaction: discord.Interaction):
            try:
                # Lorsque l'utilisateur choisit une planète, activer le select de la lune
                selected_planet = self.select_planet.values[0]

                planet: SCLocations.SCLocations = self.bot.database_manager.select_entity_by_id(SCLocations.SCLocations, selected_planet)

                # Remplir les options de la lune en fonction de la planète sélectionnée
                self.current_moons = [discord.SelectOption(label="Aucun", value="0")]
                if selected_planet != "aucun":
                    self.current_moons += [discord.SelectOption(label=moon.name, value=str(moon.id)) for moon in planet.children]


                location = self.val["location"].split('.')
                self.val["location"] =  location[0] + '.' + selected_planet + '.0'
                await interaction.response.edit_message(content= "- Localisation: ", view=await self.update_location())
            except Exception as e:
                Log.PrintError(e)
                await interaction.response.defer()
            
        async def on_moon_select(self, interaction: discord.Interaction):
            try:
                # Répondre après que l'utilisateur ait sélectionné une lune
                location = self.val["location"].split('.')
                self.val["location"] = location[0] + '.' + location[1] + '.' + self.select_moon.values[0]
                await interaction.response.edit_message(content= "- Localisation: ", view=await self.update_location())
            except Exception as e:
                Log.PrintError(e)
                await interaction.response.defer()

        async def on_search_btn(self, interaction: discord.Interaction):
            # Ouvrir un modal pour entrer un texte
            modal = Operation.UserModal(self, "Recherche", self.update_options, "Recherchez un Corps")
            await interaction.response.send_modal(modal)

        async def on_details_btn(self, interaction: discord.Interaction):
            # Ouvrir un modal pour entrer un texte
            modal = Operation.UserModal(self, 
                    "Détails", 
                    self.update_detail, 
                    "Entrez une Description:", 
                    self.val["description"] if "description" in self.val else "", 
                    self.val["price"] if "price" in self.val else "",
                    self.val["prev"] if "prev" in self.val else "")
            await interaction.response.send_modal(modal)

        # Menu de sélection pour le type d'opération
        async def select_type_callback(self, interaction: discord.Interaction):
            try:
                await interaction.response.defer()
                selected_value = interaction.data['values'][0]
                self.val["type"] = selected_value
                await self.confirm_operation(interaction)
            except Exception as e:
                Log.PrintError(e)

        async def heure_select_callback(self, interaction: discord.Interaction):
            try:
                await interaction.response.defer()
                selected_value = interaction.data['values'][0]
                self.val["minutes"] = selected_value
            except Exception as e:
                Log.PrintError(e)
                
        # Callback pour le bouton Valider
        async def validate_button_callback(self, interaction: discord.Interaction):
            try:
                global folder_path
                #await interaction.response.defer()
                role = self.bot.guild.get_role(int(self.val["type"]))
                
                tree = ET.parse(f'{folder_path}/{role.name}.svg')
                root = tree.getroot()
                
                date = datetime.datetime.now()
                # Ajouter 15 minutes à l'heure actuelle
                time_plus_15 = date + datetime.timedelta(minutes=int(self.val["minutes"]))

                # Formater l'heure dans le style [HH:MM]
                formatted_time = time_plus_15.strftime("[%H:%M]").upper()
                formatted_date = date.strftime("%A %d/%m/%Y").upper()
                description = self.val["description"] if "description" in self.val else ""

                entete = f"{formatted_time} OPÉRATION {role.name.upper()[role.name.upper().find('-') + 1:]} - RESPONSABLE: {interaction.user.display_name}"
                

                localisation = ''
                for location in self.val["location"].split("."):
                    if location != "0":
                        object: SCLocations.SCLocations = self.bot.database_manager.select_entity_by_id(SCLocations.SCLocations, int(location))
                        localisation += (" >> " if localisation != '' else "") + object.name
        

                self.write_svg("Localisation", localisation, root)
                self.write_svg("info", entete, root)
                self.write_svg("Date", formatted_date, root)
                self.write_svg("Materiel", f"Equipement : {self.val['prev']}", root)

                if self.val['price'] != "":
                    text_element = self.write_svg("Prime", f"Prime : {self.val['price']}", root)
                    if text_element is not None:
                        text_element.set('x', str(self.calculate_text_position(text_element, root.attrib.get("width", None))))
                else:
                    self.write_svg("Prime", "", root)

                # Récupérer le texte "Description"
                description_text = root.find(".//*[@id='Description']")  # Trouver l'élément par son id

                if description_text is not None:
                    logo_x = 940
                    description_x = float(description_text.attrib["x"])
                    max_width = logo_x - description_x

                    # Diviser le texte en lignes
                    lines = self.split_text(description, max_width)

                    # Supprimer le texte original et ajouter des balises <tspan>
                    description_text.text = ""  # Supprimer le texte original
                    y = float(description_text.attrib["y"])  # Coordonnée Y initiale

                    for i, line in enumerate(lines):
                        tspan = ET.SubElement(description_text, "tspan", {
                            "x": description_text.attrib["x"],
                            "y": str(y + i * 20)  # Ajouter un décalage vertical (20px par exemple)
                        })
                        tspan.text = line


                
                name_file_svg = f"{interaction.user.name}_{role.name}.svg"
                name_file_png = f"{interaction.user.name}_{role.name}.png"

                if not os.path.exists(folder_path):
                    # Créer le dossier
                    os.makedirs(folder_path)

                tree.write(f"{folder_path}/{name_file_svg}")


                cairosvg.svg2png(url=f"{folder_path}/{name_file_svg}", write_to=f"{folder_path}/{name_file_png}")

                emoji = self.bot.guild.get_emoji(1213915551210930306)
                if emoji is None:
                   emoji = "👍"

                category: discord.CategoryChannel = discord.utils.get(self.bot.guild.categories, name=category_name)
                # Vérifie si le canal existe dans la catégorie
                channel = discord.utils.get(category.channels, name=(role.name.replace(' ', '-')).lower())

                message = await channel.send(content=f"{role.mention}\nPour valider votre présence interagissez avec l'emoji {emoji}", file=discord.File(f"{folder_path}/{name_file_png}"))
                await message.add_reaction(emoji)

                dm_channel = await interaction.user.create_dm()
                async for message in dm_channel.history(limit=100):  # Limiter pour des performances optimales
                    if (
                        message.author == self.bot.user  # Vérifier si le message vient du bot (dans un DM, ça devrait être `None`)
                        and message.content.find('Veuillez remplir le formulaire suivant pour votre opération') != -1 # Vérifier si le message contient une vue (comme des boutons)
                    ):
                        async for message_delete in dm_channel.history(after=message):  # Parcourt les messages plus récents
                            await message_delete.delete()
                        await message.delete()
                        break

            except Exception as e:
                Log.PrintError(e)
                await interaction.message.reply(f"erreur lors de la validation: {e}")


        def calculate_text_position(self, text_element, svg_width, char_width=5):
            text_width = len(text_element.text) * char_width
            # Calculer la position pour centrer le texte
            return (int(svg_width) - text_width) / 2

        def write_svg(self, id, val, root):
            # Rechercher un élément avec un attribut spécifique (par exemple, id="myText")
            namespace = {'svg': 'http://www.w3.org/2000/svg'}  # Namespace SVG

            text_element = root.find(f".//svg:text[@id='{id}']", namespace)

            if text_element is not None:
                text_element.text = val  # Remplacer le texte
            
            return text_element


        # Fonction pour diviser un texte
        def split_text(self, text, max_width, char_width=12):
            """
            Divise le texte en lignes en fonction de la largeur maximale.
            :param text: Le texte à diviser
            :param max_width: La largeur maximale avant un retour à la ligne
            :param char_width: La largeur moyenne approximative d'un caractère
            :return: Une liste de lignes de texte
            """
            words = text.split()
            lines = []
            current_line = ""
            
            for word in words:
                # Ajouter le mot à la ligne actuelle et calculer sa largeur
                if (len(current_line) + len(word)) * char_width <= max_width:
                    current_line += (word + " ")
                else:
                    lines.append(current_line.strip())
                    current_line = word + " "
            
            if current_line:
                lines.append(current_line.strip())
            
            return lines


        # Callback pour le bouton Annuler
        async def cancel_button_callback(self, interaction: discord.Interaction):
            try:
                
                # Créer une vue avec des boutons pour la confirmation
                view = View(timeout=None)
                
                # Créer un bouton pour annuler l'opération
                cancel_button = Button(label="Non", style=discord.ButtonStyle.red, disabled=False)
                # Créer un bouton pour confirmer l'opération
                confirm_button = Button(label="Oui", style=discord.ButtonStyle.green, disabled=False)

                # Ajouter des callbacks aux boutons
                cancel_button.callback = self.confirm_operation
                confirm_button.callback = self.cancel_operation

                # Ajouter les boutons à la vue
                view.add_item(cancel_button)
                view.add_item(confirm_button)
                await self.validate_message.edit(content="- Voulez-vous vraiment annuler l'opération ?", view=view)
            except Exception as e:
                Log.PrintError(e)
            await interaction.response.defer()

                
        async def confirm_operation(self, interaction: discord.Interaction):
            try:

                disabled_validate = (
                    ("type" not in self.val) 
                    or ("price" not in self.val) 
                    or ("description" not in self.val) 
                    or (self.val["location"].split('.')[0] == "0")
                )

                self.view_validate = View(timeout=None)
                validate_button = Button(
                        custom_id="send_btn", 
                        label="Valider", 
                        style=discord.ButtonStyle.green,
                        disabled= disabled_validate
                    )
                
                cancel_button = Button(
                    custom_id="annuler_op_btn", 
                    label="Annuler", 
                    style=discord.ButtonStyle.red
                )
                
                # Lier les événements pour les boutons
                validate_button.callback = self.validate_button_callback
                cancel_button.callback = self.cancel_button_callback
                self.view_validate.add_item(validate_button)
                self.view_validate.add_item(cancel_button)
                await self.validate_message.edit(content="- Poster ?", view=self.view_validate)
            except Exception as e:
                Log.PrintError(e)

        async def cancel_operation(self, interaction: discord.Interaction):
            dm_channel = await interaction.user.create_dm()
            async for message in dm_channel.history(limit=100):  # Limiter pour des performances optimales
                try:
                    if (
                        message.author == self.bot.user  # Vérifier si le message vient du bot (dans un DM, ça devrait être `None`)
                        and message.content.find(f'Veuillez remplir le formulaire suivant pour votre opération') != -1 # Vérifier si le message contient une vue (comme des boutons)
                    ):
                        async for message_delete in dm_channel.history(after=message):  # Parcourt les messages plus récents
                            await message_delete.delete()
                        await message.delete()
                        break
                except Exception as e:
                    print(e)
            Log.PrintLog(f"Annulation de l'opération de {interaction.user}")

        async def update_options(self, query):
            # Filtre les options en fonction de la recherche
            body: SCLocations.SCLocations = self.bot.database_manager.select_entity(SCLocations.SCLocations, ConditionField('name', 'ilike', query), True)

            if body:
                star_obj = None
                planet_obj = None
                moon_obj = None
                match body.type.name:
                    case "STAR":
                        star_obj = body
                        
                    case "PLANET":
                        planet_obj: SCLocations.SCLocations = body
                        star_obj: SCLocations.SCLocations = self.bot.database_manager.select_entity_by_id(SCLocations.SCLocations, body.parent.id)
                        

                    case "SATELLITE":
                        moon_obj: SCLocations.SCLocations = body
                        planet_obj: SCLocations.SCLocations = self.bot.database_manager.select_entity_by_id(SCLocations.SCLocations, body.parent.id) 
                        star_obj: SCLocations.SCLocations = self.bot.database_manager.select_entity_by_id(SCLocations.SCLocations, planet_obj.parent.id)
                    
                star_list = [star for star in self.current_stars if star.value == str(star_obj.id)]
                if len(star_list) == 0:
                    self.current_stars.remove(self.current_stars[0])
                    self.current_stars.insert(0, discord.SelectOption(label=star_obj.name, value=str(star_obj.id)))

                # Remplir les options de la lune en fonction de la planète sélectionnée
                self.current_planets = [discord.SelectOption(label="Aucun", value="aucun")] + [discord.SelectOption(label=planet.name, value=str(planet.id)) for planet in star_obj.children]
                if planet_obj:
                    self.current_moons = [discord.SelectOption(label="Aucun", value="aucun")] + [discord.SelectOption(label=moon.name, value=str(moon.id)) for moon in planet_obj.children]
                
                self.val["location"] =  str(star_obj.id) + '.' + (str(planet_obj.id) if planet_obj else '0') + '.' + (str(moon_obj.id) if moon_obj else '0')
                error = None
            else:
                error = "- Corps non trouvé"

            message_content = "- Localisation: " + (f"\n```\n{error}```" if error else "")
            await self.location_message.edit(content=message_content, view=await self.update_location())
        
        async def update_detail(self, description, price, prev):
            self.val["description"] = description
            self.val["price"] = price
            self.val["prev"] = prev
            await self.confirm_operation(None)






import discord, json
from ORM import Response,Event

class EventView(discord.ui.View):
    def __init__(self, options_data, resp_id, bot):
        super().__init__()
        self.resp_id = resp_id
        self.bot = bot
        # Création dynamique de la liste d'options à partir des données fournies
        options = [
            discord.SelectOption(label=data["value"], value=data["value"], default=data["select"])
            for data in options_data
        ]

        # Création du menu déroulant avec les options dynamiques
        self.select = discord.ui.Select(
            placeholder="Choisissez un role...",
            min_values=1,
            max_values=len(options),
            options=options,
            
        )

        disabled_button = not any(data["select"] for data in options_data)

        self.add_item(self.select)
        self.select.callback = self.select_callback
    
        self.button = discord.ui.Button(
            custom_id="send_btn", 
            label="Valider", 
            style=discord.ButtonStyle.green,
            disabled= disabled_button
        )
        self.button.callback = self.button_callback
        self.add_item(self.button)

    async def select_callback(self, interaction: discord.Interaction):
        # Récupération des valeurs actuellement sélectionnées
        selected = self.select.values
        first_option_value = self.select.options[0].value

        if first_option_value in selected:
            # Si la première option est sélectionnée (même avec d'autres), on ne garde que la première.
            for i, option in enumerate(self.select.options):
                option.default = (i == 0)
        elif not selected:
            # Si aucune option n'est sélectionnée, on sélectionne automatiquement la première.
            for i, option in enumerate(self.select.options):
                option.default = (i == 0)
        else:
            # Si on a sélectionné des options sans la première,
            # on s'assure que la première est désélectionnée et on conserve les autres.
            for i, option in enumerate(self.select.options):
                if i == 0:
                    option.default = False
                else:
                    option.default = (option.value in selected)

        self.button.disabled = False
        # Mise à jour du message avec le nouveau statut du menu
        await interaction.response.edit_message(content=interaction.message.content, view=self)

    async def button_callback(self, interaction: discord.Interaction):
        response: Response.Response = await self.bot.database_manager.select_entity_by_id(Response.Response, self.resp_id)
        if not response:
            return

        event: Event.Event = await self.bot.database_manager.select_entity_by_id(Event.Event, response.event_id)
        # Récupération des valeurs sélectionnées dans le menu
        selected_values = self.select.values
        
        # Conversion de la liste des valeurs en JSON
        response.role_demand = json.dumps(selected_values)
        
        await self.bot.database_manager.insert_entity(response)
        await interaction.response.edit_message(content=f"Enregistrement de vos choix pour l'event {event.name} effectué", view=None)        


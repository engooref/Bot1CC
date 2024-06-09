import discord
from discord.ui import Button, View
from ORM import insertOrUpdate_data, select_by_fields, select_by_id, select_by_field, select_all, select_by_discordId
from ORM import Response, Parameter
import Log

# Vue personnalisée avec des boutons
class InviteView(View):
    def __init__(self, event_id):
        super().__init__()
        self.event_id = event_id

        # Bouton pour accepter
        self.add_item(Button(label="Accepted", style=discord.ButtonStyle.success, custom_id=f"accepted_{event_id}"))

        # Bouton pour refuser
        self.add_item(Button(label="Decline", style=discord.ButtonStyle.danger, custom_id=f"declined_{event_id}"))

        # Bouton pour tentative
        self.add_item(Button(label="Tentative", style=discord.ButtonStyle.secondary, custom_id=f"tentative_{event_id}"))

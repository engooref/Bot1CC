from ORM import *
from ORM import User, Role, Channel, Traces, SCLocations, SCLocationsType
from Utils import Log
import discord, BotManager
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List
from ORM.ConditionField import ConditionField

class DatabaseManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager = bot

    async def insert_and_get_user(self, author: discord.Member):
        """Insère un utilisateur dans la base si non présent et le retourne."""
        try:
            if author is None:
                raise ValueError("Utilisateur non renseigné")

            user = await select_by_field(User.User, ConditionField('discord_id', '==', author.id), True)

            if user is None:
                all_roles_discord = author.roles
                all_roles = await self.insert_and_get_new_roles(all_roles_discord)

                user = await insert_or_update_data(User.User(
                    None,
                    author.display_name,
                    author.id,
                    author.avatar.key if author.avatar else None,
                    ' ',
                    list(all_roles.values()),
                    0,
                    0
                ))
                await self.bot.add_traces(f"Ajout de l'utilisateur: {author.display_name}")

            return user
        except Exception as e:
            Log.PrintError(f"insert_and_get_user - {e}")
            raise

    async def get_user_by_discordid(self, discord_id: str):
        """Retourne un utilisateur à partir de son discord_id."""
        return await select_by_field(User.User, ConditionField('discord_id', '==', discord_id), True)

    async def insert_and_get_new_roles(self, roles: List[discord.Role]):
        """Insère de nouveaux rôles en base et retourne tous les rôles."""
        try:
            if len(roles) == 0:
                return {}

            roles_bdd = await select_all(Role.Role)
            new_roles_bdd = []

            for role in roles:
                if role.name in ["@everyone", self.bot.user.name]:
                    continue

                role_bdd = next((key for key, obj in roles_bdd.items() if obj.discord_id == role.id), None)
                if role_bdd is None:
                    new_roles_bdd.append(Role.Role(role.name, role.id))
                    await self.bot.add_traces(f'Ajout du role: {role.name}')

            if new_roles_bdd:
                await insert_multi_ligne(new_roles_bdd)

            return await select_all(Role.Role)
        except Exception as e:
            Log.PrintError(f"insert_and_get_new_roles - {e}")
            raise

    async def insert_and_get_new_channels(self, channels: List[discord.abc.GuildChannel]):
        """Insère de nouveaux canaux en base et retourne tous les canaux."""
        try:
            if len(channels) == 0:
                return {}

            channels_bdd = await select_all(Channel.Channel)
            new_channels_bdd = []

            for channel in channels:
                if isinstance(channel, (discord.VoiceChannel, discord.CategoryChannel)) or (
                    channel.category and channel.category.name.lower() == "operation"):
                    continue

                channel_bdd = next((key for key, obj in channels_bdd.items() if obj.discord_id == channel.id), None)
                if channel_bdd is None:
                    new_channels_bdd.append(Channel.Channel(channel.name, channel.id))
                    await self.bot.add_traces(f'Ajout du channel: {channel.name}')

            if new_channels_bdd:
                await insert_multi_ligne(new_channels_bdd)

            return await select_all(Channel.Channel)
        except Exception as e:
            Log.PrintError(f"insert_and_get_new_channels - {e}")
            raise

    async def insert_entity(self, entity):
        """Insère une entité dans la base."""
        if isinstance(entity, list):
            await insert_multi_ligne(entity)
        else:
            await insert_or_update_data(entity)

    async def select_entity(self, model, conditions, one_result=False, order_by_desc=False):
        """Sélectionne une entité en fonction de conditions."""
        if isinstance(conditions, list):
            return await select_by_fields(model, conditions, one_result, order_by_desc)
        else:
            return await select_by_field(model, conditions, one_result, order_by_desc)

    async def select_entity_by_id(self, model, entity_id):
        """Sélectionne une entité par son ID."""
        return await select_by_id(model, entity_id)

    async def select_all(self, model, in_list=False):
        """Sélectionne toutes les entités d'un modèle."""
        return await select_all(model, in_list)

    async def add_traces(self, message: str, user: User.User, parameter=None):
        """Ajoute une trace en base."""
        trace = Traces.Traces(user.id, message, parameter)
        await self.insert_entity(trace)
        Log.PrintLog(message)

    async def delete_entity(self, entity):
        """Supprime une entité de la base."""
        await delete(entity)

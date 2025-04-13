from asyncio import Condition
from ORM import *
from ORM import User, Role, Channel, Traces, RHMember
from Utils import Log
import discord, BotManager
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

            user: User.User = await select_by_field(User.User, ConditionField('discord_id', '==', author.id), True)

            user_roles : List[Role.Role] = await self.insert_and_get_new_roles(author.roles)

            if user is None:
                # Ensuite, on crée le User en associant le RHMember
                user = User.User(
                    email=None,
                    username=author.display_name,
                    discordId=author.id,
                    avatar=author.avatar.key if author.avatar else None,
                    accessToken=' ',
                    roles=user_roles,       # ou user_roles
                    expPour=0,
                    expLvl=0
                )
                await self.bot.add_traces(f"Ajout de l'utilisateur: {author.display_name}")
            else:
                user.username = author.display_name
                user.discord_id = author.id
                user.avatar=author.avatar.key if author.avatar else None
                user.rolesDiscord=user_roles
                await self.bot.add_traces(f"Modification de l'utilisateur: {author.display_name}")
            
            await insert_or_update_data(user)

            return await self.select_entity(User.User, ConditionField('discord_id', '==', author.id), True)
        except Exception as e:
            Log.PrintError(f"insert_and_get_user - {e}")
            raise

    async def get_user_by_discordid(self, discord_id: str):
        """Retourne un utilisateur à partir de son discord_id."""
        return await select_by_field(User.User, ConditionField('discord_id', '==', discord_id), True)

    async def insert_and_get_new_roles(self, roles: List[discord.Role]):
        """Insère de nouveaux rôles en base et retourne tous les rôles."""
        try:
            if not len(roles):
                return list()

            roles_bdd: list[Role.Role] = await select_all(Role.Role)

            # On crée un ensemble contenant tous les discord_id existants dans roles_bdd
            discord_ids_existants = {obj.discord_id for obj in roles_bdd}

            new_roles_bdd = list() 

            for role in (role for role in roles if role.id not in discord_ids_existants):
                if role.name in ["@everyone", self.bot.user.name]:
                    continue
                
                new_roles_bdd.append(Role.Role(role.name, role.id, role.hoist))
                await self.bot.add_traces(f'Ajout du role: {role.name}')

            if new_roles_bdd:
                await insert_multi_ligne(new_roles_bdd)

            return await self.select_entity(Role.Role, ConditionField('discord_id', 'in', [role.id for role in roles]))
        
        except Exception as e:
            Log.PrintError(f"insert_and_get_new_roles - {e}")
            raise

    async def insert_and_get_new_channels(self, channels: List[discord.abc.GuildChannel]):
        """Insère de nouveaux canaux en base et retourne tous les canaux."""
        try:
            if len(channels) == 0:
                return dict()

            channels_bdd: list[Channel.Channel] = await select_all(Channel.Channel)
            # On crée un ensemble contenant tous les discord_id existants dans roles_bdd
            discord_ids_existants = {obj.discord_id for obj in channels_bdd}

            new_channels_bdd = []

            channels_excludes = list()

            for category in self.bot.exclude_category:  
                try:
                    cat: discord.CategoryChannel = discord.utils.get(self.bot.guild.categories, name=category)
                    channels_excludes.extend(channel.id for channel in cat.channels)
                except:
                    pass

            
            for channel in (channel for channel in channels if channel.id not in discord_ids_existants):
                if isinstance(channel, (discord.VoiceChannel, discord.CategoryChannel)) or (channel.id in channels_excludes):
                    continue

                new_channels_bdd.append(Channel.Channel(channel.name, channel.id))
                await self.bot.add_traces(f'Ajout du channel: {channel.name}')

            if new_channels_bdd:
                await insert_multi_ligne(new_channels_bdd)

            return await self.select_entity(Channel.Channel, ConditionField('discord_id', 'in', [channel.id for channel in channels]))
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

    async def select_entity_by_id(self, model, entity_id, other_exclu=list()):
        """Sélectionne une entité par son ID."""
        return await select_by_id(model, entity_id, other_exclu)

    async def select_all(self, model):
        """Sélectionne toutes les entités d'un modèle."""
        return await select_all(model)

    async def add_traces(self, message: str, user: User.User, parameter=None):
        """Ajoute une trace en base."""
        trace = Traces.Traces(user.id, message, parameter)
        await self.insert_entity(trace)
        Log.PrintLog(message)

    async def delete_entity(self, entity):
        """Supprime une entité de la base."""
        await delete(entity)

    async def refresh_entity(self, entity):
        return await refresh_entity(entity)

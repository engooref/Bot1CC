# DatabaseManager.py
from ORM import *
from ORM import User, Role, Channel, Traces, SCLocations, SCLocationsType
from Utils import Log
import discord, BotManager


class DatabaseManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager = bot

    def insert_and_get_user(self, author: discord.Member):
        # Méthode pour insérer et obtenir de nouveaux utilisateurs
        try:
            #Sécurité
            if author is None:
                raise("Utilisateur non renseigné")
            
            #Check si l'utilisateur existe en base
            user = select_by_discordId(User.User, author.id)
        
            if user is None:
                #Si l'utilisateur n'existe pas alors on le créer
                allRoleDiscord = author.roles
                allRoles = self.insert_and_get_new_roles(allRoleDiscord)
                
                user = insertOrUpdate_data(User.User(None, author.display_name, author.id, author.avatar.key, ' ', list(allRoles.values()), 0, 0))
                self.bot.add_traces(f"Ajout de l'utilisateur: {author.display_name}")

            return user
        except Exception as e:
            Log.PrintError(f"insert_and_get_user - {e}")
            raise

    def get_user_by_discordid(self, discordId: str):
        return select_by_discordId(User.User, discordId)

      
#-----------------------------------------------------------------------------------------------------------------
    def insert_and_get_new_roles(self, roles):
        # Méthode pour insérer et obtenir de nouveaux rôles
        try:
            #Sécurité
            if len(roles) == 0:
                return list()
            
            #Récupération des roles stocké en base
            rolesbdd = select_all(Role.Role)
            newRolesBdd = list()

            #Check si un role est présent en base
            #Si non présent on l'ajoute dans la base et dans une liste
            for role in roles:
                if role.name in ["@everyone", self.bot.user.name]:
                    continue
                
                rolebdd = next((key for key, obj in rolesbdd.items() if obj.discord_id == role.id), None)
                if rolebdd is None:
                    newRolesBdd.append(Role.Role(role.name, role.id))
                    self.bot.add_traces(f'Ajout du role: {role.name}')
                    
            insert_multiLigne(newRolesBdd)    
        except Exception as e:
            Log.PrintError(f"insert_and_get_new_roles - {e}")
            raise
        
        return select_all(Role.Role)

    def insert_and_get_new_channels(self, channels):
        # Méthode pour insérer et obtenir de nouveaux canaux
        try:
            #Sécurité
            if len(channels) == 0:
                return list()
            
            #Récupération deschannels stocké en base
            channelsBdd = select_all(Channel.Channel)
            newchannelsBdd = list()

            #Check si un channel est présent en base
            #Si non présent on l'ajoute dans la base et dans une liste
            for channel in channels:
                if isinstance(channel, discord.VoiceChannel) or isinstance(channel, discord.CategoryChannel) or (channel.category and channel.category.name.lower() == "operation"):
                    continue
                
                channelbdd = next((key for key, obj in channelsBdd.items() if obj.discord_id == channel.id), None)
                if channelbdd is None:
                    newchannelsBdd.append(Channel.Channel(channel.name, channel.id))
                    self.bot.add_traces(f'Ajout du channel: {channel.name}')
            
            insert_multiLigne(newchannelsBdd)
            
        except Exception as e:
            Log.PrintError(f"insert_and_get_new_channels - {e}")
            raise
        
        return select_all(Channel.Channel)

#--------------------------------------------------------------------------------------------------------
    def insert_entity(self, entity):
        return insertOrUpdate_data(entity) if not isinstance(entity, list) else insert_multiLigne(entity)

    def select_entity(self, model, conditions, one_result = False):
        return select_by_fields(model, conditions, one_result) if isinstance(conditions, list) else select_by_field(model, conditions, one_result)

    def select_entity_by_id(self, model, id):
        return select_by_id(model, id)
    
    def select_all(self, model):
        return select_all(model)

    def add_traces(self, message: str, user: User.User, parameter = None):
        insertOrUpdate_data(Traces.Traces(user.id, message, parameter))
        Log.PrintLog(message)

    def delete_entity(self, model, conditions):
        return delete_by_fields(model, conditions)

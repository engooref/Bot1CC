import BotManager
from ORM import User, Role

class UserManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot

    def update_user(self, userId: int):
        member = self.bot.guild.get_member(userId)
        
        if member is None:
            raise Exception(f"Membre non trouvé dans le serveur: {self.bot.guild.name}")
        
        role: list[Role.Role] = self.bot.database_manager.insert_and_get_new_roles(member.roles)
        memberbdd: User.User = self.bot.database_manager.insert_and_get_user(member)
        
        if role is None:
            raise Exception(f"Erreur d'implementation des roles")
        if memberbdd is None:
            raise Exception(f"Erreur d'implementation du membre")
    
        memberbdd.rolesDiscord = [
            obj for obj in role.values() 
            if obj.name != '@everyone' 
            and any(rolem.id == obj.discord_id for rolem in member.roles) 
            and not any(roled.discord_id == obj.discord_id for roled in memberbdd.rolesDiscord)
        ]
        memberbdd.username = member.display_name

        memberbdd = self.bot.database_manager.insert_entity(memberbdd)
        
        return {"discordId": memberbdd.discord_id }
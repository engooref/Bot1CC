import BotManager
from ORM import User, RHMember, Role
from Utils import Log

class UserManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot

    async def delete_user(self, user: User.User):
        try:

            Log.PrintLog(f"Suppression des informations de l'utilisateur : {user.username}")        
            await self.bot.database_manager.delete_entity(user.rh_profile)
            user.reset()
            await self.bot.database_manager.insert_entity(user)
            Log.PrintLog(f"Suppression Effectuée")
            
        except Exception as e:
            Log.PrintError(f"Erreur lors de la suppression des infos de l'utilisateur {user.username} -> {e}")
            raise

import BotManager, datetime
from ORM import User, RHMember, ConditionField
from Utils import Log

class UserManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot

    async def delete_user(self, user: User.User):
        try:

            Log.PrintLog(f"Suppression des informations de l'utilisateur : {user.username}")        
            user.reset()
            await self.bot.database_manager.insert_entity(user)
            await self.bot.database_manager.delete_entity(user.rh_profile)

            if not (len(user.traces) or len(user.responses) or len(user.rolesDiscord)):
                await self.bot.database_manager.delete_entity(user)

            Log.PrintLog(f"Suppression Effectuée")
            
        except Exception as e:
            Log.PrintError(f"Erreur lors de la suppression des infos de l'utilisateur {user.username} -> {e}")
            raise


    async def init_member_rh(self, user_discord_id: int, is_new : bool = False):
        
        user = self.bot.guild.get_member(user_discord_id)
        
        user : User.User = await self.bot.database_manager.insert_and_get_user(user)
        
        if not user:
            return None
                         
        memberRH = await self.bot.database_manager.select_entity(RHMember.RHMember, ConditionField('user_id', '==', user.id), True)
        if not memberRH:
            memberRH = RHMember.RHMember(user)

        for role in user.rolesDiscord: 
            if role.is_grade and (role.discord_id != self.bot.role_member.id):
                memberRH.grade = role
                break
        else:
            try:
                memberRH.grade = next(role for role in user.rolesDiscord if self.bot.role_member.id == role.discord_id)
            except:
                memberRH.grade = None
                
        if is_new:
            memberRH.date_entree = datetime.datetime.now()

        await self.bot.database_manager.insert_entity(memberRH)
        return await self.bot.database_manager.select_entity(RHMember.RHMember, ConditionField('user_id', '==', user.id), True)
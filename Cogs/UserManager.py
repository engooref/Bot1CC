import BotManager
from ORM import User, Role

class UserManager:
    def __init__(self, bot):
        self.bot: BotManager.BotManager  = bot

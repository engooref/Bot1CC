import discord
from discord.ext import commands
import BotManager, Utils.Log as Log

class CommandManager(commands.Cog):
    def __init__(self, bot: BotManager.BotManager):
        self.bot = bot


# Fonction obligatoire pour charger le Cog
async def setup(bot):
    await bot.add_cog(CommandManager(bot))
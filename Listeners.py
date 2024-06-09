from discord.ext import commands
import discord
from datetime import datetime

def cmd(msg):
    return f"**{msg}**"

def argImp(msg):
    return f"*{msg}*"

def warning(msg):
    return f"__{msg}__" 


helpGeneralCmd = {cmd("Message") + " " + argImp("mess") : "Permet d'envoyer un message avec le bot"}


class Listeners(commands.Cog, name='Listeners module'):
    def __init__(self, bot):
        self.bot = bot    

        
    @commands.command(pass_context=True)
    async def help(self, ctx):
        """Affiche la liste des commanndes"""
        
        embedHelpGeneralCmd = discord.Embed(
            colour = discord.Colour.orange(),
            title = "Commandes Général",
        )

        embedHelpGeneralCmd.set_author(name="Help", icon_url=self.bot.user.display_avatar)
        embedHelpGeneralCmd.add_field(name=f"Préfixe des commandes : {self.bot.command_prefix}" , value="\n----------------------------------------", inline=False)
        embedHelpGeneralCmd.add_field(name="Code couleur:" , value=cmd("Commande") + " " + argImp("Argument_obligatoire") + "\n----------------------------------------", inline=False)

        for command in self.bot.commands: 
            # Ajout de la méthode 
            embedHelpGeneralCmd.add_field(name=f"{command.name}", value=f"{command.short_doc}" + "\n----------------------------------------", inline=False)

        await ctx.reply(embed=embedHelpGeneralCmd)
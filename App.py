
from time import sleep
import CBot, Listeners, Log
import asyncio, discord, os, threading
from ORM import initialize_sql
from sqlalchemy import create_engine
import Flaskp
import pymysql
pymysql.install_as_MySQLdb()

Log.Start()

class App():
    def __init__(self):
        Log.PrintLog("Lancement de l'App")
        self.threadBot = None
        self.bot = None
        self.loop = asyncio.get_event_loop()
        self.threadFlask = None
        asyncio.run(self.Param())
        
        engine = create_engine(os.getenv('URL_BDD'), echo=(os.getenv('ECHO_SQL') == "True"))
        initialize_sql(engine)

    async def Param(self):
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        
        self.bot = CBot.CBot(intents, os.getenv('GUILD_ID'))
        self.bot.remove_command('help')
        self.threadFlask = Flaskp.ThreadFlask(self.bot)
        self.threadFlask.daemon = True
        await self.bot.add_cog(Listeners.Listeners(self.bot))

    def LaunchBot(self):
        Log.PrintLog("Lancement du Bot")
        self.loop.create_task(self.bot.start(os.getenv("TOKEN"))) 
        self.threadBot = threading.Thread(target=self.loop.run_forever)
        self.threadBot.start()
        self.threadFlask.start()
        while 1:
            pass
    
    async def StopBot(self):
        await self.bot.Stop()
        self.loop.stop()
        self.threadBot.join()
        self.threadFlask.stop()
        Log.PrintLog("Arret du bot")

   
app = App()
app.LaunchBot()




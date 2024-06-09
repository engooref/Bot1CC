
from time import sleep
import CBot, Git, Listeners, Log
import asyncio, discord, os, threading
from ORM import initialize_sql
from sqlalchemy import create_engine
import Flaskp

Log.Start()

class App():
    def __init__(self):
        Log.PrintLog("Lancement de l'App")
        self.threadBot = None
        self.bot = None
        self.loop = asyncio.get_event_loop()
        self.threadGit = Git.ThreadGit()
        self.threadFlask = None
        asyncio.run(self.Param())
        
        engine = create_engine(os.getenv('URL_BDD'), echo=True)
        initialize_sql(engine)

    async def Param(self):
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        
        self.bot = CBot.CBot(intents, os.getenv('GUILD_ID'))
        self.bot.remove_command('help')
        self.threadFlask = Flaskp.ThreadFlask(self.bot)
        await self.bot.add_cog(Listeners.Listeners(self.bot))

    def LaunchBot(self):
        Log.PrintLog("Lancement du Bot")
        self.loop.create_task(self.bot.start(os.getenv("TOKEN"))) 
        self.threadBot = threading.Thread(target=self.loop.run_forever)
        self.threadBot.start()
        self.threadGit.start() 
        self.threadFlask.start()
        self.Run()
    
    async def StopBot(self):
        await self.bot.Stop()
        self.loop.stop()
        self.threadBot.join()
        self.threadFlask.stop()
        Log.PrintLog("Arret du bot")

    def Run(self):     
        while 1:
            if Git.gitUpdateVal:
                asyncio.run_coroutine_threadsafe(coro=self.StopBot(), loop=asyncio.get_event_loop())
                sleep(25)
                self.LaunchBot()
                Git.gitUpdateVal = False

app = App()
app.LaunchBot()




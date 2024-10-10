
from time import sleep
import CBot, Listeners, Log, Flaskp, pymysql
import asyncio, discord, os, threading, requests
from ORM import initialize_sql
from sqlalchemy import create_engine
 
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
            # Nom du fichier de contrôle
        control_file = 'run.lock'

        # Crée le fichier si besoin pour démarrer le processus
        if not os.path.exists(control_file):
            with open(control_file, 'w') as f:
                pass

        Log.PrintLog("Lancement du Bot")
        self.threadBot = threading.Thread(target=self.run_bot)
        self.threadBot.start()
        self.threadFlask.start()
        try:
            while  os.path.exists(control_file):
                sleep(5)   
        finally:
            self.StopBot()

            # Nettoyage si nécessaire, suppression du fichier par exemple.
            if os.path.exists(control_file):
                os.remove(control_file)   

    def run_bot(self):
        """Méthode pour lancer le bot dans une boucle d'événements."""
        self.loop.run_until_complete(self.bot.start(os.getenv("TOKEN")))

    def StopBot(self):
        Log.PrintLog("Arret du bot")
        asyncio.run_coroutine_threadsafe(self.bot.close(), self.loop)
        # Attendre que le thread du bot se termine
        if self.threadBot.is_alive():
            self.threadBot.join()
        requests.post('http://localhost:5000/shutdown', { 'token': self.threadFlask.shutdown_token })
        

app = App()
app.LaunchBot()




from time import sleep
import BotManager, Utils.Log as Log, Quart, pymysql
import asyncio, discord, os
from ORM import initialize_sql
from Cogs import CommandManager
import signal
import sys

 
pymysql.install_as_MySQLdb()

Log.Start()

class App():
    def __init__(self):
        Log.PrintLog("Lancement de l'App")
        self.bot = None
        self.quart_app = None
        self.control_file = 'run.lock'
        # Lancer l'initialisation asynchrone
        asyncio.run(self.Param())


    async def Param(self):
        """Initialisation des composants asynchrones : bot et serveur Quart"""
        

        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True
        intents.messages = True  # Activer la gestion des messages
        intents.dm_messages = True  # Activer la gestion des messages privés (DM)

        # Créer et configurer le bot Discord
        self.bot = BotManager.BotManager(intents, os.getenv('GUILD_ID'))
        self.bot.remove_command('help')
        await self.bot.load_extension('Cogs.CommandManager')

        # Créer et configurer le serveur Quart
        self.quart_app = Quart.AppQuart(self.bot)

    async def LaunchBot(self):
        try:
            # Nom du fichier de contrôle
            

            # Crée le fichier si besoin pour démarrer le processus
            if not os.path.exists(self.control_file):
                with open(self.control_file, 'w') as f:
                    pass

            Log.PrintLog("Lancement SQLAlchemy et BDD")
        
            await initialize_sql()
            
            """Démarrer l'application avec Quart et le bot Discord"""
            Log.PrintLog("Lancement du bot Discord et du serveur Quart")

            # Tâche pour démarrer le bot
            bot_task = self.bot.start(os.getenv("TOKEN"))

            # Tâche pour démarrer Quart
            quart_task = self.quart_app.start()

            asyncio.create_task(bot_task)
            asyncio.create_task(quart_task)

            try:
                while  os.path.exists(self.control_file):
                    await asyncio.sleep(5)   
            finally:
                await self.shutdown()

        except KeyboardInterrupt:
            Log.PrintLog("Arrêt du bot et du serveur Quart")
            asyncio.run(self.shutdown())   

        finally:
            # Nettoyage si nécessaire, suppression du fichier par exemple.
            if os.path.exists(self.control_file):
                os.remove(self.control_file)


    async def shutdown(self):
        """Arrêter proprement l'application"""
        Log.PrintLog("Arrêt de l'application")
        if os.path.exists(self.control_file):
            os.remove(self.control_file)
        
        sys.exit(0)
        await self.bot.close()  # Arrête le bot Discord
        await self.quart_app.shutdown()  # Arrête le serveur Quart




app = None
try:
    app = App()
    # Capturer SIGTERM et SIGINT (arrêt par Supervisor)
    signal.signal(signal.SIGTERM, app.shutdown)
    signal.signal(signal.SIGINT, app.shutdown)
    asyncio.run(app.LaunchBot())
except Exception as e:
    Log.PrintError(e)
        



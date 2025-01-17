from time import sleep
import BotManager, Utils.Log as Log, Quart, pymysql
import asyncio, discord, os
from ORM import initialize_sql
from sqlalchemy import create_engine
from Commands import TicketsCommands
 
pymysql.install_as_MySQLdb()

Log.Start()

class App():
    def __init__(self):
        Log.PrintLog("Lancement de l'App")
        self.bot = None
        self.quart_app = None
        
        Log.PrintLog("Lancement SQLAlchemy et BDD")
        engine = create_engine(os.getenv('URL_BDD'), 
                                echo=(os.getenv('ECHO_SQL') == "True"),
                                pool_pre_ping=True,
                                pool_size=10,          
                                max_overflow=20,       
                                pool_recycle=3600
                                )
        initialize_sql(engine)

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
        await self.bot.load_extension('Commands.TicketsCommands')
  

        # Créer et configurer le serveur Quart
        self.quart_app = Quart.AppQuart(self.bot)

    async def LaunchBot(self):
        try:
            # Nom du fichier de contrôle
            control_file = 'run.lock'

            # Crée le fichier si besoin pour démarrer le processus
            if not os.path.exists(control_file):
                with open(control_file, 'w') as f:
                    pass

            """Démarrer l'application avec Quart et le bot Discord"""
            Log.PrintLog("Lancement du bot Discord et du serveur Quart")

            # Tâche pour démarrer le bot
            bot_task = self.bot.start(os.getenv("TOKEN"))

            # Tâche pour démarrer Quart
            quart_task = self.quart_app.start()

            asyncio.create_task(bot_task)
            asyncio.create_task(quart_task)

            try:
                while  os.path.exists(control_file):
                    await asyncio.sleep(5)   
            finally:
                await self.shutdown()

        except KeyboardInterrupt:
            Log.PrintLog("Arrêt du bot et du serveur Quart")
            asyncio.run(self.shutdown())   

        finally:
            # Nettoyage si nécessaire, suppression du fichier par exemple.
            if os.path.exists(control_file):
                os.remove(control_file)


    async def shutdown(self):
        """Arrêter proprement l'application"""
        Log.PrintLog("Arrêt de l'application")
        await self.bot.close()  # Arrête le bot Discord
        await self.quart_app.shutdown()  # Arrête le serveur Quart

app = None
try:
    app = App()
    asyncio.run(app.LaunchBot())
except Exception as e:
    Log.PrintError(e)
        



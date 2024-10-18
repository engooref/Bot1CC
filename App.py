from time import sleep
import CBot, Listeners, Log, Flaskp, pymysql
import asyncio, discord, os
from ORM import initialize_sql
from sqlalchemy import create_engine
 
pymysql.install_as_MySQLdb()

Log.Start()

class App():
    def __init__(self):
        Log.PrintLog("Lancement de l'App")
        self.bot = None
        self.quart_app = None
        self.loop = asyncio.get_event_loop()
        
        engine = create_engine(os.getenv('URL_BDD'), echo=(os.getenv('ECHO_SQL') == "True"), pool_pre_ping=True)
        initialize_sql(engine)

        # Lancer l'initialisation asynchrone
        asyncio.run(self.Param())

    async def Param(self):
        """Initialisation des composants asynchrones : bot et serveur Quart"""
        intents = discord.Intents.default()
        intents.members = True
        intents.message_content = True

        # Créer et configurer le bot Discord
        self.bot = CBot.CBot(intents, os.getenv('GUILD_ID'))
        self.bot.remove_command('help')

        # Créer et configurer le serveur Quart
        self.quart_app = Flaskp.AppQuart(self.bot)

        # Ajoute les cogs au bot (Listeners)
        await self.bot.add_cog(Listeners.Listeners(self.bot))
    
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
            flask_task = self.quart_app.start()

            asyncio.create_task(bot_task)
            asyncio.create_task(flask_task)

            try:
                while  os.path.exists(control_file):
                    await asyncio.sleep(5)   
            finally:
                await self.shutdown()

                # Nettoyage si nécessaire, suppression du fichier par exemple.
                if os.path.exists(control_file):
                    os.remove(control_file)

        except KeyboardInterrupt:
            Log.PrintLog("Arrêt du bot et du serveur Quart")
            asyncio.run(self.shutdown())   

    def run_bot(self):
        """Méthode pour lancer le bot dans une boucle d'événements."""
        self.loop.run_until_complete(self.bot.start(os.getenv("TOKEN")))

    async def shutdown(self):
        """Arrêter proprement l'application"""
        Log.PrintLog("Arrêt de l'application")
        await self.bot.close()  # Arrête le bot Discord
        await self.quart_app.shutdown()  # Arrête le serveur Quart

app = App()
asyncio.run(app.LaunchBot())




from quart import Quart, request, jsonify
import asyncio
import Utils.Log as Log
import BotManager
from ORM import Event, User

class AppQuart:
    def __init__(self, bot : BotManager.BotManager):
        """Initialisation de l'application Quart et définition des routes."""
        self.app = Quart(__name__)
        self.bot: BotManager.BotManager = bot
        self.shutdown_token = "2165194652162198460321985"
        self.setup_routes()

    def setup_routes(self):
        """Définir toutes les routes de l'application Quart ici."""
        
        @self.app.route('/<path:path>', methods=['POST', 'GET'])
        async def handle_request(path):
            """Gestionnaire centralisé pour les différentes routes de l'application."""
            try:
                data = list()
                if request.method == 'POST':
                    data = await request.json

                if "ping" not in path:
                    Log.PrintLog(f"URL demandée: {path} - Data : {data}")
                
                event: Event.Event = None
                if 'eventId' in data:
                    event = self.bot.database_manager.select_entity_by_id(Event.Event, data["eventId"])
                    if event is None:
                        raise Exception(f"Event avec l'id {data["eventId"]} n'existe pas")

                search: str = ''
                if 'search' in data:
                    search = data['search']

                token: str = ''
                if 'token' in data:
                    token = data['token']

                result = None
                if path == 'setEvent':
                    await self.bot.event_manager.set_event(event)             
                elif path == 'updateParam' and request.method == 'GET':
                    self.bot.update_param()
                elif path == 'suppEvent':
                    await self.bot.event_manager.supp_event(event)                 
                elif path == 'searchUserAttribution':
                    result = self.bot.event_manager.search_user_attribution(search)   
                elif path == 'setAttributionEvent':
                    await self.bot.event_manager.attribution_event(event)    
                elif path == 'shutdown':
                    if token == self.shutdown_token:
                        Log.PrintLog("Arrêt du serveur Quart demandé")
                        shutdown_event = asyncio.get_event_loop().create_future()
                        shutdown_event.set_result(True)
                        return jsonify({"message": "Le serveur s'arrête."}), 200
                    else:
                        return jsonify({"error": "Token incorrect."}), 403
                elif path == 'ping':
                    return jsonify({}), 200
                else:
                    return jsonify({"error": "Route non reconnue"}), 404

                
                return jsonify(result if result is not None else {}), 200
            
            except Exception as e:
                Log.PrintError(e)
                return jsonify({"error": str(e)}), 400

            finally:
                if event is not None:
                    self.bot.database_manager.insert_entity(event)
            

    async def start(self):
        """Démarrer le serveur Quart."""
        Log.PrintLog("Démarrage du serveur Quart")
        await self.app.run_task(host='0.0.0.0', port=5000)

    async def shutdown(self):
        """Arrêter le serveur Quart."""
        Log.PrintLog("Arrêt du serveur Quart")
        shutdown_event = asyncio.get_event_loop().create_future()
        shutdown_event.set_result(True)

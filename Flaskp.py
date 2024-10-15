from quart import Quart, request, jsonify
import asyncio
import Log
import CBot
import traceback

class AppQuart:
    def __init__(self, bot : CBot.CBot):
        """Initialisation de l'application Quart et définition des routes."""
        self.app = Quart(__name__)
        self.bot = bot
        self.shutdown_token = "2165194652162198460321985"
        self.setup_routes()

    def setup_routes(self):
        """Définir toutes les routes de l'application Quart ici."""
        
        @self.app.route('/<path:path>', methods=['POST', 'GET'])
        async def handle_request(path):
            """Gestionnaire centralisé pour les différentes routes de l'application."""
            try:
                if request.method == 'POST':
                    data = await request.json
                else:
                    data = None
                Log.PrintLog(f"URL demandée: {path} - Data : {data}")
                
                if path == 'updateUser':
                    user_id = int(data.get('userId'))
                    result = self.bot.AddUserFlask(user_id)
                    return jsonify(result), 200

                elif path == 'setEvent':
                    event_id = data.get('eventId')
                    result =  self.bot.setEvent(event_id)
                    return jsonify(result), 200

                elif path == 'updateParam' and request.method == 'GET':
                    result = self.bot.UpdateParamFlask()
                    return jsonify(result), 200

                elif path == 'suppEvent':
                    event_id = data.get('eventId')
                    result = self.bot.suppEvent(event_id)
                    return jsonify(result), 200

                elif path == 'searchUserAttribution':
                    search = data.get('search')
                    result = self.bot.searchUserAttribution(search)
                    return jsonify(result), 200

                elif path == 'setAttributionEvent':
                    event_id = data.get('eventId')
                    result = self.bot.setAttributionEvent(event_id)
                    return jsonify(result), 200

                elif path == 'shutdown':
                    token = data.get('token')
                    if token == self.shutdown_token:
                        Log.PrintLog("Arrêt du serveur Quart demandé")
                        shutdown_event = asyncio.get_event_loop().create_future()
                        shutdown_event.set_result(True)
                        return jsonify({"message": "Le serveur s'arrête."}), 200
                    else:
                        return jsonify({"error": "Token incorrect."}), 403

                else:
                    return jsonify({"error": "Route non reconnue"}), 404

            except Exception as e:
                Log.PrintLog(e)
                traceback.print_exc()
                return jsonify({"error": str(e)}), 400

    async def start(self):
        """Démarrer le serveur Quart."""
        Log.PrintLog("Démarrage du serveur Quart")
        await self.app.run_task(host='0.0.0.0', port=5000)

    async def shutdown(self):
        """Arrêter le serveur Quart."""
        Log.PrintLog("Arrêt du serveur Quart")
        shutdown_event = asyncio.get_event_loop().create_future()
        shutdown_event.set_result(True)



    

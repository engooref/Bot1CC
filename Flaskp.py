from flask import Flask, request, jsonify
import threading, Log, CBot

app = Flask(__name__)

class ThreadFlask(threading.Thread):
    def __init__(self, bot : CBot):
        threading.Thread.__init__(self)
        self.app = Flask(__name__)

        self.shutdown_token = "2165194652162198460321985"
        self.app.add_url_rule('/updateUser', view_func=self.handleRequest, methods=['POST'])
        self.app.add_url_rule('/setEvent', view_func=self.handleRequest, methods=['POST'])
        self.app.add_url_rule('/updateParam', view_func=self.handleRequest, methods=['GET'])
        self.app.add_url_rule('/suppEvent', view_func=self.handleRequest, methods=['POST'])
        self.app.add_url_rule('/searchUserAttribution', view_func=self.handleRequest, methods=['GET'])
        self.app.add_url_rule('/setAttributionEvent', view_func=self.handleRequest, methods=['POST'])
        self.app.add_url_rule('/shutdown', view_func=self.shutdown, methods=['POST'])

        self.bot : CBot.CBot = bot

    def run(self):
        Log.PrintLog("Lancement Thread Flask")
        self.app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
    
    def shutdown(self):
        """Arrête le serveur uniquement si le token est correct."""
        token = request.json.get('token')
        if token == self.shutdown_token:
            func = request.environ.get('werkzeug.server.shutdown')
            if func is not None:
                func()
            return jsonify({"message": "Le serveur s'arrête."}), 200
        else:
            return jsonify({"error": "Token incorrect."}), 403

    def handleRequest(self):
        try:
            # Récupérer l'URL appelée
            path = request.path
            data = request.json if request.method == 'POST' else request.args

            Log.PrintLog('Url Demandé :' + path + ' Data : ' + data)
            
            # Gérer les différentes routes
            if path == '/updateUser':
                return jsonify(self.bot.AddUserFlask(int(data['userId'])))
            
            elif path == '/updateParam':
                return jsonify(self.bot.UpdateParamFlask())
            
            elif path == '/setEvent':
                return jsonify(self.bot.setEvent(data['eventId']))
            
            elif path == '/suppEvent':
                return jsonify(self.bot.suppEvent(data['eventId']))
            
            elif path == '/searchUserAttribution':
                return jsonify(self.bot.searchUserAttribution(data['search']))
            
            elif path == '/setAttributionEvent':
                return jsonify(self.bot.setAttributionEvent(data['eventId']))
            
            else:
                return jsonify({"error": "Route non reconnue"}), 404

        except Exception as e:
            Log.PrintLog(e)
            return jsonify({"error": str(e)}), 400
    

    
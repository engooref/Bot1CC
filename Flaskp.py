from flask import Flask, request, jsonify
import threading 
import Log
import CBot
import asyncio

app = Flask(__name__)

class ThreadFlask(threading.Thread):
    def __init__(self, bot : CBot):
        threading.Thread.__init__(self)
        self.app = Flask(__name__)
        self.app.add_url_rule('/updateUser', view_func=self.addUser, methods=['POST'])
        self.app.add_url_rule('/setEvent', view_func=self.setEvent, methods=['POST'])
        self.bot = bot

    def run(self):
        Log.PrintLog("Lancement Thread Flask")
        self.app.run(port=5000)
    
    def addUser(self):
        try:
            data = request.json
            return jsonify(self.bot.AddUserFlask(int(data['userId']))), 200
             
        except Exception as e:
            Log.PrintLog(e)
            return jsonify({"erreur" : e}), 400
        
    def setEvent(self):
        try:
            data = request.json
            self.bot.setEvent(data['eventId'])
           
            return jsonify({}), 200
             
        except Exception as e:
            Log.PrintLog(e)
            return jsonify({"erreur" : e}), 400
    

    
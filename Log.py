from datetime import datetime
from discord.ext import tasks
import os
# Chemin absolu du fichier en cours d'exécution
current_file = os.path.abspath(__file__)

# Dossier contenant le fichier
current_dir = os.path.dirname(current_file)

dirLog = current_dir + "/Log"
nbLogFile = 5
nameFile = f'{dirLog}/Log'


def Start():
    if not os.path.exists(dirLog):
        os.makedirs(dirLog)
        
    with open(nameFile, 'a') as f:
            f.write(f"\n---------------------------------------------------\n\n")   


def PrintLog(strLog):
    print(strLog)
    global nameFile
    with open(nameFile, 'a') as f:
        f.write(f"{datetime.now()} - {strLog} \n")




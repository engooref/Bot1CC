from datetime import datetime
from discord.ext import tasks
import os

dirLog = "./Log"
nbLogFile = 5
nameFile = f'{dirLog}/Log_{str(datetime.now().date())}'


def Start():
    with open(nameFile, 'a') as f:
            f.write(f"\n---------------------------------------------------\n\n")   


def PrintLog(strLog):
    print(strLog)
    global nameFile
    with open(nameFile, 'a') as f:
        f.write(f"{datetime.now()} - {strLog} \n")




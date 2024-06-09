import threading 
from time import sleep
import git, Log

gitUpdateVal = False

class ThreadGit(threading.Thread):
    def __init__(self):
        threading.Thread.__init__(self)
        self.repo = git.Repo('./.git')
        self.indicChange = '  (use "git pull" to update your local branch)'

    def run(self):
        Log.PrintLog("Lancement Thread Git")
        try:
            while 1:
                if self._DetectUpdate():
                    self._UpdateFromGit()
                    global gitUpdateVal
                    gitUpdateVal = True
                sleep(30)
        except Exception as e:
            Log.PrintLog(str(e))
    

    def _UpdateFromGit(self):
        Log.PrintLog("Mise à jour de l'Application")
        self.repo.git.pull()

    def _DetectUpdate(self):
        status = self.repo.git.status
        listStatus = status().split("\n")
        return self.indicChange in listStatus
        
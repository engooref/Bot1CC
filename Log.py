from datetime import datetime, timedelta
import os, zipfile, threading

# Chemin absolu du fichier en cours d'exécution
current_file = os.path.abspath(__file__)

# Dossier contenant le fichier
current_dir = os.path.dirname(current_file)

# Dossier où seront stockés les logs
dirLog = os.path.join(current_dir, "Log")

# Dossier où seront stockées les archives
dirArchive = os.path.join(dirLog, "Log_Archives")

# Nombre de fichiers de log à conserver avant archivage
nbLogFile = 15

is_thread_archivage_running = False 
# Fonction pour archiver les anciens fichiers de log et les compresser dans un fichier zip
def archive_old_logs():
    global is_thread_archivage_running 
    is_thread_archivage_running = True
    log_files = sorted([f for f in os.listdir(dirLog) if f.startswith('Log_')], reverse=True)
    if len(log_files) > nbLogFile:
        old_files = log_files[nbLogFile:]

        # Crée le dossier d'archive s'il n'existe pas
        if not os.path.exists(dirArchive):
            os.makedirs(dirArchive)

        # Nom de l'archive avec la date d'archivage
        archive_name = os.path.join(dirArchive, f'archive_logs_{datetime.now().strftime("%Y-%m-%d_%H-%M-%S")}.zip')

        # Compresser les anciens logs dans un fichier zip
        with zipfile.ZipFile(archive_name, 'w', zipfile.ZIP_DEFLATED) as archive:
            for old_file in old_files:
                file_path = os.path.join(dirLog, old_file)
                archive.write(file_path, old_file)
                os.remove(file_path)  # Supprimer le fichier après l'avoir ajouté à l'archive
        print(f"Logs archivés dans {archive_name}")
    is_thread_archivage_running = True

# Création d'un thread pour exécuter la fonction archive_old_logs
archiving_thread = threading.Thread(target=archive_old_logs)

# Fonction pour obtenir le nom du fichier de log basé sur la date
def get_log_filename():
    date_str = datetime.now().strftime('%Y-%m-%d')
    return os.path.join(dirLog, f'Log_{date_str}.txt')

def Start():
    if not os.path.exists(dirLog):
        os.makedirs(dirLog)
    
    with open(get_log_filename(), 'a') as f:
        f.write(f"\n---------------------------------------------------\n\n")

def PrintLog(strLog):
    # Démarrer le thread
    global is_thread_archivage_running
    if not is_thread_archivage_running:
        archiving_thread.start()

    print(strLog)
    with open(get_log_filename(), 'a') as f:
        f.write(f"{datetime.now()} - {strLog} \n")


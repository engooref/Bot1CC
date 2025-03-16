import discord
from discord import app_commands
import yt_dlp
import asyncio
import multiprocessing
import os, json
from typing import Literal
from gtts import gTTS
import traceback
from Utils.SharedPriorityQueue import SharedPriorityQueue
from Utils import Log

def blocking_get(q):
    return q.get()

async def async_get(q, loop):
    # Exécute blocking_get dans un thread séparé et rend l'appel awaitable
    return await loop.run_in_executor(None, blocking_get, q)

async def handle_commands(queue, voice_client, process_id, channel_id, client, shared_dict):
    """Tâche asynchrone qui écoute les commandes en priorité et les exécute."""
    loop = asyncio.get_running_loop()
    current_source = None  # Pour stocker le fichier/stream en cours
    url = None
    while True:
        # Récupère un élément prioritaire dans la queue
        priority_item = await async_get(queue, loop)
        priority, (command, data) = priority_item
        Log.PrintLog(f"{process_id} : [📩] Commande reçue (priorité {priority}) : {command}")

        if command == "play":
            if data:
                # Si data est fourni, on démarre la lecture d'un nouveau fichier audio
                Log.PrintLog(f"{process_id} : Lecture du fichier ({data})")
                current_source = url if url else data  # Met à jour l'élément en cours
                source = discord.FFmpegPCMAudio(data)
                voice_client.play(source)
            else:
                # Si data est None, on considère que c'est une demande de reprise
                if voice_client.is_paused():
                    Log.PrintLog(f"{process_id} : Reprise de la lecture")
                    voice_client.resume()
                else:
                    Log.PrintLog(f"{process_id} : Rien à reprendre")
        
        elif command == "stop":
            # La commande stop (priorité élevée) met en pause la lecture
            Log.PrintLog(f"{process_id} : Pause de la lecture")
            if voice_client.is_playing():
                voice_client.pause()
                
        
        elif command == "disconnect":
            Log.PrintLog(f"{process_id} : Déconnexion du canal ({channel_id})")
            await voice_client.disconnect()
            # Ici, on peut décider de fermer le client si besoin, par exemple :
            await client.close()
            break  # Sort de la boucle pour terminer le traitement

        elif command == "status":
            # Optionnel : envoyer le status actuel (par exemple, current_source et état de voice_client)
            status = f"Actuellement en lecture : {current_source}" if current_source and voice_client.is_playing() else "Aucune lecture en cours."
            Log.PrintLog(f"{process_id} : Status -> {status}")
            shared_dict['status'] = status
            # Ici, on pourrait éventuellement stocker ce status pour le renvoyer via une autre commande

def voice_worker(guild_id, channel_id, token, queue, shared_dict):
    """Processus gérant une connexion vocale indépendante."""
    
    intents = discord.Intents.none()
    intents.voice_states = True
    intents.guilds = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready():
        Log.PrintLog(f"[✅] Processus vocal actif")

        try:
            process_id = multiprocessing.current_process().pid
            Log.PrintLog(f"{process_id} : [✅] Processus vocal actif pour {guild_id} sur {channel_id}")

            guild = client.get_guild(guild_id)
            channel = guild.get_channel(channel_id)

            if not channel:
                Log.PrintLog(f"{process_id} : [❌] Canal introuvable ({channel_id}) !")
                return

            voice_client = await channel.connect()
            Log.PrintLog(f"{process_id} : [🔊] Connecté à {channel.name}")

            # Lancer l'écoute des commandes en tâche parallèle
            asyncio.create_task(handle_commands(queue, voice_client, process_id, channel_id, client, shared_dict))
        except Exception as e:
            Log.PrintError(f"Erreur -> {e}")

    client.run(token)


class VoiceManager(app_commands.Group):
    """Commande slash unique pour gérer la lecture audio."""

    def __init__(self, name: str, bot):
        super().__init__(name=name)
        self.bot = bot
        with open("./Config/token_slave.json", "r", encoding="utf-8") as file:
                token_list = json.load(file)
        self.available_tokens = multiprocessing.Manager().list(token_list)
        self.manager = multiprocessing.Manager()
        self.shared_dict = self.manager.dict()
        self.shared_dict['statut'] = None
        
    async def is_admin(interaction: discord.Interaction) -> bool:
        """Vérifie si l'utilisateur est administrateur."""
        return interaction.user.guild_permissions.administrator

    @app_commands.command(name="send_voice", description="Gère la lecture audio (ajout, suppression, lecture, arrêt, connexion globale).")
    @app_commands.check(is_admin)
    @app_commands.describe(
        action="Action à exécuter : add, remove, list, play, stop, clear, connect_all, disconnect_all",
        text="Texte à convertir en audio (si action=add)",
        index="Index de l'élément à supprimer (si action=remove)"
    )
    async def send_voice(self, interaction: discord.Interaction, 
                         action: Literal["add", "remove", "list", "play", "stop", "clear", "connect_all", "disconnect_all"], 
                         text: str = None, 
                         index: int = None,
                         attachment: discord.Attachment = None):
        """Commande pour gérer les actions vocales du bot."""
        try:
            guild = interaction.guild
            await interaction.response.defer(ephemeral=True)
            # Action pour connecter le bot à tous les salons vocaux avec au moins un membre non-bot
            if action == "connect_all":
                connected_channels = []

                for channel in guild.voice_channels:
                    if channel.id in self.bot.voice_processes:
                        continue  # Ignorer si déjà connecté
                    
                    if any(not member.bot for member in channel.members):
                        if not self.available_tokens:
                            if not self.bot.voice_processes:
                                await interaction.followup.send("❌ Plus aucun bot esclave disponible.", ephemeral=True)
                            else:
                                await interaction.followup.send("✅ Connecté aux salons vocaux : " + ", ".join(connected_channels), ephemeral=True)
                            return
                        
                        # Prendre un bot esclave disponible
                        token = self.available_tokens.pop(0)
                        queue = SharedPriorityQueue(self.manager)  # Utilisation d'une asyncio.Queue()
                        process = multiprocessing.Process(target=voice_worker, args=(guild.id, channel.id, token, queue, self.shared_dict))
                        process.start()
                        self.bot.voice_processes[channel.id] = (process, queue, token)  # Stocker aussi le token
                        connected_channels.append(channel.name)

                if connected_channels:
                    await interaction.followup.send("✅ Connecté aux salons vocaux : " + ", ".join(connected_channels), ephemeral=True)
                else:
                    await interaction.followup.send("Aucun salon vocal à connecter.", ephemeral=True)
                return

            elif action == "disconnect_all":
                try:
                    for channel_id, (process, queue, token) in list(self.bot.voice_processes.items()):
                        print(process)
                        queue.put((0, ("disconnect", None)))
                        
                        del self.bot.voice_processes[channel_id]

                        # Libérer le token
                        self.available_tokens.append(token)

                    await interaction.followup.send("✅ Déconnecté de tous les salons vocaux.", ephemeral=True)
                except Exception as e:
                    Log.PrintError(traceback.format_exc())
                    await interaction.followup.send(f"❌ Erreur lors de la déconnexion : {e}", ephemeral=True)
                return
            
            # Pour les autres actions, on part du principe que l'utilisateur est dans un salon vocal
            if not interaction.user.voice or not interaction.user.voice.channel:
                await interaction.followup.send("⚠️ Vous devez être connecté à un canal vocal.", ephemeral=True)
                return

           # Pour les autres actions, on diffuse la commande à tous les bots esclaves connectés
            if action == "add":
                # Priorité : si un fichier est attaché, on le prend en charge en priorité.
                if attachment is not None:
                    # On télécharge le fichier temporairement
                    file_extension = attachment.filename.split('.')[-1]
                    temp_filename = f"temp_{attachment.filename}"
                    
                    if file_extension == 'txt':
                        temp_filename = f"temp_{attachment.filename.split('.')[0]}.mp3"
                        content_bytes = await attachment.read()
                        content = content_bytes.decode('utf-8')
                        tts = gTTS(text=content, lang="fr")
                        tts.save(temp_filename)
                    else:
                        await attachment.save(fp=temp_filename)

                    for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                        queue.put((2, ("play", temp_filename)))
                elif text:
                    filename = f"tts_{len(self.bot.voice_processes)}.mp3"
                    tts = gTTS(text=text, lang="fr")
                    tts.save(filename)
                    for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                        queue.put((2, ("play", filename)))
                else:
                    await interaction.followup.send("❌ Spécifiez un texte ou un fichier ", ephemeral=True)
                    return
                await interaction.followup.send("✅ Commande 'add' diffusée à tous les bots.", ephemeral=True)

            elif action == "list":
                # Pour lister, on va créer un résumé des files d'attente de chaque salon
                summary = []
                for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                    count = queue.qsize()
                    self.shared_dict['status'] = None
                    queue.put((0, ('status', None)))
                    while not self.shared_dict['status']:
                        pass
                    summary.append(f"Salon {chan_id} : {self.shared_dict['status']} -> {count} élément(s)")
                    
                if summary:
                    await interaction.followup.send("📜 File d'attente :\n" + "\n".join(summary), ephemeral=True)
                else:
                    await interaction.followup.send("📜 Aucune file d'attente active.", ephemeral=True)

            elif action == "play":
                for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                    queue.put((2, ("play", None)))
                await interaction.followup.send("🎵 Commande 'play' diffusée à tous les bots.", ephemeral=True)

            elif action == "stop":
                for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                    queue.put((1, ("stop", None)))
                await interaction.followup.send("⏹️ Commande 'stop' diffusée à tous les bots.", ephemeral=True)

            elif action == "clear":
                for chan_id, (process, queue, token) in self.bot.voice_processes.items():
                    while not queue.empty():
                        queue.get()
                await interaction.followup.send("🗑️ Files d'attente vidées pour tous les bots.", ephemeral=True)

            else:
                await interaction.followup.send("❌ Action invalide.", ephemeral=True)

        except Exception as e:
            await interaction.followup.send(f"❌ Erreur : {e}", ephemeral=True)

# Fonction obligatoire pour charger le Cog
async def setup(bot):
    bot.tree.add_command(VoiceManager(name="voice", bot=bot))



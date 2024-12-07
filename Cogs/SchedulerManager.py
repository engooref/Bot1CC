# SchedulerManager.py
import schedule, asyncio, os, datetime, BotManager
from Utils import Log
from datetime import datetime, timedelta
from ORM import Event, ConditionField, Response

JourName = [
    'lundi',
    'mardi',
    'mercredi',
    'jeudi',
    'vendredi',
    'samedi',
    'dimanche'
]

class SchedulerManager:
    def __init__(self, bot):
        self.scheduler_weekly:  SchedulerManager.SchedulerWeekly = SchedulerManager.SchedulerWeekly(bot)
        self.scheduler_today:   SchedulerManager.SchedulerToday = SchedulerManager.SchedulerToday(bot)


    class SchedulerWeekly:
        def __init__(self, bot):
            self.bot: BotManager.BotManager = bot
            self.start_scheduler()
            Log.PrintLog(f"Création de schedule pour envoyer les events automatiquement: Date -> {JourName[int(os.getenv('DAY_EVENT'))]} Heure -> {os.getenv('HOURS_EVENT')}")


        def start_scheduler(self):
            schedule.every().day.at(os.getenv('HOURS_EVENT')).do(self.check_date)
            schedule.every().day.at('03:00').do(self.bot.star_citizen_manager.insert_and_get_locations_sc)
            
        def check_date(self):
            #Check si la date est celle configuré
            currentDate = datetime.now().strftime('%A').lower() 
            jourParam = JourName[int(os.getenv('DAY_EVENT'))]
            if currentDate == jourParam:
                asyncio.create_task(self.send_event_week())
                
        async def run_scheduler(self):
            while True:
                schedule.run_pending()
                await asyncio.sleep(1)

        def reset_scheduler(self):
            schedule.clear()
            self.start_scheduler()

        async def send_event_week(self):
            try:
                Log.PrintLog("Envoie des Appels Event")
                today = datetime.now().date()
                one_week_later = today + timedelta(weeks=1)
                conditionList = [ConditionField("start", "between", (today, one_week_later))]
                events: list[Event.Event] = self.bot.database_manager.select_entity(Event.Event, conditionList)
                for event in events:
                    await self.bot.event_manager.set_event(event)
            except Exception as e:
                Log.PrintError(f"send_event_week - {e}")
 

    class SchedulerToday:
        def __init__(self, bot):
            self.bot: BotManager.BotManager = bot
            self.scheduled_tasks = {}

        async def check_events(self):
            # Code pour vérifier les événements
            while True:                
                # Récupérer les événements du jour
                today_events = self.get_events_for_today()

                for event in today_events:
                    time_until_event = event.start - datetime.now()
                    
                    # Si l'événement est dans moins de 15 minutes
                    if time_until_event > timedelta(minutes=0) and time_until_event <= timedelta(minutes=15):
                        await self.send_event_reminder(event)
                    else:
                        # Planifie le rappel 15 minutes avant l'événement
                        await self.schedule_event_reminder(event)

                # Attendre 60 secondes avant de vérifier à nouveau
                await asyncio.sleep(60)
                

        def get_events_for_today(self):
            # Code pour obtenir les événements d'aujourd'hui
            now = datetime.now()
            today_start = datetime(now.year, now.month, now.day)
            today_end = today_start + timedelta(days=1)

            # Remplacer cela par une requête à la base de données
            events = self.bot.database_manager.select_entity(Event.Event, ConditionField('start', 'between', (today_start, today_end)))
            return events
        
        async def schedule_event_reminder(self, event: Event.Event):
            # Planifier un rappel d'événement
            now = datetime.now()
            time_until_reminder = event.start - timedelta(minutes=15) - now

            # Si le rappel est dans le passé, ne rien faire
            if time_until_reminder.total_seconds() <= 0 or event.start > now + timedelta(days=1):
                return

            if event.id in self.scheduled_tasks:
                return

            # Créer une nouvelle tâche pour le rappel
            task = asyncio.create_task(self._wait_and_remind(event, time_until_reminder))
            self.scheduled_tasks[event.id] = task

        async def _wait_and_remind(self, event: Event.Event, delay: timedelta):
            try:
                # Attendre jusqu'à 15 minutes avant l'événement
                await asyncio.sleep(delay.total_seconds())

                # Envoyer le rappel si l'événement est encore valide
                if self.is_event_valid(event):
                    await self.send_event_reminder(event)
            except asyncio.CancelledError:
                pass

        def cancel_event_reminder(self, event: Event.Event):
            if event.id in self.scheduled_tasks:
                # Annuler la tâche programmée
                self.scheduled_tasks[event.id].cancel()
                del self.scheduled_tasks[event.id]

            event.appel_msg_discord = False

        def is_event_valid(self, event: Event.Event):
            # Vérifie si l'événement existe toujours et est prévu pour aujourd'hui
            now = datetime.now()
            return event.start > now and event.id in [e.id for e in self.get_events_for_today()]
        
        async def send_event_reminder(self, event: Event.Event):
            channel = self.bot.event_manager.get_channel(event)

            if(event.discord_id != None and not event.appel_msg_discord):
                message = await channel.fetch_message(event.discord_id)
                if message is not None:
                    lFields = [
                        ConditionField("type_rep", "==", 'accepted'),
                        ConditionField("event_id", "==", event.id)
                    ]

                    responses = self.bot.database_manager.select_entity(Response.Response, lFields)
                    msgStr = event.name + "\n\n"
                    for response in responses:
                        user = self.bot.guild.get_member(response.user.discord_id)
                        if user is not None:
                            msgStr += user.mention + " " 
                    
                    try:
                        await message.reply(msgStr)
                        event.appel_msg_discord = True
                    finally:
                        self.bot.database_manager.insert_entity(event)
            
        def update_event(self, event: Event.Event):
            # Annule le rappel existant
            self.cancel_event_reminder(event)

            time_until_event = event.start - datetime.now()
                    
            # Si l'événement est dans moins de 15 minutes
            if time_until_event > timedelta(minutes=0) and time_until_event <= timedelta(minutes=15):
                asyncio.create_task(self.send_event_reminder(event))
            else:
                # Planifie le rappel 15 minutes avant l'événement
                asyncio.create_task(self.schedule_event_reminder(event))

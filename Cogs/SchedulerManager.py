# SchedulerManager.py
import schedule, asyncio, os
from datetime import datetime, timedelta
from Utils import Log
from ORM import Event, ConditionField, Response
from View.OperationView import category_name
import discord

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
        self.scheduler_appEvent: SchedulerManager.SchedulerAppEvent = SchedulerManager.SchedulerAppEvent(bot)
        self.scheduler_event: SchedulerManager.SchedulerEvent = SchedulerManager.SchedulerEvent(bot)

    class SchedulerAppEvent:
        def __init__(self, bot):
            self.bot = bot
            self.start_scheduler()
            Log.PrintLog(f"Création de schedule pour envoyer les events automatiquement: Date -> {JourName[int(os.getenv('DAY_EVENT'))]} Heure -> {os.getenv('HOURS_EVENT')}")

        def start_scheduler(self):
            schedule.every().day.at(os.getenv('HOURS_EVENT')).do(self.check_date)
  
        def check_date(self):
            current_date = datetime.now().strftime('%A').lower()
            jour_param = JourName[int(os.getenv('DAY_EVENT'))]
            if current_date == jour_param:
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
                days_until_next_monday = (7 - today.weekday()) % 7 + 1
                next_monday = today + timedelta(days=days_until_next_monday)
                next_sunday = next_monday + timedelta(days=6)

                condition_list = [ConditionField("start", "between", (next_monday, next_sunday))]
                events = await self.bot.database_manager.select_entity(Event.Event, condition_list)

                for event in events:
                    await self.bot.event_manager.set_event(event)
                    await self.bot.database_manager.insert_entity(event)

            except Exception as e:
                Log.PrintError(f"send_event_week - {e}")

    class SchedulerEvent:
        def __init__(self, bot):
            self.bot = bot
            self.scheduled_tasks = {}

        async def check_events(self):
            while True:
                today_events = await self.get_events_for_today()
                if today_events:
                    for event in today_events:
                        time_until_event = event.start - datetime.now()
                        
                        if timedelta(minutes=0) < time_until_event <= timedelta(minutes=15):
                            await self.send_event_reminder(event)
                        else:
                            await self.schedule_event_reminder(event)

                await asyncio.sleep(60)

        async def get_events_for_today(self):
            now = datetime.now()
            today_start = datetime(now.year, now.month, now.day)
            today_end = today_start + timedelta(days=1)

            return await self.bot.database_manager.select_entity(
                Event.Event, ConditionField('start', 'between', (today_start, today_end))
            )

        async def schedule_event_reminder(self, event):
            now = datetime.now()
            time_until_reminder = event.start - timedelta(minutes=15) - now

            if time_until_reminder.total_seconds() <= 0 or event.start > now + timedelta(days=1):
                return

            if event.id in self.scheduled_tasks:
                return

            task = asyncio.create_task(self._wait_and_remind(event, time_until_reminder))
            self.scheduled_tasks[event.id] = task

        async def _wait_and_remind(self, event, delay):
            try:
                await asyncio.sleep(delay.total_seconds())

                if self.is_event_valid(event):
                    await self.send_event_reminder(event)
            except asyncio.CancelledError:
                pass

        def cancel_event_reminder(self, event):
            if event.id in self.scheduled_tasks:
                self.scheduled_tasks[event.id].cancel()
                del self.scheduled_tasks[event.id]

            event.appel_msg_discord = False

        def is_event_valid(self, event):
            now = datetime.now()
            today_events = asyncio.run(self.get_events_for_today())
            return event.start > now and event.id in [e.id for e in today_events]

        async def send_event_reminder(self, event):
            channel = self.bot.event_manager.get_channel(event)

            if event.discord_id and not event.appel_msg_discord:
                message = await channel.fetch_message(event.discord_id)
                if message is not None:
                    conditions = [
                        ConditionField("type_rep", "==", 'accepted'),
                        ConditionField("event_id", "==", event.id)
                    ]

                    responses = await self.bot.database_manager.select_entity(Response.Response, conditions)
                    msg_str = f"{event.name}\n\n"

                    for response in responses:
                        user = self.bot.guild.get_member(response.user.discord_id)
                        if user:
                            msg_str += f"{user.mention} "
                    
                    try:
                        await message.reply(msg_str)
                        event.appel_msg_discord = True
                    finally:
                        await self.bot.database_manager.insert_entity(event)
        
        def update_event(self, event):
            self.cancel_event_reminder(event)

            time_until_event = event.start - datetime.now()

            if event.appel_msg_discord:
                return

            if timedelta(minutes=0) < time_until_event <= timedelta(minutes=15):
                asyncio.create_task(self.send_event_reminder(event))
            else:
                asyncio.create_task(self.schedule_event_reminder(event))
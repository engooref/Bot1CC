from sqlalchemy import Column, Integer, ForeignKey, Boolean, String, DateTime, Time, Text, BigInteger
from sqlalchemy.orm import relationship
from ORM import Base, EventType
from ORM.Association import user_events

class Event(Base):
    __tablename__ = 'event'
    id = Column(Integer, primary_key=True, autoincrement=True)
    discord_id = Column(BigInteger, nullable=True)
    start = Column(DateTime, nullable=False)
    lanc_serv = Column(Time, nullable=False)
    lanc_scen = Column(Time, nullable=False)
    end = Column(DateTime, nullable=False)
    name = Column(String(255), nullable=False, default="")
    type_id = Column(Integer, ForeignKey('event_type.id'), nullable=True)
    object1cc = Column(Text, nullable=False, default="", name='object1_cc')
    object_adv = Column(Text, nullable=False, default="")
    commentaire = Column(Text, nullable=False, default="")
    spawn = Column(String(255), nullable=False, default="")
    lieu_event = Column(String(255), nullable=False, default="")
    picture = Column(String(255), nullable=True, default="")
    nb_resp = Column(String(255), nullable=False, default="")
    reglevehicule = Column(String, nullable=False, default="{}")  # Store arrays as JSON strings
    regleenga = Column(String, nullable=False, default="{}")  # Store arrays as JSON strings
    regequi = Column(String, nullable=False, default="{}")  # Store arrays as JSON strings
    is_valid = Column(Boolean, nullable=False, default=False)
    respawn = Column(String(255), nullable=False, default="")
    briefing_Discord_Id = Column(BigInteger, nullable=True)
    briefing_file_name = Column(String(255), nullable=True)
    attribution_discord_id = Column(BigInteger, nullable=True)
    description = Column(Text, nullable=True, default="")
    appel_msg_discord = Column(Boolean, nullable=False, default=False)
    briefing_template_name = Column(String(255), nullable=True)


    type = relationship('EventType')
    responses = relationship('Response', cascade="all, delete-orphan")
    users = relationship('User', secondary=user_events, back_populates='events', overlaps="events")
    user_orig_id = Column(Integer, ForeignKey('user.id'), nullable=False)
    user_orig = relationship('User', back_populates='events_orig', overlaps="events_orig")
        
    @property
    def start_date(self):
        """Renvoie la date au format JJ/MM/AAAA."""
        if self.start:
            return self.start.strftime("%d/%m/%Y")
        return ""

    @property
    def start_time(self):
        """Renvoie l'heure au format HH:MM."""
        if self.start:
            return self.start.strftime("%H:%M")
        return ""
    
    def __str__(self):
        return self.name

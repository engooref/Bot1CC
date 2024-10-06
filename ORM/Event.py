from sqlalchemy import Column, Integer, ForeignKey, Boolean, String, DateTime, Time, Text, JSON, BigInteger
from sqlalchemy.orm import relationship
from ORM import Base, EventType, FileExtTemplate
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
    briefing_template_id = Column(Integer, ForeignKey('file_ext_template.id'), nullable=True)
    briefing_file_name = Column(String(255), nullable=True)
    attribution_discord_id = Column(BigInteger, nullable=True)

    type = relationship('EventType')
    responses = relationship('Response', cascade="all, delete-orphan")
    users = relationship('User', secondary=user_events, back_populates='events', overlaps="events")
    user_orig_id = Column(Integer, ForeignKey('user.id'), nullable=False)
    user_orig = relationship('User', back_populates='events_orig', overlaps="events_orig")
    briefing = relationship('FileExtTemplate', foreign_keys=[briefing_template_id])

    def __init__(self, discord_id, start, lanc_serv, lanc_scen, end, name, type_id, object1cc, object_adv, respawn, briefing_template_id, briefing_Discord_Id, briefing_file_name,
                 commentaire, spawn, lieu_event, picture, nb_resp, reglevehicule, regleenga, regequi, is_valid, user_orig_id):
        self.discord_id = discord_id
        self.start = start
        self.lanc_serv = lanc_serv
        self.lanc_scen = lanc_scen
        self.end = end
        self.name = name
        self.type_id = type_id
        self.object1cc = object1cc
        self.object_adv = object_adv
        self.commentaire = commentaire
        self.spawn = spawn
        self.lieu_event = lieu_event
        self.picture = picture
        self.nb_resp = nb_resp
        self.reglevehicule = reglevehicule
        self.regleenga = regleenga
        self.regequi = regequi
        self.is_valid = is_valid
        self.user_orig_id = user_orig_id
        self.respawn = respawn
        self.briefing_template_id = briefing_template_id
        self.briefing_Discord_Id = briefing_Discord_Id
        self.briefing_file_name = briefing_file_name
        
    def __str__(self):
        return self.name

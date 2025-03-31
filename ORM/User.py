from sqlalchemy import  Column, Integer, String, BigInteger, UniqueConstraint, JSON, ForeignKey
from ORM import Base
from sqlalchemy.orm import relationship
from ORM.Association import user_role_association, user_events # Assurez-vous d'importer user_role_association depuis le bon emplacement
import re

class User(Base):
    __tablename__ = 'user'
    __table_args__ = (
        UniqueConstraint('email', name='UNIQ_IDENTIFIER_EMAIL'),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(180), nullable=True)
    roles = Column(JSON)  # Store roles as a JSON string
    username = Column(String(255), nullable=False)
    discord_id = Column(BigInteger, nullable=False)
    avatar = Column(String(255), nullable=False)
    access_token = Column(String(255), nullable=True)
    exp_pourcentage = Column(Integer, default=0)
    exp_level = Column(Integer, default=0)


    # Many-to-Many relationship with Role
    rolesDiscord = relationship('Role', secondary=user_role_association)

    # One-to-Many relationship with Traces
    traces = relationship('Traces', back_populates='user')

    # One-to-Many relationship with Response
    responses = relationship('Response')

    events = relationship('Event', secondary=user_events, back_populates='users', overlaps="users", )
    events_orig = relationship('Event', back_populates='user_orig', overlaps="user_orig")

    rh_profile = relationship('RHMember', back_populates='user',cascade="all, delete-orphan", single_parent=True, uselist=False)

    relations_a_exclure = {'events', 'events_orig'}
    def __init__(self, email, username, discordId, avatar, accessToken, roles: list, expPour, expLvl, traces=[]):
        self.email = email
        self.roles = []
        self.username = username
        self.discord_id = discordId
        self.avatar =  avatar
        self.access_token = accessToken
        self.rolesDiscord = roles  
        self.traces = traces      
        self.exp_pourcentage = expPour
        self.exp_level = expLvl

    def reset(self):
        self.email = None
        self.roles = []
        self.avatar =  ''
        self.access_token = None      
        self.exp_pourcentage = 0
        self.exp_level = 0
        self.rolesDiscord.clear()
        self.username = re.sub(r'\[[^\]]*\]', '', self.username)



from sqlalchemy import Column, Integer, String, JSON, BigInteger
from ORM import Base
from sqlalchemy.orm import relationship
from ORM.Association import user_role_association  # Assurez-vous d'importer user_role_association depuis le bon emplacement


class User(Base):
    __tablename__ = 'user'
    id = Column(Integer, primary_key=True)
    email = Column(String, nullable=True)
    roles =  Column(JSON, nullable=False)   
    username = Column(String(255), nullable=False)
    discord_Id = Column(BigInteger, nullable=False)
    avatar =  Column(String(255), nullable=False)   
    access_Token = Column(String(255), nullable=False)
    rolesDiscord = relationship("Role", secondary=user_role_association)
    traces = relationship("Traces", back_populates="user")
    
    def __init__(self, email, username, discordId, avatar, accessToken, roles, traces=[]):
        self.email = email
        self.roles = []
        self.username = username
        self.discord_Id = discordId
        self.avatar =  avatar
        self.access_Token = accessToken
        self.rolesDiscord = roles  
        self.traces = traces      
        
    def __str__(self):
        return self.username

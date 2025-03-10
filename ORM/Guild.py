from sqlalchemy import Column, Integer, String, BigInteger
from sqlalchemy.orm import relationship
from ORM import Base

class Guild(Base):
    __tablename__ = 'guild'
    id = Column(Integer, primary_key=True)
    discord_id = Column(BigInteger, nullable=False)
    name = Column(String(255), nullable=False)
    roles = relationship('Role', back_populates='guild', lazy='dynamic')

    relations_a_exclure = {}
    
    def __init__(self, name, discordId):
        self.name = name
        self.discord_id = discordId
        
    def __str__(self):
        return self.name

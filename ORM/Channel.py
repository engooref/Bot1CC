from sqlalchemy import Column, Integer, String, BigInteger
from ORM import Base

class Channel(Base):
    __tablename__ = 'channel'
    id = Column(Integer, primary_key=True)
    discord_id = Column(BigInteger, nullable=False)
    name = Column(String(255), nullable=False)
    
    relations_a_exclure = {}
    
    def __init__(self, name, discordId):
        self.name = name
        self.discord_id = discordId
        
    def __hash__(self):
        return hash((self.discord_id))

    def __eq__(self, autre):
        return isinstance(autre, Channel) and self.discord_id == autre.discord_id

    def __str__(self):
        return self.name

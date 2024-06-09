from sqlalchemy import Column, Integer, String, DateTime, Text, BigInteger
from ORM import Base

class Event(Base):
    __tablename__ = 'event'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    discord_id = Column(BigInteger, nullable=True)
    picture = Column(String(255), nullable=True)
    start = Column(DateTime, nullable=False)
    end = Column(DateTime, nullable=True)
    type = Column(String(255), nullable=False)
    type = Column(String(255), nullable=False)

    def __init__(self, name, start, type, end, description=None, discord_id=None, picture=None):
        self.name = name
        self.start = start
        self.end = end
        self.description = description
        self.discord_id = discord_id
        self.picture = picture
        self.type = type
        
    def __str__(self):
        return self.name

from sqlalchemy import Column, Integer, String, BigInteger
from ORM import Base

class Role(Base):
    __tablename__ = 'role'
    id = Column(Integer, primary_key=True)
    
    discord_Id = Column(BigInteger, nullable=False)
    name = Column(String(255), nullable=False)
    
    def __init__(self, name, discordId):
        self.name = name
        self.discord_Id = discordId
        
    def __hash__(self):
        return hash((self.discord_Id))

    def __eq__(self, autre):
        return isinstance(autre, Role) and self.discord_Id == autre.discord_Id

    def __str__(self):
        return self.name

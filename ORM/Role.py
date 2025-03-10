from sqlalchemy import Column, Integer, String, BigInteger, Boolean
from sqlalchemy.orm import relationship
from ORM import Base

class Role(Base):
    __tablename__ = 'role'
    id = Column(Integer, primary_key=True)
    
    discord_id = Column(BigInteger, nullable=False)
    name = Column(String(255), nullable=False)
    is_grade = Column(Boolean, nullable=False)

    rHMembers = relationship('RHMember', back_populates='grade')

    relations_a_exclure = {}
    def __init__(self, name, discordId, isGrade):
        self.name = name
        self.discord_id = discordId
        self.is_grade = isGrade
        
    def __hash__(self):
        return hash((self.discord_id))

    def __eq__(self, autre):
        return isinstance(autre, Role) and self.discord_id == autre.discord_id

    def __str__(self):
        return self.name

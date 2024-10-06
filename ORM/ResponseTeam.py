from sqlalchemy import Column, Integer, String
from ORM import Base

class ResponseTeam(Base):
    __tablename__ = 'response_team'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)

    def __init__(self, name):
        self.name = name
        


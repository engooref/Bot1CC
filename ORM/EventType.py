from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from ORM import Base

class EventType(Base):
    __tablename__ = 'event_type'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    color = Column(String(7), nullable=False)

    events = relationship('Event', back_populates='type')

    def __init__(self, name, color):
        self.name = name
        self.color = color
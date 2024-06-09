from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from ORM import Base

class Response(Base):
    __tablename__ = 'response'
    id = Column(Integer, primary_key=True)

    users_id = Column(Integer, ForeignKey('user.id'))
    event_id = Column(Integer, ForeignKey('event.id'))
    type_rep = Column(String(255))
    
    def __init__(self, user_id, event_id, type_rep):
        self.users_id = user_id
        self.event_id = event_id
        self.type_rep = type_rep
        
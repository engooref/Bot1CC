from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, BigInteger, Boolean
from ORM import Base, TicketType
from sqlalchemy.orm import relationship
import datetime


class TicketBots(Base):
    __tablename__ = 'ticket_bot'

    id = Column(Integer, primary_key=True, autoincrement=True)

    type_id = Column(Integer, ForeignKey('ticket_type.id'), nullable=False)
    user_id = Column(BigInteger, nullable=False)
    channel_id = Column(BigInteger, nullable=False, default=0) 
    closed_user_id = Column(BigInteger, nullable=False, default=0)
    open = Column(DateTime, nullable=False)
    closed = Column(DateTime, nullable=False, default=datetime.datetime.now())
    closed_message = Column(String(255), nullable=False, default='')
    issue = Column(String(255), nullable=False, default='')

    type = relationship('TicketType')

    relations_a_exclure = {}
    def __init__(self, type, user_id, open):
        self.type = type
        self.user_id = user_id
        self.open = open


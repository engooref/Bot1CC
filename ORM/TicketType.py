from sqlalchemy import Column, Integer, String, BigInteger
from ORM import Base

class TicketType(Base):
    __tablename__ = 'ticket_type'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    category = Column(String(255), nullable=False)
    role_auth = Column(BigInteger, nullable=False)
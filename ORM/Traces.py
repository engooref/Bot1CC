from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.dialects.mysql import LONGTEXT
from ORM import Base
import datetime
from sqlalchemy.orm import relationship

class Traces(Base):
    __tablename__ = 'traces'
    id = Column(Integer, primary_key=True)
    
    user_id = Column(Integer, ForeignKey('user.id'), nullable=True)
    # Définition de la relation inverse Many-to-One
    user = relationship("User", back_populates="traces")
    message = Column(String(255), nullable=False)
    time = Column(DateTime, nullable=False)
    parameter = Column(LONGTEXT, nullable=True)
    
    relations_a_exclure = {}
    def __init__(self, userId, message, parameter = None):
        self.user_id = userId
        self.message = message
        self.time = datetime.datetime.now()
        self.parameter = parameter
        
    def __str__(self):
        return str(self.id)

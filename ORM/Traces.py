from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from ORM import Base
import datetime
from sqlalchemy.orm import relationship

class Traces(Base):
    __tablename__ = 'traces'
    id = Column(Integer, primary_key=True)
    
    user_id = Column(Integer, ForeignKey('user.id'), nullable=True)
    # Définition de la relation inverse Many-to-One
    user = relationship("User", back_populates="traces")
    command = Column(String(255), nullable=False)
    time = Column(DateTime, nullable=False)
    
    def __init__(self, userId, command):
        self.user_id = userId
        self.command = command
        self.time = datetime.datetime.now()
        
    def __str__(self):
        return str(self.id)

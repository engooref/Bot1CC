from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import relationship
from ORM import Base, SCLocations

class SCLocationsType(Base):
    __tablename__ = 'sclocations_type'

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    locations = relationship("SCLocations", back_populates="type")

    def __init__(self, name):
        self.name = name
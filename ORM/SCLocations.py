from sqlalchemy import Column, Integer, ForeignKey, String
from sqlalchemy.orm import relationship
from ORM import Base, SCLocationsType

class SCLocations(Base):
    __tablename__ = 'sclocations'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, default="")
    designation = Column(String(255), nullable=False, default="")
    
    type_id = Column(Integer, ForeignKey('sclocations_type.id'), nullable=False)
    parent_id = Column(Integer, ForeignKey('sclocations.id'), nullable=True)

    type = relationship('SCLocationsType', back_populates="locations")
    # Relation avec le parent (si la location est une planète, elle a un parent, l'étoile)
    parent = relationship('SCLocations', backref='children', remote_side=[id])

    relations_a_exclure = {}
    def __init__(self, name, designation, type, parent = None):
        self.name = name
        self.type = type
        self.designation = designation
        self.parent = parent
        if parent:
            self.parent_id = parent.id  # Lier l'étoile comme parent
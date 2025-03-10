from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship, backref
from ORM import Base

class ParameterType(Base):
    __tablename__ = 'parameter_type'
    id = Column(Integer, primary_key=True)
    type_param = Column(String(255), nullable=False)

    relations_a_exclure = {}
     
    def __init__(self, type_param):
        self.type_param = type_param
        
    def __str__(self):
        return self.type_param

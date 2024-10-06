from sqlalchemy import Column, Integer, String
from ORM import Base

class FileExtType(Base):
    __tablename__ = 'file_ext_type'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, default="")

    def __init__(self, name):
        self.name = name
        
    def __str__(self):
        return self.name

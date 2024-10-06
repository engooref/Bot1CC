from sqlalchemy import Column, Integer, String, ForeignKey
from ORM import Base, FileExtType
from sqlalchemy.orm import relationship

class FileExtTemplate(Base):
    __tablename__ = 'file_ext_template'
    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, default="")
    name_file = Column(String(255), nullable=False, default="")

    type_id = Column(Integer, ForeignKey('file_ext_type.id'), nullable=False)

    type = relationship('FileExtType')

    def __init__(self, name, nameFile, type):
        self.name = name
        self.name_file = nameFile
        self.type = type
        
    def __str__(self):
        return self.name

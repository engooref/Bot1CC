from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from ORM import Base, Association, ParameterType, User, Channel, Role

class Parameter(Base):
    __tablename__ = 'parameter'
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False)
    
    value_type_id = Column(Integer, ForeignKey('parameter_type.id'))
    type = relationship('ParameterType')
    
    value_user_id = Column(Integer, ForeignKey('user.id'), nullable=True)
    user = relationship('User')
    
    value_channel_id = Column(Integer, ForeignKey('channel.id'), nullable=True)
    channel = relationship('Channel')
    
    roles = relationship("Role", secondary=Association.parmaeter_role_table)
    
    value_text = Column(String(255), nullable=True)
    
    relations_a_exclure = {}
    
    def getValue(self):
        if self.type.type_param == 'Text':
            return self.value_text
        
        elif self.type.type_param == 'Channel':
            return self.channel.discord_id
        
        elif self.type.type_param == 'User':
            return self.user.discord_id
        
        elif self.type.type_param == 'Role':
            return [role.discord_id for role in self.roles]
        else:
            return ''
        
    def __str__(self):
        return self.name

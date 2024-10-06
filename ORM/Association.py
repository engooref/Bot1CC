from sqlalchemy import Table, Column, Integer, ForeignKey
from ORM import Base

user_role_association = Table('user_role', Base.metadata,
    Column('user_id', Integer, ForeignKey('user.id')),
    Column('role_id', Integer, ForeignKey('role.id'))
)

user_events = Table(
    'event_user', Base.metadata,
    Column('user_id', Integer, ForeignKey('user.id'), primary_key=True),
    Column('event_id', Integer, ForeignKey('event.id'), primary_key=True)
)

# Table de liaison pour la relation ManyToMany entre Response et ResponseRoles
response_roles_association_table = Table(
    'response_event_response_roles', Base.metadata,
    Column('response_event_id', Integer, ForeignKey('response_event.id'), primary_key=True),
    Column('response_roles_id', Integer, ForeignKey('response_roles.id'), primary_key=True)
)


parmaeter_role_table = Table(
    'parameter_role', Base.metadata,
    Column('parameter_id', Integer, ForeignKey('parameter.id'), primary_key=True),
    Column('role_id', Integer, ForeignKey('role.id'), primary_key=True)
)
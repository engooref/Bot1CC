from sqlalchemy import Table, Column, Integer, ForeignKey
from ORM import Base

user_role_association = Table('user_role', Base.metadata,
    Column('user_id', Integer, ForeignKey('user.id')),
    Column('role_id', Integer, ForeignKey('role.id'))
)

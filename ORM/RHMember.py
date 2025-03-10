from datetime import datetime
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from ORM import Base

class RHMember(Base):
    __tablename__ = 'rhmember'
    __mapper_args__ = {"confirm_deleted_rows": False}

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey('user.id'), nullable=True, unique=True)
    status = Column(String(255), default='Actif', nullable=False)
    last_promotion = Column(DateTime, default=datetime.utcnow, nullable=True)
    grade_id = Column(Integer, ForeignKey('role.id'), nullable=False)

    # Relations
    user = relationship('User', back_populates='rh_profile', uselist=False)
    grade = relationship('Role', back_populates='rHMembers')

    relations_a_exclure = {}
    def __init__(self, user, grade, status='Actif', last_promotion=None):
        self.user = user
        self.grade = grade
        self.status = status
        self.last_promotion = last_promotion or datetime.utcnow()

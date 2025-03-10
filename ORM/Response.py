from sqlalchemy import Column, Integer, String, ForeignKey
from sqlalchemy.orm import relationship
from ORM import Base, Association, ResponseRoles, ResponseTeam

class Response(Base):
    __tablename__ = 'response_event'
    id = Column(Integer, primary_key=True)

    users_id = Column(Integer, ForeignKey('user.id'))
    event_id = Column(Integer, ForeignKey('event.id'))
    type_rep = Column(String(255))
    team_id = Column(Integer, ForeignKey('response_team.id'), nullable=True)
    commentaire = Column(String(255), nullable=True)
    vaisseau = Column(String(255), nullable=True)
    role_vaisseau = Column(String(255), nullable=True)

    team = relationship("ResponseTeam")
    roles = relationship("ResponseRoles", secondary=Association.response_roles_association_table)
    # Relation avec la table User
    user = relationship("User", back_populates="responses")  # Associer Response à User

    relations_a_exclure = {}
    
    def __init__(self, user_id, event_id, type_rep, team = None, roles = [], commentaire = None, vaisseau = None, role_vaisseau = None):
        self.users_id = user_id
        self.event_id = event_id
        self.type_rep = type_rep
        self.team = team
        self.roles = roles
        self.commentaire = commentaire
        self.vaisseau = vaisseau
        self.role_vaisseau = role_vaisseau
        
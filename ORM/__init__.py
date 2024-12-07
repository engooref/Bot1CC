import typing, os
from dotenv import load_dotenv
from sqlalchemy.orm.exc import DetachedInstanceError
from sqlalchemy.orm import scoped_session, sessionmaker, declarative_base, joinedload
from sqlalchemy_utils import database_exists, create_database
from sqlalchemy.inspection import inspect
import requests, Utils.Log as Log
from typing import List
from ORM.ConditionField import *
# Chemin absolu du fichier en cours d'exécution
current_file = os.path.abspath(__file__)

# Dossier contenant le fichier
current_dir = os.path.dirname(current_file)

load_dotenv(current_dir + "/../config")

DBSession = scoped_session(sessionmaker())
Base = declarative_base()

def initialize_sql(engine):
    DBSession.configure(bind=engine)
    
    if not database_exists(engine.url):
        create_database(engine.url)
        
    Base.metadata.bind = engine
    Base.metadata.create_all(engine)
    

def _repr(self, **fields: typing.Any) -> str:
        '''
        Helper for __repr__
        '''
        field_strings = []
        at_least_one_attached_attribute = False
        for key, field in fields.items():
            try:
                field_strings.append(f'{key}={field!r}')
            except DetachedInstanceError:
                field_strings.append(f'{key}=DetachedInstanceError')
            else:
                at_least_one_attached_attribute = True
        if at_least_one_attached_attribute:
            return f"<{self.__class__.__name__}({','.join(field_strings)})>"
        return f"<{self.__class__.__name__} {id(self)}>"    
    
def insertOrUpdate_data(instance):
    session = DBSession()
    try:
        instance = session.merge(instance)
        session.commit()
        
    except Exception as e:
        session.rollback()
        Log.PrintLog(f'Error inserting data: {e}')
    finally:
        session.close()
    return instance

def insert_multiLigne(instances):
    session = DBSession()
    try:
        session.add_all(instances)
        session.commit()
    except Exception as e:
        session.rollback()
        Log.PrintLog(f'Error inserting data: {e}')
    finally:
        session.close()    

def select_all(model):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
        entities = query.all()
        return {str(entity): entity for entity in entities}
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return list()
    finally:
        session.close()
        
def select_by_field(model, field : ConditionField, oneResult = False):
    session = DBSession()
    try:
        query = session.query(model)

        # Charger les relations via joinedload
        for relation in get_relations(model):
            query = query.options(joinedload(relation))  # Charge les relations explicitement

        # Gestion des relations imbriquées avec jointure
        if '.' in field.name:
            parts = field.name.split('.')
            current_model = model
            model_field = None
            for part in parts:
                model_field = getattr(current_model, part, None)
                if model_field is None:
                    raise ValueError(f"Field '{field.name}' does not exist in model {current_model.__name__}")
                # Si c'est une relation, ajouter une jointure
                if hasattr(model_field, 'prop') and hasattr(model_field.prop, 'mapper'):
                    related_model = model_field.prop.mapper.class_
                    query = query.join(related_model, model_field)
                    current_model = related_model
                else:
                    break
        else:
            # Si le champ n'est pas imbriqué
            model_field = getattr(model, field.name)

        # Appliquer les filtres
        operator_func = operatorDict.get(field.operatorField)
        if operator_func:
            query = query.filter(operator_func(model_field, field.value))
        else:
            raise ValueError(f"Operator '{field.operatorField}' not supported.")
        
        # Retourner un seul résultat ou tous les résultats en fonction de `oneResult`
        if not oneResult:
            return query.all()
        else:
            return query.first()
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()
        
def select_by_fields(model, fields : List[ConditionField], one_result=False):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
        
        for field in fields:
            # Gestion des relations imbriquées avec jointure
            if '.' in field.name:
                parts = field.name.split('.')
                current_model = model
                model_field = None
                for part in parts:
                    model_field = getattr(current_model, part, None)
                    if model_field is None:
                        raise ValueError(f"Field '{field.name}' does not exist in model {current_model.__name__}")
                    # Si c'est une relation, ajouter une jointure
                    if hasattr(model_field, 'prop') and hasattr(model_field.prop, 'mapper'):
                        related_model = model_field.prop.mapper.class_
                        query = query.join(related_model)
                        current_model = related_model
                    else:
                        break
            else:
                # Si le champ n'est pas imbriqué
                model_field = getattr(model, field.name)

            # Appliquer les filtres
            operator_func = operatorDict.get(field.operatorField)
            if operator_func:
                query = query.filter(operator_func(model_field, field.value))
            else:
                raise ValueError(f"Operator '{field.operatorField}' not supported.")
            

        if not one_result:
            return query.all()
        else:
            return query.first()
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()

def select_by_id(model, id):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
            
        return query.get(id)
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()
    
def get_relations(model):
        mapper = inspect(model)
        return [getattr(model, relationship.key) for relationship in mapper.relationships]

def select_by_discordId(model, discordId):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
        query = query.filter(getattr(model, "discord_id") == discordId)
        return query.first()
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()
        
def delete_by_fields(model, fields):
    # Ouvrez une session SQLAlchemy
    session = DBSession()
    try:
        # Récupérez l'objet à supprimer en fonction du champ de recherche
        query = session.query(model)
        
        if isinstance(fields, list):
            for field in fields:
                if field.model is None:
                    model_field = getattr(model, field.name) 
                else:
                    model_field = getattr(field.model, field.name)

                operator_func = operatorDict.get(field.operatorField)
                if operator_func:
                    query = query.filter(operator_func(model_field, field.value))
                else:
                    raise ValueError(f"Operator '{field.operatorField}' not supported.")
        else:
            if field.model is None:
                model_field = getattr(model, field.name) 
            else:
                model_field = getattr(field.model, field.name)
                
            operator_func = operatorDict.get(field.operatorField)
            if operator_func:
                query = query.filter(operator_func(model_field, field.value))
            else:
                raise ValueError(f"Operator '{field.operatorField}' not supported.")
            
        obj = query.all()
        if obj:
            # Marquez l'objet comme étant à supprimer
            for object in obj:
                session.delete(object)

            # Validez la transaction
            session.commit()

            print(f"{model.__name__} deleted successfully.")

    except Exception as e:
        print(f"Error deleting {model.__name__}: {e}")
        # En cas d'erreur, effectuez un rollback de la transaction
        session.rollback()
    finally:
        # Fermez la session SQLAlchemy
        session.close()
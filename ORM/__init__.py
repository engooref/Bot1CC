import typing, os
from dotenv import load_dotenv
from sqlalchemy.orm.exc import DetachedInstanceError
from sqlalchemy.orm import scoped_session, sessionmaker, declarative_base, joinedload
from sqlalchemy_utils import database_exists, create_database
from sqlalchemy.inspection import inspect
import requests
import Log

load_dotenv("config")

DBSession = scoped_session(sessionmaker())
Base = declarative_base()

urlBase = 'http://{api_url}/{api_key}/'.format(api_url=os.getenv('API_URL'), api_key=os.getenv('API_KEY'))
url = urlBase + 'v1/live/'


def GetNbRequest():
   while True:        
        r = requests.get(urlBase + 'me')
        if r.status_code == 200:
            return r.json()['data']['value']
        else:
            raise Exception("Erreur de requete: " + str(r.headers))

def GetJSONFromRequest(url, param):
   while True:     
        if GetNbRequest != 0:
            r = requests.get(url, params=param)
            if r.status_code == 200:
                return r.json()
            else:
                raise Exception("Erreur de requete: " + str(r.headers))
        else:
            raise Exception("Nombre de requête limite atteinte")
        
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
        session.add(instance)
        session.commit()
        instance = select_by_id(instance.__class__, instance.id)
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
        return []
    finally:
        session.close()
        
def select_by_field(model, field_name, field_value, oneResult = False):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
        query = query.filter(getattr(model, field_name) == field_value)
        if not oneResult:
            return query.all()
        else:
            return query.first()
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()
        
def select_by_fields(model, fields_and_values, one_result=False):
    session = DBSession()
    try:
        query = session.query(model)
        for relation in get_relations(model):
            query = query.options(joinedload(relation))
        
        # Filtrer par chaque champ et valeur
        for field_name, field_value in fields_and_values.items():
            query = query.filter(getattr(model, field_name) == field_value)
        
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
        query = query.filter(getattr(model, "discord_Id") == discordId)
        return query.first()
    except Exception as e:
        Log.PrintLog(f'Error selecting data: {e}')
        return None
    finally:
        session.close()
        
def delete_by_field(model, field_name, field_value):
    # Ouvrez une session SQLAlchemy
    session = DBSession()
    try:
        # Récupérez l'objet à supprimer en fonction du champ de recherche
        obj = session.query(model).filter(getattr(model, field_name) == field_value).first()

        if obj:
            # Marquez l'objet comme étant à supprimer
            session.delete(obj)

            # Validez la transaction
            session.commit()

            print(f"{model.__name__} deleted successfully.")
        else:
            print(f"{model.__name__} not found with {field_name}={field_value}.")
    except Exception as e:
        print(f"Error deleting {model.__name__}: {e}")
        # En cas d'erreur, effectuez un rollback de la transaction
        session.rollback()
    finally:
        # Fermez la session SQLAlchemy
        session.close()
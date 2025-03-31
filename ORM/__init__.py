import typing, os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, selectinload
from sqlalchemy.inspection import inspect
from sqlalchemy import select
from sqlalchemy.orm import joinedload
import Utils.Log as Log
from typing import List
from ORM.ConditionField import *

# Chemin absolu du fichier en cours d'exécution
current_file = os.path.abspath(__file__)

# Dossier contenant le fichier
current_dir = os.path.dirname(current_file)

load_dotenv(current_dir + "/../Config/config_gen")

# Configuration de la base de données
engine = create_async_engine(os.getenv('URL_BDD'), 
                                echo=(os.getenv('ECHO_SQL') == "True"),
                                future=True,
                                pool_pre_ping=True,
                                pool_recycle=3600  # Recycle les connexions après une heure
                                )

Base = declarative_base()
AsyncSessionMaker = async_sessionmaker(engine, expire_on_commit=False)

async def initialize_sql():
    """Initialise la base de données et configure les sessions asynchrones."""

    # Création des tables si nécessaire
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    return engine
    
async def insert_or_update_data(instance):
    async with AsyncSessionMaker() as session:
        async with session.begin():
            try:
                session.add(instance)
                await session.commit()

                return instance
            except Exception as e:
                await session.rollback()
                Log.PrintLog(f'Error inserting data: {e}')
                return None

async def insert_multi_ligne(instances):
    async with AsyncSessionMaker() as session:
        async with session.begin():
            try:
                session.add_all(instances)
                await session.commit()
            except Exception as e:
                await session.rollback()
                Log.PrintLog(f'Error inserting data: {e}')

async def select_all(model, in_list=False):
    async with AsyncSessionMaker() as session:
        try:
            query = select(model)
            for relation in get_relations(model):
                query = query.options(selectinload(relation))
            result = await session.execute(query)
            entities = result.scalars().all()
            return {str(entity): entity for entity in entities} if not in_list else entities
        except Exception as e:
            Log.PrintLog(f'Error selecting data: {e}')
            return dict() if not in_list else list()

async def select_by_field(model, field: ConditionField, one_result=False, order_by_desc=False):
    async with AsyncSessionMaker() as session:
        try:
            query = select(model)

            for relation in get_relations(model):
                if relation not in model.relations_a_exclure:
                    query = query.options(selectinload(relation))

            # Gérer les relations imbriquées
            if '.' in field.name:
                parts = field.name.split('.')
                current_model = model
                model_field = None
                for part in parts:
                    model_field = getattr(current_model, part, None)
                    if model_field is None:
                        raise ValueError(f"Field '{field.name}' does not exist in model {current_model.__name__}")
                    if hasattr(model_field, 'prop') and hasattr(model_field.prop, 'mapper'):
                        related_model = model_field.prop.mapper.class_
                        query = query.join(related_model, model_field)
                        current_model = related_model
                    else:
                        break
            else:
                model_field = getattr(model, field.name)

            # Appliquer les filtres
            operator_func = operatorDict.get(field.operatorField)
            if operator_func:
                query = query.filter(operator_func(model_field, field.value))
            else:
                raise ValueError(f"Operator '{field.operatorField}' not supported.")

            if order_by_desc:
                query = query.order_by(model.id.desc())

            result = await session.execute(query)

            if not one_result:
                return result.scalars().all()
            else:
                return result.scalars().first()
        except Exception as e:
            Log.PrintLog(f'Error selecting data: {e}')
            return None

async def select_by_fields(model, fields: List[ConditionField], one_result=False, order_by_desc=False):
    async with AsyncSessionMaker() as session:
        try:
            query = select(model)

            for relation in get_relations(model):
                if relation not in model.relations_a_exclure:
                    query = query.options(joinedload(relation))

            for field in fields:
                # Gérer les relations imbriquées
                if '.' in field.name:
                    parts = field.name.split('.')
                    current_model = model
                    model_field = None
                    for part in parts:
                        model_field = getattr(current_model, part, None)
                        if model_field is None:
                            raise ValueError(f"Field '{field.name}' does not exist in model {current_model.__name__}")
                        if hasattr(model_field, 'prop') and hasattr(model_field.prop, 'mapper'):
                            related_model = model_field.prop.mapper.class_
                            query = query.join(related_model, model_field)
                            current_model = related_model
                        else:
                            break
                else:
                    model_field = getattr(model, field.name)

                # Appliquer les filtres
                operator_func = operatorDict.get(field.operatorField)
                if operator_func:
                    query = query.filter(operator_func(model_field, field.value))
                else:
                    raise ValueError(f"Operator '{field.operatorField}' not supported.")

            if order_by_desc:
                query = query.order_by(model.id.desc())

            result = (await session.execute(query)).unique()

            if not one_result:
                return result.scalars().all()
            else:
                return result.scalars().first()
        except Exception as e:
            Log.PrintLog(f'Error selecting data: {e}')
            return None

async def select_by_id(model, id, other_exclu=list()):
    async with AsyncSessionMaker() as session:
        try:
            query = select(model).filter(model.id == id)
            for relation in get_relations(model):
                if (relation.key not in model.relations_a_exclure) and (relation.key not in other_exclu):
                    query = query.options(joinedload(relation))

            result = await session.execute(query)
            return result.scalars().first()
        except Exception as e:
            Log.PrintLog(f'Error selecting data: {e}')
            return None

async def delete(objects):
    async with AsyncSessionMaker() as session:
        async with session.begin():
            try:
                if isinstance(objects, list):
                    for obj in objects:
                        await session.delete(obj)
                else:
                    await session.delete(objects)
                await session.commit()
                Log.PrintLog(f'Deleted data successfully')
            except Exception as e:
                await session.rollback()
                Log.PrintLog(f'Error deleting data: {e}')

async def refresh_entity(model):
    async with AsyncSessionMaker() as session:
        # Récupérer l'utilisateur depuis la base
        entity = await session.refresh(model)
        return entity
    
# Fonctions auxiliaires
def get_relations(model):
    mapper = inspect(model)
    return [getattr(model, relationship.key) for relationship in mapper.relationships]

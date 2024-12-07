from typing import Union

operatorDict = {
    '==': lambda field, value: field == value,
    '!=': lambda field, value: field != value,
    '<': lambda field, value: field < value,
    '>': lambda field, value: field > value,
    '<=': lambda field, value: field <= value,
    '>=': lambda field, value: field >= value,
    'isnull': lambda field, _: field.is_(None),
    'isnotnull': lambda field, _: field.is_not(None),
    'between': lambda field, value: field.between(value[0], value[1]),
    'in': lambda field, value: field.in_(value),  # Condition IN
    'notin': lambda field, value: field.notin_(value),  # Condition NOT IN
    'ilike': lambda field, value: field.ilike(value)
}

class ConditionField():


    def __init__(self, name: str, operator: str, value: Union[str, int, float, tuple, bool, None]):
        self.name = name
        self.operatorField = operator
        self.value = value
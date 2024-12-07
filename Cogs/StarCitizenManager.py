import BotManager, Utils.Log as Log
import requests, os
from ORM import SCLocations, SCLocationsType, ConditionField

class StarCitizenManager():
    def __init__(self, bot):
        self.bot: BotManager.BotManager = bot
        with open('apikey', 'r') as file:
            # Lire toutes les lignes et les stocker dans une liste
            self.api_key = [line.strip() for line in file.readlines()]

        self.iapi = 0
        self.urlBase = 'http://{api_url}/api_key/'.format(api_url=os.getenv('API_URL'))
        self.url = self.urlBase + 'v1/live/'


    def get_nb_request(self):
        r = requests.get(self.urlBase.replace('api_key', self.api_key[self.iapi]) + 'v1/me')
        if r.status_code == 200:
            return r.json()['data']['value']
        else:
            raise Exception("Erreur de requete: " + str(r.headers))

    def get_data_from_api_sc(self, dataUrl, param = None):   
        if self.get_nb_request() != 0:
            r = requests.get(self.url.replace('api_key', self.api_key[self.iapi]) + dataUrl, params=param)
            if r.status_code == 200:
                return r.json()
            else:
                raise Exception("Erreur de requete: " + str(r.headers))
        elif (self.iapi < self.api_key):
            self.iapi += 1
            return self.get_data_from_api_sc(dataUrl, param)
        else:
            raise Exception("Nombre de requête limite atteinte")
            
    def arabic_to_roman(self, number):
        roman_numerals = {
            1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI',
            7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X', 20: 'XX', 30: 'XXX',
            40: 'XL', 50: 'L', 60: 'LX', 70: 'LXX', 80: 'LXXX', 90: 'XC',
            100: 'C', 200: 'CC', 300: 'CCC', 400: 'CD', 500: 'D', 600: 'DC',
            700: 'DCC', 800: 'DCCC', 900: 'CM', 1000: 'M'
        }

        result = []
        for factor, roman in sorted(roman_numerals.items(), key=lambda x: -x[0]):
            while number >= factor:
                result.append(roman)
                number -= factor
        return ''.join(result)
    
    def replace_arabic_with_roman(self, input_string):
        import re
        # Rechercher un nombre entier à la fin de la chaîne
        match = re.search(r"(\d+)$", input_string)
        if match:
            arabic_number = int(match.group(1))
            roman_number = self.arabic_to_roman(arabic_number)
            # Remplacer le nombre arabe par le chiffre romain
            return input_string[:match.start()] + roman_number
        return input_string
    
    def insert_data_system_sc(self, object) -> SCLocations.SCLocations:
        object_bdd = self.bot.database_manager.select_entity(SCLocations.SCLocations, ConditionField('designation', '==', object["designation"]), True)
        if object_bdd:
            pass #TODO a voir si quelque chose est a faire
        else:
            type_bdd = self.bot.database_manager.select_entity(SCLocationsType.SCLocationsType, ConditionField('name', '==', object["type"]), True)
            if not type_bdd:
                type_bdd = self.bot.database_manager.insert_entity(SCLocationsType.SCLocationsType(object["type"]))

            parent = None
            if object["type"] != "STAR":
                designation = object["designation"]
                parent = self.bot.database_manager.select_entity(SCLocations.SCLocations, ConditionField('parent.designation', '==', designation.split(" ")[0] if object["type"] == "PLANET" else self.replace_arabic_with_roman(designation[:-1])), True)

            object_bdd = SCLocations.SCLocations(
                (object["designation"] if object["type"] == "STAR" else object["name"]), 
                object["designation"],
                type_bdd,
                parent
            )

            object_bdd = self.bot.database_manager.insert_entity(object_bdd)
        return object_bdd

    def insert_and_get_locations_sc(self): 
        try:  
            Log.PrintLog('Récupération Systèmes Star Citizen via API')
            all_systems = self.get_data_from_api_sc('starmap/systems')
            parts_pourcent = 100 / len(all_systems["data"]) 
            pourcent = 0
            for system in all_systems["data"]:
                pourcent += parts_pourcent
                Log.PrintLog(f"Insertion du système: {system["name"]} - {round(pourcent)}% ({self.get_nb_request()})")
                data_system = self.get_data_from_api_sc('starmap/search', {'name' : system['name']}) 
                stars = list()
                planets = list()
                satellites = list()
                for obj in data_system['data']['objects']:
                    object = {
                        'name' : obj["name"],
                        'designation' : obj["designation"],
                        'type': obj["type"]
                    }
                    
                    if obj['type'] == 'STAR':                    
                        stars.append(object)
                    elif obj['type'] == 'PLANET':
                        planets.append(object)
                    elif obj['type'] == 'SATELLITE':
                        satellites.append(object)


                for star in stars:
                    self.insert_data_system_sc(star)

                for planet in planets:
                    self.insert_data_system_sc(planet)

                for satellite in satellites:
                    self.insert_data_system_sc(satellite)
            
            Log.PrintLog('Fin Récupération Systèmes Star Citizen via API')
        except Exception as e:
            Log.PrintError(e)




            
            

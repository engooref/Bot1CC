import requests, os

class GitHubProjects:
    def __init__(self):
        self.git_token = os.getenv('GIT_TOKEN')
        self.user_or_org = os.getenv('GIT_NAME')
        self.headers = {
            "Authorization": f"Bearer {self.git_token}",
            "Accept": "application/vnd.github+json",
        }

        self.project_id = None

    def execute_graphql(self, query, variables=None):
        """Exécute une requête GraphQL et retourne le résultat."""
        url = "https://api.github.com/graphql"
        response = requests.post(
            url, json={"query": query, "variables": variables}, headers=self.headers
        )
        if response.status_code == 200:
            return response.json()
        else:
            raise Exception(f"Erreur GraphQL : {response.status_code}, {response.json()}")

    def get_projects_id(self):
        """Récupère les projets Beta associés à l'utilisateur ou l'organisation."""
        if self.project_id:
            return self.project_id
        
        query = """
        query($login: String!) {
          user(login: $login) {
            projectsV2(first: 10) {
              nodes {
                id
                title
              }
            }
          }
        }
        """
        variables = {"login": self.user_or_org}
        data = self.execute_graphql(query, variables)
        projects = data.get("data", {}).get("user", {}).get("projectsV2", {}).get("nodes", [])
        for project in projects:
                if project['title'] == 'Projet Site 1CC':
                    self.project_id = project['id']
                    break
        return self.project_id

    def get_repo_id(self, repo_name):
        """Récupère l'ID d'un dépôt spécifique."""
        query = """
        query($owner: String!, $repo: String!) {
          repository(owner: $owner, name: $repo) {
            id
          }
        }
        """
        owner, repo = repo_name.split("/")
        variables = {"owner": owner, "repo": repo}
        data = self.execute_graphql(query, variables)
        repo_id = data.get("data", {}).get("repository", {}).get("id", None)
        if not repo_id:
            raise Exception(f"Dépôt introuvable : {repo_name}")
        return repo_id

    def create_issue_in_repo(self, repo_name, title, body=None):
        """Crée une issue dans un dépôt spécifique."""
        mutation = """
        mutation($repositoryId: ID!, $title: String!, $body: String) {
          createIssue(input: {
            repositoryId: $repositoryId,
            title: $title,
            body: $body
          }) {
            issue {
              id
              number
              url
            }
          }
        }
        """
        repo_id = self.get_repo_id(repo_name)
        variables = {"repositoryId": repo_id, "title": title, "body": body or ""}
        data = self.execute_graphql(mutation, variables)
        issue = data.get("data", {}).get("createIssue", {}).get("issue", None)
        if not issue:
            raise Exception(f"Échec de la création de l'issue dans le dépôt : {repo_name}")
        return issue

    def add_issue_to_project(self, issue_id):
        """Ajoute une issue existante à un projet Beta."""
        mutation = """
        mutation($projectId: ID!, $contentId: ID!) {
          addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
            item {
              id
            }
          }
        }
        """
        variables = {"projectId": self.get_projects_id(), "contentId": issue_id}
        data = self.execute_graphql(mutation, variables)
        return data

    def create_and_add_issue(self, repo_name, title, body=None):
        """Crée une issue dans un dépôt et la lie à un projet Beta."""
        # Étape 1 : Créer l'issue dans le dépôt
        issue = self.create_issue_in_repo(repo_name, title, body)
        issue_id = issue["id"]

        # Étape 2 : Lier l'issue au projet Beta
        project_response = self.add_issue_to_project(issue_id)

        return {
            "issue_url": issue["url"],
            "project_response": project_response,
            "issue_id": issue_id
        }
    

    def update_field_value(self, item_id, field_id, value):
        """Met à jour un champ pour un élément dans un projet Beta."""
        mutation = """
        mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
          updateProjectV2ItemFieldValue(input: {
            projectId: $projectId,
            itemId: $itemId,
            fieldId: $fieldId,
            value: $value
          }) {
            projectV2Item {
              id
            }
          }
        }
        """
        variables = {
            "projectId": self.project_id,
            "itemId": item_id,
            "fieldId": field_id,
            "value": { 'singleSelectOptionId': value },
        }
        data = self.execute_graphql(mutation, variables)
        return data

    def get_field_id(self, field_name):
        """Récupère l'ID d'un champ en fonction de son nom dans un projet."""
        query = """
        query($projectId: ID!) {
            node(id: $projectId) {
                ... on ProjectV2 {
                    fields(first: 20) {
                        nodes {
                            ... on ProjectV2FieldCommon {
                                id
                                name
                            }
                            ... on ProjectV2SingleSelectField {
                                id
                                name
                                options {
                                    id
                                    name
                                }
                            }
                        }
                    }
                }
            }
        }
        """
        variables = {"projectId": self.get_projects_id()}
        data = self.execute_graphql(query, variables)
        
        fields = data.get("data", {}).get("node", {}).get("fields", {}).get("nodes", [])
        for field in fields:
            if field["name"].lower() == field_name.lower():
                return field["id"], field['options']
        
        raise Exception(f"Field '{field_name}' introuvable dans le projet {self.project_id}.")
    
    def add_issue_with_field(self, repo_name, title, field_name, field_value, body=None):
        """Ajoute une issue au projet et met à jour un champ."""
        # Étape 1 : Ajouter l'issue au projet
        item = self.create_and_add_issue(repo_name, title, body)
        item_id = item['project_response'].get("data", {}).get("addProjectV2ItemById", {}).get("item", {}).get("id")
        
        # Étape 2 : Mettre à jour le champ
        field_id, options = self.get_field_id(field_name)
        option = next(obj for obj in options if obj['name'].lower() == field_value.lower())
        self.update_field_value(item_id, field_id, option['id'])

        field_id, options = self.get_field_id('Status')
        option = next(obj for obj in options if obj['name'].lower() == 'backlog')
        self.update_field_value(item_id, field_id, option['id'])

        return item_id, item["issue_url"]
    
    def parse_repo_and_issue(self, repo_issue_string):
        """Analyse une chaîne 'repo_name:issue_id' pour extraire le dépôt et l'ID de l'issue."""
        try:
            repo_name, issue_number = repo_issue_string.split(":")
            return repo_name, int(issue_number)
        except ValueError:
            raise ValueError("Le format attendu est 'repo_name:issue_id'.")

    def get_issue_id(self, repo_name, issue_number):
        """Récupère l'ID interne de l'issue dans GitHub."""
        query = """
        query($owner: String!, $repo: String!, $issueNumber: Int!) {
          repository(owner: $owner, name: $repo) {
            issue(number: $issueNumber) {
              id
            }
          }
        }
        """
        owner, repo = repo_name.split("/")
        variables = {"owner": owner, "repo": repo, "issueNumber": issue_number}
        data = self.execute_graphql(query, variables)
        issue_id = data.get("data", {}).get("repository", {}).get("issue", {}).get("id", None)
        if not issue_id:
            raise Exception(f"Issue #{issue_number} introuvable dans le dépôt : {repo_name}")
        return issue_id

    def close_issue(self, repo_issue_string):
        """Ferme une issue à partir de la chaîne 'repo_name:issue_id'."""
        # Étape 1 : Extraire le dépôt et l'ID de l'issue
        repo_name, issue_number = self.parse_repo_and_issue(repo_issue_string)

        # Étape 2 : Récupérer l'ID interne de l'issue
        issue_id = self.get_issue_id(repo_name, issue_number)

        # Étape 3 : Fermer l'issue
        mutation = """
        mutation($issueId: ID!) {
          closeIssue(input: {issueId: $issueId}) {
            issue {
              id
              state
            }
          }
        }
        """
        variables = {"issueId": issue_id}
        data = self.execute_graphql(mutation, variables)
        closed_issue = data.get("data", {}).get("closeIssue", {}).get("issue", None)
        if not closed_issue or closed_issue["state"] != "CLOSED":
            raise Exception(f"Impossible de fermer l'issue #{issue_number} dans le dépôt : {repo_name}")
        return closed_issue
    
github = GitHubProjects()
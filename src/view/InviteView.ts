import BotManager from "../BotManager.js";
import { ButtonStyle, ButtonBuilder, ActionRowBuilder } from "discord.js";
import { BaseComponentView, getDefinitions, ViewHandlers } from "./BaseView.js";
import { ComponentType} from "../entities/ViewContext.js";
import { JSONComponent } from "../utils/Type.js";

/**
   * View pour l'invitation à un événement.
   * Construit ses propres boutons et leur customIds, puis appelle le super.
   */
export class InviteView extends BaseComponentView {
    constructor(
      bot: BotManager,
      private eventId: number,
      withRole = false,
    ) {
      let definitions: JSONComponent[] = getDefinitions('./src/views/definitions/invite.json');

      // 2️⃣ Filtrer le bouton “role_{id}” si `withRole` est false
      if (!withRole) {
        definitions = definitions.filter(def => !def.customId.startsWith('role_'));
      }

      // 3️⃣ Remplacer le placeholder `{id}` par la valeur eventId pour chaque customId
      const instantiatedDefs = definitions.map(def => {
        // On fait une copie superficielle de l'objet
        const copy: JSONComponent = { ...def };

        // customId original contient “_{id}” ; on remplace `{id}` par eventId
        copy.customId = def.customId.replace('{id}', String(eventId));

        return copy;
      });
      
      super(bot, ViewHandlers.InviteViewHandler, ComponentType.Button, instantiatedDefs);
    }
  
    protected getData(customId: string): Record<string, any> {
      const [responseType] = customId.split('_');
      return { eventId: this.eventId, responseType};
    }
  }
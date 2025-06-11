import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageActionRowComponentBuilder} from "discord.js";
import BotManager from "../BotManager.js";
import { BaseComponentView, injectDefaults, ViewHandlers } from "./BaseView.js";
import { ComponentType } from "../entities/ViewContext.js";
import { JSONConfigManager } from "../utils/JSONConfigManager.js";
import { JSONComponent, JSONTypeComponent } from "../utils/Type.js";
import fs from 'fs';
import path from "path";

export enum Handlers {
  SelectCategory = 'select_screen_category',

}

export default class ScreenConfigView extends BaseComponentView {
    public embed: EmbedBuilder;
    constructor(
            bot: BotManager,
        ) {
            const json: JSONComponent[] = [
                {
                    "type": JSONTypeComponent.StringSelectMenu,
                    "customId": Handlers.SelectCategory,
                    "placeholder": "Choisissez le type de catégorie",
                    "options": [
                    {
                        "label": "Salons & Rôles",
                        "value": "cat_salons_roles",
                        "description": "Channel Screenshots, Rôle Organisateur, etc."
                    },
                    {
                        "label": "Planification & Automatisation",
                        "value": "cat_planification",
                        "description": "Fuseau horaire, jour/horaire, rappels…"
                    },
                    {
                        "label": "Contenu du thread & Messages",
                        "value": "cat_contenu_messages",
                        "description": "Nom du thread, message de bienvenue, thème…"
                    },
                    {
                        "label": "Système de vote & Classement",
                        "value": "cat_vote_classement",
                        "description": "Émoji de vote, nombre de finalistes…"
                    }
                    ]
                }
            ]

            super(bot, ViewHandlers.ScreenHandler, ComponentType.Select, json)

            this.embed = new EmbedBuilder()
            .setTitle("🛠 Panneau de configuration – Screen of the Week")
            .setDescription(
                "Sélectionne dans le menu déroulant **la catégorie** que tu souhaites modifier.\n\n" +
                "🔹 **Salons & Rôles** :\n" +
                "   • `Channel Screenshots` (salon où poster les screens)\n" +
                "   • `Rôle Organisateur` (qui gère le concours)\n" +
                "   • `Channel Statistiques` (où publier les résultats)\n" +
                "   • `Rôle Notification` (ping des participants au lancement)\n\n" +
                "🔹 **Planification & Automatisation** :\n" +
                "   • `Fuseau horaire` (IANA, ex. Europe/Paris)\n" +
                "   • `Jour de création` (jour de la semaine pour générer le thread)\n" +
                "   • `Heure de création` (HH:mm)\n" +
                "   • `Durée d’archivage` (en minutes)\n" +
                "   • `Rappels automatiques` (activer/désactiver)\n" +
                "   • `Heures avant rappel` (nombre d’heures avant la clôture)\n\n" +
                "🔹 **Contenu du thread & Messages** :\n" +
                "   • `Nom du thread` (template)\n" +
                "   • `Message de bienvenue` (texte initial dans le thread)\n" +
                "   • `Thème par défaut` (texte)\n\n" +
                "\n" +
                "*Tu pourras modifier chaque option dans le menu suivant.*"
            )
            .setColor("Blue");
        }
    
        protected getData(customId: string): Record<string, any> {
            return {}
        }
}

export class ScreenConfig2View extends BaseComponentView {

    constructor(
        bot: BotManager,
        selectCat: string,
        config: JSONConfigManager<Record<string, string>>,
    ) {
        // 1️⃣ Charger le JSON global
        const raw = fs.readFileSync(path.resolve('./src/view/definitions/screen.json'), 'utf-8');
        const allDefs: Record<string, JSONComponent[]> = JSON.parse(raw);

        // 2️⃣ Récupérer uniquement la liste pour selectCat
        const categoryDefs = injectDefaults(allDefs[selectCat] ?? [], config);

        const instantiatedDefs = categoryDefs.map(def => {
            // 1️⃣ Deep‐clone rapide (si tu n'as pas de fonctions à l'intérieur)
            const copy: JSONComponent = { ... def };
            if (copy.type === JSONTypeComponent.StringSelectMenu) {
                // 2️⃣ Replace dans le customId

                // 3️⃣ Si tu as un champ `other`, boucle-le pour remplacer aussi le placeholder
                if (copy.other) {
                    copy.other = copy.other.map(o => {
                        if (o.other && (typeof o.other === 'string'))
                            return {
                                ...o,
                                other: o.other.replace(/\{(.+?)\}/g, (_match, placeholder) => {return config.get(placeholder) ?? ''}),
                            }
                        else return o;
                    });

                }
            }
            return copy;
        });
        
        // 3️⃣ Ajouter systématiquement les boutons de validation/annulation
        
        const rows = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId('config_validate')
                .setLabel('Valider')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('config_cancel')
                .setLabel('Annuler')
                .setStyle(ButtonStyle.Danger),
        )

        // 4️⃣ Appel au constructeur parent
        super(
        bot,
        ViewHandlers.ScreenHandler,   // ou l’enum adapté
        ComponentType.Button,            // drapeau générique
        instantiatedDefs                      // uniquement les composants de la catégorie
        );

        this.rows = [...this.rows, rows]
    }

    protected getData(customId: string): Record<string, any> {
        return {}
    }
}
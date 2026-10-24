/**
 * Rapprochement des labels saisis dans Discord avec ceux qui existent sur le dépôt GitHub.
 *
 * GitHub compare les noms de labels sans tenir compte de la casse ni des accents : envoyer
 * `amelioration` alors que `amélioration` existe fait échouer la création de l'issue
 * (422, `name: already_exists`). On remplace donc la saisie par le nom exact du dépôt.
 */

/** Forme comparable d'un nom de label : sans accents, en minuscules, espaces normalisés. */
export function normalizeLabelName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export interface ResolvedLabels {
    /** Noms exacts à envoyer à GitHub, sans doublon. */
    labels: string[];
    /** Saisies qui ne correspondent à aucun label du dépôt (non envoyées). */
    unknown: string[];
}

/**
 * @param requested labels saisis, dans l'ordre
 * @param existing noms exacts des labels du dépôt
 * @param alwaysSend labels toujours envoyés tels quels, même absents du dépôt (labels automatiques du bot)
 */
export function resolveLabels(requested: string[], existing: string[], alwaysSend: string[] = []): ResolvedLabels {
    const byKey = new Map<string, string>();
    for (const name of existing) byKey.set(normalizeLabelName(name), name);

    const labels: string[] = [];
    const seen = new Set<string>();
    const unknown: string[] = [];

    const push = (name: string) => {
        const key = normalizeLabelName(name);
        if (seen.has(key)) return;
        seen.add(key);
        labels.push(name);
    };

    for (const input of requested) {
        const match = byKey.get(normalizeLabelName(input));
        if (match) push(match);
        else if (!unknown.some(u => normalizeLabelName(u) === normalizeLabelName(input))) unknown.push(input);
    }
    for (const auto of alwaysSend) push(byKey.get(normalizeLabelName(auto)) ?? auto);

    return { labels, unknown };
}

class ComponentHandlerRegistry {
    constructor() {
        this.handlers = new Map();
    }
    /**
     * Enregistre un handler sous une clé unique
     */
    register(key, fn) {
        if (this.handlers.has(key)) {
            throw new Error(`Handler déjà enregistré pour la clé ${key}`);
        }
        this.handlers.set(key, fn);
    }
    /**
     * Récupère le handler associé à une clé, ou `undefined`
     */
    get(key) {
        return this.handlers.get(key);
    }
}
export const componentHandlerRegistry = new ComponentHandlerRegistry();
//# sourceMappingURL=ComponentHandlerRegistry.js.map
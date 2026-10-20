import { rmSync } from 'node:fs';

// Supprimer les anciennes entités compilées avant la découverte ORM en production.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });

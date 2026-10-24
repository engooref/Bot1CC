import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLabelName, resolveLabels } from '../dist/src/utils/GithubLabels.js';

const EXISTING = ['bug', 'enhancement', 'amélioration', 'a-trier', 'from-discord', 'P2', 'good first issue'];

test('normalizeLabelName ignore la casse, les accents et les espaces en trop', () => {
  assert.equal(normalizeLabelName('  Amélioration '), 'amelioration');
  assert.equal(normalizeLabelName('GOOD   First Issue'), 'good first issue');
});

test('amelioration retombe sur le label existant amélioration (cas du ticket #13)', () => {
  const { labels, unknown } = resolveLabels(['amelioration'], EXISTING, ['from-discord', 'a-trier']);
  assert.deepEqual(labels, ['amélioration', 'from-discord', 'a-trier']);
  assert.deepEqual(unknown, []);
});

test('la casse est corrigée et les doublons sont supprimés sans tenir compte de la casse', () => {
  const { labels } = resolveLabels(['Bug', 'bug', 'p2', 'A-Trier'], EXISTING, ['from-discord', 'a-trier']);
  assert.deepEqual(labels, ['bug', 'P2', 'a-trier', 'from-discord']);
});

test('un label inconnu est signalé et non envoyé', () => {
  const { labels, unknown } = resolveLabels(['n-existe-pas', 'N-Existe-Pas', 'bug'], EXISTING, []);
  assert.deepEqual(labels, ['bug']);
  assert.deepEqual(unknown, ['n-existe-pas']);
});

test('les labels automatiques sont envoyés même absents du dépôt', () => {
  const { labels } = resolveLabels([], ['bug'], ['from-discord', 'a-trier']);
  assert.deepEqual(labels, ['from-discord', 'a-trier']);
});

test('saisie vide', () => {
  assert.deepEqual(resolveLabels([], EXISTING, []), { labels: [], unknown: [] });
});

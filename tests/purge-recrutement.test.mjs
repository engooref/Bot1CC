import test from 'node:test';
import assert from 'node:assert/strict';
import { isOpenRecruitmentDossier, shouldSparePurgedUser } from '../dist/src/managers/purgeRules.js';

const spared = (dossier, rhMemberStatus) =>
  shouldSparePurgedUser({ hasOpenDossier: dossier ? isOpenRecruitmentDossier(dossier) : false, rhMemberStatus });

test('dossier candidate ouvert épargné', () => {
  assert.equal(spared({ status: 'candidate' }), true);
});

test('dossier awaiting_mentor épargné', () => {
  assert.equal(spared({ status: 'awaiting_mentor', mentorship: {} }), true);
});

test('waiting_rsi, review et postulant sont ouverts', () => {
  for (const status of ['waiting_rsi', 'review', 'postulant']) {
    assert.equal(isOpenRecruitmentDossier({ status }), true, status);
  }
});

test('dossier refused, expired ou integrated anonymisé', () => {
  for (const status of ['refused', 'expired', 'integrated']) {
    assert.equal(spared({ status }), false, status);
  }
});

test('mentorat clos : dossier non ouvert', () => {
  assert.equal(spared({ status: 'candidate', mentorship: { closedAt: '2026-01-01T00:00:00Z' } }), false);
});

test('sans dossier : anonymisé', () => {
  assert.equal(spared(undefined, undefined), false);
  assert.equal(spared(undefined, null), false);
});

test('ancien rhmember Candidatures toujours épargné', () => {
  assert.equal(spared(undefined, 'Candidatures'), true);
  assert.equal(spared({ status: 'refused' }, 'Candidatures'), true);
});

test('autre statut de rhmember : pas d\'effet', () => {
  assert.equal(spared(undefined, 'Actif'), false);
});

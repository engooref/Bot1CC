import assert from 'node:assert/strict';
import { test } from 'node:test';
const { shouldRejectYoungAccount, isYoungAccount, DEFAULT_YOUNG_ACCOUNT_MIN_DAYS } = await import('../dist/src/utils/YoungAccount.js');

const day = 24 * 60 * 60 * 1000;
const at = 1_000 * day;
const base = { at, minDays: 90, isBot: false, userId: '100000000000000020', exemptIds: [] };

test('compte jeune refusé, compte ancien accepté', () => {
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day }), true);
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 91 * day }), false);
});

test('identifiant exempté non soumis à la règle, autre identifiant refusé', () => {
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day, exemptIds: [base.userId] }), false);
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day, exemptIds: ['100000000000000021'] }), true);
});

test('liste vide : aucune exemption ; bots jamais refusés', () => {
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day, exemptIds: [] }), true);
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day, isBot: true }), false);
});

test('seuil configurable, valeur invalide ramenée à 90 jours', () => {
    assert.equal(shouldRejectYoungAccount({ ...base, createdTimestamp: at - 10 * day, minDays: 7 }), false);
    assert.equal(isYoungAccount(at - 10 * day, at, 0), true);
    assert.equal(isYoungAccount(at - 10 * day, at, Number.NaN), true);
    assert.equal(DEFAULT_YOUNG_ACCOUNT_MIN_DAYS, 90);
});

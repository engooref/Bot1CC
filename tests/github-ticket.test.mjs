import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_TITLE_MAX, buildIssueTitle, ticketNumberFromChannelName } from '../dist/src/utils/GithubTicket.js';

test('un salon tickets-<pseudo> ne donne pas de numéro, même si le pseudo contient des chiffres', () => {
  assert.equal(ticketNumberFromChannelName('tickets-bob2000'), null);
  assert.equal(ticketNumberFromChannelName('tickets-1234'), null);
  assert.equal(ticketNumberFromChannelName('salon-42'), null);
});

test('les anciens noms ticket-N, assistance-N et support-N sont toujours reconnus', () => {
  assert.equal(ticketNumberFromChannelName('ticket-1234'), '1234');
  assert.equal(ticketNumberFromChannelName('Ticket_56'), '56');
  assert.equal(ticketNumberFromChannelName('assistance 7'), '7');
  assert.equal(ticketNumberFromChannelName('support-9'), '9');
});

test('le titre porte le numéro du ticket quand il est connu', () => {
  assert.equal(buildIssueTitle('12', 'tickets-bob', 'Le bot crash'), '[Ticket #12] Le bot crash');
});

test('sans numéro, le titre porte le nom du salon', () => {
  assert.equal(buildIssueTitle(null, 'tickets-bob', 'Le bot crash'), '[tickets-bob] Le bot crash');
});

test('un titre court n est pas modifié', () => {
  const title = 'a'.repeat(100);
  assert.equal(buildIssueTitle('3', 'x', title), `[Ticket #3] ${title}`);
});

test('un titre trop long est tronqué à 256 caractères, préfixe conservé', () => {
  const result = buildIssueTitle('12', 'x', 'a'.repeat(256));
  assert.equal(result.length, ISSUE_TITLE_MAX);
  assert.ok(result.startsWith('[Ticket #12] '));
  assert.ok(result.endsWith('…'));
});

test('un titre exactement à la limite n est pas tronqué', () => {
  const prefix = '[Ticket #12] ';
  const title = 'b'.repeat(ISSUE_TITLE_MAX - prefix.length);
  const result = buildIssueTitle('12', 'x', title);
  assert.equal(result, prefix + title);
  assert.equal(result.length, ISSUE_TITLE_MAX);
});

test('un nom de salon énorme ne dépasse jamais la limite', () => {
  const result = buildIssueTitle(null, 'c'.repeat(400), 'titre');
  assert.ok(result.length <= ISSUE_TITLE_MAX);
});

test('les espaces autour du titre saisi sont retirés', () => {
  assert.equal(buildIssueTitle('5', 'x', '  Titre  '), '[Ticket #5] Titre');
});

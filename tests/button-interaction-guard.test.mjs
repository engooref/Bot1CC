import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ButtonInteractionGuard } from '../dist/src/utils/ButtonInteractionGuard.js';

test('blocks the entire running action, then allows retry after cooldown', async () => {
  const guard = new ButtonInteractionGuard(10);
  const release = guard.acquire('message:user');
  assert.equal(typeof release, 'function');
  await delay(20);
  assert.equal(guard.acquire('message:user'), undefined);
  release();
  assert.equal(guard.acquire('message:user'), undefined);
  await delay(20);
  const retry = guard.acquire('message:user');
  assert.equal(typeof retry, 'function');
  retry();
});

test('other users and other messages remain usable', () => {
  const guard = new ButtonInteractionGuard(10);
  const releases = ['message:user', 'message:other', 'other:user'].map(key => guard.acquire(key));
  for (const release of releases) {
    assert.equal(typeof release, 'function');
    release();
  }
});

test('finally releases the action after a handler error', async () => {
  const guard = new ButtonInteractionGuard(10);
  const release = guard.acquire('message:user');
  await assert.rejects(async () => {
    try { throw new Error('handler failed'); }
    finally { release(); }
  });
  await delay(20);
  const retry = guard.acquire('message:user');
  assert.equal(typeof retry, 'function');
  retry();
});

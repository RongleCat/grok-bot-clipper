import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { createTaskProcessor } from '../src/offscreen/tasks.js';
import { put, get } from '../src/core/db.js';

test('direct document processing sends once and checks account scope before every send stage', async () => {
  const checks = [];
  let sends = 0,
    notices = 0;
  const processor = createTaskProcessor({
    api: { runtime: { getURL: (p) => p } },
    authorize: async (scope) => {
      checks.push(scope);
      return scope.generation === 'current';
    },
    notify: async () => {
      notices++;
    },
    createClient: () => ({
      sendMessage: async () => {
        sends++;
        return { delivery: 'accepted' };
      },
    }),
  });
  await put('jobs', {
    id: 'processor-job',
    accountId: 'a',
    workspaceId: 'personal',
    botId: 'bot',
    state: 'queued',
    packet: { text: 'Hello', attachments: [] },
  });
  await processor['job.run']({
    jobId: 'processor-job',
    accountId: 'a',
    generation: 'current',
    credentials: { accessToken: 'synthetic' },
  });
  assert.equal(sends, 1);
  assert.equal((await get('jobs', 'processor-job')).state, 'accepted');
  assert.ok(checks.length >= 2);
  assert.ok(checks.every((s) => s.accountId === 'a' && s.workspaceId === 'personal'));
  assert.ok(notices > 0);
  assert.deepEqual(await processor['jobs.status'](), []);
  await put('jobs', {
    id: 'processor-stale',
    accountId: 'a',
    workspaceId: 'personal',
    botId: 'bot',
    state: 'queued',
    packet: { text: 'No', attachments: [] },
  });
  await assert.rejects(
    processor['job.run']({
      jobId: 'processor-stale',
      accountId: 'a',
      generation: 'stale',
      credentials: {},
    }),
    /ACCOUNT_CHANGED/,
  );
  assert.equal(sends, 1);
});

test('Chrome offscreen authorization messages and duplicate-job protection are preserved', async () => {
  const messages = [];
  let sends = 0;
  const processor = createTaskProcessor({
    api: {
      runtime: {
        sendMessage: async (m) => {
          messages.push(m);
          return { ok: true, value: { allowed: true } };
        },
      },
    },
    createClient: () => ({
      sendMessage: async () => {
        sends++;
        return { delivery: 'accepted' };
      },
    }),
  });
  await put('jobs', {
    id: 'chrome-offscreen-job',
    accountId: 'a',
    workspaceId: 'team:42',
    state: 'queued',
    packet: { text: 'Hello', attachments: [] },
  });
  const message = {
    jobId: 'chrome-offscreen-job',
    accountId: 'a',
    generation: 'g',
    credentials: {},
  };
  await Promise.all([processor['job.run'](message), processor['job.run'](message)]);
  assert.equal(sends, 1);
  const checks = messages.filter((m) => m.type === 'auth.check');
  assert.ok(checks.length >= 2);
  assert.ok(
    checks.every((m) => m.workspaceId === 'team:42' && m.generation === 'g' && m.accountId === 'a'),
  );
  assert.ok(messages.some((m) => m.type === 'state.changed'));
});

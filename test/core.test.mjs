import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../src/core/context.js');
test('routing uses explicit > site > action > default and rejects vanished targets', async () => {
  const { resolveBot } = await load();
  const bots = ['default', 'action', 'site', 'explicit'].map((id) => ({ id }));
  const settings = {
    defaultBotId: 'default',
    actionBots: { screenshot: 'action' },
    rules: [{ host: 'example.com', botId: 'site' }],
  };
  assert.equal(
    resolveBot({ bots, settings, url: 'https://example.com/a', kind: 'screenshot' }).id,
    'site',
  );
  assert.equal(
    resolveBot({
      bots,
      settings,
      explicitBotId: 'explicit',
      url: 'https://example.com',
      kind: 'screenshot',
    }).id,
    'explicit',
  );
  assert.throws(() => resolveBot({ bots, settings, explicitBotId: 'missing' }), /BOT_UNAVAILABLE/);
});
test('context packages full material as files when inline budget is exceeded', async () => {
  const { packContext } = await load();
  const text = '中文上下文'.repeat(4000);
  const p = await packContext({
    items: [
      {
        id: 'one',
        kind: 'page',
        title: 'Evidence',
        url: 'https://example.com/?token=secret&q=paper',
        markdown: text,
        capturedAt: '2026-10-17T00:00:00Z',
      },
    ],
    instruction: 'compare',
    maxTextBytes: 4096,
  });
  assert.ok(new TextEncoder().encode(p.text).length <= 4096);
  assert.ok(
    p.attachments.some(
      (a) => a.name.endsWith('.md') && a.blob.size >= new TextEncoder().encode(text).length,
    ),
  );
  assert.ok(p.text.includes('[1]'));
  assert.ok(!p.text.includes('secret'));
  assert.ok(p.attachments.some((a) => a.name === 'context.json'));
});
test('explicit capture loss is preserved in material and source manifest', async () => {
  const { packContext } = await load();
  const p = await packContext({
    items: [
      {
        id: 'one',
        title: 'Canvas',
        kind: 'image',
        url: 'https://example.com',
        warnings: ['原图无法读取'],
        markdown: 'image link',
      },
    ],
    instruction: '',
  });
  assert.match(p.text, /原图无法读取/);
  const manifest = JSON.parse(
    await p.attachments.find((x) => x.name === 'context.json').blob.text(),
  );
  assert.deepEqual(manifest.sources[0].warnings, ['原图无法读取']);
});
test('material URLs remove credential query and userinfo but retain ordinary context', async () => {
  const { cleanURL } = await load();
  assert.equal(
    cleanURL('https://u:p@example.com/x?access_token=abc&item=42#part'),
    'https://example.com/x?item=42#part',
  );
});
test('CSV escapes cells and prevents spreadsheet formula injection', async () => {
  const { toCSV } = await load();
  assert.equal(toCSV([['=SUM(A1)', 'a,b', '"quoted"']]), '"\'=SUM(A1)","a,b","""quoted"""');
});
test('outbox never retries an ambiguous submitted job automatically', async () => {
  const { runJob } = await import('../src/core/outbox.js');
  let sends = 0;
  const saved = [];
  const job = {
    id: 'j1',
    messageId: 'm1',
    state: 'queued',
    botId: 'b',
    sessionId: '',
    packet: { text: 'hello', attachments: [] },
    uploaded: [],
  };
  await runJob(job, {
    save: async (j) => saved.push(structuredClone(j)),
    client: {
      sendMessage: async () => {
        sends++;
        throw new Error('SEND_UNCONFIRMED');
      },
    },
  });
  assert.equal(job.state, 'uncertain');
  await runJob(job, {
    save: async () => {},
    client: {
      sendMessage: async () => {
        sends++;
      },
    },
  });
  assert.equal(sends, 1);
  assert.ok(saved.some((j) => j.state === 'submitting'));
});
test('NOT_FOUND delivery status never becomes accepted', async () => {
  const { deliveryState } = await import('../src/core/outbox.js');
  assert.equal(deliveryState(1), 'uncertain');
  assert.equal(deliveryState('GROK_BOT_SEND_STATUS_NOT_FOUND'), 'uncertain');
  assert.equal(deliveryState(2), 'accepted');
  assert.equal(deliveryState(3), 'failed');
});
test('cancelling before submission cannot send', async () => {
  const { runJob } = await import('../src/core/outbox.js');
  const c = new AbortController();
  c.abort();
  let sends = 0;
  const job = { state: 'queued', packet: { text: 'x', attachments: [] }, uploaded: [] };
  await runJob(job, {
    save: async () => {},
    signal: c.signal,
    client: {
      sendMessage: async () => {
        sends++;
      },
    },
  });
  assert.equal(sends, 0);
  assert.equal(job.state, 'failed');
});
test('context includes structured page, code and media metadata', async () => {
  const { packContext } = await load();
  const p = await packContext({
    items: [
      {
        id: 'meta',
        kind: 'page',
        title: 'source',
        url: 'https://example.com',
        markdown: 'material',
        description: 'page description',
        language: 'zh-CN',
        headings: ['Evidence'],
        codes: [{ language: 'language-python', text: 'print(42)' }],
        image: { url: 'https://example.com/img.png', alt: 'chart' },
        video: { currentTime: 12 },
      },
    ],
  });
  assert.equal(p.manifest.sources[0].language, 'zh-CN');
  assert.deepEqual(p.manifest.sources[0].headings, ['Evidence']);
  assert.equal(p.manifest.sources[0].video.currentTime, 12);
  assert.ok(p.attachments.some((a) => a.name.endsWith('.py')));
});
test('URL fragment credentials are removed from captured sources', async () => {
  const { cleanURL } = await load();
  assert.equal(cleanURL('https://example.com/#access_token=secret'), 'https://example.com/');
});
test('authorization is rechecked immediately before submission', async () => {
  const { runJob } = await import('../src/core/outbox.js');
  let sent = 0;
  const job = { state: 'queued', packet: { text: 'x', attachments: [] }, uploaded: [] };
  await runJob(job, {
    save: async () => {},
    authorize: async () => {
      throw Error('ACCOUNT_CHANGED');
    },
    client: {
      sendMessage: async () => {
        sent++;
      },
    },
  });
  assert.equal(sent, 0);
  assert.equal(job.state, 'failed');
});

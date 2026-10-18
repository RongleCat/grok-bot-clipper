import test from 'node:test';
import assert from 'node:assert/strict';
const load = () => import('../src/sdk/index.js');
test('browser PKCE challenge is SHA256 of URL-safe verifier', async () => {
  const { createLogin } = await load();
  const flow = await createLogin();
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(flow.verifier));
  const expected = Buffer.from(hash).toString('base64url');
  const u = new URL(flow.loginUrl);
  assert.equal(u.searchParams.get('challenge'), expected);
  assert.ok(flow.verifier.length >= 43);
  assert.equal(u.origin, 'https://cursor.com');
});
test('Connect parser handles fragmented Unicode and an end frame', async () => {
  const { encodeConnectFrame, readConnectFrames } = await load();
  const a = encodeConnectFrame({ message: '图像上下文' }),
    b = encodeConnectFrame({}, 2);
  const bytes = new Uint8Array(a.length + b.length);
  bytes.set(a);
  bytes.set(b, a.length);
  const stream = new ReadableStream({
    start(c) {
      for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3));
      c.close();
    },
  });
  const rows = [];
  for await (const row of readConnectFrames(stream)) rows.push(row);
  assert.deepEqual(rows, [{ message: '图像上下文' }]);
});
test('Connect rejects oversized length before buffering payload', async () => {
  const { readConnectFrames } = await load();
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(Uint8Array.of(0, 127, 255, 255, 255));
      c.close();
    },
  });
  await assert.rejects(async () => {
    for await (const row of readConnectFrames(stream)) {
    }
  }, /STREAM_FRAME_TOO_LARGE/);
});
test('uncertain send stays uncertain and uses the supplied stable ID', async () => {
  const { GrokBotClient } = await load();
  let calls = 0;
  const c = new GrokBotClient({
    accessToken: 'test-only',
    fetchImpl: async (url, init) => {
      calls++;
      assert.equal(JSON.parse(init.body).messageId, 'stable-id');
      return new Response('{}', { status: 502 });
    },
  });
  await assert.rejects(
    () => c.sendMessage({ botId: 'bot1', messageId: 'stable-id', text: 'hello' }),
    /SEND_UNCONFIRMED/,
  );
  assert.equal(calls, 1);
});
test('request headers never impersonate browser user-agent', async () => {
  const { clientHeaders } = await load();
  const h = clientHeaders({ accessToken: 'x' });
  assert.equal(h['user-agent'], undefined);
  assert.equal(h.authorization, 'Bearer x');
});
test('initial transcript read includes replies and a cursor so opening late cannot miss the answer', async () => {
  const { GrokBotClient } = await load();
  const body = Buffer.from(
    JSON.stringify({ kind: 'send-message', message: { type: 'text', content: '已收到' } }),
  ).toString('base64');
  const c = new GrokBotClient({
    accessToken: 'test',
    fetchImpl: async () =>
      Response.json({
        generation: 2,
        entries: [{ entryId: 'reply1', seq: '4', updatedSeq: '8', body }],
      }),
  });
  const result = await c.listTranscript({ botId: 'b', limit: 50 });
  assert.equal(result.messages[0].text, '已收到');
  assert.deepEqual(result.cursor, { generation: 2, afterUpdatedSeq: '8' });
});
test('team discovery exposes only routing identity, not billing metadata', async () => {
  const { GrokBotClient } = await load();
  const c = new GrokBotClient({
    accessToken: 'test',
    fetchImpl: async () =>
      Response.json({ teams: [{ id: 42, name: '产品团队', customerBalanceCents: 999999 }] }),
  });
  assert.deepEqual(await c.listTeams(), [{ id: 42, name: '产品团队' }]);
});

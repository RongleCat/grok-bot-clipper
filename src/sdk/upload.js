import { sha256, hex, toBase64 } from './bytes.js';
import { SDKError } from './errors.js';
const modeOf = (v) =>
  typeof v === 'number'
    ? ['UNSPECIFIED', 'USE_BOX', 'SINGLE_PUT', 'MULTIPART', 'REFUSED'][v]
    : String(v ?? '').replace('GROK_BOT_ATTACHMENT_UPLOAD_MODE_', '');
const refused = (v) =>
  v !== undefined &&
  v !== 0 &&
  v !== 'GROK_BOT_ATTACHMENT_UPLOAD_REFUSAL_UNSPECIFIED' &&
  v !== 'UNSPECIFIED';
async function rpc(c, name, body, signal) {
  const r = await c.rpc('GrokBotService', name, body, signal);
  if (!r.ok)
    throw new SDKError(
      r.httpStatus === 401 ? 'ACCOUNT_AUTH_FAILED' : 'UPLOAD_RPC_FAILED',
      r.httpStatus,
    );
  if (refused(r.data.refusal)) {
    const error = new SDKError('UPLOAD_REFUSED_' + r.data.refusal);
    if (Number(r.data.limitBytes) > 0) error.limitBytes = Number(r.data.limitBytes);
    throw error;
  }
  return r.data;
}
function targetURL(value) {
  const u = new URL(value);
  if (
    u.protocol !== 'https:' ||
    u.username ||
    u.password ||
    /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/i.test(u.hostname)
  )
    throw new SDKError('UPLOAD_UNTRUSTED_TARGET');
  return u.href;
}
async function put(client, target, blob, signal) {
  if (!target?.url) throw new SDKError('UPLOAD_MISSING_TARGET');
  const headers = new Headers();
  for (const [k, v] of Object.entries(target.headers ?? {})) {
    if (k.toLowerCase() === 'content-length') {
      if (Number(v) !== blob.size) throw new SDKError('UPLOAD_SIZE_MISMATCH');
    } else if (!['authorization', 'cookie', 'host', 'user-agent'].includes(k.toLowerCase()))
      headers.set(k, String(v));
  }
  const r = await client.fetch(targetURL(target.url), {
    method: 'PUT',
    headers,
    body: blob,
    credentials: 'omit',
    redirect: 'error',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000),
  });
  await r.body?.cancel();
  if (!r.ok) throw new SDKError('UPLOAD_PUT_FAILED', r.status);
}
export async function uploadAttachment(
  client,
  {
    botId,
    sessionId = '',
    blob,
    name,
    checkpoint,
    onCheckpoint = async () => {},
    onProgress = () => {},
    signal,
  } = {},
) {
  if (!(blob instanceof Blob) || blob.size === 0 || blob.size > 128 * 1024 * 1024)
    throw new SDKError('ATTACHMENT_SIZE_INVALID');
  if (!name || /[\x00-\x1f/\\]/.test(name)) throw new SDKError('ATTACHMENT_NAME_INVALID');
  let state = checkpoint;
  if (
    !state ||
    state.botId !== botId ||
    state.sessionId !== sessionId ||
    state.name !== name ||
    state.size !== blob.size ||
    Number(state.sessionExpiresAtMs) <= Date.now() + 10000
  ) {
    const digest =
      blob.size <= 64 * 1024 * 1024 ? hex(await sha256(await blob.arrayBuffer())) : undefined;
    const begin = await rpc(
      client,
      'BeginGrokBotAttachmentUpload',
      {
        agentId: botId,
        sessionId,
        fileName: name,
        sizeBytes: String(blob.size),
        supportsStoreAttachmentRefs: true,
        supportsMultipart: true,
        ...(digest ? { sha256Hex: digest } : {}),
      },
      signal,
    );
    state = { ...begin, botId, sessionId, name, size: blob.size, completed: [] };
    await onCheckpoint(state);
  }
  const mode = modeOf(state.mode);
  if (mode === 'USE_BOX')
    return uploadViaGateway(client, { botId, blob, name, signal, onProgress });
  if (!['SINGLE_PUT', 'MULTIPART'].includes(mode) || !state.uploadToken)
    throw new SDKError('UPLOAD_MODE_UNAVAILABLE');
  if (mode === 'SINGLE_PUT') {
    if (!state.completed.includes(1)) {
      let target = state.put;
      if (!target || Number(target.expiresAtMs ?? 0) <= Date.now() + 30000)
        target = (
          await rpc(
            client,
            'PresignGrokBotAttachmentUploadParts',
            { uploadToken: state.uploadToken, parts: [] },
            signal,
          )
        ).put;
      await put(client, target, blob, signal);
      state = { ...state, completed: [1] };
      await onCheckpoint(state);
      onProgress(blob.size, blob.size);
    }
  } else {
    const size = Number(state.partSizeBytes),
      count = Number(state.partCount);
    if (
      !Number.isSafeInteger(size) ||
      size < 1 ||
      count !== Math.ceil(blob.size / size) ||
      count > 10000
    )
      throw new SDKError('UPLOAD_PART_LAYOUT_INVALID');
    for (let partNumber = 1; partNumber <= count; partNumber++) {
      if (state.completed.includes(partNumber)) continue;
      signal?.throwIfAborted();
      const part = blob.slice((partNumber - 1) * size, partNumber * size),
        checksumSha256 = toBase64(await sha256(await part.arrayBuffer()));
      const signed = await rpc(
        client,
        'PresignGrokBotAttachmentUploadParts',
        { uploadToken: state.uploadToken, parts: [{ partNumber, checksumSha256 }] },
        signal,
      );
      const target = signed.parts?.find((p) => p.partNumber === partNumber)?.target;
      await put(client, target, part, signal);
      state = { ...state, completed: [...state.completed, partNumber] };
      await onCheckpoint(state);
      onProgress(Math.min(partNumber * size, blob.size), blob.size);
    }
  }
  const result = await rpc(
    client,
    'CompleteGrokBotAttachmentUpload',
    { uploadToken: state.uploadToken },
    signal,
  );
  if (typeof result.alias !== 'string' || !result.alias) throw new SDKError('UPLOAD_MISSING_ALIAS');
  return result.alias;
}
async function uploadViaGateway(client, { botId, blob, name, signal, onProgress }) {
  const box = await rpc(client, 'EnsureSandBox', { wake: true, supportsAsleepBox: true }, signal);
  let base;
  try {
    const u = new URL(box.gatewayUrl);
    if (
      !u.hostname.endsWith('.cursorvm.com') ||
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      throw 0;
    base = u.origin;
  } catch {
    throw new SDKError('ATTACHMENT_HOST_UNAVAILABLE');
  }
  if (!box.gatewayToken) throw new SDKError('ATTACHMENT_HOST_UNAVAILABLE');
  const uploadId = crypto.randomUUID();
  let path;
  for (let offset = 0; offset < blob.size; offset += 1024 * 1024) {
    const chunk = blob.slice(offset, offset + 1024 * 1024);
    const r = await client.fetch(base + '/api/uploadAttachmentChunk', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${box.gatewayToken}`,
        ...(box.networkToken ? { 'x-anyrun-network-token': box.networkToken } : {}),
      },
      body: JSON.stringify({
        agentId: botId,
        uploadId,
        filename: name,
        offset,
        totalSize: blob.size,
        bytesBase64: toBase64(new Uint8Array(await chunk.arrayBuffer())),
      }),
      credentials: 'omit',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
        : AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new SDKError('UPLOAD_GATEWAY_FAILED', r.status);
    const d = await r.json();
    path = d.committedPath ?? path;
    onProgress(Math.min(offset + chunk.size, blob.size), blob.size);
  }
  if (!path) throw new SDKError('UPLOAD_INCOMPLETE');
  return path;
}

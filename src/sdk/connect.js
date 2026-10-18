import { SDKError } from './errors.js';
import { utf8 } from './bytes.js';
export function encodeConnectFrame(value, flags = 0) {
  const p = utf8.encode(JSON.stringify(value)),
    out = new Uint8Array(5 + p.length);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, p.length);
  out.set(p, 5);
  return out;
}
export async function* readConnectFrames(
  body,
  { maxFrameBytes = 8 * 1024 * 1024, onClose = () => {} } = {},
) {
  if (!body) throw new SDKError('STREAM_INVALID_RESPONSE');
  const r = body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = new Uint8Array();
  try {
    for (;;) {
      const { done, value } = await r.read();
      if (done) throw new SDKError('STREAM_UNEXPECTED_EOF');
      const joined = new Uint8Array(pending.length + value.length);
      joined.set(pending);
      joined.set(value, pending.length);
      pending = joined;
      while (pending.length >= 5) {
        const flags = pending[0],
          n = new DataView(pending.buffer, pending.byteOffset).getUint32(1);
        if (n > maxFrameBytes) throw new SDKError('STREAM_FRAME_TOO_LARGE');
        if (flags !== 0 && flags !== 2) throw new SDKError('STREAM_FLAGS_INVALID');
        if (pending.length < 5 + n) break;
        let data;
        try {
          data = JSON.parse(decoder.decode(pending.subarray(5, 5 + n)));
        } catch {
          throw new SDKError('STREAM_INVALID_JSON');
        }
        pending = pending.slice(5 + n);
        if (!data || typeof data !== 'object' || Array.isArray(data))
          throw new SDKError('STREAM_INVALID_JSON');
        if (flags === 2) {
          if (data.error) throw new SDKError('STREAM_RPC_ERROR');
          if (pending.length) throw new SDKError('STREAM_END_INVALID');
          return;
        }
        yield data;
      }
    }
  } finally {
    onClose();
    await r.cancel().catch(() => {});
    r.releaseLock();
  }
}

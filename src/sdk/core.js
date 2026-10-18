import { base64url, utf8, sha256 } from './bytes.js';
export const API_ORIGIN = 'https://api2.cursor.sh';
export async function createLogin() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32))),
    uuid = crypto.randomUUID();
  const url = new URL('/loginDeepControl', 'https://cursor.com');
  url.search = new URLSearchParams({
    challenge: base64url(await sha256(utf8.encode(verifier))),
    uuid,
    mode: 'login',
    redirectTarget: 'sand',
    supportsSelectedTeamLogin: 'true',
  });
  return { uuid, verifier, loginUrl: url.href };
}
export function clientHeaders({ accessToken, version = '0.70.2', teamId } = {}) {
  const headers = {
    'content-type': 'application/json',
    'connect-protocol-version': '1',
    authorization: `Bearer ${accessToken}`,
    'x-cursor-client-type': 'sand',
    'x-cursor-client-version': version,
    'x-cursor-client-source': 'sand-desktop',
    'x-cursor-client-os': /Win/.test(globalThis.navigator?.platform ?? '') ? 'win32' : 'darwin',
    'x-sand-box-namespace': 'prod',
    'x-ghost-mode': 'true',
    'x-request-id': crypto.randomUUID(),
  };
  if (teamId !== undefined && teamId !== null) headers['x-cursor-team-id'] = String(teamId);
  return headers;
}
export async function requestJSON(
  url,
  { method = 'POST', headers = {}, body, fetchImpl = fetch, timeoutMs = 20000, signal } = {},
) {
  try {
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      redirect: 'error',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs),
    });
    if (Number(response.headers.get('content-length')) > 8 * 1024 * 1024) {
      await response.body?.cancel();
      return { ok: false, httpStatus: response.status, code: 'RESPONSE_TOO_LARGE' };
    }
    const reader = response.body?.getReader();
    let text = '',
      size = 0;
    const decoder = new TextDecoder();
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 8 * 1024 * 1024) {
            await reader.cancel();
            return { ok: false, httpStatus: response.status, code: 'RESPONSE_TOO_LARGE' };
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, httpStatus: response.status, code: 'NON_JSON_RESPONSE' };
    }
    if (!response.ok)
      return {
        ok: false,
        httpStatus: response.status,
        code:
          typeof data?.code === 'string' && /^[a-z_]{1,48}$/.test(data.code)
            ? data.code
            : 'HTTP_ERROR',
      };
    return { ok: true, httpStatus: response.status, data };
  } catch (error) {
    if (signal?.aborted) throw error;
    return { ok: false, code: 'NETWORK_ERROR' };
  }
}
export async function pollLoginOnce(flow, { fetchImpl = fetch } = {}) {
  const u = new URL('/auth/poll', API_ORIGIN);
  u.search = new URLSearchParams({ uuid: flow.uuid, verifier: flow.verifier });
  const r = await requestJSON(u, { method: 'GET', fetchImpl });
  if (r.ok && typeof r.data.accessToken === 'string' && r.data.accessToken) return r.data;
  if (r.httpStatus === 404) return null;
  throw new Error('LOGIN_POLL_FAILED');
}
export async function pollLogin(
  flow,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    maxAttempts = 150,
    onPending = () => {},
    signal,
  } = {},
) {
  for (let i = 0; i < maxAttempts; i++) {
    signal?.throwIfAborted();
    const r = await pollLoginOnce(flow, { fetchImpl });
    if (r) return r;
    onPending(i + 1);
    await sleep(Math.min(1000 * 1.2 ** i, 10000));
  }
  throw new Error('LOGIN_TIMED_OUT');
}

export const utf8 = new TextEncoder();
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 16384)
    s += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(s);
}
export function fromBase64(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}
export function base64url(bytes) {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function encodeJSON(value) {
  return base64url(utf8.encode(JSON.stringify(value)));
}
export function decodeJSON(s) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fromBase64(s)));
}
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}
export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

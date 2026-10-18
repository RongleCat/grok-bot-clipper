import { douyinPlayerSnapshots } from './douyin.js';
import { normalizeSocialPayload, platformForURL, mergeSocialRecord, postID } from './records.js';

export function publicPostRequest(platform, value, base) {
  try {
    const u = new URL(value, base);
    if (u.protocol !== 'https:') return false;
    if (platform === 'x')
      return (
        /^(?:[^.]+\.)?(?:x|twitter)\.com$/.test(u.hostname) &&
        /\/(?:graphql\/[^/]+\/(?:TweetDetail|TweetResultByRestId|HomeTimeline|HomeLatestTimeline|UserTweets|UserMedia|SearchTimeline)|2\/timeline\/)/.test(
          u.pathname,
        )
      );
    if (platform === 'xiaohongshu')
      return (
        /(?:^|\.)xiaohongshu\.com$/.test(u.hostname) &&
        /\/api\/sns\/web\/v\d+\/(?:feed|note)(?:\/|$)/.test(u.pathname)
      );
    if (platform === 'douyin')
      return (
        /(?:^|\.)douyin\.com$/.test(u.hostname) &&
        /\/aweme\/v\d+\/web\/(?:aweme\/(?:detail|post|related)|(?:filter\/)?(?:familiar\/)?(?:tab\/)?feed)(?:\/|$)/.test(
          u.pathname,
        )
      );
  } catch {}
  return false;
}
export function installNetworkObserver(window) {
  if (window.__grokSocialObserver) return;
  window.__grokSocialObserver = true;
  const platform = platformForURL(window.location.href);
  if (!platform || platform === 'wechat') return;
  const limit = 4 * 1024 * 1024,
    cache = new Map();
  const emit = (payload, onlyId) => {
    for (const incoming of normalizeSocialPayload(platform, payload)) {
      if (onlyId && incoming.id !== onlyId) continue;
      const record = mergeSocialRecord(
        cache.has(incoming.id) ? JSON.parse(cache.get(incoming.id)) : null,
        incoming,
      );
      record.captureSource = 'network';
      const key = record.id,
        encoded = JSON.stringify(record);
      if (cache.get(key) === encoded) continue;
      cache.delete(key);
      cache.set(key, encoded);
      while (cache.size > 100) cache.delete(cache.keys().next().value);
      window.postMessage(
        { source: 'grok-social-record', version: 1, record },
        window.location.origin,
      );
    }
  };
  async function inspect(response) {
    let reader;
    try {
      if (Number(response.headers.get('content-length')) > limit) return;
      reader = response.body?.getReader();
      if (!reader) return;
      let total = 0,
        body = '';
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          reader.cancel().catch(() => {});
          return;
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      emit(JSON.parse(body));
    } catch {
    } finally {
      reader?.releaseLock();
    }
  }
  const originalFetch = window.fetch;
  if (originalFetch)
    window.fetch = function (...args) {
      const result = Reflect.apply(originalFetch, this, args);
      const url =
        typeof args[0] === 'string' || args[0] instanceof URL ? String(args[0]) : args[0]?.url;
      if (publicPostRequest(platform, url, window.location.href))
        result
          .then((response) => {
            try {
              inspect(response.clone()).catch(() => {});
            } catch {}
          })
          .catch(() => {});
      return result;
    };
  const proto = window.XMLHttpRequest?.prototype;
  if (proto) {
    const open = proto.open,
      send = proto.send,
      urls = new WeakMap();
    proto.open = function (method, url, ...rest) {
      urls.set(this, String(url));
      return Reflect.apply(open, this, [method, url, ...rest]);
    };
    proto.send = function (...args) {
      if (publicPostRequest(platform, urls.get(this), window.location.href))
        this.addEventListener(
          'load',
          () => {
            try {
              if (!publicPostRequest(platform, urls.get(this), window.location.href)) return;
              if (this.responseType === 'json') emit(this.response);
              else if (
                (!this.responseType || this.responseType === 'text') &&
                this.responseText.length <= limit
              )
                emit(JSON.parse(this.responseText));
            } catch {}
          },
          { once: true },
        );
      return Reflect.apply(send, this, args);
    };
  }
  function activeXHSNote() {
    const id = postID(platform, window.location.href);
    if (!id) return;
    const root = window.document.querySelector(
      '.note-detail-mask .note-container, .note-container, #noteContainer, [data-note-id]',
    );
    if (!root) return;
    const seen = new WeakSet();
    // Read only this note's public player props. Never traverse global app stores,
    // unrelated component state, or bind an arbitrary CDN request to the current route.
    for (const start of [root.querySelector('video'), root]) {
      let node = start;
      for (let level = 0; node && level < 16; level++, node = node.parentElement) {
        let component = node.__vueParentComponent;
        for (let depth = 0; component && depth < 20 && !seen.has(component); depth++) {
          seen.add(component);
          const props = component.props;
          const note = props?.note || props?.noteCard;
          const noteId =
            note?.noteId || note?.note_id || note?.id || props?.noteId || props?.note_id;
          if (note && String(noteId) === id && (!props.noteId || String(props.noteId) === id)) {
            emit({ id, note });
          }
          component = component.parent;
        }
        if (node === root) break;
      }
    }
  }
  function initial() {
    try {
      if (platform === 'xiaohongshu') {
        emit(window.__INITIAL_STATE__);
        activeXHSNote();
      }
    } catch {}
    try {
      if (platform === 'douyin') {
        emit(window._ROUTER_DATA);
        emit(window.__INITIAL_STATE__);
        const data = window.document.getElementById('RENDER_DATA')?.textContent;
        try {
          if (data && data.length <= limit) emit(JSON.parse(decodeURIComponent(data)));
        } catch {}
        const id = postID(platform, window.location.href);
        for (const snapshot of douyinPlayerSnapshots(window, id)) emit(snapshot, id);
      }
    } catch {}
  }
  window.addEventListener('message', (e) => {
    if (
      e.source !== window ||
      e.origin !== window.location.origin ||
      e.data?.source !== 'grok-social-request' ||
      e.data?.version !== 1
    )
      return;
    // Replay only sanitized public-post records to a newly loaded isolated script.
    for (const record of cache.values())
      window.postMessage(
        { source: 'grok-social-record', version: 1, record: JSON.parse(record) },
        window.location.origin,
      );
    initial();
    if (typeof e.data.requestId === 'string' && e.data.requestId.length <= 100)
      window.postMessage(
        { source: 'grok-social-ready', requestId: e.data.requestId },
        window.location.origin,
      );
  });
  window.document.addEventListener('DOMContentLoaded', initial, { once: true });
  window.setTimeout(initial, 1000);
  window.setTimeout(initial, 3500);
}

import { SDKError } from './errors.js';
const encoder = new TextEncoder();
function encodeEvent(event) {
  if (typeof event.type !== 'string' || !/^[a-z][a-z0-9._-]{0,60}$/.test(event.type))
    throw new SDKError('STREAM_PROTOCOL_ERROR');
  if (
    event.id !== undefined &&
    (typeof event.id !== 'string' || event.id.length > 2048 || /[\r\n\0]/.test(event.id))
  )
    throw new SDKError('STREAM_PROTOCOL_ERROR');
  return encoder.encode(
    `event: ${event.type}\n${event.id !== undefined ? `id: ${event.id}\n` : ''}data: ${JSON.stringify(event.data ?? {})}\n\n`,
  );
}
export function eventsToSSE(events, { signal, keepAliveMs = 15000, onCancel = () => {} } = {}) {
  const iterator = events[Symbol.asyncIterator]();
  let stopped = false,
    timer,
    abortHandler;
  const cleanup = () => {
    clearInterval(timer);
    if (abortHandler) signal?.removeEventListener('abort', abortHandler);
  };
  const stream = new ReadableStream({
    start(controller) {
      abortHandler = () => {
        if (stopped) return;
        stopped = true;
        cleanup();
        onCancel();
        controller.close();
        void iterator.return?.().catch(() => {});
      };
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      signal?.addEventListener('abort', abortHandler, { once: true });
      if (keepAliveMs > 0) {
        timer = setInterval(() => {
          if (!stopped && controller.desiredSize > 0)
            controller.enqueue(encoder.encode(': keepalive\n\n'));
        }, keepAliveMs);
        timer.unref?.();
      }
    },
    async pull(controller) {
      if (stopped) return;
      try {
        const next = await iterator.next();
        if (stopped) return;
        if (next.done) {
          controller.enqueue(encodeEvent({ type: 'stream.closed', data: {} }));
          stopped = true;
          cleanup();
          controller.close();
        } else controller.enqueue(encodeEvent(next.value));
      } catch (error) {
        if (stopped) return;
        const code = error instanceof SDKError ? error.code : 'SDK_ERROR';
        controller.enqueue(encodeEvent({ type: 'error', data: { code } }));
        stopped = true;
        cleanup();
        onCancel();
        controller.close();
        void iterator.return?.().catch(() => {});
      }
    },
    async cancel() {
      stopped = true;
      cleanup();
      onCancel();
      await iterator.return?.().catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
    },
  });
}

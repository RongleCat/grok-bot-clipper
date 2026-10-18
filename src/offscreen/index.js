import { api } from '../platform/browser.js';
import { createTaskProcessor } from './tasks.js';
const processor = createTaskProcessor({ api });
api.runtime.onMessage.addListener((message, sender, respond) => {
  if (message.target !== 'offscreen') return;
  if (sender.id !== api.runtime.id) return;
  const fn = processor[message.action];
  if (!fn) {
    respond({ ok: false, error: 'UNKNOWN_OFFSCREEN_ACTION' });
    return;
  }
  fn(message).then(
    (value) => respond({ ok: true, value }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

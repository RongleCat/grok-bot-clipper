import { initI18n } from '../i18n/index.js';
import { api } from '../platform/browser.js';
import { installSocialUI } from './ui.js';
import { mountAvatars, releaseAvatars } from '../ui/avatars.js';
if (!globalThis.__grokSocialUI) {
  globalThis.__grokSocialUI = true;
  initI18n({ api, document: null })
    .catch(() => {})
    .finally(() => {
      installSocialUI(window, { avatars: { mount: mountAvatars, release: releaseAvatars } });
    });
}

import { installSocialUI } from './ui.js';
import { mountAvatars, releaseAvatars } from '../ui/avatars.js';
if (!globalThis.__grokSocialUI) {
  globalThis.__grokSocialUI = true;
  installSocialUI(window, { avatars: { mount: mountAvatars, release: releaseAvatars } });
}

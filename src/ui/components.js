// Semantic HTML adaptations of the free ReUI patterns recorded in vendor/reui/.
// The extension keeps its existing DOM renderer; React reference files are not bundled.
export const escapeHTML = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

export function field({ id, label, description = '', control }) {
  return `<div class="form-row field"><div class="field-copy"><label for="${id}">${escapeHTML(label)}</label>${description ? `<p class="field-description" id="${id}-hint">${escapeHTML(description)}</p>` : ''}<p class="field-error" id="${id}-error" role="alert" hidden></p></div><div class="field-control">${control}</div></div>`;
}

export function settingsSection(id, title, description, content) {
  return `<section class="settings-section" id="settings-${id}" aria-labelledby="heading-${id}"><header class="section-heading"><h2 id="heading-${id}">${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></header><div class="settings-card">${content}</div></section>`;
}

export function disclosure(label, content, { className = '', open = false } = {}) {
  return `<details class="disclosure ${className}" ${open ? 'open' : ''}><summary><span>${escapeHTML(label)}</span><svg class="disclosure-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></summary><div class="disclosure-content">${content}</div></details>`;
}

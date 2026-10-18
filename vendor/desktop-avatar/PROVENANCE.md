# Grok Bot desktop avatar runtime

Source: locally installed `/Applications/Grok Bot.app/Contents/Resources/app.asar`, Grok Bot 0.70.2, `dist/renderer/assets/index.eager-platform-DKZJbDqM.js`.

`engine.js` contains the original declaration bodies for the native `AvatarMark` React component, body mapping, still renderer and their transitive dependencies: geometry, perspective projection, facial expressions, clips, gaze and autonomous motion scheduling. Declaration bodies are copied byte for byte. Only imports are connected to the React package, declarations are separated, and descriptive exports are added. There is no fitted geometry, substitute eye drawing or custom motion implementation.

Regenerate using `node scripts/extract-desktop-avatar.mjs [path/to/app.asar]`. This reads application program assets only. It never reads app profiles, authentication or user data. The resulting hashes are recorded in `provenance.json`.

These desktop application assets are not covered by the former open-source avatar project's MIT license. Original rights remain with the desktop application's rights holders. This extraction is included for the requested local integration; it makes no claim of an open-source license for these assets. React and React DOM are separately MIT licensed.

# ReUI component references

Free MIT-licensed registry examples retrieved on 2026-10-17. Original TSX is retained in `reference/`; exact source URLs and dependencies are recorded in `provenance.json`. The MIT notice is retained in `LICENSE.md` and copied to the extension distribution.

The app uses a vanilla DOM renderer with React only for native avatars. ReUI examples are adapted to semantic HTML and the shared CSS in `public/components.css`, rather than adding a second React application or a Tailwind runtime. `src/ui/components.js` provides the reusable Field, settings section and Collapsible markup; existing buttons, switches and dialogs use the same tokens.

| ReUI example | Application use |
| --- | --- |
| Button | Toolbar actions, primary/secondary/destructive buttons |
| Field | Settings labels, descriptions, errors and controls |
| Card | Settings sections and draft material groups |
| Input Group | BOT search and chat composer |
| Collapsible | Material body and image editor |
| Message | Markdown reply content with separate timestamp |
| Switch | Boolean preferences |
| Attachment | File metadata, download and remove actions |
| Empty | Empty history, materials and BOT search |
| Scroll Area | Chat transcript, code blocks and tables |

Visual verification used Chromium with a local mocked transport, real bundled UI and native browser controls: 400×560 popup/picker, 360×700 light/dark chat, 360×800 draft/settings, and 1100×900 settings. No horizontal page overflow or uncaught browser exceptions were observed. Header and composer remain outside the chat scroll area. Source controls, authentication and cloud SDK behavior were not replaced.

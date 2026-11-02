# Classes: today and tomorrow

Separate from the workshops and events sync. Nothing in this folder touches `scripts/fetch-sessions.mjs` or `docs/sessions.json`.

| | |
|---|---|
| Script | `classes/fetch-classes.mjs` |
| Output | `docs/classes/classes.json` |
| Public URL | `https://radiantlyalive.github.io/ra-momence-sync/classes/classes.json` |
| Runs | Same workflow, own step, every 15 minutes. A failure here does not stop the events sync. |
| Momence type | `Regular` (the weekly classes on /classes). Change with the `CLASS_TYPES` repo variable. |
| Window | Classes that have not started yet, up to midnight at the end of tomorrow, Bali time |

Per class: id, name, start and end, duration, spots left, teacher name, location and the Momence booking link. No capacity or booking counts.

The Squarespace code block that reads this file lives in `radiantlyalive/ra-site` (`code-blocks/`). Its `DATA_URL` must be the public URL above. Status: pending Rafa's call on custom list versus the Momence widget for /classes.

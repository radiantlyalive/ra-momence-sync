# ra-momence-sync

Feeds the Workshops & Events list on www.radiantlyalive.com from Momence.

Momence's API needs a login, so the website can't call it directly. A GitHub Actions workflow logs in every 15 minutes, saves upcoming events to a public file (`docs/sessions.json`), and a Squarespace code block reads that file. Booking still happens on Momence.

| Part | Where it lives | What it does |
|---|---|---|
| Fetch script | `scripts/fetch-sessions.mjs` | Logs into Momence, pulls upcoming events, writes `docs/sessions.json` |
| Workflow | `.github/workflows/sync-momence.yml` | Runs the script every 15 minutes, commits only when the file changed |
| GitHub Pages | `docs/` folder on `main` | Serves `sessions.json` at a public URL |
| Code block | Squarespace, Workshops & Events page | Reads the file and lists events with image, description, time, teacher and Book now |

Passwords and keys stay in GitHub Secrets. Nothing sensitive is in this repo or on the website. The repo must stay Public for free GitHub Pages. The only trade-off is that "spots left" can lag by up to 15 minutes.

## What gets published

`sessions.json` holds, per event: id, name, type, description, start and end, duration, spots left, teacher name and photo, location, image, tags and the Momence booking link. Capacity and booking counts are not published. Momence sends descriptions as plain text; the script turns them into paragraphs.

The file is rewritten only when the events change, or when it is more than 7 days old. The weekly rewrite keeps the repo active so GitHub does not auto-disable the schedule after 60 days without activity (check the Actions tab after 60 days to confirm).

## Setup

### 1. Momence: host id and token

In the Momence dashboard, open the **Legacy API** page. It shows a host id and an API token, e.g. `{hostId: 5617, token: ...}`. That is all the sync needs: no staff user or OAuth client.

The token is the one Momence's own website plugins use, and it only reads schedule data that is already public. It still goes in a secret, not in this repo.

### 2. GitHub: secrets and variables

Settings, Secrets and variables, Actions, New repository secret:

| Secret | Value |
|---|---|
| `MOMENCE_HOST_ID` | Host id from the Legacy API page (`5617`) |
| `MOMENCE_TOKEN` | API token from the Legacy API page |

Optional, same page, Variables tab. Only add these to change the defaults:

| Variable | Default | Use |
|---|---|---|
| `SESSION_TYPES` | `Workshop` | Momence session types to show, comma separated. The other type in use is `Regular` (weekly classes) |
| `DAYS_AHEAD` | `120` | How far ahead to list events |
| `LOCATION` | (none) | Only show one location, by name, e.g. `Radiantly Alive Ubud` |

### 3. GitHub Pages and first run

1. Actions tab, Sync Momence sessions, Run workflow. A green tick means it worked; a red cross means a secret is wrong or missing (open the run to read the error).
2. After a green run, a commit "chore: sync Momence sessions" appears and `docs/sessions.json` exists.
3. Settings, Pages, Build and deployment: Source = Deploy from a branch, Branch = `main`, Folder = `/docs`, Save. The first build takes 1 to 3 minutes.
4. Open `https://radiantlyalive.github.io/ra-momence-sync/sessions.json`. You should see JSON starting with `generatedAt`. The Squarespace code block needs this URL.

Until the secrets are in, every scheduled run fails. To stop the failure emails, disable the workflow in the Actions tab and enable it again before the first manual run.

### 4. Squarespace

The code block is not kept here. Its source and review file live in the `radiantlyalive/ra-site` repo and follow that repo's gates: Rafa signs off the review file first, the live section is snapshotted before it is replaced, and saving and publishing are separate confirmations.

## Checks before going live

- [ ] `sessions.json` lists the events you expect. If some are missing, they are probably another session type (in Momence, the event must be created as a workshop/event, not a class): add the type to `SESSION_TYPES` and re-run the workflow.
- [ ] Every event has an `imageUrl`. If it is `null`, set the event banner in Momence (without one, the teacher's photo is used).
- [ ] Descriptions render cleanly (paragraphs, bold, bullets, links). Anything else is stripped on purpose.
- [ ] Book now opens the correct event on Momence.
- [ ] The page looks right on a phone (cards stack into one column).
- [ ] The Actions tab shows green runs every 15 minutes or so. If the Legacy API token is regenerated in Momence, update `MOMENCE_TOKEN`.

If the sync breaks later, the page shows "We couldn't load the schedule just now" with a link to Momence, so visitors are never stuck.

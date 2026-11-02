// Runs in GitHub Actions (Node 20+). Pulls today's and tomorrow's classes from
// Momence and writes docs/classes/classes.json for GitHub Pages to serve.
// Kept apart from scripts/fetch-sessions.mjs (events) so either can change or
// fail without touching the other.
//
// Uses the same Momence legacy plugin API and secrets as the events sync.
// Secrets: MOMENCE_HOST_ID, MOMENCE_TOKEN
// Optional repo variables:
//   CLASS_TYPES   default "Regular" (the classes on the /classes plugin)
//   LOCATION      optional location name, shared with the events sync
//
// Window: classes that have not started yet, up to midnight at the end of
// tomorrow, Bali time. The file is only rewritten when the classes changed,
// or when it is more than 7 days old.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const API = "https://momence.com/_api/primary/api/v1";
const DIR = "docs/classes";
const OUT = `${DIR}/classes.json`;
const REFRESH_MS = 7 * 86_400_000;
const BALI_OFFSET_MS = 8 * 3_600_000; // Asia/Makassar, UTC+8, no daylight saving
const env = (k, d) => process.env[k] || d; // || not ??: Actions passes unset vars as ""
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing secret ${k}`); return v; };

// Classes need less than events: no description, image or tags.
function classShape(e) {
  const start = new Date(e.dateTime);
  return {
    id: e.id,
    name: e.title,
    startsAt: e.dateTime,
    endsAt: new Date(start.getTime() + (e.duration || 0) * 60_000).toISOString(),
    durationInMinutes: e.duration,
    spotsLeft: e.capacity == null || e.spotsRemaining == null ? null : Math.max(0, e.spotsRemaining),
    teacher: e.teacher || null,
    location: e.isLocationPrivate ? null : e.location || null,
    bookUrl: e.link || `https://momence.com/s/${e.id}`,
  };
}

// Midnight at the end of tomorrow, Bali time, in ms.
function endOfTomorrowBali(now) {
  const bali = new Date(now + BALI_OFFSET_MS);
  return Date.UTC(bali.getUTCFullYear(), bali.getUTCMonth(), bali.getUTCDate() + 2) - BALI_OFFSET_MS;
}

async function readPrevious() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return null; }
}

async function main() {
  const qs = new URLSearchParams({ hostId: need("MOMENCE_HOST_ID"), token: need("MOMENCE_TOKEN") });
  const res = await fetch(`${API}/Events?${qs}`);
  if (!res.ok) throw new Error(`events ${res.status}: ${await res.text()}`);
  const all = await res.json();
  if (!Array.isArray(all)) throw new Error(`events: expected a list, got ${JSON.stringify(all).slice(0, 200)}`);

  const types = env("CLASS_TYPES", "Regular").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const location = env("LOCATION");
  const now = Date.now();
  const until = endOfTomorrowBali(now);

  const classes = all
    .filter((e) => e.published !== false && !e.isCancelled && !e.isDeleted)
    .filter((e) => types.includes(String(e.type).toLowerCase()))
    .filter((e) => !location || e.location === location)
    .filter((e) => { const t = Date.parse(e.dateTime); return t >= now && t <= until; })
    .sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime))
    .map(classShape);

  const prev = await readPrevious();
  const same = prev && JSON.stringify(prev.sessions) === JSON.stringify(classes);
  const fresh = prev && Date.now() - Date.parse(prev.generatedAt) < REFRESH_MS;
  if (same && fresh) {
    console.log(`No change (${classes.length} classes), file left as is`);
    return;
  }

  const out = { generatedAt: new Date().toISOString(), count: classes.length, sessions: classes };
  await mkdir(DIR, { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1));
  console.log(`Wrote ${classes.length} classes`);
}

main().catch((e) => { console.error(e); process.exit(1); });

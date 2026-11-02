// Runs in GitHub Actions (Node 20+). Pulls from Momence and writes two files
// for GitHub Pages to serve:
//   docs/sessions.json  upcoming events (Workshops & Events page)
//   docs/classes.json   classes from now to the end of tomorrow, Bali time
//
// Secrets (Settings > Secrets and variables > Actions):
//   MOMENCE_CLIENT_ID, MOMENCE_CLIENT_SECRET, MOMENCE_USERNAME, MOMENCE_PASSWORD
// Optional repo variables:
//   SESSION_TYPES   default "special-event,special-event-new"
//   DAYS_AHEAD      default 120
//   LOCATION_ID     optional numeric Momence location id
//   CLASS_TYPES     default "fitness" (Momence type for regular classes)
//
// Changes from the first version:
//   1. The file is only rewritten when the sessions actually changed, or when
//      the existing file is more than 7 days old. Before, generatedAt changed
//      every run, so the workflow committed every 15 minutes. The weekly
//      refresh also counts as repo activity for the 60-day scheduled workflow
//      auto-disable rule (verify this in the Actions tab after 60 days).
//   2. capacity and bookingCount are no longer published. Only spotsLeft is.
//      Pending Rafa's decision (see review file).

import { writeFile, readFile, mkdir } from "node:fs/promises";

const API = "https://api.momence.com";
const BALI_OFFSET_MS = 8 * 3_600_000; // Asia/Makassar, UTC+8, no daylight saving
const REFRESH_MS = 7 * 86_400_000;
const env = (k, d) => process.env[k] || d; // || not ??: Actions passes unset vars as ""
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing secret ${k}`); return v; };

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: need("MOMENCE_CLIENT_ID"),
    client_secret: need("MOMENCE_CLIENT_SECRET"),
    username: need("MOMENCE_USERNAME"),
    password: need("MOMENCE_PASSWORD"),
  });
  const res = await fetch(`${API}/api/v2/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${await res.text()}`);
  return (await res.json()).access_token;
}

function slugify(s) {
  return String(s || "").trim().replace(/\s+/g, "-").replace(/[^\w\-|:.,()!?&'%]/g, "");
}

function publicShape(s) {
  return {
    id: s.id,
    name: s.name,
    type: s.type,
    description: s.description,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    durationInMinutes: s.durationInMinutes,
    spotsLeft: s.capacity == null ? null : Math.max(0, s.capacity - s.bookingCount),
    teacher: s.teacher ? { name: `${s.teacher.firstName} ${s.teacher.lastName}`.trim(), pictureUrl: s.teacher.pictureUrl } : null,
    location: s.inPersonLocation?.name || null,
    isInPerson: s.isInPerson,
    imageUrl: s.bannerImageUrl || s.hostPhotoUrl || null,
    tags: (s.tags || []).map((t) => ({ name: t.name, color: t.badgeColor })),
    bookUrl: bookUrl(s),
  };
}

// Classes need less than events: no description, image or tags.
function classShape(s) {
  return {
    id: s.id,
    name: s.name,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    durationInMinutes: s.durationInMinutes,
    spotsLeft: s.capacity == null ? null : Math.max(0, s.capacity - s.bookingCount),
    teacher: s.teacher ? `${s.teacher.firstName || ""} ${s.teacher.lastName || ""}`.trim() : null,
    location: s.inPersonLocation?.name || null,
    bookUrl: bookUrl(s),
  };
}

function bookUrl(s) {
  return `https://momence.com/Radiantly-Alive/${encodeURIComponent(slugify(s.name))}/${s.id}?skipPreview=true`;
}

async function fetchSessions(token, types, from, until) {
  const all = [];
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      page: String(page), pageSize: "200",
      sortBy: "startsAt", sortOrder: "ASC",
      startAfter: from.toISOString(), startBefore: until.toISOString(),
      includeCancelled: "false",
    });
    types.forEach((t) => qs.append("types", t));
    if (env("LOCATION_ID")) qs.set("locationId", env("LOCATION_ID"));

    const res = await fetch(`${API}/api/v2/host/sessions?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`sessions ${res.status}: ${await res.text()}`);
    const json = await res.json();
    all.push(...(json.payload || []));
    const { totalCount, pageSize } = json.pagination || {};
    if (!totalCount || (page + 1) * pageSize >= totalCount) break;
  }
  return all.filter((s) => !s.isDraft && !s.isCancelled);
}

async function readPrevious(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

async function writeIfChanged(path, sessions) {
  const prev = await readPrevious(path);
  const same = prev && JSON.stringify(prev.sessions) === JSON.stringify(sessions);
  const fresh = prev && Date.now() - Date.parse(prev.generatedAt) < REFRESH_MS;
  if (same && fresh) {
    console.log(`${path}: no change (${sessions.length}), file left as is`);
    return;
  }
  const out = { generatedAt: new Date().toISOString(), count: sessions.length, sessions };
  await mkdir("docs", { recursive: true });
  await writeFile(path, JSON.stringify(out, null, 1));
  console.log(`${path}: wrote ${sessions.length}`);
}

// Midnight at the end of tomorrow, Bali time, as a UTC Date.
function endOfTomorrowBali(now) {
  const bali = new Date(now.getTime() + BALI_OFFSET_MS);
  return new Date(Date.UTC(bali.getUTCFullYear(), bali.getUTCMonth(), bali.getUTCDate() + 2) - BALI_OFFSET_MS);
}

const list = (v) => v.split(",").map((t) => t.trim()).filter(Boolean);

async function main() {
  const token = await getToken();
  const now = new Date();

  const days = Number(env("DAYS_AHEAD", 120));
  const events = await fetchSessions(token, list(env("SESSION_TYPES", "special-event,special-event-new")), now, new Date(now.getTime() + days * 86_400_000));
  await writeIfChanged("docs/sessions.json", events.map(publicShape));

  const classes = await fetchSessions(token, list(env("CLASS_TYPES", "fitness")), now, endOfTomorrowBali(now));
  await writeIfChanged("docs/classes.json", classes.map(classShape));
}

main().catch((e) => { console.error(e); process.exit(1); });

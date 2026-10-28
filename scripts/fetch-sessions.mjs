// Runs in GitHub Actions (Node 20+). Pulls upcoming events from Momence
// and writes docs/sessions.json for GitHub Pages to serve.
//
// Secrets (Settings > Secrets and variables > Actions):
//   MOMENCE_CLIENT_ID, MOMENCE_CLIENT_SECRET, MOMENCE_USERNAME, MOMENCE_PASSWORD
// Optional repo variables:
//   SESSION_TYPES   default "special-event,special-event-new"
//   DAYS_AHEAD      default 120
//   LOCATION_ID     optional numeric Momence location id
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
const OUT = "docs/sessions.json";
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
    bookUrl: `https://momence.com/Radiantly-Alive/${encodeURIComponent(slugify(s.name))}/${s.id}?skipPreview=true`,
  };
}

async function readPrevious() {
  try { return JSON.parse(await readFile(OUT, "utf8")); } catch { return null; }
}

async function main() {
  const token = await getToken();
  const days = Number(env("DAYS_AHEAD", 120));
  const types = env("SESSION_TYPES", "special-event,special-event-new").split(",").map((t) => t.trim()).filter(Boolean);
  const now = new Date();
  const until = new Date(now.getTime() + days * 86_400_000);

  const all = [];
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({
      page: String(page), pageSize: "200",
      sortBy: "startsAt", sortOrder: "ASC",
      startAfter: now.toISOString(), startBefore: until.toISOString(),
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

  const sessions = all.filter((s) => !s.isDraft && !s.isCancelled).map(publicShape);

  const prev = await readPrevious();
  const same = prev && JSON.stringify(prev.sessions) === JSON.stringify(sessions);
  const fresh = prev && Date.now() - Date.parse(prev.generatedAt) < REFRESH_MS;
  if (same && fresh) {
    console.log(`No change (${sessions.length} sessions), file left as is`);
    return;
  }

  const out = { generatedAt: new Date().toISOString(), count: sessions.length, sessions };
  await mkdir("docs", { recursive: true });
  await writeFile(OUT, JSON.stringify(out, null, 1));
  console.log(`Wrote ${sessions.length} sessions`);
}

main().catch((e) => { console.error(e); process.exit(1); });

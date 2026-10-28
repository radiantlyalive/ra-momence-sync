// Runs in GitHub Actions (Node 20+). Pulls upcoming events from Momence
// and writes docs/sessions.json for GitHub Pages to serve.
//
// Uses Momence's legacy plugin API (Momence dashboard, Integrations, Legacy
// API), which needs only the host id and the plugin token shown there. No
// staff login or OAuth client is involved.
//
// Secrets (Settings > Secrets and variables > Actions):
//   MOMENCE_HOST_ID, MOMENCE_TOKEN
// Optional repo variables:
//   SESSION_TYPES   default "Workshop". Legacy API types seen: Regular, Workshop
//   DAYS_AHEAD      default 120
//   LOCATION        optional location name, e.g. "Radiantly Alive Ubud"
//
// The file is only rewritten when the sessions changed, or when it is more
// than 7 days old. The weekly refresh counts as repo activity for the 60-day
// scheduled workflow auto-disable rule.

import { writeFile, readFile, mkdir } from "node:fs/promises";

const API = "https://momence.com/_api/primary/api/v1";
const OUT = "docs/sessions.json";
const REFRESH_MS = 7 * 86_400_000;
const env = (k, d) => process.env[k] || d; // || not ??: Actions passes unset vars as ""
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`Missing secret ${k}`); return v; };

// Legacy descriptions are plain text with newlines. The page expects HTML.
function textToHtml(s) {
  if (!s) return "";
  const esc = (t) => t.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  return s.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`).join("");
}

function publicShape(e) {
  const start = new Date(e.dateTime);
  return {
    id: e.id,
    name: e.title,
    type: e.type,
    description: textToHtml(e.description),
    startsAt: e.dateTime,
    endsAt: new Date(start.getTime() + (e.duration || 0) * 60_000).toISOString(),
    durationInMinutes: e.duration,
    spotsLeft: e.capacity == null || e.spotsRemaining == null ? null : Math.max(0, e.spotsRemaining),
    teacher: e.teacher ? { name: e.teacher, pictureUrl: e.image2 || null } : null,
    location: e.isLocationPrivate ? null : e.location || null,
    isInPerson: !e.online,
    imageUrl: e.image1 || e.image2 || null,
    tags: (e.tags || []).map((t) => (typeof t === "string" ? { name: t, color: null } : { name: t.name, color: t.badgeColor ?? t.color ?? null })),
    bookUrl: e.link || `https://momence.com/s/${e.id}`,
  };
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

  const days = Number(env("DAYS_AHEAD", 120));
  const types = env("SESSION_TYPES", "Workshop").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const location = env("LOCATION");
  const now = Date.now();
  const until = now + days * 86_400_000;

  const sessions = all
    .filter((e) => e.published !== false && !e.isCancelled && !e.isDeleted)
    .filter((e) => types.includes(String(e.type).toLowerCase()))
    .filter((e) => !location || e.location === location)
    .filter((e) => { const t = Date.parse(e.dateTime); return t >= now && t <= until; })
    .sort((a, b) => Date.parse(a.dateTime) - Date.parse(b.dateTime))
    .map(publicShape);

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

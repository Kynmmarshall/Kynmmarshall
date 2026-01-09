// Simple script that fetches GitHub data and writes three basic SVGs into assets/stats/
// Uses built-in fetch (Node 18+) and no external deps.
// Expects env.GITHUB_TOKEN and env.GITHUB_USER to be set.

import fs from "fs";
import path from "path";

const TOKEN = process.env.GITHUB_TOKEN;
const USER = process.env.GITHUB_USER || "Kynmmarshall";
if (!TOKEN) {
  console.error("GITHUB_TOKEN not set. Exiting.");
  process.exit(1);
}

const API = "https://api.github.com";
const GQL = "https://api.github.com/graphql";

async function rest(path) {
  const res = await fetch(API + path, {
    headers: { Authorization: `bearer ${TOKEN}`, "User-Agent": "github-actions" },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`REST ${path} failed: ${res.status}\n${text}`);
  }
  return res.json();
}

async function graphql(query, variables = {}) {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors, null, 2));
  return data.data;
}

function svgWrap(content, width = 680, height = 120) {
  return `<?xml version="1.0" encoding="utf-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <style>
    .title{ font: 700 20px 'Segoe UI', Roboto, Arial; fill:#2f363d; }
    .label{ font: 600 14px 'Segoe UI', Roboto, Arial; fill:#57606a; }
    .value{ font: 700 18px 'Segoe UI', Roboto, Arial; fill:#111827; }
  </style>
  ${content}
</svg>`;
}

function safeString(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

async function generate() {
  // 1) Get basic user info
  const user = await rest(`/users/${USER}`);
  const followers = user.followers || 0;

  // 2) Get repos (first page; if you have >100 repos you can paginate)
  const repos = await rest(`/users/${USER}/repos?per_page=100&type=owner&sort=updated`);
  const repoCount = repos.length;

  // 3) Total stars and language bytes (summed)
  let totalStars = 0;
  const langBytes = {}; // language -> bytes

  for (const r of repos) {
    totalStars += r.stargazers_count || 0;
    try {
      const langs = await rest(`/repos/${USER}/${r.name}/languages`);
      for (const [lang, bytes] of Object.entries(langs || {})) {
        langBytes[lang] = (langBytes[lang] || 0) + bytes;
      }
    } catch (e) {
      // ignore repo errors
      console.warn("langs fetch failed for", r.name, e.message);
    }
  }

  // Top languages: sort by bytes
  const topLangs = Object.entries(langBytes)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // 4) Get contributions calendar via GraphQL
  const query = `
  query userCalendar($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
      }
    }
  }`;
  const data = await graphql(query, { login: USER });
  const weeks = data.user.contributionsCollection.contributionCalendar.weeks || [];
  const days = weeks.flatMap(w => w.contributionDays || []);
  // compute current streak (consecutive days up to today with >0)
  days.sort((a, b) => new Date(a.date) - new Date(b.date));
  let currentStreak = 0;
  for (let i = days.length - 1; i >= 0; --i) {
    if (days[i].contributionCount > 0) currentStreak++;
    else break;
  }
  // compute best streak
  let best = 0, runner = 0;
  for (const d of days) {
    if (d.contributionCount > 0) runner++;
    else { best = Math.max(best, runner); runner = 0; }
  }
  best = Math.max(best, runner);

  const totalContribs = data.user.contributionsCollection.contributionCalendar.totalContributions || 0;

  // Build stats SVG (simple)
  const statsContent = `
    <text x="20" y="30" class="title">GitHub Summary — ${safeString(USER)}</text>
    <text x="20" y="60" class="label">Followers</text>
    <text x="140" y="60" class="value">${followers}</text>

    <text x="20" y="85" class="label">Public repos</text>
    <text x="140" y="85" class="value">${repoCount}</text>

    <text x="260" y="60" class="label">Total stars</text>
    <text x="380" y="60" class="value">${totalStars}</text>

    <text x="260" y="85" class="label">Total contributions (last year)</text>
    <text x="560" y="85" class="value">${totalContribs}</text>
  `;
  const statsSVG = svgWrap(statsContent, 720, 120);

  // Build top-langs SVG
  const maxBytes = topLangs.length ? topLangs[0][1] : 1;
  let langRects = `<text x="20" y="24" class="title">Top Languages</text>`;
  let y = 40;
  for (const [lang, bytes] of topLangs) {
    const w = Math.round((bytes / maxBytes) * 400);
    const pct = ((bytes / (Object.values(langBytes).reduce((a,b)=>a+b,0) || 1)) * 100).toFixed(1);
    langRects += `
      <text x="20" y="${y}" class="label">${safeString(lang)}</text>
      <rect x="120" y="${y-12}" width="${w}" height="12" fill="#2b8be6" rx="3" />
      <text x="${130 + w}" y="${y}" class="value">${pct}%</text>
    `;
    y += 24;
  }
  const topLangsSVG = svgWrap(langRects, 720, Math.max(80, y + 10));

  // Build streak SVG
  const streakContent = `
    <text x="20" y="30" class="title">Contribution Streak</text>
    <text x="20" y="60" class="label">Current streak</text>
    <text x="160" y="60" class="value">${currentStreak} days</text>

    <text x="20" y="90" class="label">Best streak</text>
    <text x="160" y="90" class="value">${best} days</text>
  `;
  const streakSVG = svgWrap(streakContent, 720, 120);

  // Write files
  const outDir = path.resolve("assets/stats");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, "github-stats.svg"), statsSVG, "utf8");
  fs.writeFileSync(path.join(outDir, "top-langs.svg"), topLangsSVG, "utf8");
  fs.writeFileSync(path.join(outDir, "streak.svg"), streakSVG, "utf8");

  console.log("Wrote SVGs to assets/stats/");
}

generate().catch(err => { console.error(err); process.exit(1); });

// Renders the profile stats cards to static SVGs so the README no longer
// depends on third-party hosted services (which return 402 / fetch errors).
//
// Env:
//   GITHUB_USER  GitHub login (default: Kynmmarshall)
//   GRS_DIR      Path to a checkout of anuraghazra/github-readme-stats with deps installed
//   PAT_1        Token used by github-readme-stats (also used for the streak card)
//   OUT_DIR      Output directory (default: assets/stats)

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const USER = process.env.GITHUB_USER || "Kynmmarshall";
const GRS_DIR = process.env.GRS_DIR;
const TOKEN = process.env.PAT_1 || process.env.GITHUB_TOKEN;
const OUT_DIR = process.env.OUT_DIR || "assets/stats";

if (!GRS_DIR || !TOKEN) {
  console.error("GRS_DIR and PAT_1 (or GITHUB_TOKEN) must be set.");
  process.exit(1);
}
process.env.PAT_1 = TOKEN;

const COLORS = {
  bg: "#151515",
  border: "#e4e2e2",
  title: "#4682b4",
  text: "#8ec5e8",
  accent: "#00bfff",
  white: "#ffffff",
  muted: "#9e9e9e",
};

const WIDTH = 495;

async function graphql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
      "User-Agent": "profile-stats-cards",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) {
    throw new Error(`GraphQL failed (${res.status}): ${JSON.stringify(body.errors || body)}`);
  }
  return body.data;
}

async function fetchContributionDays() {
  const meta = await graphql(
    `query($login: String!) {
      user(login: $login) {
        createdAt
        contributionsCollection { contributionYears }
      }
    }`,
    { login: USER },
  );
  const years = meta.user.contributionsCollection.contributionYears;

  const days = new Map();
  for (const year of years) {
    const data = await graphql(
      `query($login: String!, $from: DateTime!, $to: DateTime!) {
        user(login: $login) {
          contributionsCollection(from: $from, to: $to) {
            contributionCalendar {
              weeks { contributionDays { date contributionCount } }
            }
          }
        }
      }`,
      { login: USER, from: `${year}-01-01T00:00:00Z`, to: `${year}-12-31T23:59:59Z` },
    );
    for (const week of data.user.contributionsCollection.contributionCalendar.weeks) {
      for (const d of week.contributionDays) days.set(d.date, d.contributionCount);
    }
  }
  return { days, createdAt: meta.user.createdAt.slice(0, 10) };
}

const MS_DAY = 86400000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toStr = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => toStr(new Date(toDate(s).getTime() + n * MS_DAY));

function computeStreaks(days, today) {
  const dates = [...days.keys()].filter((d) => d <= today).sort();
  const total = dates.reduce((sum, d) => sum + days.get(d), 0);

  let longest = { length: 0, start: null, end: null };
  let run = { length: 0, start: null, end: null };
  for (const d of dates) {
    if (days.get(d) > 0) {
      if (run.length === 0 || addDays(run.end, 1) !== d) run = { length: 0, start: d, end: d };
      run.length += 1;
      run.end = d;
      if (run.length > longest.length) longest = { ...run };
    } else {
      run = { length: 0, start: null, end: null };
    }
  }

  // A streak is still alive if today has no contributions yet but yesterday had.
  let cursor = days.get(today) > 0 ? today : addDays(today, -1);
  let current = { length: 0, start: null, end: null };
  while (days.get(cursor) > 0) {
    current = { length: current.length + 1, start: cursor, end: current.end || cursor };
    cursor = addDays(cursor, -1);
  }
  return { total, current, longest, firstDay: dates[0] };
}

function formatRange(start, end, today) {
  if (!start) return "No streak yet";
  const thisYear = today.slice(0, 4);
  const fmt = (s, withYear) => {
    const label = toDate(s).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    return withYear ? `${label}, ${s.slice(0, 4)}` : label;
  };
  const withYear = start.slice(0, 4) !== thisYear || end.slice(0, 4) !== thisYear;
  const endLabel = end === today ? "Present" : fmt(end, withYear);
  return `${fmt(start, withYear)} - ${endLabel}`;
}

function renderStreakCard({ total, current, longest, firstDay }, today) {
  const col = WIDTH / 3;
  const center = (i) => col * i + col / 2;
  const font = "font-family: 'Segoe UI', Ubuntu, 'Helvetica Neue', Sans-Serif;";
  const big = `${font} font-size: 28px; font-weight: 700; fill: ${COLORS.white};`;
  const label = `${font} font-size: 14px; font-weight: 400;`;
  const range = `${font} font-size: 12px; fill: ${COLORS.muted};`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="195" viewBox="0 0 ${WIDTH} 195" role="img" aria-labelledby="streakTitle">
  <title id="streakTitle">${USER}'s GitHub Streak</title>
  <rect x="0.5" y="0.5" rx="4.5" width="${WIDTH - 1}" height="194" fill="${COLORS.bg}" stroke="${COLORS.border}" />

  <g text-anchor="middle">
    <text x="${center(0)}" y="88" style="${big}">${total.toLocaleString("en-US")}</text>
    <text x="${center(0)}" y="122" style="${label} fill: ${COLORS.white};">Total Contributions</text>
    <text x="${center(0)}" y="148" style="${range}">${formatRange(firstDay, today, today)}</text>

    <circle cx="${center(1)}" cy="82" r="40" fill="none" stroke="${COLORS.accent}" stroke-width="5" />
    <rect x="${center(1) - 16}" y="36" width="32" height="14" fill="${COLORS.bg}" />
    <path transform="translate(${center(1)} 44)" fill="${COLORS.accent}"
      d="M0,-12 C6,-5 10,0 10,6 A10,10 0 0 1 -10,6 C-10,1 -6,-2 -4,-6 C-3,-3 -1,-2 0,-3 C1,-6 0,-9 0,-12 Z" />
    <text x="${center(1)}" y="93" style="${big}">${current.length}</text>
    <text x="${center(1)}" y="140" style="${label} fill: ${COLORS.accent}; font-weight: 600;">Current Streak</text>
    <text x="${center(1)}" y="164" style="${range}">${formatRange(current.start, current.end, today)}</text>

    <text x="${center(2)}" y="88" style="${big}">${longest.length}</text>
    <text x="${center(2)}" y="122" style="${label} fill: ${COLORS.white};">Longest Streak</text>
    <text x="${center(2)}" y="148" style="${range}">${formatRange(longest.start, longest.end, today)}</text>
  </g>
</svg>
`;
}

async function main() {
  const load = (rel) => import(pathToFileURL(path.join(GRS_DIR, rel)).href);
  const [{ fetchStats }, { renderStatsCard }, { fetchTopLanguages }, { renderTopLanguages }] =
    await Promise.all([
      load("src/fetchers/stats.js"),
      load("src/cards/stats.js"),
      load("src/fetchers/top-languages.js"),
      load("src/cards/top-languages.js"),
    ]);

  const common = {
    bg_color: COLORS.bg.slice(1),
    border_color: COLORS.border.slice(1),
    card_width: WIDTH,
  };

  const stats = await fetchStats(USER, true, [], true, false, false);
  const statsSvg = renderStatsCard(stats, {
    ...common,
    show_icons: true,
    include_all_commits: true,
    custom_title: "My GitHub Statistics",
    title_color: COLORS.title.slice(1),
    text_color: COLORS.text.slice(1),
    icon_color: COLORS.title.slice(1),
    ring_color: COLORS.title.slice(1),
    show: ["reviews", "prs_merged", "prs_merged_percentage"],
  });

  const langs = await fetchTopLanguages(USER, []);
  const langsSvg = renderTopLanguages(langs, {
    ...common,
    layout: "compact",
    langs_count: 10,
    custom_title: "My Programming Languages",
    title_color: COLORS.white.slice(1),
    text_color: "c9d1d9",
  });

  const today = toStr(new Date());
  const { days, createdAt } = await fetchContributionDays();
  const streakSvg = renderStreakCard({ ...computeStreaks(days, today), firstDay: createdAt }, today);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "github-stats.svg"), statsSvg);
  fs.writeFileSync(path.join(OUT_DIR, "top-langs.svg"), langsSvg);
  fs.writeFileSync(path.join(OUT_DIR, "streak.svg"), streakSvg);
  console.log(`Wrote 3 cards to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

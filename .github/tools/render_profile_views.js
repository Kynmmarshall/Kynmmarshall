// Renders the profile-views counter as a static SVG using the Moe-Counter
// "booru-twifanartsfw" digits, with the number taken from the komarev badge
// so both counters on the profile always agree.
//
// Env (all optional):
//   GITHUB_USER  GitHub login (default: Kynmmarshall)
//   BADGE_URL    Badge to read the count from (default: komarev profile views badge)
//   OUT_FILE     Output path (default: assets/profile-views/profile-views.svg)

const fs = require("fs");
const path = require("path");

const USER = process.env.GITHUB_USER || "Kynmmarshall";
const BADGE_URL =
  process.env.BADGE_URL ||
  `https://komarev.com/ghpvc/?username=${USER}&style=for-the-badge&color=2F81F7`;
const OUT_FILE = process.env.OUT_FILE || "assets/profile-views/profile-views.svg";

const THEME = "booru-twifanartsfw";
const THEME_REF = "ba5b1fa9758b467e4436128ca2c9708f99d2977b";
const THEME_BASE = `https://raw.githubusercontent.com/journey-ad/Moe-Counter/${THEME_REF}/assets/theme/${THEME}`;
const LENGTH = 7;

async function fetchOk(url, options) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (profile-views-renderer)" }, ...options });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res;
}

function extractCount(badgeSvg) {
  const fromLabel = badgeSvg.match(/aria-label="[^"]*?([\d,]+)"/i);
  const texts = [...badgeSvg.matchAll(/>\s*([\d,]+)\s*</g)];
  const raw = fromLabel ? fromLabel[1] : texts.length ? texts[texts.length - 1][1] : null;
  const count = raw ? parseInt(raw.replace(/,/g, ""), 10) : NaN;
  if (!Number.isFinite(count)) throw new Error("Could not read a view count from the badge");
  return count;
}

async function loadDigit(digit) {
  const buf = Buffer.from(await (await fetchOk(`${THEME_BASE}/${digit}.gif`)).arrayBuffer());
  return {
    width: buf.readUInt16LE(6),
    height: buf.readUInt16LE(8),
    data: `data:image/gif;base64,${buf.toString("base64")}`,
  };
}

async function main() {
  const count = extractCount(await (await fetchOk(BADGE_URL)).text());
  const digits = String(count).padStart(LENGTH, "0").split("");
  const unique = [...new Set(digits)];

  const images = {};
  await Promise.all(unique.map(async (d) => (images[d] = await loadDigit(d))));

  const height = Math.max(...unique.map((d) => images[d].height));
  let x = 0;
  const uses = digits
    .map((d) => {
      const part = `<use x="${x}" xlink:href="#d${d}" />`;
      x += images[d].width;
      return part;
    })
    .join("\n    ");
  const defs = unique
    .map((d) => `<image id="d${d}" width="${images[d].width}" height="${images[d].height}" xlink:href="${images[d].data}" />`)
    .join("\n    ");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 ${x} ${height}" width="${x}" height="${height}" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="Profile views: ${count}">
  <title>Profile views: ${count}</title>
  <style>
    svg { image-rendering: pixelated; }
    @media (prefers-color-scheme: dark) { svg { filter: brightness(.6); } }
  </style>
  <defs>
    ${defs}
  </defs>
  <g>
    ${uses}
  </g>
</svg>
`;

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, svg);
  console.log(`Wrote ${OUT_FILE} for ${count} views`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

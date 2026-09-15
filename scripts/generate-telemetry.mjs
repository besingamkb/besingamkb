import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const USERNAME = 'besingamkb';
const API = process.env.GITHUB_API_URL ?? 'https://api.github.com';
const outputPath = process.env.TELEMETRY_OUTPUT_PATH
  ? path.resolve(process.env.TELEMETRY_OUTPUT_PATH)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../assets/telemetry.svg');
const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': `${USERNAME}-profile-telemetry`,
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

async function github(endpoint) {
  const response = await fetch(`${API}${endpoint}`, { headers });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${endpoint}`);
  return response.json();
}

async function listRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(`/users/${USERNAME}/repos?type=owner&sort=updated&per_page=100&page=${page}`);
    repositories.push(...batch);
    if (batch.length < 100) return repositories;
  }
}

async function mapWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const xml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

const languageColors = {
  PHP: '#4F5D95', TypeScript: '#3178C6', JavaScript: '#D4B830', CSS: '#563D7C',
  HTML: '#E34C26', Rust: '#B86B4B', Go: '#00ADD8', Java: '#B07219', Python: '#3572A5',
  Ruby: '#701516', Shell: '#4EAA25', Dockerfile: '#384D54', 'C#': '#178600', 'C++': '#F34B7D',
};

function formatLanguages(languageMaps) {
  const totals = new Map();
  for (const languages of languageMaps) {
    for (const [name, bytes] of Object.entries(languages)) totals.set(name, (totals.get(name) ?? 0) + bytes);
  }
  const totalBytes = [...totals.values()].reduce((sum, bytes) => sum + bytes, 0);
  const ranked = [...totals.entries()]
    .map(([name, bytes]) => ({ name, bytes, percent: totalBytes ? (bytes / totalBytes) * 100 : 0 }))
    .sort((a, b) => b.bytes - a.bytes);
  const visible = ranked.slice(0, 7);
  const otherPercent = ranked.slice(7).reduce((sum, language) => sum + language.percent, 0);
  if (otherPercent > 0.05) visible.push({ name: 'Other', percent: otherPercent });
  return visible;
}

function metric(x, value, label) {
  return `<g transform="translate(${x} 0)"><text class="metric-value" y="320">${xml(value)}</text><text class="metric-label" y="342">${xml(label)}</text></g>`;
}

function render({ profile, allRepositories, originalRepositories, languages }) {
  const years = Math.max(1, new Date().getUTCFullYear() - new Date(profile.created_at).getUTCFullYear());
  const stars = originalRepositories.reduce((sum, repository) => sum + repository.stargazers_count, 0);
  const recent = [...originalRepositories]
    .filter(repository => repository.name !== USERNAME)
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, 4);
  const firstYear = new Date(profile.created_at).getUTCFullYear();
  const currentYear = new Date().getUTCFullYear();
  const momentumYears = Array.from({ length: 7 }, (_, index) =>
    Math.round(firstYear + ((currentYear - firstYear) * index) / 6));

  let offset = 0;
  const languageBar = languages.map(language => {
    const width = language.percent * 8.12;
    const rect = `<rect x="${44 + offset}" y="418" width="${Math.max(width, 1).toFixed(2)}" height="14" fill="${languageColors[language.name] ?? '#8C959F'}"/>`;
    offset += width;
    return rect;
  }).join('');

  const legend = languages.slice(0, 8).map((language, index) => {
    const x = 44 + (index % 4) * 203;
    const y = 459 + Math.floor(index / 4) * 26;
    return `<g transform="translate(${x} ${y})"><circle cx="5" cy="-4" r="5" fill="${languageColors[language.name] ?? '#8C959F'}"/><text class="legend" x="16">${xml(language.name)} ${language.percent.toFixed(1)}%</text></g>`;
  }).join('');

  const signalRows = recent.map((repository, index) => {
    const y = 579 + index * 34;
    const language = repository.language ?? 'Mixed';
    const tagWidth = Math.max(48, language.length * 7 + 18);
    return `<g transform="translate(62 ${y})"><rect width="${tagWidth}" height="21" rx="4" class="tag-bg"/><text class="tag" x="8" y="15">${xml(language)}</text><text class="signal-name" x="${tagWidth + 13}" y="15">${xml(repository.name)}</text></g>`;
  }).join('');

  const momentum = momentumYears.map(year => ({
    year,
    count: originalRepositories.filter(repository => new Date(repository.created_at).getUTCFullYear() <= year).length,
  }));
  const maxMomentum = Math.max(...momentum.map(point => point.count), 1);
  const momentumBars = momentum.map((point, index) => {
    const height = Math.max(8, (point.count / maxMomentum) * 112);
    const x = 482 + index * 48;
    const label = index === 0 || index === 3 || index === 6
      ? `<text class="axis" x="${x + 17}" y="723" text-anchor="middle">${point.year}</text>`
      : '';
    return `<rect x="${x}" y="${704 - height}" width="34" height="${height.toFixed(1)}" rx="4" fill="#A6D84B"/>${label}`;
  }).join('');

  const generatedAt = new Date().toISOString().slice(0, 10);
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title description" viewBox="0 0 900 820" width="900" height="820">
  <title id="title">Mark Kevin Besinga developer telemetry</title>
  <desc id="description">Public GitHub activity, repository metrics, language composition, and recent original projects.</desc>
  <defs><linearGradient id="hero" x1="0" x2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#F0FFD1"/></linearGradient></defs>
  <style>.name{font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:2px;fill:#59636E}.title{font:800 46px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:-2px;fill:#11181C}.accent{fill:#608C00}.intro{font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#59636E}.contact{font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#446800}.section{font:700 13px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#24292F}.updated{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#7D8590}.metric-value{font:750 24px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#1F2328}.metric-label{font:10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.5px;fill:#6E7781}.legend{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#57606A}.panel{fill:#FFFFFF;stroke:#D0D7DE}.tag-bg{fill:#F0F7E4}.tag{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#446800}.signal-name{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#59636E}.axis{font:9px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#7D8590}.footer{font:11px ui-monospace,SFMono-Regular,Menlo,monospace;fill:#59636E}</style>
  <rect width="900" height="820" rx="10" fill="#FFFFFF" stroke="#D0D7DE"/>
  <path d="M10 0h880a10 10 0 0 1 10 10v240H0V10A10 10 0 0 1 10 0Z" fill="url(#hero)"/>
  <text class="name" x="44" y="38">MARK KEVIN C. BESINGA · PHILIPPINES</text>
  <text class="title" x="44" y="91">I BUILD USEFUL</text><text class="title accent" x="44" y="139">SYSTEMS.</text>
  <text class="intro" x="44" y="174">Senior software engineer working across product engineering, developer tooling, and systems</text>
  <text class="intro" x="44" y="196">modernization. PHP roots. TypeScript daily. Increasing amounts of Go and Rust.</text>
  <text class="contact" x="44" y="225">↗ PORTFOLIO　 ↗ LINKEDIN　 ✉ EMAIL</text>
  <text class="section" x="44" y="284">DEVELOPER TELEMETRY</text>
  <text class="updated" x="856" y="284" text-anchor="end">updated ${generatedAt} · public GitHub data</text>
  ${metric(44, profile.public_repos, 'PUBLIC REPOS')}${metric(205, originalRepositories.length, 'ORIGINAL BUILDS')}${metric(366, stars, 'ORIGINAL STARS')}${metric(527, profile.followers, 'FOLLOWERS')}${metric(688, `${years}+`, 'YEARS SHIPPING')}
  <rect x="44" y="360" width="812" height="1" fill="#D8DEE4"/>
  <text class="section" x="44" y="395">REPOSITORY LANGUAGE MIX</text>
  <text class="updated" x="856" y="395" text-anchor="end">code bytes · original repositories · forks excluded</text>
  <clipPath id="bar"><rect x="44" y="418" width="812" height="14" rx="7"/></clipPath><g clip-path="url(#bar)">${languageBar}</g>
  ${legend}
  <rect x="44" y="530" width="398" height="210" rx="7" class="panel"/><rect x="458" y="530" width="398" height="210" rx="7" class="panel"/>
  <text class="section" x="62" y="558">CURRENT SIGNAL</text>${signalRows}
  <text class="section" x="476" y="558">BUILD MOMENTUM</text><text class="updated" x="838" y="558" text-anchor="end">cumulative original repos</text>
  <line x1="482" x2="816" y1="704" y2="704" stroke="#D0D7DE"/>${momentumBars}
  <line x1="44" x2="856" y1="775" y2="775" stroke="#D8DEE4"/>
  <text class="footer" x="44" y="803">PHP → TYPESCRIPT → GO + RUST</text>
  <text class="footer accent" x="856" y="803" text-anchor="end">${allRepositories.length} PUBLIC REPOSITORIES · ${originalRepositories.length} AUTHORED</text>
</svg>`;
}

async function main() {
  const [profile, allRepositories] = await Promise.all([github(`/users/${USERNAME}`), listRepositories()]);
  const originalRepositories = allRepositories.filter(repository => !repository.fork && !repository.archived);
  const languageMaps = await mapWithConcurrency(originalRepositories, 8, repository =>
    github(`/repos/${USERNAME}/${encodeURIComponent(repository.name)}/languages`));
  const languages = formatLanguages(languageMaps);
  if (!languages.length) throw new Error('No language data returned; keeping the previous telemetry asset.');
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, render({ profile, allRepositories, originalRepositories, languages }));
  console.log(`Updated ${outputPath} from ${originalRepositories.length} original repositories.`);
}

await main();

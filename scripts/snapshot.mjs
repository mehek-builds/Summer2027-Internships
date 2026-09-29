// Daily snapshot of the Litos internship feed, for measuring how long postings stay open.
//
//   node scripts/snapshot.mjs
//
// Why: the Litos feed deletes a closed posting two days after it closes, so its
// history is gone unless someone writes it down. This keeps that record.
//
// Two files, both in data/:
//   internship-lifespan.csv  one row per internship posting ever seen: when the
//                            employer posted it, when Litos first saw it, and the
//                            first and last day this snapshot saw it open. A row
//                            whose last_seen is before today has closed.
//   daily-totals.csv         one row per day with the feed's own totals for a few
//                            fixed filters (the API's `total` field, not a count
//                            we make), so trends need no re-pull.
//
// Read only, paced at about one request a second, far under the API's limit.
// Re-running on the same day is safe: it only moves last_seen forward.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const API = 'https://api.trylitos.com/jobs';
const today = new Date().toISOString().slice(0, 10);
const LIFESPAN = 'data/internship-lifespan.csv';
const TOTALS = 'data/daily-totals.csv';
const COLUMNS = ['id', 'company', 'title', 'ats', 'country', 'sponsorship_status', 'posted_at', 'litos_first_seen_at', 'first_seen', 'last_seen'];
const TOTAL_FILTERS = [
  ['all', {}],
  ['us', { location: 'United States' }],
  ['us_sponsor_only', { location: 'United States', sponsor_only: 'true' }],
  ['internship', { employment_type: 'Internship' }],
  ['internship_sponsor_only', { employment_type: 'Internship', sponsor_only: 'true' }],
  ['internship_us', { employment_type: 'Internship', location: 'United States' }],
];

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function get(params) {
  const url = `${API}?${new URLSearchParams(params)}`;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'summer2027-internships-snapshot' } });
    if (response.ok) {
      const body = await response.json();
      await pause(1000);
      return body;
    }
    if (attempt === 4) throw new Error(`${url} returned ${response.status}`);
    await pause(5000 * attempt);
  }
}

/* RFC 4180: quote a field when it holds a comma, quote or newline. */
const cell = value => {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function readRows(path) {
  try {
    const [header, ...rows] = parseCsv(await readFile(path, 'utf8'));
    return rows.filter(row => row.length === header.length).map(row => Object.fromEntries(header.map((key, i) => [key, row[i]])));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function fetchInternships() {
  const jobs = [];
  for (let offset = 0; offset < 20_000; offset += 100) {
    const body = await get({ employment_type: 'Internship', limit: '100', offset: String(offset) });
    jobs.push(...body.jobs);
    if (body.jobs.length < 100) break;
  }
  return jobs;
}

await mkdir('data', { recursive: true });

/* 1. Lifespan. */
const jobs = await fetchInternships();
if (jobs.length === 0) throw new Error('The feed returned no internships; refusing to mark every posting closed.');
const byId = new Map((await readRows(LIFESPAN)).map(row => [row.id, row]));
let added = 0;
for (const job of jobs) {
  const known = byId.get(job.id);
  if (known) {
    if (known.last_seen < today) known.last_seen = today;
    known.sponsorship_status = job.sponsorship_status ?? known.sponsorship_status;
    continue;
  }
  added++;
  byId.set(job.id, {
    id: job.id,
    company: job.company_name,
    title: job.title,
    ats: job.ats_name,
    country: job.job_country,
    sponsorship_status: job.sponsorship_status,
    posted_at: job.posted_at,
    litos_first_seen_at: job.first_seen_at,
    first_seen: today,
    last_seen: today,
  });
}
const rows = [...byId.values()].sort((a, b) => a.first_seen.localeCompare(b.first_seen) || a.id.localeCompare(b.id));
await writeFile(LIFESPAN, [COLUMNS.join(','), ...rows.map(row => COLUMNS.map(key => cell(row[key])).join(','))].join('\n') + '\n');
/* Closed since the last run: open on the previous snapshot day, not seen today. Measured from the
   last run rather than yesterday, so a day the Action did not run is not miscounted. */
const previousTotals = (await readRows(TOTALS)).filter(row => row.date < today);
const lastRun = previousTotals.at(-1)?.date;
const closedToday = lastRun ? rows.filter(row => row.last_seen === lastRun).length : 0;

/* 2. Daily totals, one row per day (a re-run replaces today's row). */
const totals = { date: today, internship_rows_seen: jobs.length, new_internships: added, internships_closed_since_last_run: closedToday };
for (const [name, params] of TOTAL_FILTERS) {
  const body = await get({ ...params, limit: '1', offset: '0' });
  totals[name] = body.total;
}
const header = Object.keys(totals);
const kept = (await readRows(TOTALS)).filter(row => row.date !== today);
const lines = [header.join(','), ...[...kept, totals].map(row => header.map(key => cell(row[key])).join(','))];
await writeFile(TOTALS, lines.join('\n') + '\n');

console.log(`Snapshot ${today}: ${jobs.length} open internships, ${added} new, ${closedToday} closed since the last run, ${rows.length} tracked in total.`);


// Rebuild README.md from the live Litos jobs feed.
//
//   node scripts/update.mjs
//
// Every listing comes from an employer's own applicant tracking system board,
// read by the Litos job monitor. Nothing here is typed by hand, so a role that
// closes on the employer's board drops off on the next run.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';

const API = 'https://api.trylitos.com/jobs/grouped';
const SITE = 'https://trylitos.com';
const UTM = 'utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027';
const MAX_AGE_DAYS = 120;
const MAX_ROWS_PER_SECTION = 200;
const now = new Date();

/* The feed writes timestamps as "2026-09-28 14:03:17+00", which Date cannot
   parse until the space and the bare hour offset are made ISO. */
const parseTime = value => new Date(String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
const daysSince = value => (now - parseTime(value)) / 86_400_000;

async function fetchAll() {
  const jobs = [];
  for (let offset = 0; offset < 10_000; offset += 100) {
    const url = `${API}?employment_type=Internship&limit=100&offset=${offset}`;
    let body;
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (response.ok) { body = await response.json(); break; }
      if (attempt === 3) throw new Error(`${url} returned ${response.status}`);
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
    jobs.push(...body.jobs);
    if (!body.has_more) break;
  }
  return jobs;
}

/* ---------- which rows belong on the list ---------- */

const INTERN = /\bintern(ship)?s?\b|\bco-?op\b(?!\s*city)/i;
const NOT_A_ROLE_FOR_STUDENTS = /\brecruit(er|ing)\b|\b(senior|staff|principal|director)\b/i;

const STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');
const PROVINCES = 'ON BC QC AB MB SK NS NB NL PE'.split(' ');
const PLACES = /\b(united states|usa|u\.s\.|canada|new york|san francisco|bay area|seattle|boston|chicago|austin|los angeles|toronto|vancouver|montreal|waterloo|washington,? d\.?c)\b/i;
const OTHER_COUNTRY = /\b(uk|united kingdom|london|germany|deutschland|france|netherlands|nederland|india|singapore|malaysia|spain|italy|belgium|ireland|poland|australia|japan|uae|dubai|brazil|mexico|philippines|emea|europe|apac|latam)\b/i;

function isNorthAmerica(location) {
  const code = location.match(/,\s*([A-Z]{2})\b/)?.[1];
  if (code && (STATES.includes(code) || PROVINCES.includes(code))) return true;
  if (PLACES.test(location)) return true;
  return /\bremote\b/i.test(location) && !OTHER_COUNTRY.test(location);
}

/* First match wins, so order matters: "Quant Developer" is quant, and any
   title that names an engineering discipline is engineering before "design"
   can claim it ("IC Design Engineer", "Bridge Design Internship"). */
const SECTIONS = [
  ['Quant and Trading', /\bquant|\btrad(ing|er)\b/i],
  ['Software Engineering', /software|developer|\bswe\b|full.?stack|back.?end|front.?end|firmware|embedded|devops|site reliability|\bsre\b|cyber ?security|security engineer|cloud|platform eng|\bmobile\b|\bios\b|android|\bweb\b|computer science/i],
  ['Data Science, AI and Machine Learning', /\bdata\b|machine learning|\bml\b|\bai\b|artificial intelligence|research scien|analytics|computer vision|\bnlp\b/i],
  ['Hardware and Other Engineering', /hardware|electrical|mechanical|avionics|propulsion|manufacturing|robotics|civil|structural|aerospace|chemical|industrial|engineer|\bic\b|bridge|roadway|transportation|rfic/i],
  ['Product and Design', /product manag|product design|\bux\b|\bui\b|designer|\bdesign\b/i],
  ['Business, Finance and Marketing', /./],
];

/* ---------- formatting ---------- */

const cell = text => String(text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').replace(/\u2014/g, '-').trim();

function ageLabel(iso) {
  if (!iso) return '';
  const days = Math.floor(daysSince(iso));
  if (days <= 0) return 'today';
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

function payLabel(job) {
  const { salary_min: min, salary_max: max, salary_currency: currency, salary_interval: interval } = job;
  if (!min && !max) return '';
  const symbol = currency === 'USD' ? '$' : currency === 'CAD' ? 'CA$' : `${currency} `;
  const amount = n => interval === 'year' ? `${Math.round(n / 1000)}k` : `${Math.round(n * 100) / 100}`;
  const unit = { year: '/yr', hour: '/hr', month: '/mo', week: '/wk' }[interval] ?? '';
  if (min && max && min !== max) return `${symbol}${amount(min)}-${amount(max)}${unit}`;
  return `${symbol}${amount(min || max)}${unit}`;
}

const splitLocations = locations => locations.flatMap(location => String(location).split(/\s*;\s*/)).filter(Boolean);

function locationLabel(locations) {
  const shown = splitLocations(locations).filter(isNorthAmerica);
  const first = cell(shown[0] ?? locations[0]);
  return shown.length > 1 ? `${first} (+${shown.length - 1})` : first;
}

function row(job) {
  const apply = `<a href="${job.apply_url}">Apply</a>`;
  const litos = `<a href="${SITE}/start?job=${encodeURIComponent(job.id)}&${UTM}">Apply with Litos</a>`;
  return `| **${cell(job.company_name)}** | ${cell(job.title)} | ${locationLabel(job.locations)} | ${payLabel(job)} | ${apply} / ${litos} | ${ageLabel(job.posted_at)} |`;
}

/* ---------- build ---------- */

const all = await fetchAll();
const seen = new Set();
const bySection = new Map(SECTIONS.map(([name]) => [name, []]));
for (const job of all) {
  if (!job.apply_url || !INTERN.test(job.title) || NOT_A_ROLE_FOR_STUDENTS.test(job.title)) continue;
  if (!splitLocations(job.locations ?? []).some(isNorthAmerica)) continue;
  if (job.posted_at && !(daysSince(job.posted_at) <= MAX_AGE_DAYS)) continue;
  const key = `${job.company_name}|${job.title}`.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const [name] = SECTIONS.find(([, pattern]) => pattern.test(job.title));
  bySection.get(name).push(job);
}
for (const list of bySection.values()) list.sort((a, b) => String(b.posted_at).localeCompare(String(a.posted_at)));

const total = [...bySection.values()].reduce((sum, list) => sum + list.length, 0);
const companies = new Set([...bySection.values()].flat().map(job => job.company_name)).size;
const anchor = name => name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-');
const updated = now.toISOString().slice(0, 10);

const TABLE_HEAD = ['| Company | Role | Location | Pay | Application | Posted |', '| --- | --- | --- | --- | --- | --- |'];
const nonEmpty = [...bySection].filter(([, list]) => list.length);

/* Each section also gets its own page with every role, so a search for, say,
   "summer 2027 finance internships" can land on a page about exactly that. */
const pagePath = name => `lists/${anchor(name)}.md`;
const sections = nonEmpty.map(([name, list]) => [
  `## ${name}`,
  '',
  list.length > MAX_ROWS_PER_SECTION
    ? `${list.length} open roles; the newest ${MAX_ROWS_PER_SECTION} are below. [See all ${list.length} ${name} internships](${pagePath(name)}).`
    : `${list.length} open role${list.length === 1 ? '' : 's'}. [Open this list on its own page](${pagePath(name)}).`,
  '',
  ...TABLE_HEAD,
  ...list.slice(0, MAX_ROWS_PER_SECTION).map(row),
  '',
].join('\n'));

const litosLink = `[Litos](${SITE}/?${UTM})`;
await mkdir(new URL('../lists/', import.meta.url), { recursive: true });
const wanted = new Set(nonEmpty.map(([name]) => `${anchor(name)}.md`));
for (const file of await readdir(new URL('../lists/', import.meta.url))) {
  if (!wanted.has(file)) await rm(new URL(`../lists/${file}`, import.meta.url));
}
for (const [name, list] of nonEmpty) {
  const page = [
    `# Summer 2027 ${name} Internships`,
    '',
    `**${list.length} open ${name.toLowerCase()} internships in the US, Canada and remote.** Updated ${updated}.`,
    '',
    `Every role comes straight from the employer's own job board, checked every day by ${litosLink}, and drops off once the employer takes it down. **Apply** goes to the employer's application; **Apply with Litos** tailors your resume to that job and fills in the form, and you check everything before it is sent.`,
    '',
    `[Back to all Summer 2027 internships](../README.md)`,
    '',
    ...TABLE_HEAD,
    ...list.map(row),
    '',
    `Maintained by ${litosLink}. Found a closed role or a mistake? [Open an issue](../../../issues).`,
    '',
  ].join('\n');
  await writeFile(new URL(`../${pagePath(name)}`, import.meta.url), page);
}

const template = await readFile(new URL('../README.template.md', import.meta.url), 'utf8');
const readme = template
  .replace('{{TOTAL}}', String(total))
  .replace('{{COMPANIES}}', String(companies))
  .replace('{{UPDATED}}', updated)
  .replace('{{TOC}}', nonEmpty.map(([name, list]) => `- [${name}](#${anchor(name)}) (${list.length}), [full list](${pagePath(name)})`).join('\n'))
  .replace('{{SECTIONS}}', sections.join('\n'));
await writeFile(new URL('../README.md', import.meta.url), readme);
console.log(`README.md: ${total} internships at ${companies} companies (from ${all.length} in the feed)`);

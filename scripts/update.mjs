// Rebuild README.md from the live Litos jobs feed.
//
//   node scripts/update.mjs
//
// Every listing comes from an employer's own applicant tracking system board,
// read by the Litos job monitor. Nothing here is typed by hand, so a role that
// is observed in a snapshot. Absence alone does not establish closure.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { loadInternshipExport } from './internship-export.mjs';
import { eligiblePostingLocation } from './posting-location.mjs';

const SITE = 'https://trylitos.com';
const UTM = 'utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027';
const MAX_AGE_DAYS = 120;
const MAX_ROWS_PER_SECTION = 200;
const exportArtifact = await loadInternshipExport();
const now = new Date(exportArtifact.as_of);

/* The feed writes timestamps as "2026-09-28 14:03:17+00", which Date cannot
   parse until the space and the bare hour offset are made ISO. */
const parseTime = value => new Date(String(value).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
const daysSince = value => (now - parseTime(value)) / 86_400_000;

const comparePostings = (a, b) => {
  const aTime = a.posted_at === null ? -Infinity : Date.parse(a.posted_at);
  const bTime = b.posted_at === null ? -Infinity : Date.parse(b.posted_at);
  return (aTime === bTime ? 0 : aTime > bTime ? -1 : 1) || a.id.localeCompare(b.id);
};
const fetchAll = () => [...exportArtifact.jobs].sort(comparePostings);

/* ---------- which rows belong on the list ---------- */

const INTERN = /\bintern(ship)?s?\b|\bco-?op\b(?!\s*city)/i;
const NOT_A_ROLE_FOR_STUDENTS = /\brecruit(er|ing)\b|\b(senior|staff|principal|director)\b/i;

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

const cell = text => String(text ?? '').replace(/\|/g, '/').replace(/\s+/g, ' ').replace(/\s*[\u2013\u2014]\s*/g, ' - ').trim();

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

function row(job) {
  /* The role links to its page on trylitos.com: pay, location, the employer's
     application and the sponsorship record, and a page search engines can
     index. No separate apply column (Mehek, 2026-10-15). */
  const role = `<a href="${SITE}/job/${encodeURIComponent(job.id)}?${UTM}">${cell(job.title)}</a>`;
  return `| **${cell(job.company_name)}** | ${role} | ${cell(job.location)} | ${payLabel(job)} | ${ageLabel(job.posted_at)} |`;
}

/* ---------- build ---------- */

const all = await fetchAll();
const seen = new Set();
const bySection = new Map(SECTIONS.map(([name]) => [name, []]));
for (const job of all) {
  if (!job.apply_url || !INTERN.test(job.title) || NOT_A_ROLE_FOR_STUDENTS.test(job.title)) continue;
  if (!eligiblePostingLocation(job)) continue;
  if (job.posted_at && !(daysSince(job.posted_at) <= MAX_AGE_DAYS)) continue;
  const key = `${job.company_name}|${job.title}`.toLowerCase();
  if (seen.has(key)) continue;
  seen.add(key);
  const [name] = SECTIONS.find(([, pattern]) => pattern.test(job.title));
  bySection.get(name).push(job);
}
for (const list of bySection.values()) list.sort(comparePostings);

const total = [...bySection.values()].reduce((sum, list) => sum + list.length, 0);
const companies = new Set([...bySection.values()].flat().map(job => job.company_name)).size;
const anchor = name => name.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-');
const updated = now.toISOString().slice(0, 10);

const TABLE_HEAD = ['| Company | Role | Location | Pay | Posted |', '| --- | --- | --- | --- | --- |'];
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
    `**${list.length} ${name.toLowerCase()} internships observed in the US, Canada and remote.** Updated ${updated}.`,
    '',
    `Roles come from employers' public job boards through ${litosLink}. This is a dated observation of the feed. Employer availability can change after capture; confirm each role on the employer's current posting before applying. Absence from a later snapshot does not by itself confirm that a role closed. Click a role to open its Litos page, including the employer's application link.`,
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

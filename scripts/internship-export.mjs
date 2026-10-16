import { readFile } from 'node:fs/promises';
import { createFeedClient } from './feed-client.mjs';
export const EXPORT_BYTES = 32 * 1024 * 1024;
const ROW_CAP = 25_000;
export function validateExport(value, now = Date.now()) {
  const fail = () => { throw new Error('Internship export is incomplete or malformed'); };
  if (!value || value.version !== 1 || value.complete !== true || typeof value.generation !== 'string'
    || !/^[0-9a-f-]{36}$/i.test(value.generation) || typeof value.as_of !== 'string') fail();
  const time = Date.parse(value.as_of);
  if (!Number.isFinite(time) || time > now + 300_000 || now - time > 86_400_000) fail();
  if (!Array.isArray(value.jobs) || !Array.isArray(value.grouped) || !value.jobs.length
    || value.jobs.length > ROW_CAP || value.grouped.length > ROW_CAP
    || value.total !== value.jobs.length || value.grouped_total !== value.grouped.length) fail();
  const rawKeys = new Set(['id','company_name','title','ats_name','job_country','sponsorship_status','posted_at','first_seen_at']);
  const groupKeys = new Set(['id','company_name','title','locations','apply_url','posted_at','ats_name','salary_min','salary_max','salary_currency','salary_interval','openings']);
  const ids = new Set();
  for (const row of value.jobs) {
    if (!row || Object.keys(row).length !== rawKeys.size || Object.keys(row).some(key => !rawKeys.has(key)) || typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || ['company_name','title','ats_name','job_country','sponsorship_status','first_seen_at'].some(key => typeof row[key] !== 'string')
      || !Number.isFinite(Date.parse(row.first_seen_at)) || (row.posted_at !== null && !Number.isFinite(Date.parse(row.posted_at)))) fail();
    ids.add(row.id);
  }
  const groups = new Set(); let openings = 0;
  for (const row of value.grouped) {
    if (!row || Object.keys(row).length !== groupKeys.size || Object.keys(row).some(key => !groupKeys.has(key)) || !ids.has(row.id) || groups.has(row.id)
      || ['company_name','title','ats_name','apply_url'].some(key => typeof row[key] !== 'string')
      || !Array.isArray(row.locations) || row.locations.some(location => typeof location !== 'string')
      || !Number.isSafeInteger(row.openings) || row.openings < 1
      || (row.posted_at !== null && !Number.isFinite(Date.parse(row.posted_at)))) fail();
    groups.add(row.id); openings += row.openings;
  }
  if (openings !== value.total || !value.totals) fail();
  for (const key of ['all','us','us_sponsor_only','internship','internship_sponsor_only','internship_us'])
    if (!Number.isSafeInteger(value.totals[key]) || value.totals[key] < 0) fail();
  const t = value.totals;
  if (t.internship !== value.total || t.internship > t.all || t.us > t.all || t.us_sponsor_only > t.us
    || t.internship_sponsor_only > t.internship || t.internship_us > t.internship) fail();
  return value;
}
export async function loadInternshipExport() {
  if (process.env.LITOS_EXPORT_PATH) {
    const bytes = await readFile(process.env.LITOS_EXPORT_PATH);
    if (bytes.length > EXPORT_BYTES) throw new Error('Internship export exceeds its byte budget');
    return validateExport(JSON.parse(bytes));
  }
  const feed = createFeedClient();
  return validateExport(await feed.get('https://api.trylitos.com/jobs/internship-export', {}, { maxBytes: EXPORT_BYTES }));
}

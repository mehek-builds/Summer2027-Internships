import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { roleTitle, isInternshipRole, postingTerm } from './posting-term.mjs';
const exec = promisify(execFile);

test('term evidence belongs to the role, not a returning-intern restriction or graduation year', () => {
  assert.equal(roleTitle('Systems Engineer I (For SNC Summer 2026 Interns Only)'), 'Systems Engineer I');
  assert.equal(isInternshipRole('Systems Engineer I (For SNC Summer 2026 Interns Only)'), false);
  assert.equal(isInternshipRole('Software Engineer Intern (For SNC Summer 2026 Intern Only)'), true);
  assert.equal(postingTerm('Software Engineer Intern (For SNC Summer 2026 Intern Only)'), 'unspecified');
  for (const title of ['New Grad Field Engineer I- Central Division- For Current/Former HNTB Interns Only', 'Returning Inspector I - Central States Office - For Current/Former HNTB Interns Only', 'New Grad Project Finance Associate II- Winter/Summer 2027- SED Division- For Current/Previous HNTB Interns ONLY'])
    assert.equal(isInternshipRole(title), false, title);
  assert.equal(isInternshipRole('Returning Intern Construction Services- Central Division- For Current/Former HNTB Interns Only'), true);
  for (const title of ['Summer 2027 Engineering Intern', '2027 Summer Engineering Intern', 'Engineering Intern (Summer2027)', 'Summer Internship Program 2027', 'Summer 2027 Intern (For returning Summer 2026 Interns Only)'])
    assert.equal(postingTerm(title), 'summer2027', title);
  for (const title of ['Spring 2027 Engineering Intern', 'Engineering Intern - Fall 2026', '2028 Winter Co-op'])
    assert.equal(postingTerm(title), 'other', title);
  for (const title of ['Engineering Intern 2027', 'Summer Engineering Intern', 'Engineering Intern', 'Summer 2027 / Fall 2027 Intern', 'Summer 2027 / 2028 Intern', 'Summer Intern - Class of 2027', 'Summer Internship 2027 graduates'])
    assert.equal(postingTerm(title), 'unspecified', title);
});

test('the real renderer partitions and conserves eligible postings while historical feed totals stay separate', async () => {
  const titles = [
    ['Software Engineering Intern - Summer 2027', 'summer2027'],
    ['2027 Summer Software Engineering Intern', 'summer2027'],
    ['Software Engineering Intern (Summer 2027) (For returning Summer 2026 Interns Only)', 'summer2027'],
    ['Software Engineering Intern (Spring 2027)', 'other'],
    ['Software Engineering Intern (Fall 2026)', 'other'],
    ['Software Engineering Intern 2027', 'unspecified'],
    ['Software Engineering Intern', 'unspecified'],
    ['Software Engineering Intern (Summer 2027 or Fall 2027)', 'unspecified'],
    ['Software Engineer Intern (For SNC Summer 2026 Intern Only)', 'unspecified'],
    ['Systems Engineer I (For SNC Summer 2026 Interns Only)', null],
    ['New Grad Field Engineer I- Central Division- For Current/Former HNTB Interns Only', null],
    ['Returning Inspector I - Central States Office - For Current/Former HNTB Interns Only', null],
    ['New Grad Project Finance Associate II- Winter/Summer 2027- SED Division- For Current/Previous HNTB Interns ONLY', null],
    ['Returning Intern Construction Services- Central Division- For Current/Former HNTB Interns Only', 'unspecified'],
  ];
  const as_of = new Date().toISOString();
  const jobs = titles.map(([title], i) => ({
    id: `30000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, company_name: `Example ${i}`, title,
    ats_name: 'greenhouse', job_country: 'us', sponsorship_status: 'unstated', posted_at: as_of, first_seen_at: as_of,
    location: 'New York, NY', apply_url: `https://example.com/jobs/${i}`, salary_min: 20, salary_max: 30, salary_currency: 'USD', salary_interval: 'hour',
  }));
  const grouped = jobs.map(({ id, company_name, title, ats_name, apply_url, posted_at, salary_min, salary_max, salary_currency, salary_interval }) => ({ id, company_name, title, ats_name, apply_url, posted_at, salary_min, salary_max, salary_currency, salary_interval, locations: ['New York, NY'], openings: 1 }));
  const artifact = { version: 2, generation: '40000000-0000-4000-8000-000000000001', as_of, complete: true, jobs, grouped,
    total: 14, grouped_total: 14, totals: { all: 14, us: 14, us_sponsor_only: 0, internship: 14, internship_sponsor_only: 0, internship_us: 14 } };
  const dir = await mkdtemp(join(tmpdir(), 'litos-term-render-'));
  try {
    await cp(new URL('.', import.meta.url), join(dir, 'scripts'), { recursive: true });
    await cp(new URL('../README.template.md', import.meta.url), join(dir, 'README.template.md'));
    await mkdir(join(dir, 'lists')); await mkdir(join(dir, 'data'));
    await writeFile(join(dir, 'README.md'), 'old');
    await writeFile(join(dir, 'data/internship-lifespan.csv'), 'id,last_seen\n');
    await writeFile(join(dir, 'data/daily-totals.csv'), 'date,all\n');
    const input = join(dir, 'export.json'); await writeFile(input, JSON.stringify(artifact));
    await exec(process.execPath, ['scripts/refresh.mjs'], { cwd: dir, env: { ...process.env, LITOS_EXPORT_PATH: input }, timeout: 10000 });
    const readme = await readFile(join(dir, 'README.md'), 'utf8');
    const page = await readFile(join(dir, 'lists/software-engineering.md'), 'utf8');
    assert.match(readme, /\*\*3 postings state Summer 2027 in the role title\.\*\* 10 internships and co-ops/);
    assert.match(page, /^# Software Engineering Internships: Summer 2027 and Other Terms/m);
    const headings = ['Summer 2027 stated in the role title', 'Other stated terms', 'Term incomplete or not stated'];
    const allPages = await Promise.all((await readdir(join(dir, 'lists'))).map(file => readFile(join(dir, 'lists', file), 'utf8')));
    const buckets = headings.map((heading, i) => allPages.map(content => content.split(`## ${heading}\n`)[1].split(i < 2 ? `## ${headings[i + 1]}` : 'Maintained by')[0]).join('\n'));
    assert.deepEqual(buckets.map(part => [...part.matchAll(/<a href="https:\/\/trylitos\.com\/job\//g)].length), [3, 2, 5]);
    const expected = new Map([['summer2027', 0], ['other', 1], ['unspecified', 2]]);
    for (const [i, [, bucket]] of titles.entries()) {
      const id = jobs[i].id;
      if (bucket === null) { assert.ok(!readme.includes(id)); assert.ok(!allPages.some(content => content.includes(id))); continue; }
      assert.equal(buckets.filter(part => part.includes(id)).length, 1, `posting ${i} occurs once`);
      assert.ok(buckets[expected.get(bucket)].includes(id), `posting ${i} belongs to its stated term`);
      assert.ok(allPages.some(content => content.includes(jobs[i].title)), 'displayed title retains the audience restriction');
    }
    assert.match(page, /\$20-30\/hr/);
    assert.match(page, /utm_source=github&utm_medium=internship_list&utm_campaign=summer_2027/);
    const receipt = JSON.parse(await readFile(join(dir, 'data/export-generation.json'), 'utf8'));
    assert.equal(receipt.total, 14, 'historical feed provenance is not rewritten to the ten list postings');
    assert.equal(receipt.totals.internship, 14);
    assert.equal(receipt.generation, artifact.generation);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

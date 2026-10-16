import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateExport, loadInternshipExport, EXPORT_TIMEOUT_MS } from './internship-export.mjs';
import { createFeedClient } from './feed-client.mjs';
const exec = promisify(execFile);
function fixture() {
  const id = '30000000-0000-4000-8000-000000000001', time = new Date().toISOString();
  return { version: 1, generation: '40000000-0000-4000-8000-000000000001', as_of: time, complete: true,
    jobs: [{ id, company_name: 'Example', title: 'Engineering Intern', ats_name: 'greenhouse', job_country: 'us', sponsorship_status: 'unstated', posted_at: time, first_seen_at: time }],
    grouped: [{ id, company_name: 'Example', title: 'Engineering Intern', ats_name: 'greenhouse', locations: ['New York, NY'], apply_url: 'https://example.com/apply', posted_at: time, openings: 1, salary_min: null, salary_max: null, salary_currency: null, salary_interval: null }],
    total: 1, grouped_total: 1, totals: { all: 10, us: 6, us_sponsor_only: 3, internship: 1, internship_sponsor_only: 0, internship_us: 1 } };
}
test('incomplete, stale, duplicated, private-field and inconsistent exports are refused', () => {
  for (const change of [x => x.complete=false, x => x.as_of='2020-01-01', x => x.jobs.push(x.jobs[0]),
    x => x.total=2, x => x.grouped[0].openings=2, x => x.jobs[0].raw_json={}, x => x.grouped[0].career_url='private',
    x => x.totals.internship=2, x => x.totals.all=-1, x => x.totals.us_sponsor_only=7,
    x => x.totals.unexpected_private_field='private', x => x.grouped[0].salary_min={},
    x => x.grouped[0].salary_max='not numeric', x => x.grouped[0].salary_currency={}, x => x.grouped[0].salary_interval=3, x => x.extra_private='secret']) {
    const value = fixture(); change(value); assert.throws(() => validateExport(value), /malformed/);
  }
  assert.equal(validateExport(fixture()).total, 1);
});
test('response byte limit applies while streaming, before JSON parsing', async () => {
  const client = createFeedClient({ fetchImpl: async () => new Response('x'.repeat(33)) });
  await assert.rejects(client.get('https://example.com/export', {}, { maxBytes: 32 }), /byte budget/);
});
async function stage(value = fixture()) {
  const dir = await mkdtemp(join(tmpdir(), 'litos-export-test-'));
  await cp(new URL('.', import.meta.url), join(dir, 'scripts'), { recursive: true });
  await cp(new URL('../README.template.md', import.meta.url), join(dir, 'README.template.md'));
  await mkdir(join(dir, 'lists')); await mkdir(join(dir, 'data'));
  await writeFile(join(dir, 'README.md'), 'previous list'); await writeFile(join(dir, 'lists/old.md'), 'previous roles');
  await writeFile(join(dir, 'data/internship-lifespan.csv'), 'id,last_seen\nold,2020-01-01\n');
  await writeFile(join(dir, 'data/daily-totals.csv'), 'date,all\n2020-01-01,10\n');
  const path = join(dir, 'fixture.json'); await writeFile(path, JSON.stringify(value));
  return { dir, env: { ...process.env, LITOS_EXPORT_PATH: path } };
}
async function unchanged(dir) {
  assert.equal(await readFile(join(dir, 'README.md'), 'utf8'), 'previous list');
  assert.equal(await readFile(join(dir, 'lists/old.md'), 'utf8'), 'previous roles');
  assert.equal(await readFile(join(dir, 'data/daily-totals.csv'), 'utf8'), 'date,all\n2020-01-01,10\n');
  assert.equal(await readFile(join(dir, 'data/internship-lifespan.csv'), 'utf8'), 'id,last_seen\nold,2020-01-01\n');
}
test('one validated export generates the list and history without another network request', async () => {
  const { dir, env } = await stage();
  try {
    await exec(process.execPath, ['scripts/refresh.mjs'], { cwd: dir, env, timeout: 10000 });
    assert.match(await readFile(join(dir, 'README.md'), 'utf8'), /Example/);
    assert.equal(JSON.parse(await readFile(join(dir, 'data/export-generation.json'), 'utf8')).generation, '40000000-0000-4000-8000-000000000001');
    assert.match(await readFile(join(dir, 'data/internship-lifespan.csv'), 'utf8'), /30000000-0000-4000-8000-000000000001/);
    assert.match(await readFile(join(dir, 'data/daily-totals.csv'), 'utf8'), new RegExp(fixture().as_of.slice(0,10)));
    assert.equal((await readdir(dir)).some(name => name.startsWith('.litos-refresh-')), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('invalid totals or a failed history stage preserve all previous published files', async () => {
  for (const failure of ['totals', 'history', 'private metadata', 'salary']) {
    const value = fixture(); if (failure === 'totals') value.totals.internship=-1;
    if (failure === 'private metadata') value.totals.unexpected_private_field='must not publish';
    if (failure === 'salary') value.grouped[0].salary_min={ unexpected: 'must not publish' };
    const { dir, env } = await stage(value);
    try {
      if (failure === 'history') await writeFile(join(dir, 'scripts/snapshot.mjs'), "throw new Error('snapshot refused');");
      await assert.rejects(exec(process.execPath, ['scripts/refresh.mjs'], { cwd: dir, env, timeout: 10000 }));
      await unchanged(dir);
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
});
test('a swap failure rolls back earlier replacements instead of publishing a partial generation', async () => {
  const { dir, env } = await stage();
  try {
    await writeFile(join(dir, 'scripts/snapshot.mjs'), "import {rm} from 'node:fs/promises'; await rm('data',{recursive:true});");
    await assert.rejects(exec(process.execPath, ['scripts/refresh.mjs'], { cwd: dir, env, timeout: 10000 }));
    await unchanged(dir);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


test('export requests have their own bounded generation and body deadline; ordinary calls retain20seconds', async () => {
  const durations = [];
  const client = createFeedClient({ timeoutSignal: ms => { durations.push(ms); return AbortSignal.timeout(ms); }, fetchImpl: async () => new Response(JSON.stringify(fixture())) });
  await client.get('https://example.com/ordinary', {});
  assert.equal(durations[0], 20000);
  const original = process.env.LITOS_EXPORT_PATH;
  delete process.env.LITOS_EXPORT_PATH;
  try { await loadInternshipExport({ client }); }
  finally { if (original === undefined) delete process.env.LITOS_EXPORT_PATH; else process.env.LITOS_EXPORT_PATH=original; }
  assert.equal(durations[1], EXPORT_TIMEOUT_MS);
  assert.equal(EXPORT_TIMEOUT_MS, 45000);
});

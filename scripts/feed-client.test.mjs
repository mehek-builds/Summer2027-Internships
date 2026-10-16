import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedClient } from './feed-client.mjs';
import { mkdtemp, mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const API = 'https://api.trylitos.com/jobs';
const ok = data => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
function fixture(fetchImpl) {
  let time = 0; const waits = [], calls = [];
  const client = createFeedClient({ now: () => time, sleep: async ms => { waits.push(ms); time += ms; }, fetchImpl: async (...args) => { calls.push(time); return fetchImpl(...args); } });
  return { client, waits, calls };
}
const page = (offset, jobs, total, has_more, limit = 100) => ({ offset: 0, limit, jobs, total, has_more, pagination_mode: 'cursor', next_cursor: has_more ? `page-${offset + limit}` : null });
const requestedOffset = url => { const cursor = new URL(url).searchParams.get('cursor'); assert.ok(cursor); assert.equal(new URL(url).searchParams.has('offset'), false); return cursor === 'start' ? 0 : Number(cursor.replace('page-', '')); };
test('successful calls are paced across pages', async () => {
  const f = fixture(url => { const n = requestedOffset(url); return ok(page(n, [{ id: String(n) }], 2, n === 0, 1)); });
  assert.equal((await f.client.all(API, {}, { pageSize: 1 })).length, 2);
  assert.deepEqual(f.calls, [0, 1500]);
});
test('pagination passes the former 10000-row cutoff and reaches explicit completion', async () => {
  const f = fixture(url => { const offset = requestedOffset(url); return ok(page(offset, Array.from({ length: 100 }, (_, i) => ({ id: String(offset + i) })), 10100, offset < 10000)); });
  assert.equal((await f.client.all(API)).length, 10100); assert.equal(f.calls.length, 101);
});
test('429 waits for Retry-After and rate-limit reset before retrying the same page', async () => {
  let n = 0; const urls = [];
  const f = fixture(url => { urls.push(url); return ++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '20', 'ratelimit-reset': '60' } }) : ok({ done: true }); });
  await f.client.get(API, {}); assert.deepEqual(f.calls, [0, 60000]); assert.equal(urls[0], urls[1]);
});
test('HTTP-date cooldown is honored and an over-budget cooldown stops without retrying early', async () => {
  const f = fixture(() => new Response('', { status: 503, headers: { 'retry-after': new Date(90000).toUTCString() } }));
  await assert.rejects(f.client.get(API, {}), /503/); assert.equal(f.calls[1], 90000);
  const long = fixture(() => new Response('', { status: 429, headers: { 'retry-after': '121' } }));
  await assert.rejects(long.client.get(API, {}), /budget/); assert.equal(long.calls.length, 1);
});
test('permanent errors and exhausted retries stop; network errors retry with pacing', async () => {
  const permanent = fixture(() => new Response('', { status: 401 })); await assert.rejects(permanent.client.get(API, {}), /401/); assert.equal(permanent.calls.length, 1);
  const exhausted = fixture(() => new Response('', { status: 429 })); await assert.rejects(exhausted.client.get(API, {}), /429/); assert.equal(exhausted.calls.length, 4);
  let n = 0; const network = fixture(() => { if (++n === 1) throw new TypeError('network'); return ok({ done: true }); }); await network.client.get(API, {}); assert.ok(network.calls[1] >= 5000);
});
test('page budget, repeated IDs, premature end and inconsistent totals fail closed', async () => {
  const capped = fixture(() => ok(page(0, [{ id: 'a' }], 2, true, 1))); await assert.rejects(capped.client.all(API, {}, { pageSize: 1, maxPages: 1 }), /budget/);
  const duplicate = fixture(url => { const n = requestedOffset(url); return ok(page(n, [{ id: 'a' }], 2, n === 0, 1)); }); await assert.rejects(duplicate.client.all(API, {}, { pageSize: 1 }), /repeated/);
  const short = fixture(() => ok(page(0, [], 2, true))); await assert.rejects(short.client.all(API), /final page/);
  const falseEnd = fixture(() => ok(page(0, [{ id: 'a' }], 2, false))); await assert.rejects(falseEnd.client.all(API), /total/);
});
test('malformed pagination and limited ranking pools cannot publish a complete result', async () => {
  for (const body of [{ ...page(0, [], 0, false), offset: 1 }, { jobs: [] }, { ...page(0, [], 0, false), ranked: true }, { ...page(0, [], 0, false), pool_exhausted: true }]) {
    await assert.rejects(fixture(() => ok(body)).client.all(API));
  }
});
async function staging() {
  const dir = await mkdtemp(join(tmpdir(), 'litos-internship-refresh-'));
  await cp(new URL('.', import.meta.url), join(dir, 'scripts'), { recursive: true });
  await mkdir(join(dir, 'data')); await mkdir(join(dir, 'lists'));
  await writeFile(join(dir, 'README.md'), 'existing list'); await writeFile(join(dir, 'lists/software.md'), 'existing roles');
  await writeFile(join(dir, 'data/internship-lifespan.csv'), 'id,last_seen\nold,2026-10-15\n');
  await writeFile(join(dir, 'data/daily-totals.csv'), 'date,all\n2026-10-15,10\n');
  return dir;
}
test('a failed list fetch preserves existing published list files', async () => {
  const dir = await staging(); await writeFile(join(dir, 'mock.mjs'), "globalThis.fetch = async () => new Response('', {status:401});");
  await assert.rejects(exec(process.execPath, ['--import', join(dir, 'mock.mjs'), 'scripts/update.mjs'], { cwd: dir, timeout: 10000 }));
  assert.equal(await readFile(join(dir, 'README.md'), 'utf8'), 'existing list'); assert.equal(await readFile(join(dir, 'lists/software.md'), 'utf8'), 'existing roles');
});
test('opaque cursors retain filters; cursor cycles, changed totals and invalidation abort', async () => {
  let n = 0; const urls = [];
  const opaque = fixture(url => {
    urls.push(new URL(url));
    return ok(++n === 1 ? { ...page(0, [{id:'a'}], 2, true, 1), next_cursor: 'opaque+/=&signed' } : page(1, [{id:'b'}], 2, false, 1));
  });
  await opaque.client.all(API, {employment_type:'Internship'}, {pageSize:1});
  assert.equal(urls[1].searchParams.get('cursor'), 'opaque+/=&signed');
  assert.ok(urls.every(u => u.searchParams.get('employment_type') === 'Internship'));
  let count = 0;
  const cycle = fixture(() => ok({ ...page(0, [{id:String(++count)}], 3, true, 1), next_cursor:'same' }));
  await assert.rejects(cycle.client.all(API, {}, {pageSize:1}), /continuation repeated/);
  count = 0;
  const changed = fixture(() => ok(page(count, [{id:String(count++)}], count === 1 ? 2 : 3, true, 1)));
  await assert.rejects(changed.client.all(API, {}, {pageSize:1}), /total changed/);
  count = 0;
  const invalid = fixture(() => ++count === 1 ? ok(page(0, [{id:'a'}], 2, true, 1)) : new Response('', {status:409}));
  await assert.rejects(invalid.client.all(API, {}, {pageSize:1}), /409/);
  assert.equal(invalid.calls.length, 2);
});

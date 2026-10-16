import { setTimeout as delay } from 'node:timers/promises';

// Shared pacing for the list and historical snapshot. Respect server cooldowns;
// never publish a capped or failed pagination result as a complete refresh.
export function createFeedClient({ fetchImpl = fetch, sleep = delay, now = Date.now,
  minGapMs = 1500, maxAttempts = 4, maxRetryWaitMs = 120_000 } = {}) {
  let nextRequestAt = 0;
  async function get(api, params) {
    const url = new URL(api);
    url.search = new URLSearchParams(params).toString();
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await sleep(Math.max(0, nextRequestAt - now()));
      let response;
      try {
        response = await fetchImpl(url.href, { headers: { Accept: 'application/json', 'User-Agent': 'litos-public-internship-resource' }, signal: AbortSignal.timeout(20_000) });
      } catch (error) {
        nextRequestAt = now() + minGapMs;
        if (attempt === maxAttempts) throw new Error('Internship feed transport failed', { cause: error });
        await sleep(5000 * attempt);
        continue;
      }
      nextRequestAt = now() + minGapMs;
      if (response.ok) return response.json();
      const status = response.status;
      const retryAfter = response.headers.get('retry-after');
      const reset = response.headers.get('ratelimit-reset');
      await response.body?.cancel();
      if (![429, 502, 503, 504].includes(status) || attempt === maxAttempts) {
        throw new Error(`Internship feed returned ${status}`);
      }
      const seconds = value => value != null && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : null;
      const retryMs = seconds(retryAfter) ?? (retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - now()) : null);
      const waitMs = Math.max(5000 * attempt, retryMs ?? 0, status === 429 ? seconds(reset) ?? 0 : 0);
      if (!Number.isFinite(waitMs) || waitMs > maxRetryWaitMs) throw new Error('Internship feed cooldown exceeds this run budget');
      await sleep(waitMs);
    }
  }
  async function all(api, params = {}, { pageSize = 100, maxPages = 1000 } = {}) {
    const jobs = [], ids = new Set();
    for (let page = 0; page < maxPages; page++) {
      const offset = page * pageSize;
      const body = await get(api, { ...params, limit: String(pageSize), offset: String(offset) });
      if (!Array.isArray(body.jobs) || typeof body.has_more !== 'boolean' || body.jobs.length > pageSize
        || body.offset !== offset || body.limit !== pageSize || !Number.isSafeInteger(body.total) || body.total < 0) {
        throw new Error('Internship feed pagination is malformed');
      }
      if (body.ranked === true || body.pool_exhausted === true) throw new Error('Internship feed is a limited ranking pool');
      if (body.has_more && body.jobs.length !== pageSize) throw new Error('Internship feed ended before its final page');
      for (const job of body.jobs) {
        if (!job || typeof job.id !== 'string' || !job.id || ids.has(job.id)) throw new Error('Internship feed contains missing or repeated IDs');
        ids.add(job.id);
        jobs.push(job);
      }
      if (!body.has_more) {
        if (body.total > jobs.length) throw new Error('Internship feed total exceeds returned rows');
        return jobs;
      }
    }
    throw new Error('Internship feed page budget reached before completion');
  }
  return { get, all };
}

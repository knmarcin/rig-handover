import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { RigConfig } from '../src/config.js';
import type { NightDigest } from '../src/digest/types.js';

// runs/ is read-only: the nights below are written to a temp dir.
const runsDir = mkdtempSync(join(tmpdir(), 'rig-routes-'));
afterAll(() => rmSync(runsDir, { recursive: true, force: true }));

const config: RigConfig = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir,
};

const line = (fields: Record<string, unknown>) =>
  JSON.stringify({ at: '2026-11-01T01:00:00+01:00', job: 'b/sync', status: 'ok', owner: 'rook', ...fields });

function writeNight(name: string, lines: string[]): void {
  writeFileSync(join(runsDir, `${name}.jsonl`), lines.map((l) => `${l}\n`).join(''));
}

// The job names in the page's table, in the order the page prints them.
function jobsInPage(html: string): string[] {
  return [...html.matchAll(/<tr><td>([^<]+)<\/td>/g)].map((m) => m[1] ?? '');
}

writeNight('2026-11-01', [
  line({ at: '2026-11-01T01:00:00+01:00', status: 'retry' }),
  line({ at: '2026-11-01T01:05:00+01:00', status: 'retry' }),
  line({ at: '2026-11-01T01:10:00+01:00', status: 'retry' }),
  line({ at: '2026-11-01T01:15:00+01:00', status: 'ok' }),
  line({ at: '2026-11-01T02:00:00+01:00', job: 'a/backup', status: 'fail', owner: null, error: 'quota exceeded' }),
]);
writeNight('2026-11-02', []);
writeNight('2026-11-03', [line({}), 'not json', line({ job: 'a/backup', status: 'fail', owner: null })]);

describe('GET /digest/:night', () => {
  it('shows a normal night: jobs in order, a dash for no owner, retries and fail marked', async () => {
    const res = await createApp(config).request('/digest/2026-11-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(jobsInPage(html)).toEqual(['a/backup', 'b/sync']);
    expect(html).toContain('—');
    expect(html).toContain('! 3');
    expect(html).toContain('! fail');
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request('/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('no run log for 2026-01-01');
  });

  it('says nothing ran for an empty night', async () => {
    const res = await createApp(config).request('/digest/2026-11-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('keeps the good jobs and says how many lines did not parse', async () => {
    const res = await createApp(config).request('/digest/2026-11-03');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(jobsInPage(html)).toEqual(['a/backup', 'b/sync']);
    expect(html).toContain('1 line(s) did not parse');
  });

  it('answers 404 for a night that is not a date', async () => {
    const res = await createApp(config).request('/digest/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/digest/:night', () => {
  it('returns the same jobs, in the same order, as the page', async () => {
    const page = await (await createApp(config).request('/digest/2026-11-01')).text();
    const res = await createApp(config).request('/api/digest/2026-11-01');
    expect(res.status).toBe(200);
    const digest = (await res.json()) as NightDigest;
    expect(digest.rows.map((r) => r.job)).toEqual(jobsInPage(page));
    expect(digest.rows.map((r) => r.job)).toEqual(['a/backup', 'b/sync']);
    expect(digest.rows[0]?.owner).toBeNull();
    expect(digest.rows[1]?.retries).toBe(3);
  });

  it('answers 404 for a night with no file', async () => {
    const res = await createApp(config).request('/api/digest/2026-01-01');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'no run log for that night' });
  });

  it('returns no rows for the empty night', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-02');
    expect(res.status).toBe(200);
    const digest = (await res.json()) as NightDigest;
    expect(digest.rows).toEqual([]);
  });

  it('keeps the good jobs and counts the bad line', async () => {
    const res = await createApp(config).request('/api/digest/2026-11-03');
    expect(res.status).toBe(200);
    const digest = (await res.json()) as NightDigest;
    expect(digest.rows.map((r) => r.job)).toEqual(['a/backup', 'b/sync']);
    expect(digest.badLines).toBe(1);
  });

  it('answers 404 for a night that is not a date', async () => {
    const res = await createApp(config).request('/api/digest/nope');
    expect(res.status).toBe(404);
  });
});

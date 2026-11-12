import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

// runs/ is read-only: everything written here goes to a temp dir.
const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function night(name: string, text: string): string {
  writeFileSync(join(dir, `${name}.jsonl`), text);
  return name;
}

const line = (fields: Record<string, unknown>) =>
  JSON.stringify({ at: '2026-11-01T01:00:00+01:00', job: 'a/job', status: 'ok', owner: 'rook', ...fields });

describe('readNight on runs/2026-10-28.jsonl', () => {
  const digest = readNight('runs', '2026-10-28');

  it('reads 5 jobs sorted by job, and 1 bad line', () => {
    expect(digest?.night).toBe('2026-10-28');
    expect(digest?.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(digest?.badLines).toBe(1);
  });

  it('counts log lines by status over the whole night', () => {
    expect(digest?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('builds each row from its lines, times as the log wrote them', () => {
    expect(digest?.rows).toEqual([
      {
        job: 'digest/render',
        owner: null,
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-29T05:41:09+01:00',
        lastAt: '2026-10-29T05:41:09+01:00',
      },
      {
        job: 'fixtures/refresh',
        owner: 'rook',
        runs: 4,
        retries: 3,
        lastStatus: 'ok',
        lastError: 'upstream 503',
        firstAt: '2026-10-29T01:30:00+01:00',
        lastAt: '2026-10-29T01:37:00+01:00',
      },
      {
        job: 'lane/sync',
        owner: 'rook',
        runs: 8,
        retries: 1,
        lastStatus: 'ok',
        lastError: 'lock held',
        firstAt: '2026-10-28T23:00:06+01:00',
        lastAt: '2026-10-29T05:00:04+01:00',
      },
      {
        job: 'notes/backup',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        lastStatus: 'fail',
        lastError: 'quota exceeded',
        firstAt: '2026-10-29T04:00:01+01:00',
        lastAt: '2026-10-29T04:00:01+01:00',
      },
      {
        job: 'rig/rotate-logs',
        owner: 'lane-07',
        runs: 1,
        retries: 0,
        lastStatus: 'ok',
        lastError: null,
        firstAt: '2026-10-28T23:00:02+01:00',
        lastAt: '2026-10-28T23:00:02+01:00',
      },
    ]);
  });
});

describe('readNight on a temp runs dir', () => {
  it('returns null when the night has no file', () => {
    expect(readNight(dir, '2026-01-01')).toBeNull();
  });

  it('returns no rows for an empty file', () => {
    expect(readNight(dir, night('2026-11-01', ''))).toEqual({
      night: '2026-11-01',
      rows: [],
      counts: { ok: 0, retry: 0, fail: 0 },
      badLines: 0,
    });
  });

  it('returns null for a night that is not YYYY-MM-DD, even if a file answers to it', () => {
    const sub = join(dir, 'sub');
    mkdirSync(sub);
    writeFileSync(join(sub, '2026-11-02.jsonl'), `${line({})}\n`);
    night('latest', `${line({})}\n`);
    expect(readNight(sub, '2026-11-02')?.rows).toHaveLength(1);

    // Each of these would reach one of the two files above if it were joined to the dir.
    expect(readNight(dir, 'sub/2026-11-02')).toBeNull();
    expect(readNight(dir, 'latest')).toBeNull();
    expect(readNight(sub, '../latest')).toBeNull();
    expect(readNight(sub, '../sub/2026-11-02')).toBeNull();
    for (const bad of ['2026-11-2', '2026-11-02\n', ' 2026-11-02', '2026-11-02.jsonl', '']) {
      expect(readNight(sub, bad)).toBeNull();
    }
  });

  it('skips blank lines: a trailing newline is not a bad line', () => {
    const digest = readNight(dir, night('2026-11-03', `${line({})}\n\n   \n${line({ status: 'retry' })}\n`));
    expect(digest?.badLines).toBe(0);
    expect(digest?.counts).toEqual({ ok: 1, retry: 1, fail: 0 });
    expect(digest?.rows).toHaveLength(1);
  });

  it('counts a line with an unknown status as a bad line', () => {
    const digest = readNight(dir, night('2026-11-04', `${line({})}\n${line({ status: 'skipped' })}\n`));
    expect(digest?.badLines).toBe(1);
    expect(digest?.counts).toEqual({ ok: 1, retry: 0, fail: 0 });
    expect(digest?.rows.map((r) => r.runs)).toEqual([1]);
  });

  it('counts broken JSON and lines missing `at` or `job` as bad lines, and keeps the rest', () => {
    const text = ['{"at":"2026-11-0', '[]', 'null', '"ok"', line({ at: 5 }), line({ job: null }), line({})].join('\n');
    const digest = readNight(dir, night('2026-11-05', text));
    expect(digest?.badLines).toBe(6);
    expect(digest?.rows.map((r) => r.job)).toEqual(['a/job']);
  });

  it('turns a missing owner into null and ignores an error that is not a string', () => {
    const text = [
      line({ job: 'b/job', owner: undefined, status: 'retry', error: 'first' }),
      line({ job: 'b/job', owner: 7, status: 'fail', error: { code: 1 }, at: '2026-11-01T02:00:00+01:00' }),
    ].join('\n');
    expect(readNight(dir, night('2026-11-06', text))?.rows).toEqual([
      {
        job: 'b/job',
        owner: null,
        runs: 2,
        retries: 1,
        lastStatus: 'fail',
        lastError: 'first',
        firstAt: '2026-11-01T01:00:00+01:00',
        lastAt: '2026-11-01T02:00:00+01:00',
      },
    ]);
  });

  it('sorts rows by plain string comparison, not by locale', () => {
    const text = ['b', 'a', 'B', 'ä', 'a-1'].map((job) => line({ job })).join('\n');
    expect(readNight(dir, night('2026-11-07', text))?.rows.map((r) => r.job)).toEqual(['B', 'a', 'a-1', 'b', 'ä']);
  });
});

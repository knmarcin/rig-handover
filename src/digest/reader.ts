import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, NightDigest, ReadNight, RunStatus } from './types.js';

// `night` arrives from a URL. Anything that isn't a plain date never reaches the disk.
const NIGHT = /^\d{4}-\d{2}-\d{2}$/;

type RunLine = { at: string; job: string; status: RunStatus; owner: string | null; error: string | null };

// The edge: one log line in, a typed line out, or null for a line that doesn't hold up.
function parseLine(line: string): RunLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { at, job, status, owner, error } = raw as Record<string, unknown>;
  if (typeof at !== 'string' || typeof job !== 'string') return null;
  if (status !== 'ok' && status !== 'retry' && status !== 'fail') return null;
  return {
    at,
    job,
    status,
    owner: typeof owner === 'string' ? owner : null,
    error: typeof error === 'string' ? error : null,
  };
}

// One row per job, lines taken in file order. A bad line is counted, never thrown: the night
// still renders. Times stay the strings the log wrote.
export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;

  let text: string;
  try {
    text = readFileSync(join(runsDir, `${night}.jsonl`), 'utf8');
  } catch {
    return null;
  }

  const byJob = new Map<string, DigestRow>();
  const counts: NightDigest['counts'] = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const run = parseLine(trimmed);
    if (run === null) {
      badLines += 1;
      continue;
    }
    counts[run.status] += 1;

    const row = byJob.get(run.job);
    if (row === undefined) {
      byJob.set(run.job, {
        job: run.job,
        owner: run.owner,
        runs: 1,
        retries: run.status === 'retry' ? 1 : 0,
        lastStatus: run.status,
        lastError: run.error,
        firstAt: run.at,
        lastAt: run.at,
      });
      continue;
    }
    row.owner = run.owner;
    row.runs += 1;
    if (run.status === 'retry') row.retries += 1;
    row.lastStatus = run.status;
    if (run.error !== null) row.lastError = run.error;
    row.lastAt = run.at;
  }

  const rows = [...byJob.values()].sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));
  return { night, rows, counts, badLines };
};

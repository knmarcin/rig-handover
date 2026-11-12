// Plan morning-digest § 1. The contract the page, the JSON route, the board link and the route
// tests are built against: change it here and every part of section 2 changes with it.
export type RunStatus = 'ok' | 'retry' | 'fail';

// One row per job for one night.
export type DigestRow = {
  job: string;
  owner: string | null; // null stays null; views show it as —
  runs: number; // log lines for this job
  retries: number; // lines with status `retry`
  lastStatus: RunStatus; // status of the job's last line
  lastError: string | null; // `error` of the latest line that had one, else null
  firstAt: string; // `at` exactly as in the log (offset kept, never converted)
  lastAt: string;
};

export type NightDigest = {
  night: string; // YYYY-MM-DD
  rows: DigestRow[]; // sorted by job (plain string comparison, not locale)
  counts: Record<RunStatus, number>; // log lines by status, over the whole night
  badLines: number; // lines that did not parse; counted, never thrown
};

// null: there is no file for that night (or `night` is not YYYY-MM-DD). An empty file: rows [].
export type ReadNight = (runsDir: string, night: string) => NightDigest | null;

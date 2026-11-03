// SPDX-License-Identifier: Apache-2.0
// perf/race-memory-probe only: resident memory of the server before, during and 60 s after the e2e suite.
import { readFileSync } from 'node:fs';
const [rssFile, marksFile] = process.argv.slice(2);
const rss = readFileSync(rssFile, 'utf8').trim().split('\n').map((l) => l.split(' ').map(Number)).filter(([t, kb]) => t && kb);
const marks = Object.fromEntries(readFileSync(marksFile, 'utf8').trim().split('\n').map((l) => l.split(' ')).map(([k, v]) => [k, Number(v)]));
const at = (t) => (rss.filter(([s]) => s <= t).pop() || [0, 0])[1];
const mib = (kb) => (kb / 1024).toFixed(1);
const during = rss.filter(([t]) => t >= marks.E2E_START && t <= marks.E2E_END).map(([, kb]) => kb).sort((a, b) => a - b);
const med = during.length ? during[Math.floor(during.length / 2)] : 0;
console.log('| rest | before e2e | e2e median | e2e max | e2e end | +60 s |');
console.log('|---|---|---|---|---|---|');
console.log(`| Mi | ${mib(at(marks.E2E_BEFORE))} | ${mib(med)} | ${mib(during.at(-1) || 0)} | ${mib(at(marks.E2E_END))} | ${mib(at(marks.E2E_AFTER60))} |`);

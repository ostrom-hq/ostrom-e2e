// Regenerates the scenario table of RAPPORT.md from SCENARIOS.md: `pnpm report`.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCatalog, renderTable, updateReport } from '../src/catalog.ts';

const root = new URL('../', import.meta.url);
const table = renderTable(parseCatalog(readFileSync(new URL('SCENARIOS.md', root), 'utf8')));
const path = new URL('RAPPORT.md', root);
writeFileSync(path, updateReport(readFileSync(path, 'utf8'), table));

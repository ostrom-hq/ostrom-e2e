// Every scenario of SCENARIOS.md that has no test yet appears as a todo, with its status, so the CI report shows the
// whole catalogue: implemented ones (status « codé » or « vert ») live in their family's file.
import { readFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { parseCatalog } from '../src/catalog.ts';

const all = parseCatalog(readFileSync(new URL('../SCENARIOS.md', import.meta.url), 'utf8'));

describe('catalogue (not implemented yet)', () => {
  for (const s of all.filter((x) => x.state === 'bloqué' || x.state === 'écrit')) {
    it.todo(`${s.id} — ${s.title} [${s.priority}] (${s.status})`);
  }
});

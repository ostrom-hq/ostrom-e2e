import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BEGIN, END, countByFamily, parseCatalog, renderTable, stateOf, updateReport } from '../src/catalog.ts';

const md = `# Catalogue
intro
### E2E-GATE-001 — Push gated
- Priorité : jalon
- Statut : vert (run 1)
### E2E-GATE-002 — Yes on another SHA
- Priorité : P1
- Statut : codé
## Section
- Statut : ignored outside a scenario
### E2E-WEB-001 — Web yes
- Priorité : jalon
- Statut : bloqué : ostrom-web
### E2E-WEB-002 — Spec only
- Statut : écrit
### not a scenario
`;

describe('catalog', () => {
  it('maps a status line to its state', () => {
    expect([stateOf(' vert (run)'), stateOf('codé'), stateOf('écrit'), stateOf('bloqué : x'), stateOf('')]).toEqual(['vert', 'codé', 'écrit', 'bloqué', 'bloqué']);
  });

  it('parses scenarios, their priority and status', () => {
    const s = parseCatalog(md);
    expect(s.map((x) => [x.id, x.family, x.title, x.priority, x.state])).toEqual([
      ['E2E-GATE-001', 'GATE', 'Push gated', 'jalon', 'vert'],
      ['E2E-GATE-002', 'GATE', 'Yes on another SHA', 'P1', 'codé'],
      ['E2E-WEB-001', 'WEB', 'Web yes', 'jalon', 'bloqué'],
      ['E2E-WEB-002', 'WEB', 'Spec only', '', 'écrit'],
    ]);
  });

  it('counts by family and renders the report table', () => {
    const s = parseCatalog(md);
    expect(countByFamily(s)).toEqual([
      { family: 'GATE', total: 2, jalon: 1, vert: 1, codé: 1, écrit: 0, bloqué: 0 },
      { family: 'WEB', total: 2, jalon: 1, vert: 0, codé: 0, écrit: 1, bloqué: 1 },
    ]);
    expect(renderTable(s).split('\n').at(-1)).toBe('| **Total** | 4 | 2 | 1 | 1 | 1 | 1 |');
  });

  it('replaces the generated block, or appends it', () => {
    expect(updateReport(`a\n${BEGIN}\nold\n${END}\nb`, 'new')).toBe(`a\n${BEGIN}\nnew\n${END}\nb`);
    expect(updateReport('a\n', 'new')).toBe(`a\n\n${BEGIN}\nnew\n${END}\n`);
    expect(updateReport(`${END} ${BEGIN}`, 'n')).toBe(`${END} ${BEGIN}\n\n${BEGIN}\nn\n${END}\n`);
  });

  it('reads the real catalogue: unique ids, every scenario has a priority and a status', () => {
    const s = parseCatalog(readFileSync(new URL('../SCENARIOS.md', import.meta.url), 'utf8'));
    expect(s.length).toBeGreaterThan(250);
    expect(new Set(s.map((x) => x.id)).size).toBe(s.length);
    expect(s.filter((x) => !['jalon', 'P1', 'P2'].includes(x.priority)).map((x) => x.id)).toEqual([]);
    expect(s.filter((x) => x.status === '').map((x) => x.id)).toEqual([]);
  });
});

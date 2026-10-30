// SPDX-License-Identifier: Apache-2.0
// Reads the scenario catalogue (SCENARIOS.md) and summarises it for RAPPORT.md.
// A scenario is a `### E2E-<FAMILY>-<NNN> — <title>` section with `- Priorité : …` and `- Statut : …` bullets.

export type State = 'vert' | 'codé' | 'écrit' | 'bloqué';

export interface Scenario {
  readonly id: string;
  readonly family: string;
  readonly title: string;
  readonly priority: string;
  readonly status: string;
  readonly state: State;
}

const HEADING = /^### (E2E-([A-Z]+)-\d{3}) — (.+)$/;

export function stateOf(status: string): State {
  const s = status.trim();
  if (s.startsWith('vert')) return 'vert';
  if (s.startsWith('codé')) return 'codé';
  if (s.startsWith('écrit')) return 'écrit';
  return 'bloqué';
}

export function parseCatalog(markdown: string): Scenario[] {
  const out: Scenario[] = [];
  let cur: { id: string; family: string; title: string; priority: string; status: string } | undefined;
  const flush = () => {
    if (cur) out.push({ ...cur, state: stateOf(cur.status) });
    cur = undefined;
  };
  for (const line of markdown.split('\n')) {
    const h = HEADING.exec(line);
    if (h) {
      flush();
      cur = { id: h[1] as string, family: h[2] as string, title: (h[3] as string).trim(), priority: '', status: '' };
    } else if (line.startsWith('#')) {
      flush();
    } else if (cur && line.startsWith('- Priorité :')) {
      cur.priority = line.slice('- Priorité :'.length).trim();
    } else if (cur && line.startsWith('- Statut :')) {
      cur.status = line.slice('- Statut :'.length).trim();
    }
  }
  flush();
  return out;
}

export interface FamilyCount {
  readonly family: string;
  readonly total: number;
  readonly jalon: number;
  readonly vert: number;
  readonly codé: number;
  readonly écrit: number;
  readonly bloqué: number;
}

export function countByFamily(scenarios: readonly Scenario[]): FamilyCount[] {
  const map = new Map<string, { total: number; jalon: number; vert: number; codé: number; écrit: number; bloqué: number }>();
  for (const s of scenarios) {
    const c = map.get(s.family) ?? { total: 0, jalon: 0, vert: 0, codé: 0, écrit: 0, bloqué: 0 };
    c.total += 1;
    if (s.priority === 'jalon') c.jalon += 1;
    c[s.state] += 1;
    map.set(s.family, c);
  }
  return [...map.entries()].map(([family, c]) => ({ family, ...c }));
}

/** The scenario table of RAPPORT.md, between its markers. */
export function renderTable(scenarios: readonly Scenario[]): string {
  const rows = countByFamily(scenarios);
  const sum = (k: keyof Omit<FamilyCount, 'family'>) => rows.reduce((a, r) => a + r[k], 0);
  const line = (r: Omit<FamilyCount, 'family'> & { family: string }) =>
    `| ${r.family} | ${r.total} | ${r.jalon} | ${r.vert} | ${r.codé} | ${r.écrit} | ${r.bloqué} |`;
  const total = { family: '**Total**', total: sum('total'), jalon: sum('jalon'), vert: sum('vert'), codé: sum('codé'), écrit: sum('écrit'), bloqué: sum('bloqué') };
  return [
    '| Famille | Scénarios | dont jalon | vert | codé | écrit | bloqué |',
    '|---|---|---|---|---|---|---|',
    ...rows.map(line),
    line(total),
  ].join('\n');
}

export const BEGIN = '<!-- scenarios:begin -->';
export const END = '<!-- scenarios:end -->';

/** Replaces the generated block of RAPPORT.md (or appends it when the markers are missing). */
export function updateReport(report: string, table: string): string {
  const block = `${BEGIN}\n${table}\n${END}`;
  const a = report.indexOf(BEGIN);
  const b = report.indexOf(END);
  if (a === -1 || b < a) return `${report.trimEnd()}\n\n${block}\n`;
  return report.slice(0, a) + block + report.slice(b + END.length);
}

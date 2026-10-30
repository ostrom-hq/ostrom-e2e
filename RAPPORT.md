# Tableau de bord des tests d'Ostrom

Tenu par l'agent QA. Règle (Lyes, 30/10/2026) : unitaires, intégration, end-to-end et charge, 100 % des lignes et
des branches imposé par la CI, checks obligatoires sur `main`. Mis à jour le 30/10/2026 à 02:45. « posée » = PR obligatoire, à jour avec `main`, admins compris, ni force-push
ni suppression, historique linéaire.

## Par dépôt

| Dépôt | Socle fusionné | Couverture mesurée (lignes / branches) | Unitaires | Intégration | E2E | Charge | Checks obligatoires | Protection de `main` | Dernier run vert |
|---|---|---|---|---|---|---|---|---|---|
| ostrom-core | oui (#1, #3, #5) | pas encore mesurée : Kover arrive avec ostrom-core#8 (`chore/conventions`) | 26 | — | — | — | `native` (puis `linux`, `contract`) | posée | — |
| ostrom-cli | non (ostrom-cli#1 en CI) | 100 % imposé dans le socle (`coverage`), pas encore sur `main` | 0 sur `main` | — | — | — | PR seule (puis `coverage`, `native-tests`, `e2e`) | posée | — |
| ostrom-server | non (ostrom-server#1 en CI) | `ops/stripe` : 100 % (job `stripe-provision`) ; Kover arrive avec le socle | — | 28 (stripe-mock) | — | — | PR seule (puis `build`, `coverage`, `native-tests`, `e2e`, `load-smoke`) | posée | — |
| ostrom-web | oui (#1) | 100 % imposé (Vitest, job `check`) | 21 | — | 3 (Playwright) | — | `check`, `e2e` | posée | — |
| ostrom-app | oui (#4) | 100 % imposé (Jest, job `Typecheck, lint, test`) | 51 | 15 (MSW) | — (Maestro à brancher) | — | `Typecheck, lint, test` (puis `e2e-android`) | posée | — |
| ostrom-e2e | oui (#1, #2) | 100 % / 100 % imposé (job `ci`) | 30 | — | 2 (banc) + 4 parcours du jalon codés | 3 scripts k6 | `ci` | posée | — |

## Scénarios end-to-end (SCENARIOS.md)

Généré par `pnpm report`. `vert` = vert en CI ; `codé` = test écrit, pas encore vert ; `écrit` = spécifié ;
`bloqué` = la fonction n'existe pas encore dans la réécriture.

<!-- scenarios:begin -->
| Famille | Scénarios | dont jalon | vert | codé | écrit | bloqué |
|---|---|---|---|---|---|---|
| LOGIN | 8 | 1 | 0 | 1 | 0 | 7 |
| CONN | 15 | 0 | 0 | 0 | 0 | 15 |
| CLAUDE | 19 | 4 | 0 | 2 | 0 | 17 |
| CODEX | 9 | 0 | 0 | 0 | 0 | 9 |
| GATE | 15 | 5 | 0 | 1 | 0 | 14 |
| BYPASS | 33 | 12 | 0 | 0 | 0 | 33 |
| YES | 13 | 5 | 0 | 2 | 0 | 11 |
| YESCLI | 4 | 1 | 0 | 1 | 0 | 3 |
| SLACK | 5 | 0 | 0 | 0 | 0 | 5 |
| WEB | 6 | 1 | 0 | 0 | 0 | 6 |
| APP | 6 | 0 | 0 | 0 | 0 | 6 |
| RESUME | 5 | 0 | 0 | 0 | 0 | 5 |
| WAKE | 9 | 0 | 0 | 0 | 0 | 9 |
| RECEIPT | 11 | 4 | 0 | 1 | 0 | 10 |
| COMPAT | 12 | 6 | 0 | 0 | 0 | 12 |
| GHCHECK | 8 | 0 | 0 | 0 | 0 | 8 |
| FOREIGN | 4 | 1 | 0 | 0 | 0 | 4 |
| CACHE | 6 | 0 | 0 | 0 | 0 | 6 |
| NOTIFY | 11 | 0 | 0 | 0 | 0 | 11 |
| MCP | 6 | 0 | 0 | 0 | 0 | 6 |
| SECRETS | 8 | 0 | 0 | 0 | 0 | 8 |
| GW | 9 | 0 | 0 | 0 | 0 | 9 |
| SHARE | 5 | 0 | 0 | 0 | 0 | 5 |
| CLOUD | 8 | 0 | 0 | 0 | 0 | 8 |
| WF | 14 | 0 | 0 | 0 | 0 | 14 |
| WFRUN | 8 | 0 | 0 | 0 | 0 | 8 |
| AUTO | 5 | 0 | 0 | 0 | 0 | 5 |
| ARTIFACT | 4 | 0 | 0 | 0 | 0 | 4 |
| ONBOARD | 10 | 0 | 0 | 0 | 0 | 10 |
| CONSOLE | 8 | 0 | 0 | 0 | 0 | 8 |
| ANA | 5 | 0 | 0 | 0 | 0 | 5 |
| HARNESS | 8 | 0 | 0 | 0 | 0 | 8 |
| DIST | 4 | 0 | 0 | 0 | 0 | 4 |
| TC | 2 | 0 | 0 | 0 | 0 | 2 |
| LOAD | 10 | 0 | 0 | 3 | 0 | 7 |
| DOGFOOD | 3 | 0 | 0 | 0 | 0 | 3 |
| **Total** | 316 | 40 | 0 | 11 | 0 | 305 |
<!-- scenarios:end -->

## Charge

| Script | Quand | Seuils | Dernier résultat |
|---|---|---|---|
| `load/smoke.js` | chaque PR serveur | p95/p99 : `/health` 50/100 ms, question de hook `POST /api/v1/gates` 50/150 ms, push sur main + oui 150/400 ms ; erreurs < 1 % | bloqué : pas encore de serveur |
| `load/race.js` | chaque PR serveur + nuit | 100 oui simultanés sur une demande : 1 × 200, 99 × 409, rien d'autre | bloqué : pas encore de serveur |
| `load/soak.js` | nuit | 20 min à 500 questions/s + 50 portes/s, rampe 2 000/s p99 < 500 ms | bloqué : pas encore de serveur |

## Journal

- 30/10 02:00 — ostrom-e2e#1 : banc, gabarits et catalogue (302 scénarios, 34 du jalon) ; clés de déploiement en lecture
  seule et secrets d'org posés ; actions composites ouvertes aux dépôts de l'org.
- 30/10 02:15 — 14 contournements de l'audit de la porte ajoutés (BYPASS-020 à 033 : A1, A2, A3, A7b, A9, A10, A12 à A20, A24), dont 6 au jalon ; actions épinglées par SHA (CONVENTIONS § 11) ; pour Kotlin, le gabarit de CONVENTIONS (job `linux`) fait foi.
- 30/10 02:45 — faux GitHub local (`src/fake-github.ts`), bacs à sable git sans réseau (`src/git.ts`), parcours du jalon
  codés (`scenarios/jalon.e2e.ts` : LOGIN-001, CLAUDE-001, CLAUDE-003, GATE-001 avec YES-001, YES-003, YESCLI-002,
  RECEIPT-001), lancés dès que serveur et CLI les servent (`OSTROM_E2E_JALON=1`) ; k6 aligné sur le contrat `/api/v1` ;
  le banc tourne en un seul job `ci`.

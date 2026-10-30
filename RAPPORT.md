# Tableau de bord des tests d'Ostrom

Tenu par l'agent QA. Règle (Lyes, 30/10/2026) : unitaires, intégration, end-to-end et charge, 100 % des lignes et
des branches imposé par la CI, checks obligatoires sur `main`. Mis à jour le 30/10/2026 à 02:00.

## Par dépôt

| Dépôt | Socle fusionné | Couverture mesurée (lignes / branches) | Unitaires | Intégration | E2E | Charge | Checks obligatoires | Protection de `main` | Dernier run vert |
|---|---|---|---|---|---|---|---|---|---|
| ostrom-core | non | — | — | — | — | — | `coverage`, `native-tests` | à poser | — |
| ostrom-cli | non | — | — | — | — | — | `coverage`, `native-tests`, `e2e` | à poser | — |
| ostrom-server | non | — | — | — | — | — | `coverage`, `native-tests`, `e2e`, `load-smoke` | à poser | — |
| ostrom-web | non | — | — | — | — | — | `lint`, `coverage`, `e2e` | à poser | — |
| ostrom-app | non | — | — | — | — | — | `lint`, `coverage`, `e2e-android` | à poser | — |
| ostrom-e2e | en cours | 100 % / 100 % (local) | 22 | — | 2 (banc) | 3 scripts k6 | `lint`, `coverage`, `e2e` | à poser | — |

## Scénarios end-to-end (SCENARIOS.md)

Généré par `pnpm report`. `vert` = vert en CI ; `codé` = test écrit, pas encore vert ; `écrit` = spécifié ;
`bloqué` = la fonction n'existe pas encore dans la réécriture.

<!-- scenarios:begin -->
| Famille | Scénarios | dont jalon | vert | codé | écrit | bloqué |
|---|---|---|---|---|---|---|
| LOGIN | 8 | 1 | 0 | 0 | 0 | 8 |
| CONN | 15 | 0 | 0 | 0 | 0 | 15 |
| CLAUDE | 19 | 4 | 0 | 0 | 0 | 19 |
| CODEX | 9 | 0 | 0 | 0 | 0 | 9 |
| GATE | 15 | 5 | 0 | 0 | 0 | 15 |
| BYPASS | 33 | 12 | 0 | 0 | 0 | 33 |
| YES | 13 | 5 | 0 | 0 | 0 | 13 |
| YESCLI | 4 | 1 | 0 | 0 | 0 | 4 |
| SLACK | 5 | 0 | 0 | 0 | 0 | 5 |
| WEB | 6 | 1 | 0 | 0 | 0 | 6 |
| APP | 6 | 0 | 0 | 0 | 0 | 6 |
| RESUME | 5 | 0 | 0 | 0 | 0 | 5 |
| WAKE | 9 | 0 | 0 | 0 | 0 | 9 |
| RECEIPT | 11 | 4 | 0 | 0 | 0 | 11 |
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
| **Total** | 316 | 40 | 0 | 3 | 0 | 313 |
<!-- scenarios:end -->

## Charge

| Script | Quand | Seuils | Dernier résultat |
|---|---|---|---|
| `load/smoke.js` | chaque PR serveur | p95/p99 : health 50/100 ms, check 50/150 ms, porte et oui 150/400 ms ; erreurs < 1 % | bloqué : pas encore de serveur |
| `load/race.js` | chaque PR serveur + nuit | 100 oui simultanés : 1 × 200, 99 × 409 | bloqué : pas encore de serveur |
| `load/soak.js` | nuit | 20 min à 500 check/s + 50 portes/s, rampe 2 000/s p99 < 500 ms | bloqué : pas encore de serveur |

## Journal

- 30/10 02:00 — ostrom-e2e#1 : banc, gabarits et catalogue (302 scénarios, 34 du jalon) ; clés de déploiement en lecture
  seule et secrets d'org posés ; actions composites ouvertes aux dépôts de l'org.
- 30/10 02:15 — 14 contournements de l'audit de la porte ajoutés (BYPASS-020 à 033 : A1, A2, A3, A7b, A9, A10, A12 à A20, A24), dont 6 au jalon ; actions épinglées par SHA (CONVENTIONS § 11) ; pour Kotlin, le gabarit de CONVENTIONS (job `linux`) fait foi.

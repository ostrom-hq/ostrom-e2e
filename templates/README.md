# Gabarits de CI de test d'Ostrom

Règle de Lyes (30/10/2026) : tout est testé de A à Z, dès le premier jour — unitaires, intégration (vraie
PostgreSQL, vrai HTTP), end-to-end dans la CI, charge ; **100 % des lignes et des branches**, imposé par la CI ;
une PR ne fusionne que si tous ses checks sont verts. Ces gabarits sont la façon de l'imposer dans chaque dépôt.

| Fichier | Pour | Ce qu'il fait |
|---|---|---|
| `ostrom-core/docs/conventions/` (CONVENTIONS, fait foi) | core, cli, server | Plugin `ostrom.kmp` : cible `jvm()` réservée aux tests (Kover ne mesure pas le natif ; jamais publiée), Kover, règle 100 % lignes + branches ; workflow `build.yml`, job `linux` = detekt + `jvmTest` + `koverVerify` + `linuxX64Test`, PostgreSQL en service. Toute exclusion de couverture est dans le plugin ou annotée, avec sa ligne de justification. |
| `server/ci-extra.yml` | server | Jobs `e2e` (banc complet contre CE commit du serveur) et `load-smoke` (k6 : `load/smoke.js` seuils p95/p99 + `load/race.js` 100 oui simultanés → un seul gagne). |
| `cli/ci-extra.yml` | cli | Job `e2e` : CE binaire natif contre le vrai serveur, faux agent du banc. |
| `web/vitest-coverage.snippet.ts`, `web/ci.yml` | web | Seuils Vitest 100 % (lignes, branches, fonctions, instructions) ; jobs `lint`, `coverage`, `e2e` (Playwright contre le vrai serveur + PostgreSQL). |
| `app/jest-coverage.snippet.js`, `app/ci.yml` | app | Seuils Jest 100 % ; jobs `lint`, `coverage`, `e2e-android` (Maestro sur émulateur Android, KVM sur runner Linux). |

## Noms des checks (obligatoires sur `main`)

La protection de branche exige ces noms exacts (nom du job, `name:`). Ne pas les renommer sans prévenir QA.

| Dépôt | Checks obligatoires |
|---|---|
| ostrom-core | `linux` |
| ostrom-cli | `linux`, `e2e` |
| ostrom-server | `linux`, `e2e`, `load-smoke` |
| ostrom-web | `lint`, `coverage`, `e2e` |
| ostrom-app | le job Jest à seuils 100 %, `e2e-android` |
| ostrom-e2e | `ci` (un seul job : runners rares) |

Protection (posée par QA, admins compris) : PR obligatoire, checks ci-dessus obligatoires, branche à jour avec
`main` avant fusion, pas de force-push ni de suppression de `main`.

## Contrat du banc full-stack

Les actions composites `ostrom-hq/ostrom-e2e/.github/actions/server@main` et `.../cli@main` (ouvertes aux dépôts de
l'organisation) construisent les vrais binaires natifs linuxX64, en cache par commit, depuis le dépôt lui-même
(`path: .`) ou depuis `main` d'un autre dépôt (clé de déploiement en lecture seule, secrets d'org `DEPLOY_KEY_*`).

- **ostrom-server** : `ci/build-linux.sh` (exécutable) laisse `dist/ostrom-server`, sinon `./gradlew :app:linkReleaseExecutableLinuxX64` ; le binaire lit
  `OSTROM_DATABASE_URL`, `OSTROM_DATABASE_USER`, `OSTROM_DATABASE_PASSWORD` et `OSTROM_PORT`, applique ses migrations au démarrage, répond `GET /health` → 200 quand il
  est prêt ; un moyen de semer des comptes de test (`dev-a`, `rev-b`, `rev-c`, un admin) pour le banc.
- **ostrom-cli** : `ci/build-linux.sh` laisse `dist/ostrom` ; `OSTROM_URL`, `OSTROM_TOKEN`, `OSTROM_HOME`,
  `OSTROM_CLAUDE_BIN`, `OSTROM_CODEX_BIN` honorés (le banc remplace l'agent par `bin/fake-claude` / `bin/fake-codex`).
- **ostrom-web** : l'URL de l'API par `VITE_OSTROM_API_URL`.
- **ostrom-app** : l'URL de l'API par `EXPO_PUBLIC_OSTROM_API_URL` ; un `testID` sur chaque élément d'un parcours.

## Charge (k6, `load/`)

| Script | Quand | Seuils (le job échoue au-delà) |
|---|---|---|
| `smoke.js` | chaque PR serveur, ~70 s | `/health` p95 < 50 ms, p99 < 100 ms ; `/check` (200/s) p95 < 50 ms, p99 < 150 ms ; porte et oui (20/s) p95 < 150 ms, p99 < 400 ms ; erreurs < 1 % ; checks > 99 % |
| `race.js` | chaque PR serveur + nuit | 100 oui simultanés sur la même porte : exactement 1 × 200, 99 × 409, aucun autre code |
| `soak.js` | nuit (`nightly.yml`, 25 min) | 500 `/check`/s et 50 portes/s pendant 20 min (mêmes p95/p99, erreurs < 0,1 %), puis rampe à 2 000/s : p99 < 500 ms |

Les routes viennent de la spec du serveur de contrôle du prototype (`research/perf-langages/controle/SPEC.md`) ;
quand ostrom-server fixe les siennes, on les passe par `OSTROM_ROUTE_*` sans toucher aux scénarios. Seuils de
départ, recalés sur la première série verte (le serveur de contrôle du prototype consomme ~0,1 ms de CPU par
`/check` et ~0,2-0,6 ms par porte : ces seuils laissent large pour un runner partagé).

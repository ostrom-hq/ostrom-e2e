# Gabarits de CI de test d'Ostrom

Règle de Lyes (30/10/2026) : tout est testé de A à Z, dès le premier jour — unitaires, intégration (vraie
PostgreSQL, vrai HTTP), end-to-end dans la CI, charge ; **100 % des lignes et des branches**, imposé par la CI ;
une PR ne fusionne que si tous ses checks sont verts. Ces gabarits sont la façon de l'imposer dans chaque dépôt.

## Règles de CI de l'organisation (JOURNAL 03:10, les runners sont rares)

1. Sur une pull request, **un seul job `ci`** : types, lint, tests, couverture 100 %, e2e et k6 courts, dans cet ordre
   (le moins cher d'abord). Jobs séparés, matrices, macOS, Windows, arm64, images, publication : seulement sur `main`
   et les tags (`if: github.event_name != 'pull_request'`).
2. Une PR en brouillon ne lance pas de CI : `types: [opened, synchronize, reopened, ready_for_review]` et, sur chaque
   job de PR, `if: github.event_name != 'pull_request' || !github.event.pull_request.draft`. Passer la PR en « ready »
   quand on veut la CI.
3. `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: ${{ github.ref != 'refs/heads/main' }} }`.
4. Caches : `setup-node` avec `cache: pnpm` (ou `npm`), `gradle/actions/setup-gradle`, `~/.konan` par `actions/cache`.
5. On pousse une fois quand le travail est prêt, pas commit par commit : chaque push relance la CI.

En-tête à copier :

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  push:
    branches: [main]
    tags: ["[0-9]*"]
  merge_group:
  workflow_dispatch:
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}
jobs:
  ci:
    name: ci
    if: github.event_name != 'pull_request' || !github.event.pull_request.draft
```

| Fichier | Pour | Ce qu'il fait |
|---|---|---|
| `ostrom-core/docs/conventions/` (CONVENTIONS, fait foi) | core, cli, server | Plugin `ostrom.kmp` : cible `jvm()` réservée aux tests (Kover ne mesure pas le natif ; jamais publiée), Kover, règle 100 % lignes + branches ; job `ci` = detekt + `jvmTest` + `koverVerify` + `linuxX64Test`, PostgreSQL en service. Toute exclusion de couverture est dans le plugin ou annotée, avec sa ligne de justification. |
| `server/ci-extra.yml` | server | Fragment à ajouter au job `ci` : banc complet contre CE commit du serveur, puis k6 (`load/smoke.js` seuils p95/p99 + `load/race.js` 100 oui simultanés → un seul gagne) sur le même serveur. |
| `cli/ci-extra.yml` | cli | Fragment à ajouter au job `ci` : CE binaire natif contre le vrai serveur, faux agent du banc. |
| `web/vitest-coverage.snippet.ts`, `web/ci.yml` | web | Seuils Vitest 100 % ; un job `ci` (types, lint, Vitest 100 %, Playwright contre le vrai serveur + PostgreSQL). |
| `app/jest-coverage.snippet.js`, `app/ci.yml` | app | Seuils Jest 100 % ; un job `ci` (types, lint, Jest 100 %, Maestro sur émulateur Android, KVM sur runner Linux). |

## Noms des checks (obligatoires sur `main`)

**`ci` dans chaque dépôt** (core, cli, server, web, app, e2e, site, helm). La protection l'exige sous ce nom exact ;
ne pas le renommer sans prévenir QA. Un dépôt passe à `ci` dès que ce job est sur sa `main`.

Protection (posée par QA, admins compris) : PR obligatoire, `ci` obligatoire, branche à jour avec `main` avant
fusion, pas de force-push ni de suppression de `main`.

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
| `smoke.js` | chaque PR serveur, ~70 s | `/health` p95 < 50 ms, p99 < 100 ms ; questions de hook `POST /api/v1/gates` sur des actions ordinaires (200/s) p95 < 50 ms, p99 < 150 ms ; push sur main puis oui `POST /api/v1/approvals/{id}/answer` (20/s) p95 < 150 ms, p99 < 400 ms ; erreurs < 1 % ; checks > 99 % |
| `race.js` | chaque PR serveur + nuit | 100 oui simultanés sur la même demande : exactement 1 × 200, 99 × 409, aucun autre code |
| `soak.js` | nuit (`nightly.yml`, 25 min) | 500 questions/s et 50 portes/s pendant 20 min (mêmes p95/p99, erreurs < 0,1 %), puis rampe à 2 000/s : p99 < 500 ms |
| `inference.js` | `chart-load.yml` | surcoût du gateway (gateway moins appel direct au faux fournisseur, même ingress), premier octet et fin, JSON et flux : p95 < 15 ms (`scripts/relay-summary.ts --check`) |
| `streams.js` | `chart-load.yml` | 50 puis 200 flux d'une minute ouverts ensemble : tous entiers, aucun redémarrage de pod serveur (OOM à 256 Mi) ; mémoire par flux dans le résumé |
| `cut.js` | `chart-load.yml` | client qui coupe en plein flux : connexion amont fermée et usage enregistré en 2 s au plus |
| `mcp.js` | `chart-load.yml` | relais MCP, serveurs rapide, lent, muet et éteint en même temps : outil rapide p95 < 250 ms, muet coupé à l'échéance, éteint en erreur d'outil < 1 s |

Les routes sont celles du contrat `ostrom-core/api/openapi.yaml` (`/api/v1/...`, sonde `/health`) ; `OSTROM_ROUTE_*`
les change sans toucher aux scénarios. Identifiants : `OSTROM_LOAD_TOKEN` (jeton `gates:ask` du demandeur) et la
session de l'approbateur (`OSTROM_LOAD_APPROVER_COOKIE` + `OSTROM_LOAD_APPROVER_CSRF` : seul un navigateur dit oui ;
`OSTROM_LOAD_APPROVER_TOKEN` là où un jeton le peut), approbateur de la porte de `OSTROM_LOAD_REPO` (défaut `acme/api`).
`scripts/load-setup.ts` les crée par les routes du serveur (lien de connexion lu dans `OSTROM_MAIL_DIR`, invitation,
jeton, workflow) et écrit `ready` ; tant qu'il manque une route sur `main`, il dit laquelle, seuls `/health` et
`/api/v1/instance` sont mesurés et la course ne tourne pas (la variable `OSTROM_LOAD_GATES` ne sert plus qu'au
fragment `server/ci-extra.yml`). Un scénario de porte lancé sans jetons s'arrête aussitôt en le disant. Seuils de
départ, recalés sur la première série verte (le serveur de contrôle du prototype consomme ~0,1 ms de CPU par
`/check` et ~0,2-0,6 ms par porte : ces seuils laissent large pour un runner partagé).

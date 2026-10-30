# ostrom-e2e

Ostrom — tests end-to-end full-stack et tests de charge (Apache 2.0).

- `SCENARIOS.md` : le catalogue des parcours à couvrir (repris du prototype et de TeamCode), avec leur statut.
- `RAPPORT.md` : le tableau de bord des tests de tous les dépôts (couverture, nombre de tests, scénarios, charge).
- `scenarios/` : les scénarios exécutables (Vitest), contre le vrai serveur natif + PostgreSQL et le vrai binaire
  `ostrom`, avec un faux agent (`bin/fake-claude`, `bin/fake-codex`, `src/fake-agent.ts`) qui joue les hooks comme
  Claude Code et Codex. Un scénario non encore codé apparaît en `todo` dans le rapport de la CI.
- `load/` : k6 (court à chaque PR serveur, long chaque nuit).
- `templates/` : les gabarits de CI de test des autres dépôts et le contrat du banc.
- `.github/actions/` : actions composites qui construisent et démarrent le vrai serveur et le vrai CLI.

```sh
pnpm install
pnpm test:coverage   # le code du banc, 100 %
pnpm e2e             # OSTROM_E2E_SERVER_URL et OSTROM_E2E_CLI_BIN pour les scénarios full-stack
pnpm report          # régénère le tableau des scénarios de RAPPORT.md
```

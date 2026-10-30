# ostrom-e2e

End-to-end and load tests of Ostrom: the real native server with PostgreSQL, the real `ostrom` binary, and a fake agent
that plays the hooks the way Claude Code and Codex do. Apache 2.0.

| Path | What |
|---|---|
| `SCENARIOS.md` | the catalogue of journeys to cover, with their status |
| `RAPPORT.md` | the test dashboard of every repository: coverage, number of tests, scenarios, load |
| `scenarios/` | the runnable scenarios (Vitest); a scenario not written yet shows as `todo` in the CI report |
| `bin/fake-claude`, `bin/fake-codex`, `src/fake-agent.ts` | the fake agent |
| `load/` | k6 scripts: a short run on every server pull request, a long one every night |
| `templates/` | the test CI templates of the other repositories and the contract of the test bench |
| `.github/actions/` | composite actions that build and start the real server and the real CLI |

## Run

```sh
pnpm install
pnpm test:coverage   # the bench's own code, 100 % coverage
pnpm e2e             # full-stack scenarios: set OSTROM_E2E_SERVER_URL and OSTROM_E2E_CLI_BIN
pnpm report          # regenerates the scenario table of RAPPORT.md
```

CI (`.github/workflows/ci.yml`) runs `pnpm typecheck`, `pnpm test:coverage` and `pnpm e2e` on every pull request and
on `main`; `nightly.yml` runs the long k6 soak and ramp against the server built from `ostrom-server` main.

## Documentation

The public documentation is at [ostrom.run/docs](https://ostrom.run/docs). The engineering conventions shared by every
Ostrom repository are in `ostrom-core`, `docs/CONVENTIONS.md`.

## Licence

Apache 2.0, see [`LICENSE`](LICENSE).

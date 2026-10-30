# ostrom-e2e

End-to-end and load tests of Ostrom: the real native server with PostgreSQL, the real `ostrom` binary, and a fake agent
that plays the hooks the way Claude Code and Codex do. Apache 2.0.

| Path | What |
|---|---|
| `SCENARIOS.md` | the catalogue of journeys to cover, with their status |
| `RAPPORT.md` | the test dashboard of every repository: coverage, number of tests, scenarios, load |
| `scenarios/` | the runnable scenarios (Vitest); a scenario not written yet shows as `todo` in the CI report |
| `bin/fake-claude`, `bin/fake-codex`, `src/fake-agent.ts` | the fake agent |
| `src/fake-github.ts`, `src/git.ts` | a fake GitHub and throwaway git repositories for the scenarios |
| `load/` | k6 scripts: smoke, soak and ramp, and the race of 100 simultaneous yes |
| `templates/` | the test CI templates of the other repositories and the contract of the test bench |
| `.github/actions/` | composite actions that build and start the real server and the real CLI |

## Run

```sh
pnpm install
pnpm test:coverage   # the bench's own code, 100 % coverage
pnpm e2e             # full-stack scenarios: set OSTROM_E2E_SERVER_URL and OSTROM_E2E_CLI_BIN
pnpm report          # regenerates the scenario table of RAPPORT.md
```

CI (`.github/workflows/ci.yml`) is one job, `ci`, on every pull request and on `main`: `pnpm typecheck`, actionlint,
`k6 inspect` of the load scripts, `pnpm test:coverage`, then the real server and CLI are built and started and
`pnpm e2e` runs the scenarios. `nightly.yml` runs the k6 soak and ramp (`load/soak.js`) and the race of 100 simultaneous yes, of which
exactly one must win (`load/race.js`), against the server built from `ostrom-server` main; it skips them, with a note in
the job summary, while that server does not meet the bench contract. The short k6 run on server pull requests is a
template (`templates/server/ci-extra.yml`) not installed in `ostrom-server` yet.

## Documentation

The public documentation is at [ostrom.run/docs](https://ostrom.run/docs). The engineering conventions shared by every
Ostrom repository are in `ostrom-core`, `docs/CONVENTIONS.md`.

## Licence

Apache 2.0, see [`LICENSE`](LICENSE).

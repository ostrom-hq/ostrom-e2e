# Tableau de bord des tests d'Ostrom

Tenu par l'agent QA. Règle (Lyes, 30/10/2026) : unitaires, intégration, end-to-end et charge, 100 % des lignes et
des branches imposé par la CI, checks obligatoires sur `main`. Mis à jour le 02/11/2026. « posée » = PR obligatoire, à jour avec `main`, admins compris, ni force-push
ni suppression, historique linéaire.

## Par dépôt

| Dépôt | Socle fusionné | Couverture mesurée (lignes / branches) | Unitaires | Intégration | E2E | Charge | Checks obligatoires | Protection de `main` | Dernier run vert |
|---|---|---|---|---|---|---|---|---|---|
| ostrom-core | oui (#1, #3, #5) | pas encore mesurée : Kover arrive avec ostrom-core#8 (`chore/conventions`) | 26 | — | — | — | `native` (puis `ci`) | posée | — |
| ostrom-cli | non (ostrom-cli#1 en CI) | 100 % imposé dans le socle (`coverage`), pas encore sur `main` | 0 sur `main` | — | — | — | PR seule (puis `ci`) | posée | — |
| ostrom-server | oui (#1, 4fe38dd) | Kover 100 % lignes et branches par module (job `ci`, `koverVerify`) ; `ops/stripe` 100 % | jvmTest + linuxX64Test | PostgreSQL 17 dans `ci` | image distroless testée par le banc (SRV-001 à 004) | k6 `health,instance` sur l'image (banc) | `ci` | posée (`ci`, non stricte) | [40996470171](https://github.com/ostrom-hq/ostrom-server/actions/runs/40996470171) |
| ostrom-web | oui (#1) | 100 % imposé (Vitest, job `check`) | 21 | — | 3 (Playwright) | — | `check`, `e2e` (puis `ci`) | posée | — |
| ostrom-app | oui (#4) | 100 % imposé (Jest, job `ci`) | 51 | 15 (MSW) | — (Maestro à brancher) | — | `ci` (Jest 100 %, puis Maestro) | posée | — |
| ostrom-e2e | oui (#1 à #18 ; #19 rouge sur un bug serveur) | 100 % / 100 % imposé (job `ci`) | 43 | — | 2 (banc) + 4 SRV + 6 AUTH + 7 BILL + 2 ISO sur l'image serveur, 4 parcours du jalon codés | 3 scripts k6, smoke dans `ci` | `ci` | posée | [41011286496](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41011286496) (`main` ; voir le faux vert plus bas) |
| ostrom-site | oui | 100 % imposé (docs-tools, `node --test`, job `ci`) | 60 | — | blocs de code testés (`--strict`) | — | `ci` | posée | — |
| ostrom-helm | oui (#1) | — (chart : helm-unittest, kubeconform, ct install sur kind) | helm-unittest | ct install | Docker Compose de bout en bout | — | `ci` | posée | — |

## Scénarios end-to-end (SCENARIOS.md)

Généré par `pnpm report`. `vert` = vert en CI ; `codé` = test écrit, pas encore vert ; `écrit` = spécifié ;
`bloqué` = la fonction n'existe pas encore dans la réécriture.

<!-- scenarios:begin -->
| Famille | Scénarios | dont jalon | vert | codé | écrit | bloqué |
|---|---|---|---|---|---|---|
| LOGIN | 9 | 1 | 0 | 1 | 0 | 8 |
| CONN | 16 | 0 | 0 | 1 | 0 | 15 |
| CLAUDE | 19 | 4 | 0 | 2 | 0 | 17 |
| CODEX | 9 | 0 | 0 | 0 | 0 | 9 |
| GATE | 15 | 5 | 0 | 1 | 0 | 14 |
| BYPASS | 33 | 12 | 0 | 3 | 0 | 30 |
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
| AUTH | 7 | 7 | 6 | 1 | 0 | 0 |
| LOAD | 11 | 0 | 1 | 3 | 0 | 7 |
| DOGFOOD | 3 | 0 | 0 | 0 | 0 | 3 |
| OBS | 3 | 0 | 0 | 0 | 0 | 3 |
| SRV | 4 | 2 | 4 | 0 | 0 | 0 |
| BILL | 7 | 0 | 7 | 0 | 0 | 0 |
| ISO | 2 | 2 | 2 | 0 | 0 | 0 |
| PARC | 37 | 15 | 6 | 31 | 0 | 0 |
| ATT | 3 | 3 | 0 | 3 | 0 | 0 |
| GHORG | 3 | 0 | 0 | 3 | 0 | 0 |
| **Total** | 385 | 69 | 26 | 53 | 0 | 306 |
<!-- scenarios:end -->

### Scénarios lancés en CI, un par un

État dans le job `ci` d'ostrom-e2e, contre l'image du serveur de `main` (son `Dockerfile`, binaire natif `linuxX64`) et
PostgreSQL 18. `vert` porte le lien du run ; `rouge` dit ce qui casse ; `manquant` dit ce qui n'est pas encore servi.

| Scénario | Sujet | État | Preuve ou cause |
|---|---|---|---|
| SRV-001 | `/health`, `/api/v1/health` | vert | [40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849) (ostrom-server@4fe38dd en image, 59 Mo, debout en 1 s) |
| SRV-002 | `/api/v1/instance`, clé Ed25519, `/keys` | vert | [40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849) |
| SRV-003 | erreurs 404/405 en `{"error":{type,message}}` | vert | [40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849) |
| SRV-004 | `X-Request-Id` gardé ou remplacé | vert | [40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849) |
| LOAD-011 | k6 `health,instance`, p95 < 50 ms, p99 < 100 ms | vert | [40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849) : `/health` p95 1,31 ms / p99 2,14 ms ; `/api/v1/instance` p95 1,92 ms / p99 3,04 ms ; 0 erreur sur 6 002 requêtes |
| BILL-001 | webhook signé reçu une fois (`ignored` puis `duplicate`) | vert | [41011286496](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41011286496) (rouge d'abord sur une hypothèse du banc : une organisation inconnue est `processed`, question à BILLING) |
| BILL-002 | signatures absente, fausse, périmée, future, d'un autre corps : 400, rien d'enregistré | vert | [41010125416](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41010125416) (ostrom-server@87f9d14) |
| BILL-003 | événement > 256 Kio : 413 | vert | [41010125416](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41010125416) |
| BILL-004 | 7 routes `/api/v1/orgs/{id}/billing…` sans identifiants : 401 + `WWW-Authenticate: Bearer` | vert | [41010125416](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41010125416) |
| AUTH-001 | lien par e-mail : une seule connexion, cookie HttpOnly/SameSite, CSRF, profil ; lien réutilisé ou forgé refusé | vert | [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947) (PR ostrom-e2e#19, image ostrom-server@51ad17b, rôle `ostrom_app`, `Origin` de #58) |
| AUTH-002 | GitHub OAuth (faux GitHub du banc) : PKCE S256, `state` lié au navigateur, secret et `code_verifier` à l'échange ; mauvais `state`, code rejoué, refus → `/login?error=` sans session | vert | [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947) (PR ostrom-e2e#19, image ostrom-server@51ad17b, rôle `ostrom_app`, `Origin` de #58) |
| AUTH-003 | connexion d'appareil de la CLI (RFC 8628), sondage du contrat (#62) : 428 tant qu'en attente, puis `AuthToken {token, login, scopes}` au login de la personne ; jeton sans `gates:answer` ni `user:*`, une seule fois ; code refusé → 400 `access_denied` | vert | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) (image ostrom-server@fa6755b8) |
| AUTH-004 | jeton révoqué, jeton tourné, déconnexion, « partout » : refusés à l'appel suivant | vert | [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947) (PR ostrom-e2e#19, image ostrom-server@51ad17b, rôle `ostrom_app`, `Origin` de #58) |
| AUTH-005 | sans identifiant ou mauvais : 401 + `WWW-Authenticate: Bearer` ; écriture sans CSRF refusée ; jeton sur route navigateur 403 ; portées `gates:answer`, `user:*`, `agent:session` refusées | vert | [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947) (PR ostrom-e2e#19, image ostrom-server@51ad17b, rôle `ostrom_app`, `Origin` de #58) |
| AUTH-006 | un jeton CLI ne dit jamais oui : 403, seule une session navigateur répond (canal BROWSER) | vert | [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947) |
| BILL-005 à 007 | checkout Stripe test, refus du 6e en Free (402), 403 sans rôle de facturation | vert | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) (image ostrom-server@fa6755b8, #67 : organisations sous `ostrom_app`) |
| ISO-001 | B ne lit, n'écrit ni ne liste rien de A : organisation, membres, invitations, facturation, sessions, artefacts, secrets MCP, automations, attentes, budgets, reçus, approbations, comptes, usage | vert | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) (31 routes ; A ne crée pas encore sessions cloud, artefacts, secrets, automations : routes de l'org courante, #64) |
| ISO-002 | pendant console (demande WEB) : rien de A dans ce que la console lit pour B | vert | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) |
| LOGIN-001 | `ostrom login` réel contre l'image réelle : code lu sur la sortie de la CLI, oui depuis la session navigateur, fichier 0600 sans secret, jeton `cli` listé, jeton authentifié | rouge, corrigé dans le banc | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) : la connexion réelle passe ; `ostrom inbox` sort en 77 (trou du serveur, LOGIN-009). Avant, au run 41054325763, le banc refusait à tort l'indice de 12 caractères du jeton |
| CLAUDE-001, GATE-001, YES-001, YES-003, YESCLI-002, RECEIPT-001 | jalon : `ostrom claude`, porte sur le push, oui de l'approbateur en session fraîche lié au SHA, auto-approbation refusée, jeton refusé, reçu | manquant | codés contre la CLI et l'image réelles ; s'allument avec ostrom-server#43 (flux, catalogue signé, paquets) et #26 (sessions). La vérification hors ligne attend une commande `verify` de la CLI |
| LOGIN-009 | `ostrom inbox` après `ostrom login` | rouge connu (`it.fails`) | `CLI_SCOPES` sans `gates:read`, que demande `GET /api/v1/approvals` ; → AUTH-REPRISE, GATES (JOURNAL 02/11) |
| ATT-001 à 003 | attestation d'un check : `workstation_declared` dans le reçu signé, le poste ne peut se dire `ci` ni `isolated_runner`, porte `attested` non satisfaite par une déclaration | manquant | codés, allumés par sondes (`/launches`, `/checks`, reçu de workflow : #84, #78 ; règles : SRV-REGLES-2) |
| GHORG-001 à 003 | `install/start?org` : propriétaire et admin oui (id, slug) ; membre, étranger, slug inconnu : même 403 ; 401 sans session ; admin rétrogradé refusé | manquant | codés, allumés par sonde dès ostrom-server#44 |
| PARC-001/003/005/006/010/028 | parcours client contre le vrai serveur | vert | [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659) ; les 31 autres attendent #64 (org courante), #43/#84/#78 |
| AUTH-007 | une session de plus de 5 min ne dit pas oui (403 `step_up_required`), reconnectée elle le peut | manquant | codé (session vieillie en base) ; s'allume avec #43, demande #41 pour passer |
| APP (Maestro) | flux Maestro de l'app sur émulateur Android | vert, dans ostrom-app | [41026295995](https://github.com/ostrom-hq/ostrom-app/actions/runs/41026295995) (`main` d'ostrom-app@8b38da1, flux `login.yaml`, sans serveur Ostrom). Pas dans le job `ci` du banc : un émulateur de plus après deux constructions natives dépasse le budget runner ; les flux contre l'image réelle iront dans le nightly |
| BYPASS-001/005/024 | contournements | manquant | idem (porte servie par le serveur, hooks par la CLI) |
| LOAD-002/006 | portes + oui, course de 100 oui (1 × 200, 99 × 409) | manquant | prêts ; au run [41034102057](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41034102057), la mise en place des charges est sautée après le rouge des organisations (« gate load : not run ») ; puis il faut ostrom-server#43 (compilateur, `POST /api/v1/workflows`) |
| LOAD-003 | soak + rampe (nuit) | manquant | idem pour les portes ; `/health` seul la nuit d'ici là |

## Charge

| Script | Quand | Seuils | Dernier résultat |
|---|---|---|---|
| `load/smoke.js` | chaque PR et `main` du banc (`health,instance` sur l'image serveur) ; chaque PR serveur | p95/p99 : `/health` et `/api/v1/instance` 50/100 ms à 50 req/s, question de hook `POST /api/v1/gates` 50/150 ms, push sur main + oui 150/400 ms ; erreurs < 1 %, checks > 99 % | `health,instance` vert ([40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849), 50 req/s × 60 s chacun) : p95/p99 1,31/2,14 ms et 1,92/3,04 ms, 0 % d'erreurs ; portes : pas encore servies |
| `load/race.js` | chaque PR et `main` du banc + nuit, dès que `scripts/load-setup.ts` écrit `ready=true` | 100 oui simultanés sur la demande de l'approbateur : 1 × 200, 99 × 409, rien d'autre | prêt ; pas lancé : création d'organisation en 500 (run 41034102057), puis compilateur #43 |
| `load/soak.js` | nuit | 20 min à 500 questions/s + 50 portes/s, rampe 2 000/s p99 < 500 ms | bloqué : pas encore de serveur |

## Journal

- 30/10 02:00 — ostrom-e2e#1 : banc, gabarits et catalogue (302 scénarios, 34 du jalon) ; clés de déploiement en lecture
  seule et secrets d'org posés ; actions composites ouvertes aux dépôts de l'org.
- 30/10 02:15 — 14 contournements de l'audit de la porte ajoutés (BYPASS-020 à 033 : A1, A2, A3, A7b, A9, A10, A12 à A20, A24), dont 6 au jalon ; actions épinglées par SHA (CONVENTIONS § 11) ; pour Kotlin, le gabarit de CONVENTIONS (job `linux`) fait foi.
- 30/10 02:45 — faux GitHub local (`src/fake-github.ts`), bacs à sable git sans réseau (`src/git.ts`), parcours du jalon
  codés (`scenarios/jalon.e2e.ts` : LOGIN-001, CLAUDE-001, CLAUDE-003, GATE-001 avec YES-001, YES-003, YESCLI-002,
  RECEIPT-001), lancés dès que serveur et CLI les servent (`OSTROM_E2E_JALON=1`) ; k6 aligné sur le contrat `/api/v1` ;
  le banc tourne en un seul job `ci`.
- 30/10 03:20 — Règles de CI de l'organisation (JOURNAL 03:10) : un seul job `ci` par PR, pas de CI sur un
  brouillon, `concurrency` annulant sauf sur `main`, caches ; check obligatoire `ci` partout. Gabarits mis à jour.
- 30/10 04:30 — Règles de CI appliquées et fusionnées : e2e#6, app#11, site#10, helm#4, server#22 ; checks
  obligatoires `ci` sur e2e, app, site, helm. Famille OBS ajoutée (3 scénarios, demande OBS 04:20).
- 30/10 05:20 — ostrom-server#1 fusionné (4fe38dd) : protection de `main` d'ostrom-server sur `ci` (non stricte). Le banc
  lance l'image distroless du serveur de `main` (action `server`, `image: "true"`, conteneur `ostrom-e2e-server`) :
  famille SRV (santé, instance, erreurs, `X-Request-Id`) et fumée k6 `health,instance` (LOAD-011) dans le job `ci`.
- 30/10 05:40 — ostrom-e2e#11 fusionnée, `ci` vert ([40999403849](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/40999403849)) : SRV-001 à 004 et LOAD-011 verts sur l'image
  d'ostrom-server@4fe38dd ; k6 : p95 1,31 ms (`/health`) et 1,92 ms (`/api/v1/instance`), 0 erreur.
- 30/10 06:10 — Scénarios qui s'allument seuls au fil des fusions (`src/probe.ts`) : facturation BILL-001 à 007
  (stripe-mock derrière l'image, webhooks signés par le banc, liens de connexion lus dans `OSTROM_MAIL_DIR`) et
  isolation entre organisations ISO-001 (`src/isolation.ts`). Charge des portes prête : `scripts/load-setup.ts` crée
  jeton du demandeur et session de l'approbateur, la course et `gates` tournent dès `ready=true` (fin de la variable
  `OSTROM_LOAD_GATES` dans le banc).
- 30/10 07:10 — ostrom-server#15 fusionnée (87f9d14) : facturation servie sous `/api/v1/orgs/{orgId}/billing` (décision 05:55),
  webhook à `/api/v1/billing/stripe/webhook` (pas `/webhooks/stripe` : signalé à BILLING). BILL-002 à 004 verts ([41010125416](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41010125416)) ;
  BILL-001 rouge sur une hypothèse du banc (organisation inconnue `processed`), corrigé ; BILL-005 à 007 attendent l'identité et les orgs.
- 30/10 07:25 — BILL-001 vert ([41011286496](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41011286496)) : BILL-001 à 004 verts contre ostrom-server@87f9d14.
- 30/10 10:00 — **Faux vert sur `main` du banc** : le run [41028221230](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41028221230) est vert, mais
  ni le serveur ni la CLI n'y sont construits. GitHub Packages répond 401 sur ostrom-core au jeton d'un autre dépôt, et les
  constructions étaient facultatives. Correction dans ostrom-e2e#19 : ostrom-core est récupéré par clé de déploiement à
  `gradle/ostrom-core.ref`, et les constructions deviennent obligatoires.
- 30/10 10:05 — ostrom-e2e#19 : scénarios AUTH-001 à 006 alignés sur les routes servies (contrat 0.1.140) ; faux GitHub sur
  :4610 ; routes de #51 (`/api/v1/orgs`, invitations) ; ISO-001 étendu à toutes les ressources servies et ISO-002 (console).
- 30/10 10:30 — Le serveur de `main` refuse un rôle qui contourne la RLS (run [41030017522](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41030017522)).
  Le banc et les gabarits appliquent maintenant `ci/database-roles.sql` : `migrate` en `ostrom_owner`, service en `ostrom_app`,
  comme en production. Le run 41031154110 a été annulé deux fois pendant l'édition de liens de la CLI, faute de mémoire ; les
  démons Gradle sont maintenant arrêtés entre les deux constructions.
- 30/10 10:45 — Run [41034102057](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41034102057), image ostrom-server@a3b551d (#10, #51, #59) :
  - verts : AUTH-001 à 005, BILL-001 à 004, SRV-001 à 004, banc ;
  - sauté : AUTH-006 ;
  - rouges : BILL-005 à 007 et ISO-001/002, sur un bug serveur (`POST /api/v1/orgs` → 500 sous `ostrom_app`), signalé à
    AUTH-REPRISE.

  ostrom-e2e#19 reste rouge jusqu'au correctif, puis sera relancée et fusionnée.
- 30/10 11:20 — Run [41037581947](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41037581947), image ostrom-server@51ad17b (#58 compris) :
  - le banc envoie l'`Origin` de la console sur les écritures de session (S2-08) ;
  - verts : AUTH-001 à 006, BILL-001 à 004 et SRV-001 à 004 ;
  - toujours rouges sur la création d'organisation : BILL-005 à 007 et ISO-001/002 ;
  - nouveaux scénarios codés, en attente des fusions serveur : AUTH-007 (step-up d'une session vieillie de 6 min) ;
    LOGIN-001, CLAUDE-001, GATE-001, YES-001/003, YESCLI-002 et RECEIPT-001, réécrits contre la CLI et l'image
    réelles et allumés par sondes (#62, #43, #26) ;
  - Maestro : runs de l'app cités, pas dans le banc.
- 02/11 — Run [41456816659](https://github.com/ostrom-hq/ostrom-e2e/actions/runs/41456816659), image ostrom-server@fa6755b8 (#45, #62, #67), après la pause :
  - verts : SRV-001 à 004, AUTH-001 à 006 (AUTH-003 sur le sondage du contrat : 428 puis `AuthToken`), BILL-001 à 007,
    ISO-001/002, PARC-001/003/005/006/010/028 ;
  - LOGIN-001 : la connexion réelle de la CLI passe ; `ostrom inbox` après connexion sort en 77, le jeton de la CLI n'a pas
    `gates:read` (LOGIN-009, rouge connu, signalé à AUTH-REPRISE et GATES) ;
  - codés et allumés par sondes : ATT-001 à 003 (attestation, décision du 30/10 13:23) et GHORG-001 à 003 (`?org`,
    décision du 30/10 12:55) ; le parcours « porte, oui du second membre, reçu » attend #64, #84 et #78.

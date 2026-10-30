# Catalogue des parcours end-to-end d'Ostrom (banc `ostrom-e2e`)

Rédigé le 30/10/2026 pour l'agent QA de la réécriture (Kotlin/Native + React + React Native). Le prototype TypeScript/Rust (`~/git/ostrom/mvp`) est la spécification exécutable : chaque scénario ci-dessous renvoie au test, au document ou au trou connu qui le justifie.

## Ce que fait le banc

- Un vrai serveur natif Ostrom avec une vraie base PostgreSQL, sur une instance jetable (horloge et UUID pilotables pour les vecteurs).
- Le vrai binaire `ostrom` (lanceur, hooks, `verify`), lancé dans des copies neuves de dépôt dont `origin` est un dépôt nu local (avec un `pushInsteadOf` qui échoue si une commande sort vers le réseau) et une régression plantée.
- La console web pilotée par Playwright (clair/sombre, 1440 et 390 px, zéro erreur console).
- L'app mobile pilotée par Maestro sur un émulateur Android.
- Un faux agent qui joue les hooks comme Claude Code et Codex : `SessionStart`, `PreToolUse`, `PostToolUse`, `Stop`, `SessionEnd`, appels MCP (`node_done`, `rules_for`), exit 2 qui bloque, délais de hook, reprise, mise en veille. Aucun appel à un vrai modèle.
- Des faux services locaux : GitHub (OAuth, device flow, ruleset, check runs, PR, webhooks signés), Slack (OAuth v2, DM, `chat.update`), récepteur Discord (200, 404, 429, lenteur), fournisseur d'inférence SSE (Anthropic et OpenAI).
- Comptes de test : `dev-a` (demandeur), `rev-b` et `rev-c` (approbateurs), un administrateur, un membre non approbateur.

Hypothèse de correspondance des dépôts (`ostrom-hq`) : `ostrom-core` = domaine, reçus, forme canonique ; `ostrom-server` = serveur natif, passerelle, portes, sessions, compilateur ; `ostrom-cli` = binaire `ostrom`, lanceur et hooks ; `ostrom-web` = console ; `ostrom-app` = app mobile ; `ostrom-e2e` = ce banc. À corriger si le découpage change : le nom du dépôt qui doit livrer est dans le statut de chaque scénario.

## Légende des statuts

Ligne `- Statut :` de chaque scénario, à mettre à jour par `sed`.

- `écrit` : spécifié ici, pas encore de code de test.
- `codé` : test écrit, pas encore vert en CI.
- `vert` : vert en CI, avec le lien du run.
- `bloqué : <quoi>` : la fonction n'existe pas encore dans la réécriture. Au départ, tout est `bloqué : <dépôt/fonction manquante>`.

Priorités : `jalon` = premier jalon (`ostrom claude` + porte qui bloque un push + oui lié au SHA + reçu vérifié hors ligne, plus ce qui les rend possibles : identité de l'approbateur, contournements de la porte du premier jalon) ; `P1` ; `P2`.

## Abréviations des sources

- `proto/` = `~/git/ostrom/mvp` (prototype, branche principale locale).
- `audit/` = `~/git/ostrom-audit/mvp`, branche `audit/gate-bypass` (tests `server/src/bridge/audit-gate.test.ts`, pistes P1 à P7).
- `corr/` = `~/git/ostrom-correctifs/mvp`, branche `fix/wake-window` (passe 4 : tests `wake-window`, non fusionnés).
- `fusion/` = `~/git/ostrom-fusion/mvp` (FUSION-TEAMCODE) ; `amont/` = `~/git/ostrom-amont/mvp` (AMONT-TEAMCODE, vecteurs d'or `compat/`) ; `cli/` = `~/git/ostrom-cli/mvp` (`COORD/CLI.md`).
- Un nom de test entre guillemets est le titre exact dans le fichier de test ; un nom en `code` est une fonction Rust.

## Notes de lecture

- Les parties « TeamCode reste le serveur » (FUSION-TEAMCODE) et « délègue à `teamcode run` » (CLI.md) sont caduques : tout est refait dans Ostrom. Les scénarios les traitent comme des fonctions d'Ostrom (passerelle, budgets, partage d'abonnement, MCP relayés, cloud, waits, automations, artefacts).
- `AUDIT-PORTE.md` (cité par le commit 7166396e) n'existe pas dans la branche d'audit : le catalogue des contournements vient de `audit-gate.test.ts` et du message du commit. Les contournements sans test (faux vert, `--admin`, déclassement 404) viennent de GATE-GITHUB, ARCHI, VERIF-LANCEUR.
- Aucun script k6 n'existe dans le prototype : les scénarios de charge reprennent les protocoles de PERF-CONTROLE, PERF-GATEWAY, PERF-MCP et HOOK-DISPATCH ; les seuils chiffrés sont à fixer par QA sur la première série (le poste de mesure du prototype était saturé).
- Le partage d'abonnement est contradictoire dans les sources (PLATEFORME : « ne refait pas » ; FUSION du 29/10 : on garde le routage des comptes). Les scénarios SHARE suivent FUSION et signalent la contradiction.



## LOGIN : Login et premier lancement

### E2E-LOGIN-001 — Login par device flow GitHub

- Étapes : `ostrom login` sur un serveur neuf, faux GitHub qui répond au device flow ; le code est saisi par le faux navigateur.
- Attendu : Jeton de poste écrit en 0600, `ostrom whoami` rend `<login> on <server>` ; le jeton ne peut pas dire oui.
- Surfaces : CLI, serveur, faux GitHub
- Source : cli/COORD/CLI.md §1a (`ostrom login`), §3.1 écran 3 ; proto/COORD/GATE-GITHUB.md « Ce qui manque » 3 (device flow jamais testé contre une vraie app)
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (login) + ostrom-server (AUTH))

### E2E-LOGIN-002 — Repli sur le jeton `gh` du poste

- Étapes : `ostrom login --gh` (ou app sans device flow : `githubClientId` nul).
- Attendu : Connexion réussie en disant le repli utilisé ; aucun jeton dans la sortie ni dans les journaux.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §1a ; proto/COORD/GATE-GITHUB.md « Ce qui manque » 3 ; proto/COORD/GATE-GITHUB.md § traces (recherche `gh[opsu]_`)
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-LOGIN-003 — `whoami`, jeton expiré, non connecté

- Étapes : `ostrom whoami` connecté ; puis sans identifiants ; puis avec un jeton expiré.
- Attendu : Connecté : login et date de validité. Sinon : `Not signed in. Run ostrom login.`, code 65.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §1a (`whoami`), §2.3 (code 65)
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-LOGIN-004 — `logout` efface le jeton

- Étapes : `ostrom logout` puis `ostrom claude`.
- Attendu : Le fichier d'identifiants disparaît, `ostrom claude` sort en 65 sans lancer l'agent ; le jeton est révoqué côté serveur (appareil).
- Surfaces : CLI, serveur
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Connexion : pas de `logout`) ; cli/COORD/CLI.md §1a « Manques », §2.2
- Priorité : P2
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-LOGIN-005 — Dev non invité ou dépôt hors organisation

- Étapes : Un login GitHub inconnu de l'organisation lance `ostrom claude` ; puis un dev invité dans un dépôt d'une autre organisation.
- Attendu : Refus 77 avec le message qui dit quoi faire (`Ask an admin ... ostrom invite`, `... is not in <org>'s GitHub organisation`) ; l'agent n'est pas lancé.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.1 « Ce qui peut rater » ; §2.3 (77)
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-LOGIN-006 — Serveur injoignable au lancement

- Étapes : `ostrom claude --server http://localhost:1` (port fermé).
- Attendu : Code 69, message clair, aucun repli silencieux sur un harnais fixe ni sur un paquet périmé (fail-closed).
- Surfaces : CLI
- Source : cli/COORD/CLI.md §2.3 (69), §0 point 4 ; proto/COORD/VERIF-LANCEUR.md §3 bug 9
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-LOGIN-007 — Premier lancement d'un dev invité en moins de 2 minutes

- Étapes : Installation, `ostrom login`, `cd` dans un dépôt, `ostrom claude` ; mesure du temps de chaque étape avec faux GitHub et faux agent.
- Attendu : Les trois étapes réussissent ; la clé de l'instance est épinglée à la première utilisation (`Pinned ... key`) ; durée totale sous 2 min (seuil de la maquette, à mesurer).
- Surfaces : CLI, serveur, faux agent
- Source : cli/COORD/CLI.md §3.1 (écrans 2 à 4)
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-LOGIN-008 — Compte d'opérateur : un second approbateur sur le même serveur

- Étapes : Création de `rev-b` par l'opérateur (`POST /api/operators`), connexion sur la page du oui avec son jeton `opk_`.
- Attendu : Jeton rendu une seule fois (empreinte seule gardée) ; création et retrait sont des décisions signées ; interdit pour son propre login ; `opk_` inconnu : 401. (Dans la réécriture : membres et rôles du serveur.)
- Surfaces : serveur, web
- Source : proto/COORD/APPROBATION.md §2 ; proto/server/src/yes/approval.test.ts « an operator account is a second person: its yes is accepted and signed in its name, not self-approved »
- Priorité : P1
- Statut : bloqué : ostrom-server (membres et rôles)


## CONN : Connexion GitHub et Slack (onboarding)

### E2E-CONN-001 — Éditeur absent : les boutons disent pourquoi

- Étapes : Serveur sans apps éditeur ; clic sur « Connect GitHub » puis « Add to Slack ».
- Attendu : Message d'absence de l'éditeur, aucun appel sortant vers GitHub ni Slack.
- Surfaces : web, serveur
- Source : proto/server/src/connexion-test.ts étape « without the vendor apps, Connect GitHub and Add to Slack say so (no GitHub, no Slack call) »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-CONN-002 — Page éditeur : les deux étapes

- Étapes : Ouvrir la page éditeur `/api/vendor`.
- Attendu : Les étapes GitHub et Slack s'affichent avec leur état ; les secrets ne reviennent jamais en clair.
- Surfaces : web, serveur
- Source : proto/server/src/connexion-test.ts étape « vendor page renders both steps » ; proto/COORD/CONNEXION.md « Ce que Lyes clique » 1
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-CONN-003 — « Connect GitHub » ouvre l'installation avec un `state` neuf

- Étapes : Clic sur Connect GitHub.
- Attendu : Redirection vers la page d'installation de l'app avec un `state` à usage unique.
- Surfaces : web, serveur
- Source : proto/server/src/connexion-test.ts étape « Connect GitHub opens the app installation page with a fresh state »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONN-004 — `state` inconnu refusé, `state` réutilisé refusé

- Étapes : Retour d'installation avec un `state` inventé ; puis le même `state` valide deux fois.
- Attendu : Le premier est refusé ; le second passage est refusé (usage unique).
- Surfaces : serveur
- Source : proto/server/src/connexion-test.ts étapes « an unknown state is refused » et « the same state cannot be used twice »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONN-005 — Installation + autorisation : utilisateur identifié, analyse lancée

- Étapes : Retour d'installation avec `good-code` ; faux GitHub.
- Attendu : L'opérateur est la personne connectée par OAuth, l'installation est vérifiée (`/app/installations/42`), l'analyse démarre pour l'organisation.
- Surfaces : serveur, faux GitHub
- Source : proto/server/src/connexion-test.ts étape « install + authorize: state checked, user identified, installation verified, analysis started »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONN-006 — Retour sans `state` : seule une installation visible à l'utilisateur passe

- Étapes : Retour sans `state` avec une installation étrangère, puis avec la sienne.
- Attendu : L'installation étrangère est refusée, la sienne acceptée.
- Surfaces : serveur, faux GitHub
- Source : proto/server/src/connexion-test.ts étape « without a state, only an installation visible to the signed-in user is accepted » ; proto/COORD/CONNEXION.md « Pas vérifié » (state renvoyé ou non)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONN-007 — Mauvais code OAuth, annulation, demande d'installation

- Étapes : Retour avec un mauvais code, puis `error=access_denied`, puis une demande d'installation en attente.
- Attendu : Chaque cas affiche sa raison ; rien n'est connecté.
- Surfaces : web, serveur
- Source : proto/server/src/connexion-test.ts étape « a bad OAuth code, a cancel and an install request say why »
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-CONN-008 — Identifiants Slack vérifiés avant d'être gardés

- Étapes : Coller un jeton d'app `xapp-` faux, puis bon (faux `apps.connections.open`).
- Attendu : Faux : refus `invalid_auth` et rien n'est sauvé ; bon : sauvé chiffré.
- Surfaces : web, serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étape « vendor Slack credentials are checked before being saved »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONN-009 — « Add to Slack » : OAuth v2, redirection HTTPS locale, `state`

- Étapes : Clic sur Add to Slack.
- Attendu : URL Slack avec client id, scopes, redirect HTTPS local et `state` ; callback avec `state` inconnu ou annulation : refus/compte rendu.
- Surfaces : web, serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étapes « Add to Slack opens Slack OAuth v2 ... » et « Slack callback refuses an unknown state and reports a cancel »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-CONN-010 — « Allow » : jeton du bot gardé, membres liés

- Étapes : Callback avec `slack-code`.
- Attendu : `oauth.v2.access` échangé, jeton chiffré, Slack passe à connecté, membres liés par e-mail puis par nom, bots ignorés.
- Surfaces : serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étape « Allow: code exchanged, bot token stored, Slack connected, members linked by e-mail then name »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONN-011 — Un DM par approbateur désigné

- Étapes : Workflow avec porte à deux approbateurs ; une demande de oui.
- Attendu : Par défaut chaque approbateur reçoit un DM (la personne demandée et la porte du workflow).
- Surfaces : serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étape « by default every designated approver gets a DM (requested person + the workflow gate) »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONN-012 — Liste d'autorisation des DM et approbateur absent de Slack

- Étapes : `OSTROM_SLACK_DM_ALLOW` restreint ; un approbateur n'est pas dans Slack.
- Attendu : Seuls les autorisés reçoivent un DM ; l'absent attend dans la console.
- Surfaces : serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étape « OSTROM_SLACK_DM_ALLOW restricts; an approver not on Slack waits in the console »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONN-013 — Envoi Slack coupé

- Étapes : `OSTROM_SLACK_SEND=0`.
- Attendu : Aucun appel `chat.postMessage` ; les demandes restent visibles dans la console.
- Surfaces : serveur
- Source : proto/server/src/connexion-test.ts étape « OSTROM_SLACK_SEND=0 sends nothing » ; proto/server/src/selftest.ts étape « approval waits in the console (Slack not connected) »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONN-014 — Écouteur HTTPS local pour le retour Slack

- Étapes : Appel HTTPS sur `localhost:<port>` (certificat auto-signé ou mkcert).
- Attendu : La route de retour répond ; le certificat est généré au besoin.
- Surfaces : serveur
- Source : proto/server/src/connexion-test.ts étape « the local HTTPS listener serves the Slack return (self-signed or mkcert) »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONN-015 — Permissions minimales de l'app du check et installation « all »

- Étapes : `gate-app status` (équivalent serveur) sur une installation sur tous les dépôts.
- Attendu : Les permissions réelles sont affichées ; un avertissement prévient que l'installation atteint des dépôts non gouvernés, avec le lien pour la restreindre.
- Surfaces : serveur, web
- Source : proto/COORD/GATE-GITHUB.md § app, point 4 (`launcher/dev/gate-app.mjs status`)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-web


## CLAUDE : `ostrom claude` : lancement, hooks, budget du hook

### E2E-CLAUDE-001 — Lancement sous le paquet signé, rien d'écrit chez le dev

- Étapes : `ostrom claude` dans une copie de dépôt, faux agent rejouant les hooks de Claude Code (SessionStart, PreToolUse, PostToolUse, SessionEnd).
- Attendu : Le plugin de session est posé dans un dossier temporaire 0700 ; ni le dépôt ni `~/.claude` ne changent ; le dossier est supprimé à la sortie ; le contexte « Workflows compiled into this session » est injecté.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (c1) et §2 « Isolation » ; proto/COORD/PONT.md « Le parcours »
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (lanceur) + ostrom-server (paquet))

### E2E-CLAUDE-002 — Une seule entrée de hook par événement

- Étapes : Lire `hooks/hooks.json` du plugin posé, pour un paquet de 1, 5 et 20 nœuds.
- Attendu : `PreToolUse` et `PostToolUse` appellent chacun `ostrom hook gate`, une seule entrée par événement, quel que soit le nombre de nœuds.
- Surfaces : CLI
- Source : proto/COORD/HOOK-DISPATCH.md §1
- Priorité : jalon
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-003 — Budget de démarrage du hook sur un appel ordinaire

- Étapes : Le faux agent envoie 200 `PreToolUse` Bash `ls` ; comptage des processus, des `git` et des appels HTTP ; CPU et temps mur médians.
- Attendu : 1 processus, 0 `git`, 0 appel HTTP par appel ; CPU médiane de l'ordre de 4 ms et mur de l'ordre de 6 ms (mesure du 28/10 : 3,7 ms et 5,5 ms, poste chargé) ; seuil CI à fixer par QA avec marge x3, indépendant du nombre de nœuds (1, 5, 20).
- Surfaces : CLI, faux agent
- Source : proto/COORD/HOOK-DISPATCH.md §3 (lignes `ls`) et §4 ; proto/launcher/dev/dispatch-bench/bench.py
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (hooks))

### E2E-CLAUDE-004 — Action gardée dont les checks sont déjà passés : coût constant

- Étapes : Push gardé, checks en cache, paquets de 1, 5 puis 20 nœuds.
- Attendu : 5 processus et 2 appels HTTP quel que soit le nombre de nœuds (mesure : 5 et 2) ; un seul aller-retour de porte par action.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/HOOK-DISPATCH.md §3 (lignes « checks déjà passés ») et §2
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-005 — `git` lancé seulement pour une action gardée

- Étapes : Commande Bash dans un autre clone : `ls`, puis une commande gardée.
- Attendu : `ls` ne lance aucun `git` ; la commande gardée en lance un seul `git status --porcelain=v2 --branch` plus la racine du dépôt par dossier.
- Surfaces : CLI
- Source : proto/COORD/HOOK-DISPATCH.md §2 (premier point) ; proto/launcher/src/package.rs test `tree_state_reads_head_and_tree_from_one_git_status_and_sees_a_change`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-006 — Délai du hook = somme des délais des checks + 20 s

- Étapes : Paquet à trois checks appliqués à la même action ; lire le `timeout` écrit pour l'agent.
- Attendu : Le délai donné à l'agent couvre tous les checks l'un après l'autre.
- Surfaces : CLI
- Source : proto/launcher/src/package.rs test `the_hook_timeout_covers_every_enforced_check_of_the_action_one_after_the_other` ; proto/COORD/HOOK-DISPATCH.md §2 (dernier point)
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-007 — Résultats de checks et notifications en un appel, avec repli

- Étapes : Action déclenchant 7 checks et 7 notifications ; serveur récent, puis serveur ancien qui répond `package not found` / `notification not in this package`.
- Attendu : Récent : un seul `POST /api/compiler/runs` (lot) et un seul `/notify`, dans l'ordre ; ancien : le lanceur renvoie un appel par élément (7 et 7) ; une notification refusée n'arrête pas les suivantes ; lot vide ou paquet inconnu refusé.
- Surfaces : CLI, serveur
- Source : proto/server/src/compiler/batch.test.ts (4 tests : « runs: the results of every check... », « runs: an empty batch or an unknown package is refused », « notify: the notifications of one action in one call... », « notify: an older Ostrom answers a batch... ») ; proto/COORD/HOOK-DISPATCH.md §2
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-CLAUDE-008 — Check qui échoue : action refusée, porte non demandée, sortie rendue à l'agent

- Étapes : Paquet avec deux checks en ordre, le premier sort 3 ; le faux agent tente `git push origin main`.
- Attendu : Code 2 du hook avec la sortie du check ; aucune demande de porte ; l'ordre `order` du workflow est respecté ; après correction le check repasse.
- Surfaces : CLI, faux agent
- Source : proto/COORD/HOOK-DISPATCH.md §2 « Gardé, et vérifié » ; proto/COORD/VERIF-LANCEUR.md §1 (c1, check → hook PreToolUse)
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-009 — Commande composée refusée en bloc : message honnête

- Étapes : Le faux agent envoie `git commit -am x && git push origin main`.
- Attendu : Refus avant exécution (le check ne peut pas tester un commit qui n'existe pas) ; le message dit de séparer commit et push et ne laisse pas croire que la correction est fausse.
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md § « Mineur, vu en route » ; proto/launcher/tests/pushed_commit.rs `a_commit_and_its_push_in_one_command_are_refused_before_anything_runs`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-010 — Signature et empreinte du paquet vérifiées une fois ; script contrôlé avant exécution

- Étapes : Lancement avec un paquet valide, puis avec un paquet dont un fichier est modifié, puis signé par une autre clé.
- Attendu : Valide : vérifié une fois au lancement, SHA-256 d'un script recalculé avant qu'il tourne ; modifié ou clé différente : code 78, agent non lancé.
- Surfaces : CLI, serveur
- Source : proto/COORD/HOOK-DISPATCH.md §1 ; cli/COORD/CLI.md §2.3 (78) ; proto/launcher/src/verify.rs tests `a_swapped_package_is_caught`, `a_key_from_the_file_is_not_trusted`
- Priorité : jalon
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CLAUDE-011 — Clé épinglée à la première utilisation

- Étapes : Premier lancement sur un poste neuf, puis l'instance change de clé.
- Attendu : Première fois : clé épinglée et affichée ; clé différente ensuite : refus 78 ; la clé d'un fichier posé par le serveur n'est pas fiable.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.1 écran 4 ; proto/launcher/src/package.rs `pinned_key` (FUSION 1b) ; verify.rs `a_key_from_the_file_is_not_trusted`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-012 — Politique au lancement : modèle hors liste refusé, fail-closed

- Étapes : `ostrom claude -- --model opus` quand la liste dit sonnet et haiku ; puis la politique ne répond pas ; puis `/api/compiler/package` répond 404.
- Attendu : Modèle hors liste : 77, agent non lancé. Politique muette ou 404 du paquet : refus, jamais lancement avec le harnais fixe ni sans workflows.
- Surfaces : CLI, serveur
- Source : proto/COORD/PONT.md tableau « Politique au lancement » ; proto/COORD/VERIF-LANCEUR.md §3 bug 9 (fail-open, repli sur 404) ; fusion/COORD/FUSION-TEAMCODE.md 1b « Politique au lancement : Jeter »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-CLAUDE-013 — Le jeton long n'est pas lisible par l'agent

- Étapes : Le faux agent lit son environnement et les fichiers du plugin.
- Attendu : Aucun jeton de 30 jours dans `OSTROM_TOKEN` ni dans `.mcp.json` ; seul un jeton éphémère par run, valable pour ce run (rien de lisible par une commande lancée par l'agent).
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 « MCP de l'équipe » (gravité haute) ; fusion/FUSION-TEAMCODE.md D6
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CLAUDE-014 — Session enregistrée avant l'agent, signe de vie, code de sortie

- Étapes : Lancer, laisser tourner 30 s, quitter avec le code 3.
- Attendu : Le run existe avant le premier outil ; battement visible ; le code 3 est propagé par `ostrom` et noté au reçu de session ; Ctrl-C laissé à l'agent.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Enregistrement de la session, Sortie) ; proto/COORD/CORRECTIFS.md passe 2 point 8a
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CLAUDE-015 — Erreurs de lancement : usage, agent absent, hors dépôt

- Étapes : `ostrom bogus`, `ostrom claude` sans `claude` installé, `ostrom claude` hors dépôt git.
- Attendu : 64 (agent inconnu), 127 (agent absent, avec où l'installer), 66 (pas un dépôt git) ; aucun appel d'inférence.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §2.3 et §3.1 « Ce qui peut rater » ; §1a (« tout autre mot » : 64)
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-016 — Lancement local par défaut, `--cloud` à la demande

- Étapes : `ostrom claude` sans option, puis `ostrom claude --cloud`.
- Attendu : Sans option : sur le poste ; `--cloud` : session cloud créée et rattachée au terminal (voir E2E-CLOUD-001).
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §0 point 6
- Priorité : P2
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CLAUDE-017 — Mode interactif (TUI) sous un pseudo-terminal

- Étapes : Lancer `ostrom claude` dans un pty avec un faux agent interactif.
- Attendu : Le faux agent reçoit le terminal, les hooks fonctionnent comme en mode `-p` (trou de VERIF-LANCEUR : mode interactif non testé).
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §4 « Pas fait : le mode interactif (TUI) »
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CLAUDE-018 — Activité en direct : travaille / attend un humain

- Étapes : Le faux agent joue `Stop`, `Notification`, `PostToolUseFailure`.
- Attendu : La console et l'app montrent la session `working` puis `waiting_for_human` (équivalent de l'état de TeamCode ; absent du lanceur du prototype).
- Surfaces : CLI, serveur, web, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Activité en direct)
- Priorité : P2
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CLAUDE-019 — Identité du dev et variables assignées dans la session

- Étapes : `ostrom claude` par un membre avec une variable d'équipe assignée.
- Attendu : Le prompt système dit qui est le dev (login GitHub) ; la variable arrive à l'agent et est relue périodiquement ; les clés personnelles sont retirées.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Identité, Variables d'environnement assignées)
- Priorité : P2
- Statut : bloqué : ostrom-cli + ostrom-server


## CODEX : `ostrom codex` et les autres agents

### E2E-CODEX-001 — Codex : identifiant de lancement, MCP approuvés, hook de fin à 3 s

- Étapes : `ostrom codex exec` avec un faux `codex` qui enregistre ses arguments.
- Attendu : `OSTROM_LAUNCH_ID` posé ; `-c mcp_servers.ostrom` et `ostrom-workflow` avec `default_tools_approval_mode="approve"` ; `SessionEnd` demandé à 3 s ; le lanceur donne signe de vie et envoie le code de sortie.
- Surfaces : CLI, faux agent
- Source : proto/launcher/tests/codex_launch.rs `codex_gets_the_launch_id_approved_mcp_tools_a_3s_end_hook_and_the_launcher_reports_life_and_exit` ; proto/COORD/VERIF-LANCEUR.md §3 bug 7
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CODEX-002 — `CODEX_HOME` : skills et rôles de sous-agent au nom accepté

- Étapes : Lancer Codex sur un paquet à nœud agent.
- Attendu : Skills lisibles dans `CODEX_HOME/skills` ; rôle `codex/agents/ostrom_<slug>.toml` en `[a-z0-9_]` ; le skill nomme les deux et interdit de déclarer un sous-agent qui n'a pas tourné.
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §3 bug 4 ; proto/COORD/CORRECTIFS.md passe 2 bug 5 ; proto/launcher/src/main.rs test `codex_home_lays_the_package_roles_beside_the_developers` ; proto/server/src/bridge/gate-integrity.test.ts « bug 4: the sub-agent of an agent node has a name Codex accepts... »
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server (compilateur)

### E2E-CODEX-003 — Codex : `node_done` rattaché à la bonne session

- Étapes : Le faux Codex appelle `node_done` avec les en-têtes `http_headers` (dépôt, dev, lancement).
- Attendu : L'appel est enregistré dans la session de ce lancement, le reçu dit `done: ...` et non `not reported`.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (x1) et §3 bug 3 ; proto/COORD/CORRECTIFS.md passe 2 bug 3
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-CODEX-004 — Codex : MCP `ostrom` utilisable en `exec`

- Étapes : Le faux Codex appelle `rules_for` et `get_receipt` sans approbation interactive.
- Attendu : Les deux outils répondent (pas de « requires approval »).
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §3 bug 7
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CODEX-005 — Fin de session Codex : filet du lanceur

- Étapes : Le faux Codex ne laisse que 3 s au hook de fin et le tue.
- Attendu : Le lanceur attend 2,5 s (`OSTROM_SESSION_END_MS`), puis signe le reçu lui-même ; un reçu existe, avec code de sortie.
- Surfaces : CLI, serveur
- Source : proto/COORD/CORRECTIFS.md passe 2 bug 7 ; proto/COORD/VERIF-LANCEUR.md §3 bug 7
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CODEX-006 — Codex : hooks approuvés seulement pour le paquet signé

- Étapes : Lancer avec un paquet signé, puis avec un paquet à signature invalide.
- Attendu : Signé : hooks actifs sans interaction (`--dangerously-bypass-hook-trust` limité à ce paquet) ; invalide : refus avant lancement.
- Surfaces : CLI
- Source : proto/COORD/COMPILATEUR.md §2 (Codex) ; proto/COORD/VERIF-LANCEUR.md §2 « Isolation »
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CODEX-007 — OpenCode : plugin, porte, `git status` libre

- Étapes : Charger le plugin OpenCode, jouer `session.created`, `tool.execute.before` sur `git push origin main`, `after`, un `git status`, puis `session.deleted`.
- Attendu : Le push est bloqué jusqu'au oui, le oui est consommé à l'`after`, `git status` passe sans demande, la session finit avec un reçu valide et sa porte.
- Surfaces : CLI, serveur, faux agent
- Source : proto/bridge/tools/opencode-gate-test.mjs (programme entier)
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CODEX-008 — Grok, Gemini, Hermes, Pi : adaptateurs et limites de hook

- Étapes : Un faux agent par adaptateur ; hooks de 5 s (Grok), `BeforeTool`, `pre_tool_call`, extension `tool_call`.
- Attendu : Un check long est refusé tout de suite chez Grok et se lance par `ostrom check <nœud>` ; chaque adaptateur refuse de lui-même avant la fin du budget (jamais un hook planté qui laisse passer) ; les plugins embarqués gardent la forme patchée.
- Surfaces : CLI, faux agent
- Source : proto/COORD/PONT.md grille « Ce que chaque agent accepte » ; proto/COORD/COMPILATEUR.md §2 ; proto/launcher/src/adapters.rs tests `embedded_plugins_still_have_the_shapes_the_adapters_patch`, `strips_one_toml_table`
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CODEX-009 — `ostrom agents` et inférence par OpenRouter pour les quatre autres agents

- Étapes : `ostrom agents`, puis `ostrom grok` avec le relais OpenRouter.
- Attendu : La liste dit ce qu'Ostrom sait lancer et ce que la politique autorise ; le relais envoie `zdr` et `data_collection: deny`.
- Surfaces : CLI, faux fournisseur
- Source : proto/COORD/PONT.md « Ce que le dev tape » ; fusion/COORD/FUSION-TEAMCODE.md 1b « Relais OpenRouter »
- Priorité : P2
- Statut : bloqué : ostrom-cli


## GATE : Porte qui bloque un push

### E2E-GATE-001 — Boucle complète : push bloqué, oui d'un second compte, push passé, reçu vérifié

- Étapes : Copie neuve d'un dépôt avec `origin` nu local et régression plantée ; `ostrom claude` ; le faux agent corrige, commite, tente `git push origin main` ; le dev ne peut pas se dire oui ; `rev-b` dit oui ; le faux agent relance.
- Attendu : 1re tentative : refus `waiting for a yes` + consigne `ostrom wait <id>` ; après le oui : push accepté, `main` distant = le commit ; reçu de porte et de session signés ; `ostrom verify` hors ligne sort 0.
- Surfaces : CLI, serveur, web (oui), faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (passage c1) ; proto/COORD/APPROBATION.md §5 (film à deux personnes) ; cli/COORD/CLI.md §3.3
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (hooks) + ostrom-server (GATES))

### E2E-GATE-002 — Le oui est consommé : un oui, un push

- Étapes : Après le E2E-GATE-001, relancer `git push origin main` une seconde fois avec un autre commit.
- Attendu : Nouvelle demande ; le oui précédent n'est pas réutilisé ; `/gates/consume` use le oui, ne le crée jamais.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/APPROBATION.md §3 (consume) ; corr/COORD/CORRECTIFS.md passe 4 point 1 (`/gates/consume` reste accepté)
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-GATE-003 — Un non est signé et l'agent reçoit l'ordre de ne pas contourner

- Étapes : Le second compte répond non.
- Attendu : Le hook refuse avec `<who> said no ... Do not retry it or work around it` ; reçu de refus signé ; un non vaut pour la session.
- Surfaces : CLI, serveur, web
- Source : cli/COORD/CLI.md §3.3 (variante `deny`) ; proto/COORD/PONT.md « Le parcours » ; proto/server/src/yes/yes.test.ts « a no is signed too; a bad result is refused; an unknown request is 404 »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-GATE-004 — Attente de 300 s puis refus, la demande reste ouverte

- Étapes : Aucun oui pendant le délai du hook (délai raccourci pour le test) ; relance de la même commande.
- Attendu : Le hook refuse en disant que la demande reste ouverte ; la relance retrouve la même demande (pas de doublon).
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/PONT.md « L'idée de départ, challengée » (limite 1)
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-GATE-005 — Serveur arrêté : l'action gardée est refusée, l'ordinaire passe

- Étapes : Arrêter le serveur en cours de session ; le faux agent envoie `ls` puis `git push origin main`.
- Attendu : `ls` passe sans appel serveur ; le push est refusé (`Ostrom is unreachable`) ; `OSTROM_GATE_FAIL=open` inverse le comportement.
- Surfaces : CLI, faux agent
- Source : proto/COORD/PLATEFORME.md §4 « Le serveur Ostrom en panne » ; proto/COORD/PONT.md (fin du bloc portes) ; proto/launcher/src/main.rs message `Ostrom: denied. ... unreachable`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-GATE-006 — Workflow seulement proposé : la porte est en ombre

- Étapes : Un workflow proposé couvre `git push` ; le faux agent pousse.
- Attendu : Le push passe, la demande est journalisée (`shadow`), aucun oui n'est demandé ; le script d'un check n'est pas lancé (`would have run`).
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/PONT.md (Une porte d'un workflow encore proposé) ; proto/COORD/COMPILATEUR.md §5 (dernier paragraphe) ; cli/COORD/CLI.md §0 point 3
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-GATE-007 — Le check teste le commit poussé, pas l'arbre

- Étapes : Commit cassé, correction laissée non commitée, `git push origin main`.
- Attendu : Refus `check ... not run ... working tree has uncommitted changes` ; aucun oui demandé pour le commit cassé ; arbre propre et HEAD poussé : check lancé en place ; autre commit poussé par nom : worktree détaché, supprimé ensuite.
- Surfaces : CLI, faux agent
- Source : proto/launcher/tests/pushed_commit.rs (3 tests) ; proto/bridge/test/push-parity.test.mjs « bug 1 : ... » (2 tests) ; proto/COORD/VERIF-LANCEUR.md §3 bug 1 ; proto/COORD/CORRECTIFS.md passe 2 bug 1
- Priorité : jalon
- Statut : bloqué : ostrom-cli

### E2E-GATE-008 — Push gardé qui n'est pas seul dans sa commande : refusé

- Étapes : `git push origin main && echo done`, `git commit && git push`.
- Attendu : Refus avant exécution, personne n'est demandé, message qui dit de pousser seul.
- Surfaces : CLI, serveur
- Source : proto/bridge/test/push-parity.test.mjs « a guarded push that is not alone in its command is refused: its commit does not exist yet » ; proto/launcher/tests/pushed_commit.rs `a_commit_and_its_push_in_one_command_are_refused_before_anything_runs`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-GATE-009 — Lecture du push : remote, refs, sha, séparateurs, guillemets, redirections

- Étapes : Table de commandes : `git push origin HEAD:main`, `git push --force`, `... 2>&1 | tail`, chemins entre guillemets.
- Attendu : Le parseur donne les mêmes remotes/refs/sha que la référence ; segments coupés aux séparateurs mais pas dans les guillemets ni les redirections ; parité entre implémentations.
- Surfaces : CLI
- Source : proto/launcher/src/push.rs tests `segments_cut_at_separators_but_not_in_quotes_or_redirections`, `parse_reads_the_commits_and_refs_a_push_sends` ; proto/bridge/test/push-parity.test.mjs `parsePush reads like launcher/src/push.rs`
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-GATE-010 — Un oui par action, quel que soit le texte de la commande

- Étapes : Demande pour `git commit ... && git push origin main` (refusée en bloc), puis `git push origin main 2>&1 | tail -15`.
- Attendu : Une seule demande de oui pour le push (clé = dépôt, classe, remote, ref=sha, session), pas deux.
- Surfaces : CLI, serveur
- Source : proto/server/src/bridge/gate-integrity.test.ts « bug 6: one yes per action, whatever the text of the command » ; proto/COORD/VERIF-LANCEUR.md §3 bug 6 ; audit/server/src/bridge/audit-gate.test.ts P2 (partie `| tail -f`)
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-GATE-011 — Ancien lanceur : demande de push sans commits refusée (426)

- Étapes : Le faux agent envoie une demande de porte pour un push sans le champ `push`.
- Attendu : 426 « this Ostrom launcher is out of date ... Update the launcher », rien de demandé ni ajouté à la session ; le check GitHub n'est pas concerné.
- Surfaces : serveur, faux agent
- Source : proto/server/src/bridge/gate-integrity.test.ts « CORRECTIFS-3: a hook that asks a yes for a push without its commits (an old launcher) is refused and told to update » ; proto/COORD/CORRECTIFS.md passe 3 point 2
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GATE-012 — Le oui est lié à la plage poussée, et la montre

- Étapes : Demande de push de 2 commits ; lecture de la demande côté approbateur.
- Attendu : « This yes covers these commits only » avec sujets et sha ; les commits sont signés dans le reçu de porte (`push = {remote, refs:[{ref,sha}]}`).
- Surfaces : serveur, web, CLI
- Source : proto/COORD/CORRECTIFS.md passe 2 bugs 2 et 6 ; amont/compat/README.md « Clé d'action d'un push » ; amont/compat/compat.test.ts « the gate receipt binds the pushed commit... »
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-GATE-013 — Classes d'action : push-main, deploy, merge couverts par le catalogue

- Étapes : Le faux agent envoie `git push origin main`, `helm upgrade`, `kubectl apply`, `npm publish`, `gh pr merge 3`, `git push origin feature/x`.
- Attendu : Chaque commande est classée comme prévu ; `feature/x` et les commandes de lecture ne sont pas gardées ; le catalogue est rafraîchi en arrière-plan sous 30 s et en ligne au-delà.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/PONT.md (catalogue `gates.json`) ; proto/launcher/tests/gates_catalogue.rs `the_catalogue_is_refreshed_in_the_background_within_the_ttl_and_in_line_past_it` ; proto/launcher/src/main.rs test `pattern_hit_matches_like_a_fresh_regex_every_time` (motifs compilés une fois) ; proto/COORD/HOOK-DISPATCH.md §2
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-GATE-014 — Porte d'une commande lancée hors de l'agent (terminal du dev)

- Étapes : Le dev pousse `main` à la main dans son terminal, sans agent.
- Attendu : Le hook ne s'applique pas ; la frontière est côté GitHub (voir E2E-GHCHECK-009) : le push direct est refusé par le ruleset.
- Surfaces : CLI, faux GitHub
- Source : proto/COORD/PONT.md limite 2 ; proto/COORD/PLATEFORME.md §4 « Un hook contourné »
- Priorité : P1
- Statut : bloqué : ostrom-e2e (faux GitHub) + ostrom-server

### E2E-GATE-015 — Le refus du hook nomme les approbateurs qui restent

- Étapes : Porte à deux approbateurs dont le demandeur ; le faux agent pousse.
- Attendu : Le message dit « needs a yes from <autre> » (lu sur `waitingFor` : approbateurs moins le demandeur), pas la liste complète.
- Surfaces : CLI, serveur
- Source : proto/COORD/APPROBATION.md §8 (« Message du hook Rust ») ; proto/COORD/APPROBATION.md §5 (film, 19,2 s)
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server


## BYPASS : Contournements de la porte (audit du 30/10 et trous connus)

### E2E-BYPASS-001 — Contournement : options avant le verbe `push` (piste 1a)

- Étapes : Catalogue du dépôt ; commandes `git -C /work/core push origin main`, `git -C "/my work/core" push origin HEAD:main`, `git -c core.sshCommand=ssh push origin main`, `git --no-pager push origin main`, `git --git-dir /work/core/.git push origin main`.
- Attendu : Toutes sont classées `push-main` (porte demandée).
- Surfaces : serveur (catalogue), faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P1 (première boucle) ; commit 4a74f6a0
- Priorité : jalon
- Statut : codé : `scenarios/bypass.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (hooks) + ostrom-server (GATES))

### E2E-BYPASS-002 — Contournement : options avant le verbe de déploiement (piste 1b)

- Étapes : `kubectl -n production apply -f api.yaml`, `kubectl --context prod rollout restart deploy/api`, `kubectl -n production patch deploy api -p {}`, `helm --kube-context prod upgrade api ./chart`, `terraform -chdir=infra apply -auto-approve`, `npm --registry https://registry.npmjs.org publish`, `docker --config /tmp/c push ghcr.io/o/api:1.2.3`.
- Attendu : Toutes sont classées `deploy`.
- Surfaces : serveur (catalogue), faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P1 (deuxième boucle)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-003 — Contournement : fusion par l'API (piste 1c)

- Étapes : `gh api -X PUT repos/o/repo-t/pulls/3/merge`, `curl -X PUT -H "authorization: token x" https://api.github.com/repos/o/repo-t/pulls/3/merge`.
- Attendu : Classées `merge`.
- Surfaces : serveur (catalogue), faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P1 (troisième boucle)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-004 — Pas de faux positifs sur la lecture

- Étapes : `git -C /work/core pull origin main`, `git log main`, `git push origin feature/x`, `kubectl -n production get pods`, `helm --kube-context prod list`.
- Attendu : Aucune n'est une action frontière (aucune demande).
- Surfaces : serveur (catalogue), faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P1 (dernière boucle « not a frontier action »)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-005 — Contournement : le oui d'un push ordinaire sert à un force-push (piste 2)

- Étapes : Oui donné à `git push origin main` (commit C) ; puis `git push --force origin main`, `-f`, `+main`, `--force-with-lease`, `-uf`, avec le même commit ; et `git push origin main 2>&1 | tail -f`.
- Attendu : Le push relu à travers `tail` retrouve la même demande ; chaque variante de force est une nouvelle demande `pending`.
- Surfaces : serveur, faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P2
- Priorité : jalon
- Statut : codé : `scenarios/bypass.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (hooks) + ostrom-server (GATES))

### E2E-BYPASS-006 — Contournement : git redirigé vers un autre dépôt (piste 3)

- Étapes : `GIT_DIR=/tmp/other/.git git push origin main`, `GIT_WORK_TREE=...`, `git --git-dir=... push`, `git -c remote.origin.url=... push`, `... pushurl ...`, `-c url.<x>.pushInsteadOf=...`, `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=remote.origin.url ...`.
- Attendu : Réponse 400 « plain `git push <remote> <ref>` » pour chacune ; personne n'est demandé (le nombre d'approbations ne change pas).
- Surfaces : serveur, faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P3
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-BYPASS-007 — Contournement : diff montré écrit par l'agent (piste 4)

- Étapes : L'agent demande lui-même le oui avec un diff inoffensif ; l'approbateur dit oui ; le hook redemande avec le vrai diff.
- Attendu : Le vrai diff est une nouvelle demande `pending` ; le diff exact qui a été approuvé retrouve l'ancien oui.
- Surfaces : serveur, faux agent
- Source : audit/server/src/bridge/audit-gate.test.ts P4
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-BYPASS-008 — Contournement : oui de fusion réutilisé vers une autre branche ou une autre porte (piste 5)

- Étapes : `repo-t` a deux portes (main : `rev-b`, autres branches : `rev-c`) ; `ci-check` sha E vers `develop`, oui de `rev-c` ; puis `ci-check` du même sha vers `main`.
- Attendu : La demande vers `main` est autre, sous l'autre porte, `pending` : `rev-b` n'a pas dit oui.
- Surfaces : serveur, faux GitHub
- Source : audit/server/src/bridge/audit-gate.test.ts P5
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-BYPASS-009 — Contournement : `ci-check` forgé avec `base=develop` (piste 5b)

- Étapes : Sans jeton, appel `/api/bridge/ci-check` se disant fusionné vers `develop` ; oui ; puis la vraie PR vers `main`.
- Attendu : La PR vers `main` est une autre demande `pending` ; la même PR redemandée retrouve la même demande.
- Surfaces : serveur
- Source : audit/server/src/bridge/audit-gate.test.ts P5b
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-010 — Contournement : écrire dans la session d'un autre sans son jeton (piste 6)

- Étapes : Sans jeton du dev : fin d'une session vérifiée, résultat de check (seul et en lot), notification.
- Attendu : 403 pour chacun ; avec le jeton du dev, la fin passe (200).
- Surfaces : serveur
- Source : audit/server/src/bridge/audit-gate.test.ts P6 ; proto/COORD/VERIF-LANCEUR.md §3 bug 3
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-011 — Contournement : reçu de workflow signé trop tôt ou sous un autre paquet (piste 7)

- Étapes : Demander le reçu de workflow pendant que la session est ouverte, puis après sa fin avec le digest d'un autre paquet, puis avec le bon.
- Attendu : 409 tant que la session est ouverte ; 409 sous un autre paquet ; 200 et vérification ok avec le paquet de la session.
- Surfaces : serveur
- Source : audit/server/src/bridge/audit-gate.test.ts P7
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-012 — `node_done` : jeton obligatoire, session du lancement, nœud du paquet

- Étapes : `curl` sans jeton avec `x-ostrom-repo`/`x-ostrom-dev` ; deux sessions du même dev dans le même dépôt ; un `node` absent du paquet.
- Attendu : 401 sans jeton ; le dev vient du jeton seul ; l'appel va à la session du lancement (`x-ostrom-launch`), jamais à la plus récente ; nœud inconnu refusé ; rien enregistré sans session.
- Surfaces : serveur, faux agent
- Source : proto/server/src/bridge/gate-integrity.test.ts « bug 3: node_done needs a token, lands on the session of its launch only, and only for an agent node of its package » ; proto/COORD/VERIF-LANCEUR.md §3 bug 3
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-013 — Faux vert `ostrom-gate` posé à la main

- Étapes : Poser un statut `ostrom-gate=success` avec le jeton `gh` d'un dev sur une PR en attente ; ruleset restreint à l'app.
- Attendu : `mergeable_state` reste `blocked`, `gh pr merge` refusé alors que l'état combiné est `success` (faux GitHub qui applique `integration_id`).
- Surfaces : faux GitHub, serveur
- Source : proto/COORD/GATE-GITHUB.md § app, point 2 (PR #4)
- Priorité : P1
- Statut : bloqué : ostrom-e2e (faux GitHub) + ostrom-server

### E2E-BYPASS-014 — Fusion `--admin` et push direct par un acteur en contournement

- Étapes : Liste de contournement vide : `gh pr merge --admin`, push direct `main` depuis un terminal ; puis un acteur en contournement.
- Attendu : Admin refusé aussi (jamais mesuré sur le vrai GitHub) ; push direct refusé GH006 ; un push qui atteint quand même `main` est tracé `bypass` (reçu et alerte).
- Surfaces : faux GitHub, serveur
- Source : proto/COORD/GATE-GITHUB.md « Ce qui manque » 5 ; proto/COORD/ARCHI.md § « Le check GitHub ostrom-gate » (admin en contournement) ; proto/COORD/PLATEFORME.md §4
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-e2e

### E2E-BYPASS-015 — L'administrateur ne répond pas à la place de l'approbateur ; l'agent ne répond pas à sa propre porte

- Étapes : Le dev est OWNER/ADMIN ; son faux agent lance `ostrom approve` / `waits answer` sur sa propre porte, avec le login interactif du dev.
- Attendu : 403 : l'administrateur ne répond pas pour un autre et le demandeur ne répond pas (sauf seul approbateur, signé `selfApproved`) ; la réponse d'un jeton d'agent est toujours refusée.
- Surfaces : serveur, CLI, faux agent
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 3 (extension E3) ; proto/COORD/APPROBATION.md §1
- Priorité : jalon
- Statut : bloqué : ostrom-server (portes sur waits)

### E2E-BYPASS-016 — Décideur non approbateur de la porte

- Étapes : Un compte membre qui n'est pas dans la liste des approbateurs de la porte répond oui.
- Attendu : Refus ; seul un approbateur désigné décide (aujourd'hui le prototype ne vérifie que « pas l'auteur »).
- Surfaces : serveur
- Source : proto/COORD/APPROBATION.md §8 « Appartenance »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-017 — Déclassement silencieux du harnais

- Étapes : Un mandataire répond 404 à `/api/compiler/package` après épinglage du serveur ; politique muette.
- Attendu : Refus (fail-closed) au lieu du harnais fixe sans workflows.
- Surfaces : CLI, serveur
- Source : proto/COORD/VERIF-LANCEUR.md §3 bug 9
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-BYPASS-018 — SSRF et amont privé via le MCP relayé

- Étapes : Enregistrer un serveur MCP d'équipe dont l'URL vise `127.0.0.1`/une adresse privée, puis un nom DNS qui se résout en privé après coup.
- Attendu : Refus (DNS épinglé, aucune requête vers une adresse interne non autorisée) ; le trou SSRF du prototype n'existe plus.
- Surfaces : serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (PinnedDns, McpGateway) et 1b ligne « MCP du harnais » ; proto/COORD/PLATEFORME.md #10
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-BYPASS-019 — Clé de signature et jetons forgés

- Étapes : Poster un reçu, un paquet ou une décision avec une clé de test ; un jeton d'appareil pour poser un webhook, une politique ou épingler.
- Attendu : Rien n'est accepté : jetons d'appareil et clés de service ne disent jamais oui, ne changent pas de politique, n'épinglent pas.
- Surfaces : serveur
- Source : proto/COORD/PLATEFORME.md §4 « Un jeton volé » ; proto/COORD/APPROBATION.md §2 ; proto/server/src/discord/discord.test.ts « a device token cannot set a webhook; an operator can... »
- Priorité : P1
- Statut : bloqué : ostrom-server



### E2E-BYPASS-020 — Contournement A1 : recréer le compte d'un approbateur sans authentification

- Étapes : `POST` de création de compte/opérateur pour le login `rev-b` sans jeton, puis avec le jeton d'appareil de `dev-a` ; tenter ensuite de dire oui avec le jeton rendu.
- Attendu : 401/403 dans les deux cas ; le compte et les jetons de `rev-b` restent inchangés ; aucun oui « approved by rev-b » ; une tentative est tracée.
- Surfaces : serveur, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A1 ; audit/server/src/bridge/audit-gate.test.ts P8 ; JOURNAL 30/10 « EXIGENCES » point 1
- Priorité : jalon
- Statut : bloqué : ostrom-server (AUTH)

### E2E-BYPASS-021 — Contournement A2 : écrire dans la console (workflows, politique, gate-actions, règles, membres) sans session utilisateur

- Étapes : Sans jeton, puis avec le jeton d'appareil ou de session d'agent : `PUT/PATCH` du workflow pour retirer la porte, passer la politique en ombre, modifier `gate-actions`, règles, membres, réglages.
- Attendu : 401 sans session, 403 avec un jeton d'agent ; rien ne change en base ; la porte s'applique toujours au push suivant.
- Surfaces : serveur, web, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A2 ; audit-gate.test.ts P9 ; JOURNAL 30/10 « EXIGENCES » point 2
- Priorité : jalon
- Statut : bloqué : ostrom-server (AUTH)

### E2E-BYPASS-022 — Contournement A3 : décider une porte sans jeton

- Étapes : `POST` de décision sur une porte ouverte sans aucun jeton.
- Attendu : 401 ; la porte reste ouverte ; aucun reçu.
- Surfaces : serveur
- Source : audit/COORD/AUDIT-PORTE.md A3
- Priorité : P1
- Statut : bloqué : ostrom-server (AUTH, GATES)

### E2E-BYPASS-023 — Contournement A7b : déplacer la ref distante locale pour réduire le diff montré

- Étapes : L'agent fait `git update-ref refs/remotes/origin/main HEAD~1` puis demande le push de 3 commits.
- Attendu : Le diff montré à l'approbateur est calculé côté serveur depuis le distant réel (GitHub ou dépôt nu du banc) et contient les 3 commits ; le reçu signe la liste des commits.
- Surfaces : CLI, serveur, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A7b ; JOURNAL 30/10 « EXIGENCES » point 5
- Priorité : jalon
- Statut : bloqué : ostrom-cli (hook) + ostrom-server (GATES)

### E2E-BYPASS-024 — Contournement A9 : push qui atterrit sur main sans la nommer

- Étapes : Depuis main : `git push origin HEAD` ; `git push` nu avec amont main ; `push.default=matching` ; `remote.origin.push` ; distant miroir ; `pushurl` et `pushInsteadOf` différents de l'URL de fetch.
- Attendu : Chaque cas ouvre la porte de main (ou est refusé si piloté par la config) ; le oui nomme l'URL de push réelle ; aucun cas ne part sans oui.
- Surfaces : CLI, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A9 ; audit/bridge/test/audit-push.test.mjs (4 cas) ; audit/launcher/tests/audit_push_refs.rs
- Priorité : jalon
- Statut : codé : `scenarios/bypass.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (hooks) + ostrom-server (GATES))

### E2E-BYPASS-025 — Contournement A10 : écrire dans une session sans en être le propriétaire

- Étapes : Avec le jeton d'un autre dev ou sans jeton : fin de session avec coût/modèle choisis, check « passé » posé, notification au nom d'un dev, consommation du oui d'un autre.
- Attendu : 403 partout ; la session, ses checks et ses oui sont inchangés.
- Surfaces : serveur
- Source : audit/COORD/AUDIT-PORTE.md A10 ; JOURNAL 30/10 « EXIGENCES » point 3
- Priorité : P1
- Statut : bloqué : ostrom-server (GATES)

### E2E-BYPASS-026 — A12 : le jeton de l'agent ne lui donne que sa session

- Étapes : Depuis le faux agent, avec le jeton présent dans son environnement : déclarer un check passé, `node_done` d'un autre nœud, `alive` d'une autre session, fixer le coût ou le code de sortie, fermer/rouvrir la session d'un autre.
- Attendu : Refus pour tout ce qui sort de sa session ; les résultats de check sont signés ou recalculés par le serveur ; le reçu ne contient que ce que le serveur a vérifié.
- Surfaces : CLI, serveur, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A12 ; JOURNAL 30/10 « EXIGENCES » point 3 ; VERIF-LANCEUR
- Priorité : jalon
- Statut : bloqué : ostrom-server (GATES) + ostrom-cli

### E2E-BYPASS-027 — A13 : altérer les fichiers de session du hook

- Étapes : Le faux agent réécrit le cache de check (« déjà passé »), `session-env.json` (`OSTROM_GATE_FAIL=open`, autre `OSTROM_URL`), les scripts du plugin.
- Attendu : Le hook détecte l'altération (cache signé, liste blanche des variables, empreintes) et refuse l'action ; rien ne passe ouvert.
- Surfaces : CLI, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A13
- Priorité : P1
- Statut : bloqué : ostrom-cli (hook)

### E2E-BYPASS-028 — A14 : le reçu de porte dit ce qui a été approuvé

- Étapes : Push approuvé, puis `ostrom verify` du reçu hors ligne.
- Attendu : Le sujet signé contient les refs et shas poussés, le distant, `force`, l'empreinte du diff montré (et pour une PR, `sha` et `base`) ; `verify` les affiche.
- Surfaces : CLI, serveur
- Source : audit/COORD/AUDIT-PORTE.md A14
- Priorité : jalon
- Statut : bloqué : ostrom-core (reçus) + ostrom-server

### E2E-BYPASS-029 — A15 : push direct sur main détecté sans faux positif

- Étapes : Webhook de push sur main après une fusion approuvée, puis après un vrai push hors porte.
- Attendu : La fusion approuvée n'est pas marquée « bypass » ; le vrai contournement l'est et donne un reçu signé de contournement.
- Surfaces : serveur
- Source : audit/COORD/AUDIT-PORTE.md A15 ; GATE-GITHUB
- Priorité : P1
- Statut : bloqué : ostrom-server (GATES, GitHub)

### E2E-BYPASS-030 — A16 : fusion GraphQL par requête lue depuis un fichier

- Étapes : `gh api graphql -F query=@q.graphql` contenant `mergePullRequest`.
- Attendu : La porte de fusion s'applique (lecture du fichier ou classe `gh api graphql` gardée) ; à défaut, le check GitHub tient et le scénario le prouve.
- Surfaces : CLI, serveur, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A16
- Priorité : P2
- Statut : bloqué : ostrom-cli (classement des commandes)

### E2E-BYPASS-031 — A17 et A18 : remplacer la session d'un autre, se faire passer pour le lanceur

- Étapes : Créer une session avec l'id d'une session existante d'un autre dev ; tuer le lanceur puis envoyer des `alive` avec le jeton.
- Attendu : Création refusée (propriétaire) ; un `alive` qui ne vient pas du lanceur ne masque pas la perte : la session est close « launcher lost » avec le code de sortie connu.
- Surfaces : serveur, CLI
- Source : audit/COORD/AUDIT-PORTE.md A17, A18
- Priorité : P2
- Statut : bloqué : ostrom-server (sessions)

### E2E-BYPASS-032 — A19 et A20 : reçu exact sur la réouverture, pas de repli ouvert

- Étapes : Segment rouvert par un hook ; serveur qui répond 404 au paquet.
- Attendu : Le reçu dit `reopenedBy: hook` ou `launcher` ; un 404 de paquet ne lance rien en mode ouvert (refus clair).
- Surfaces : CLI, serveur
- Source : audit/COORD/AUDIT-PORTE.md A19, A20 ; VERIF-LANCEUR bug 9
- Priorité : P2
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-BYPASS-033 — A24 : deux appels d'outil parallèles sur le même oui

- Étapes : Dans une même session, deux `git push` parallèles après un seul oui.
- Attendu : Le oui n'est consommé qu'une fois (transaction) : un seul push part, l'autre redemande.
- Surfaces : CLI, serveur, faux agent
- Source : audit/COORD/AUDIT-PORTE.md A24 ; JOURNAL 30/10 « EXIGENCES » point 5
- Priorité : P1
- Statut : bloqué : ostrom-server (GATES)

## YES : Oui lié au SHA, au dépôt, aux commits montrés ; auteur et approbateurs

### E2E-YES-001 — Un oui sur un SHA ne vaut pas pour un autre

- Étapes : Demande pour le commit A, oui ; un nouveau commit B (que l'approbateur n'a pas vu) ; même commande.
- Attendu : Nouvelle demande pour B ; le oui de A reste `approved` sans être consommé ; poussée de B seulement après un second oui.
- Surfaces : serveur, CLI, faux agent
- Source : proto/server/src/bridge/gate-integrity.test.ts « bug 2: a yes to a push holds for the commit it was given for; a new commit asks again » ; proto/COORD/VERIF-LANCEUR.md §3 bug 2 ; proto/COORD/CORRECTIFS.md passe 2 (passage réel, `ea600203` / `d8908d39`)
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-server (GATES))

### E2E-YES-002 — Le oui montre les commits, le dépôt réel et le diff

- Étapes : Ouvrir la demande côté approbateur (console, DM, CLI).
- Attendu : Titre, champ « Repository » (dépôt réel), commits (sujets, sha), diff ; `shownDigest` correspond à ce qui est signé dans le reçu.
- Surfaces : serveur, web, CLI
- Source : proto/COORD/CORRECTIFS.md passe 1 §2 et passe 2 bug 2 ; proto/server/src/yes/yes.test.ts « the queue lists a pending request with who, what, gate and the diff the hook sent »
- Priorité : jalon
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-YES-003 — Le demandeur ne peut pas s'approuver quand un autre approbateur existe

- Étapes : Le dev, auteur de la demande, répond oui dans la console ; un autre approbateur existe.
- Attendu : 403 `self_approval_refused` avec la liste `others` ; la demande reste en attente ; badge « waiting for another approver » ; un non de l'auteur passe toujours.
- Surfaces : serveur, web
- Source : proto/server/src/yes/approval.test.ts « the author cannot say yes to their own request when another approver exists (server-side, 403) » ; proto/COORD/APPROBATION.md §1
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-server (GATES))

### E2E-YES-004 — Seul approbateur déclaré : son oui passe et le dit partout

- Étapes : Un seul approbateur, auteur de la demande ; il dit oui.
- Attendu : Accepté, `selfApproved: true` dans la demande, la décision, le reçu de porte, le reçu de session et le reçu de workflow ; `ostrom verify` affiche `SELF-APPROVED`.
- Surfaces : serveur, CLI
- Source : proto/server/src/yes/approval.test.ts « the sole approver may approve their own request: accepted, marked self-approved in the decision and every signed receipt » ; proto/launcher/src/verify.rs `a_self_approved_yes_is_said_out_loud`
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-YES-005 — Réglage `selfApproval = never`

- Étapes : Politique `never` ; l'auteur, même seul approbateur, dit oui ; puis dit non.
- Attendu : Oui refusé, la demande attend qu'on ajoute quelqu'un ; le non de l'auteur passe.
- Surfaces : serveur
- Source : proto/server/src/yes/approval.test.ts « organisation setting "never": no self-approval at all... » ; proto/COORD/APPROBATION.md §1
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-YES-006 — Premier oui ferme les autres demandes

- Étapes : Une porte à trois approbateurs : trois demandes (ou waits) en attente ; le premier répond oui, le second tente non.
- Attendu : Les autres sont fermées dans la même transaction que la réponse ; le second reçoit « déjà décidé » ; un seul reçu ; ni double décision en cas de réponses simultanées.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 4 (extension E4) ; proto/server/src/selftest.ts étape « a second decision does not change anything »
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-YES-007 — Une décision ne se rejoue pas

- Étapes : Décider deux fois la même demande avec deux résultats.
- Attendu : La seconde ne change rien ; le reçu reste celui de la première.
- Surfaces : serveur
- Source : proto/server/src/selftest.ts étape « a second decision does not change anything »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-YES-008 — Hook et check GitHub : une demande, un reçu (check d'abord)

- Étapes : PR vue par le check, puis `gh pr merge N` par le hook.
- Attendu : Une seule demande (clé `merge-pr` + sha), `askedVia` = hook et ci ; un oui : check vert, hook relancé trouve `approved` avec le même reçu, `consume`, reçu de session à un oui.
- Surfaces : serveur, faux GitHub, faux agent
- Source : proto/server/src/yes/approval.test.ts « one yes per action: the GitHub check first, then the agent hook on `gh pr merge` share one request and one receipt »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-YES-009 — Hook et check : une demande (hook d'abord)

- Étapes : `gh pr merge N` par le hook, tête lue sur GitHub ; puis le check rejoint.
- Attendu : Même demande ; un nouveau commit sur la PR = nouvelle demande.
- Surfaces : serveur, faux GitHub
- Source : proto/server/src/yes/approval.test.ts « one yes per action, the other way round: the hook first (head read from GitHub), then the check joins »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-YES-010 — Lecture de la PR visée par une commande de fusion

- Étapes : `gh pr merge N`, `#N`, URL de PR, `-R owner/repo`, `gh api .../pulls/N/merge` ; sans numéro.
- Attendu : La PR est lue ; sans numéro, demande à part (non unifiée).
- Surfaces : serveur
- Source : proto/server/src/yes/approval.test.ts « prOfCommand reads the PR a merge command targets » ; proto/COORD/APPROBATION.md §3
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-YES-011 — Le oui montre le dépôt où la commande tourne réellement

- Étapes : Commande gardée lancée dans un autre clone (autorisé par le serveur) ; lecture de la demande.
- Attendu : Champ « Repository » = dépôt réel ; si différent de la session : « Session repository ... NOT the repository this command runs in » et bandeau « other repository ».
- Surfaces : serveur, web, faux Slack
- Source : proto/server/src/yes/approval.test.ts « the yes shows the repository the command really runs in, and says so when it is not the session's (PAQUET, 28/10) » ; proto/COORD/CORRECTIFS.md passe 1 §2
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-YES-012 — Un jeton de poste ne dit jamais oui

- Étapes : `ostrom login` (jeton `ost_`) puis tentative de oui ; jeton `opk_` inconnu.
- Attendu : 403 pour le jeton de poste (il peut demander une porte) ; 401 pour l'`opk_` inconnu.
- Surfaces : serveur
- Source : proto/server/src/yes/approval.test.ts « a device token (ostrom login) can ask for a gate but never say yes » ; proto/COORD/APPROBATION.md §2
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-YES-013 — Un oui par session : il ne survit pas à une reprise

- Étapes : Oui donné dans le segment 1 ; reprise (`--resume`) ; même commit.
- Attendu : Une nouvelle demande dans le segment suivant (décision orchestrateur : un oui par segment).
- Surfaces : serveur, CLI
- Source : proto/COORD/CORRECTIFS.md passe 2 « Questions pour Lyes » et passe 3 (décisions appliquées)
- Priorité : P2
- Statut : bloqué : ostrom-server


## YESCLI : Oui depuis le terminal

### E2E-YESCLI-001 — `ostrom inbox` et `ostrom approve`

- Étapes : L'approbateur lance `ostrom inbox` puis `ostrom approve <id>`.
- Attendu : La liste montre la porte, le dépôt, le demandeur, le nombre de commits ; `approve` affiche commits, `+/-`, tests, demande `[y/N]`, signe le reçu ; l'agent peut pousser.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.3
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-YESCLI-002 — Le demandeur tente `approve` de sa propre demande

- Étapes : `@maya-k` lance `ostrom approve` sur sa demande.
- Attendu : `You asked for this one. @lena or @omar must say yes.`, code 77.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.3 (dernière variante) ; proto/COORD/APPROBATION.md §8 (message du hook)
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (approve))

### E2E-YESCLI-003 — `ostrom wait` : codes et texte lu par les modèles

- Étapes : `ostrom wait <id>` approuvé, refusé, délai dépassé.
- Attendu : 0 `approved by <who> (receipt ...). Run the same command again now.` ; 2 refusé ; délai : code 75 (aujourd'hui 1, à changer) ; le début du texte (≈200 caractères) suffit à un agent comme Grok.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §1a (`wait`), §2.3 (75), §2.4 ; proto/COORD/PONT.md
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-YESCLI-004 — `ostrom deny --reason`

- Étapes : L'approbateur refuse avec une raison.
- Attendu : L'agent lit `said no ... Do not retry it or work around it; report the refusal`; reçu de refus.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.3 (variante deny)
- Priorité : P2
- Statut : bloqué : ostrom-cli


## SLACK : Oui depuis Slack

### E2E-SLACK-001 — DM Slack avec boutons Oui / Non

- Étapes : Une porte demande un oui ; faux Slack reçoit le DM.
- Attendu : Le DM porte les champs (dépôt réel, commits, diff) et deux boutons ; le clic est une interaction Socket Mode simulée.
- Surfaces : serveur, faux Slack
- Source : proto/COORD/CONNEXION.md « Fait » (DM à chaque approbateur) ; proto/server/src/connexion-test.ts (DM par approbateur)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SLACK-002 — Clic Oui : décision signée, DM mis à jour

- Étapes : Un approbateur clique Oui.
- Attendu : Reçu signé au nom de la personne Slack liée ; le DM est mis à jour (`chat.update`) avec le résultat ; le check/hook en attente se débloque.
- Surfaces : serveur, faux Slack
- Source : proto/server/src/connexion-test.ts (mise à jour des DM après une décision, en-tête) ; proto/COORD/CONNEXION.md
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SLACK-003 — Premier oui : les DM des autres approbateurs sont fermés

- Étapes : Deux approbateurs reçoivent un DM ; l'un clique Oui.
- Attendu : L'autre DM est mis à jour en « décidé par X » et ses boutons disparaissent.
- Surfaces : serveur, faux Slack
- Source : proto/COORD/APPROBATION.md §8 « Slack » ; amont/COORD/AMONT-TEAMCODE.md §0 point 4
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SLACK-004 — Auto-approbation par Slack : refusée visiblement

- Étapes : Le demandeur clique Oui dans son propre DM.
- Attendu : Refus visible dans Slack (pas seulement journalisé) ; la demande reste en attente.
- Surfaces : serveur, faux Slack
- Source : proto/COORD/APPROBATION.md §8 « Slack : un oui refusé y est seulement journalisé »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SLACK-005 — Utilisateur Slack non relié : pas de oui par Slack

- Étapes : Un compte Slack qui n'est lié à aucun membre clique Oui.
- Attendu : Refusé ; correspondance e-mail puis nom documentée.
- Surfaces : serveur, faux Slack
- Source : proto/server/src/connexion-test.ts étape « Allow ... members linked by e-mail then name »
- Priorité : P2
- Statut : bloqué : ostrom-server


## WEB : Oui et console web

### E2E-WEB-001 — Oui depuis la page, signé par la personne connectée

- Étapes : `rev-b` ouvre la file, la demande, clique Oui.
- Attendu : Reçu signé au nom de `rev-b`, valide, cite ce qui a été montré ; la page affiche le reçu ; « signed as rev-b ».
- Surfaces : web, serveur (Playwright)
- Source : proto/server/src/yes/yes.test.ts « a yes from the page is signed by the operator, and the receipt is valid and cites what was shown » ; proto/COORD/APPROBATION.md §1 (affichage)
- Priorité : jalon
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-WEB-002 — La page du oui pour le demandeur : badges et bannière de refus

- Étapes : Le demandeur ouvre sa demande et tente un oui.
- Attendu : Badges « you asked », « waiting for another approver » ; bannière « Refused by Ostrom ... reviewer-local must say yes » ; la demande reste en attente.
- Surfaces : web (Playwright)
- Source : proto/COORD/APPROBATION.md §1 (page /yes) et §5 (film, 36,6 s)
- Priorité : P1
- Statut : bloqué : ostrom-web

### E2E-WEB-003 — File des demandes en attente

- Étapes : Ouvrir la file avec deux demandes.
- Attendu : Chaque ligne dit qui, quoi, quelle porte, le diff envoyé par le hook ; demande inconnue : 404.
- Surfaces : web, serveur
- Source : proto/server/src/yes/yes.test.ts premier et troisième tests
- Priorité : P1
- Statut : bloqué : ostrom-web

### E2E-WEB-004 — Le lien du check GitHub mène à la demande, le reçu s'y affiche

- Étapes : Suivre `details_url` du check `ostrom-gate`.
- Attendu : `/yes/<approvalId>` ; après la décision le reçu s'affiche.
- Surfaces : web, faux GitHub
- Source : proto/COORD/GATE-GITHUB.md « Ce qui a changé dans le code » (lien du check)
- Priorité : P2
- Statut : bloqué : ostrom-web

### E2E-WEB-005 — Console : sessions, portes, coût, lien depuis une notification

- Étapes : Ouvrir `/console/sessions?session=<id>`.
- Attendu : La session s'ouvre avec ses portes, ses reçus, son coût et le badge self-approved le cas échéant.
- Surfaces : web (Playwright)
- Source : proto/COORD/NOTIFY-DISCORD.md (lien du message) ; proto/COORD/APPROBATION.md §1 ; proto/COORD/CONSOLE.md
- Priorité : P1
- Statut : bloqué : ostrom-web

### E2E-WEB-006 — Responsive et thèmes de la page du oui et de la console

- Étapes : 390 px et 1440 px, clair et sombre, sur les écrans du oui, des sessions et des réglages.
- Attendu : Aucun débordement horizontal, aucune erreur console.
- Surfaces : web (Playwright)
- Source : proto/COORD/CONNEXION.md « Intégration » ; proto/COORD/ONBOARDING.md ; proto/scripts/yes_captures.py
- Priorité : P2
- Statut : bloqué : ostrom-web


## APP : Oui depuis l'app mobile

### E2E-APP-001 — Boîte « Waiting for you » dans l'app

- Étapes : Une porte demande un oui à l'utilisateur de l'app (Maestro sur Android).
- Attendu : La demande apparaît dans la liste avec porte, dépôt, demandeur ; le détail montre commits et diff.
- Surfaces : app, serveur
- Source : proto/COORD/PLATEFORME.md §1 #22 (app mobile centrée sur le oui) ; amont/COORD/AMONT-TEAMCODE.md §0 (section « Waiting for you » des compagnons)
- Priorité : P1
- Statut : bloqué : ostrom-app

### E2E-APP-002 — Oui depuis l'app : reçu signé

- Étapes : Ouvrir la demande et valider (biométrie simulée).
- Attendu : Reçu signé au nom du membre, le hook du dev se débloque, le reçu est consultable dans l'app.
- Surfaces : app, serveur, faux agent
- Source : proto/COORD/PLATEFORME.md §1 #22 ; proto/COORD/APPROBATION.md §5
- Priorité : P1
- Statut : bloqué : ostrom-app

### E2E-APP-003 — Non depuis l'app

- Étapes : Refuser avec une raison.
- Attendu : Reçu de refus signé ; l'agent lit le refus.
- Surfaces : app, serveur
- Source : cli/COORD/CLI.md §3.3 (deny)
- Priorité : P2
- Statut : bloqué : ostrom-app

### E2E-APP-004 — Auto-approbation et décideur non désigné refusés dans l'app

- Étapes : Le demandeur ouvre sa propre demande dans l'app.
- Attendu : Bouton Oui absent ou refusé avec le message « Refused by Ostrom » ; aucune décision enregistrée.
- Surfaces : app, serveur
- Source : proto/COORD/APPROBATION.md §1
- Priorité : P1
- Statut : bloqué : ostrom-app

### E2E-APP-005 — Premier oui ferme la demande dans l'app des autres

- Étapes : Deux approbateurs avec l'app ; l'un valide.
- Attendu : La demande de l'autre passe à « décidé par X ».
- Surfaces : app, serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 4
- Priorité : P1
- Statut : bloqué : ostrom-app

### E2E-APP-006 — Notification push à la demande de oui

- Étapes : Une porte est demandée.
- Attendu : L'approbateur reçoit une notification qui ouvre la demande ; aucun secret ni diff complet dans la notification.
- Surfaces : app, serveur
- Source : proto/COORD/PLATEFORME.md §1 #22 ; proto/COORD/PLATEFORME.md §3 (surfaces)
- Priorité : P2
- Statut : bloqué : ostrom-app + ostrom-server


## RESUME : Reprise de session

### E2E-RESUME-001 — `--resume` ouvre un segment chaîné avec son reçu

- Étapes : Lancer, pousser (porte), quitter ; relancer avec le même `session_id` d'agent, pousser.
- Attendu : Segments `<id>`, `<id>~r2` : `resumedFrom`, `previousReceiptId`, `segment` signés ; chaque reçu porte ses propres portes ; le premier reste à 0 porte si rien n'y a été fait.
- Surfaces : CLI, serveur, faux agent
- Source : proto/server/src/bridge/gate-integrity.test.ts « bug 5: a resumed session is a new segment with its own receipt, chained to the one before » ; proto/COORD/VERIF-LANCEUR.md §3 bug 5 ; proto/COORD/CORRECTIFS.md passe 2 bug 4
- Priorité : P1
- Statut : bloqué : ostrom-server (sessions à segments) + ostrom-cli

### E2E-RESUME-002 — Les hooks d'une reprise envoient le segment donné par le serveur

- Étapes : Lancer un faux agent avec reprise ; relever l'id de session dans chaque appel de hook.
- Attendu : Tous les hooks envoient le segment d'Ostrom (table id d'agent -> id Ostrom à côté du fichier de session).
- Surfaces : CLI
- Source : proto/launcher/tests/resume_segment.rs `the_hooks_of_a_resumed_launch_send_the_segment_ostrom_gave_it`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-RESUME-003 — Même lancement après `/compact` : même segment ; ancien segment resté ouvert : clos « superseded »

- Étapes : Redémarrer l'agent dans le même lancement ; puis un nouveau lancement alors que le précédent n'a pas fini.
- Attendu : Même lancement : même segment ; lanceur mort : le segment est clos « superseded » avant d'en ouvrir un nouveau.
- Surfaces : CLI, serveur
- Source : proto/COORD/CORRECTIFS.md passe 2 bug 4 ; amont/compat/vectors (reçu `session-resume-superseded`)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-RESUME-004 — Quatre lancements, quatre segments chaînés, reçus vérifiés hors ligne

- Étapes : Une session lancée puis reprise trois fois ; `ostrom verify` sur chaque reçu de workflow.
- Attendu : Segments `~r2`, `~r3`, `~r4` ; chacun vérifié hors ligne (exit 0) ; les portes se répartissent dans le bon segment.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/CORRECTIFS.md passe 2 « Passage réel » (Reprise, bug 4)
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-RESUME-005 — Le oui ne survit pas à une reprise

- Étapes : Oui au commit A dans le segment 1 ; reprise ; même commit A.
- Attendu : Nouvelle demande dans le nouveau segment.
- Surfaces : serveur
- Source : proto/COORD/CORRECTIFS.md passe 2 « Ce qui reste » et « Questions pour Lyes »
- Priorité : P2
- Statut : bloqué : ostrom-server


## WAKE : Réveil : signe de vie, session close, fenêtre de réveil

### E2E-WAKE-001 — Signe de vie : session muette close avec reçu « launcher lost »

- Étapes : Lanceur qui a donné signe de vie puis se tait plus de 120 s (délais réglés pour le test) ; code de sortie du lanceur conservé.
- Attendu : La session est close avec un reçu signé « launcher lost » ; une session qui n'a jamais donné signe de vie (ancien lanceur) n'est jamais coupée.
- Surfaces : serveur, faux agent
- Source : proto/server/src/bridge/gate-integrity.test.ts « sign of life: a session whose launcher stops answering is closed with a receipt; the exit code is kept » ; proto/COORD/CORRECTIFS.md passe 2 bug 8a
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WAKE-002 — Une session close pour silence ne prend plus de oui ; le lanceur réveillé rouvre un segment

- Étapes : Session close pour silence ; le lanceur envoie une porte.
- Attendu : 409 « session closed » ; `alive` répond `lost: true` ; `POST /reopen` ouvre le segment suivant du même lancement, chaîné, idempotent ; la porte est demandée dans ce segment.
- Surfaces : serveur, CLI
- Source : proto/server/src/bridge/gate-integrity.test.ts « CORRECTIFS-3 (8a): a session closed for silence takes no yes; its launcher, back, reopens a chained segment » ; proto/launcher/tests/wake_reopen.rs `a_gate_asked_in_a_session_closed_for_silence_reopens_a_segment_and_is_asked_there` ; proto/bridge/test/wake-reopen.test.mjs premier test
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-WAKE-003 — Lanceur de retour de veille : signe de vie, session rouverte, fin avec le code de sortie

- Étapes : Suspendre le lanceur au-delà du délai, le réveiller, laisser l'agent finir.
- Attendu : Le lanceur rouvre sa session, le nouveau segment se termine avec le code de sortie ; (variante Node et variante native).
- Surfaces : CLI, serveur
- Source : proto/launcher/tests/wake_reopen.rs `the_launcher_back_from_sleep_reopens_its_session_and_ends_the_new_segment` ; proto/bridge/test/wake-reopen.test.mjs second test
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-WAKE-004 — Fenêtre du réveil : résultats de check refusés puis renvoyés dans le segment rouvert

- Étapes : Entre le réveil et le premier signe de vie, le faux agent envoie un résultat de check (seul puis en lot).
- Attendu : 409 « session closed » (rien du lot n'est gardé) puis renvoi du même corps dans le segment rouvert, avec l'id relu à chaque envoi ; le reçu signé du segment perdu ne change pas.
- Surfaces : serveur, CLI, faux agent
- Source : corr/server/src/bridge/wake-window.test.ts « CORRECTIFS-4: a check result sent between the wake-up and the first sign of life ... » ; corr/bridge/test/wake-window.test.mjs « a check result refused by the session closed for silence reopens a segment ... » ; corr/launcher/tests/wake_window.rs `check_results_refused_by_a_session_closed_for_silence_...`
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli (branche fix/wake-window non fusionnée)

### E2E-WAKE-005 — Fenêtre du réveil : notifications et « skill ouvert »

- Étapes : Dans la fenêtre, le faux agent déclenche une notification et ouvre un skill.
- Attendu : 409, rien n'est envoyé ni enregistré dans la session close ; les deux sont renvoyés une seule fois dans le segment rouvert.
- Surfaces : serveur, CLI, faux agent
- Source : corr/server/src/bridge/wake-window.test.ts « CORRECTIFS-4: notifications and "skill opened" sent in the window ... » ; corr/bridge/test/wake-window.test.mjs « a notification refused ... once » ; corr/launcher/tests/wake_window.rs `notifications_refused_...`, `a_skill_opened_in_the_window_is_recorded_in_the_reopened_segment`
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-WAKE-006 — Refus d'une porte : `lost` distingue silence et fin voulue

- Étapes : Porte demandée dans une session close pour silence, puis dans une session que l'agent a finie lui-même.
- Attendu : Le corps porte `lost: true` pour la première, pas pour la seconde.
- Surfaces : serveur
- Source : corr/server/src/bridge/wake-window.test.ts « CORRECTIFS-4: a gate refused by a session closed for silence says `lost`; a session the agent ended says it is not »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WAKE-007 — `node_done` dans la fenêtre : segment rouvert du lancement

- Étapes : Appel `node_done` pendant la fenêtre.
- Attendu : Enregistré dans le segment rouvert du même lancement (même dev par le jeton, même lancement par l'en-tête), jamais dans le segment clos ; le MCP du pont n'inscrit pas d'appel dans une session close.
- Surfaces : serveur, faux agent
- Source : corr/server/src/bridge/wake-window.test.ts « CORRECTIFS-4: node_done in the window lands in the reopened segment of its launch, never in the closed one » ; corr/COORD/CORRECTIFS.md passe 4 point 1
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WAKE-008 — Hors lanceur : pas de signe de vie, réouverture par la porte

- Étapes : Plugin installé à la main (sans `OSTROM_LAUNCH_ID`) : SessionEnd puis une porte.
- Attendu : La session n'est jamais close pour silence ; une porte après SessionEnd rouvre un segment, idempotent à chaque porte suivante.
- Surfaces : serveur, faux agent
- Source : corr/COORD/CORRECTIFS.md passe 3 « Ce qui reste » (dernier point) ; proto/COORD/CORRECTIFS.md passe 3 point 3
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WAKE-009 — Portable en veille plus de 2 minutes : rien n'échappe aux reçus ensuite

- Étapes : Délai de 120 s dépassé ; le lanceur se réveille et agit.
- Attendu : Tout ce qui suit est dans un segment rouvert et son reçu ; Ostrom injoignable au moment du `/reopen` : le résultat de check est perdu pour les reçus mais l'action suit la décision du check (limite connue, à tester et dire).
- Surfaces : serveur, CLI
- Source : corr/COORD/CORRECTIFS.md passe 4 « Ce qui reste » ; proto/COORD/CORRECTIFS.md passe 2 « Questions pour Lyes » (120 s)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli


## RECEIPT : Reçu signé et vérification hors ligne

### E2E-RECEIPT-001 — `ostrom verify` d'un reçu de porte, hors ligne

- Étapes : Après E2E-GATE-001, `OSTROM_URL` pointant sur un port fermé, `ostrom verify <receipt>`.
- Attendu : `VERIFIED offline`, exit 0 ; chaîne des oui vérifiée (« approved by X, the same in both receipts »).
- Surfaces : CLI
- Source : proto/COORD/GATE-GITHUB.md (t = 50,3 s) ; proto/COORD/VERIF-LANCEUR.md §1 (gate → hook + oui + reçu) ; cli/COORD/CLI.md §1a (verify)
- Priorité : jalon
- Statut : codé : `scenarios/jalon.e2e.ts`, lancé quand `OSTROM_E2E_JALON=1` (bloqué : ostrom-cli (verify) + ostrom-server (reçus))

### E2E-RECEIPT-002 — `ostrom verify` d'un reçu de workflow et de son paquet

- Étapes : Vérifier le reçu de workflow d'une session avec check, porte, notification, sous-agent.
- Attendu : Signature, paquet cité (version et empreinte), reçu de session et reçu de porte vérifiés ; lignes ✓ ; exit 0.
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `a_signed_workflow_bundle_verifies` ; proto/COORD/VERIF-LANCEUR.md § Preuves (reçus vérifiés hors ligne en 0)
- Priorité : jalon
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-003 — Reçu de session signé à la fin

- Étapes : Fin de session normale.
- Attendu : Reçu cite harnais, portes demandées, décisions, règles en vigueur, modèle, coût mesuré, `exitCode` ; signature valide en ligne (`/api/receipts/:id/verify`).
- Surfaces : serveur
- Source : proto/server/src/selftest.ts « decision signs a receipt and closes the task » (coût et modèle gardés) ; proto/COORD/PONT.md « Un reçu par session »
- Priorité : jalon
- Statut : bloqué : ostrom-server

### E2E-RECEIPT-004 — Reçu modifié, signature modifiée

- Étapes : Changer `decisions[0].result`, `subject.digest`, un octet de la signature.
- Attendu : `verifyReceipt` faux ; `ostrom verify` : `NOT VALID`, exit 1.
- Surfaces : CLI, serveur
- Source : proto/server/src/selftest.ts « a tampered receipt fails verification » ; proto/launcher/src/verify.rs `a_modified_field_is_caught`, `a_modified_signature_is_caught`
- Priorité : jalon
- Statut : bloqué : ostrom-core + ostrom-cli

### E2E-RECEIPT-005 — Autre clé, clé du fichier non fiable

- Étapes : Vérifier avec une autre clé publique ; avec la clé posée dans le lot lui-même.
- Attendu : Autre clé : refusé ; la clé fournie par le fichier n'est pas fiable (clé épinglée ou `--key` seulement).
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `another_key_does_not_verify`, `a_key_from_the_file_is_not_trusted`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-006 — Paquet absent, échangé ou de mauvaise version

- Étapes : Lot sans paquet ; paquet échangé ; reçu signé citant la mauvaise version.
- Attendu : Absent : `INCOMPLETE`, exit 2 ; échangé et mauvaise version : détectés.
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `a_missing_package_is_incomplete`, `a_swapped_package_is_caught`, `a_signed_receipt_citing_the_wrong_version_is_caught`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-007 — Reçu de porte manquant ou forgé

- Étapes : Reçu de session qui cite une porte dont le reçu manque ; reçu de porte forgé.
- Attendu : Manquant : incomplet ; forgé : détecté.
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `a_missing_gate_receipt_is_incomplete`, `a_forged_gate_receipt_is_caught`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-008 — Auto-approbation dite par `verify`, désaccord entre reçus

- Étapes : Reçu auto-approuvé ; reçu de session qui cache la marque alors que le reçu de porte la porte.
- Attendu : `SELF-APPROVED: X asked for this action and was its only approver` ; le désaccord est `Bad`.
- Surfaces : CLI
- Source : proto/COORD/APPROBATION.md §1 (`ostrom verify`) ; proto/launcher/src/verify.rs `a_self_approved_yes_is_said_out_loud` ; proto/launcher/tests/vectors/self-approved.json
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-009 — Reçu nu, codes de sortie, sortie JSON

- Étapes : `verify` d'un reçu seul ; reçu introuvable ; option inconnue ; `--json`.
- Attendu : Signature vérifiée seule ; 66 introuvable ; 64 usage ; sortie JSON stable.
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `a_bare_receipt_verifies_its_signature` ; cli/COORD/CLI.md §1a et §2.3
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-010 — Nombres et Unicode du serveur vérifient dans le vérificateur

- Étapes : Vecteurs `odd-numbers.json`.
- Attendu : Nombres écrits comme JavaScript, tri des clés, Unicode ; tous vérifient.
- Surfaces : CLI
- Source : proto/launcher/src/verify.rs `numbers_are_written_like_javascript`, `canonical_sorts_keys_and_drops_spaces`, `server_numbers_and_unicode_verify`
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-RECEIPT-011 — Reçu de workflow : ce que chaque nœud a fait, skill livré/lu, sous-agent lancé

- Étapes : Session avec step, check échoué puis passé, porte, notify, agent.
- Attendu : Lignes « passed after 1 failure », « yes from X », « sent to <canal> », « skill opened at HH:MM (whether it was followed is not checked) » ou « delivered as a skill; no sign it was opened », « done: ... (sub-agent started at HH:MM) » ou « not reported ».
- Surfaces : serveur, CLI
- Source : proto/server/src/bridge/gate-integrity.test.ts « 8: the receipt tells a skill delivered from a skill opened, and a reported review from a sub-agent that ran » ; proto/launcher/src/main.rs `seen_of_reads_skills_opened_and_sub_agents_started` ; proto/COORD/VERIF-LANCEUR.md §3 bug 8
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli


## COMPAT : Compatibilité à l'octet avec les vecteurs d'or

### E2E-COMPAT-001 — Le serveur reproduit chaque vecteur à l'octet

- Étapes : Rejouer le générateur (horloge figée, UUID dérivés, clé de test) sur le serveur natif et comparer chaque fichier de `vectors/`.
- Attendu : Chaque fichier identique octet pour octet ; deux passages donnent les mêmes octets.
- Surfaces : serveur (+ banc)
- Source : amont/compat/compat.test.ts « the generator reproduces every committed vector byte for byte » ; amont/compat/README.md « Régénérer, tester »
- Priorité : jalon
- Statut : bloqué : ostrom-core + ostrom-server

### E2E-COMPAT-002 — Clé de test : graine, PKCS#8, SPKI, clé brute, kid

- Étapes : Importer la clé du vecteur.
- Attendu : PKCS#8 reconstruit de la graine, SPKI, clé brute et `kid` concordent.
- Surfaces : serveur
- Source : amont/compat/compat.test.ts « the test key: PKCS#8 from the seed, SPKI, raw key and kid agree » ; amont/compat/README.md « La clé de test »
- Priorité : jalon
- Statut : bloqué : ostrom-core

### E2E-COMPAT-003 — Formes canoniques : 12 cas

- Étapes : Rejouer `canonical.json`.
- Attendu : Texte canonique, octets UTF-8 et SHA-256 identiques : tri par unités UTF-16, échappements, surrogats isolés, U+2028, `-0`, `1e21`, `5e-324`, clés `undefined` omises.
- Surfaces : serveur
- Source : amont/compat/compat.test.ts « canonical forms: the README encoder gives the same text and bytes » ; amont/compat/README.md « Le format canonique (v1) » ; proto/launcher/tests/vectors/odd-numbers.json
- Priorité : jalon
- Statut : bloqué : ostrom-core

### E2E-COMPAT-004 — Reçus : signature Ed25519 déterministe, 9 reçus

- Étapes : Pour chaque reçu de `receipts.json`, vérifier avec la clé de test seule puis re-signer le corps.
- Attendu : Digest et signature vérifient ; la nouvelle signature est identique ; champ inconnu signé comme les autres ; `costUsd` à 17 chiffres (`cost-double`).
- Surfaces : serveur
- Source : amont/compat/compat.test.ts « receipts: canonical body, digest and Ed25519 signature verify with the test key only » ; amont/compat/README.md « Les reçus » (`odd-values`, `cost-double`)
- Priorité : jalon
- Statut : bloqué : ostrom-core

### E2E-COMPAT-005 — Reçu de porte lié au commit poussé ; segments chaînés

- Étapes : Rejouer `gate-push-sha`, `session-resume-*`, `session-wake-*`.
- Attendu : Le reçu de porte porte remote, ref, sha et la clé d'action ; les segments de reprise et de réveil se chaînent.
- Surfaces : serveur
- Source : amont/compat/compat.test.ts « the gate receipt binds the pushed commit; the resumed and reopened segments chain to the receipt before them » ; amont/compat/README.md tableau des reçus
- Priorité : jalon
- Statut : bloqué : ostrom-core + ostrom-server

### E2E-COMPAT-006 — Paquet servi tel qu'il a été signé

- Étapes : Compiler l'entrée de `private/package.json` ; comparer `payload` ; servir le paquet.
- Attendu : `payload` identique à l'octet ; digest, signature (sans préfixe `ed25519;`) et sha256 de chaque fichier vérifient ; le serveur sert les octets signés sans les re-sérialiser.
- Surfaces : serveur
- Source : amont/compat/compat.test.ts « package: payload is canonical, its digest and signature verify, each file has its sha256 » ; amont/compat/README.md « Paquet » ; fusion/COORD/FUSION-TEAMCODE.md D4 et T4
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-COMPAT-007 — Le vérificateur natif accepte les vecteurs du serveur

- Étapes : `ostrom verify` sur chaque reçu et l'enveloppe du paquet des vecteurs `neutral/`.
- Attendu : Tous vérifiés hors ligne (exit 0) ; non fait dans le prototype.
- Surfaces : CLI
- Source : amont/compat/README.md « Suites » (Rust) ; proto/launcher/dev/verify-vectors.mts
- Priorité : jalon
- Statut : bloqué : ostrom-cli

### E2E-COMPAT-008 — Ordre des fichiers du paquet et des workflows par unités de code

- Étapes : Compiler un paquet avec `ostrom_second_look.toml` et `ostrom_second.toml`.
- Attendu : Ordre par unités de code (pas de collation ICU) ; mêmes octets sur toute plateforme.
- Surfaces : serveur
- Source : amont/compat/README.md « Pièges » 1 (`filesSortedByLocaleCompare`)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-COMPAT-009 — Slug NFKD non latin, texte des notifications

- Étapes : Compiler des noms de nœud non latins ; notification avec `{session}`.
- Attendu : `slug()` : NFKD puis `[a-z0-9]`, mêmes octets ; `{session}` remplacé par les 8 premiers caractères.
- Surfaces : serveur
- Source : amont/compat/README.md « Pièges » 2 et 3
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-COMPAT-010 — Vecteurs manquants à produire

- Étapes : Ajouter : oui auto-approuvé, fusion de PR (`prKey`), refus, porte en ombre, workflow proposé.
- Attendu : Ces cas ont un vecteur d'or chacun, vérifié par le serveur et le CLI.
- Surfaces : serveur, CLI
- Source : amont/compat/README.md « Pièges » 4 ; proto/launcher/tests/vectors/self-approved.json
- Priorité : P1
- Statut : bloqué : ostrom-e2e + ostrom-core

### E2E-COMPAT-011 — Clé d'une instance importée : même `kid`

- Étapes : Importer une instance du prototype (clé de signature, reçus, paquets).
- Attendu : Même `kid` ; les anciens reçus vérifient avec la clé publique de l'instance ; aucun paquet à ré-épingler.
- Surfaces : serveur, CLI
- Source : fusion/COORD/FUSION-TEAMCODE.md D3, T13 ; proto/COORD/CORRECTIFS.md « Ce qui reste » (receipt-key.json non chiffrée volontairement)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-COMPAT-012 — Décision signée : coût et modèle gardés, reçu de décision

- Étapes : Reçu provisoire de l'agent (modèle, coût) puis décision de oui.
- Attendu : Le reçu de décision garde `costUsd` et `model`, `decisions[0].approvalId` correct, vérification ok.
- Surfaces : serveur
- Source : proto/server/src/selftest.ts « decision signs a receipt and closes the task »
- Priorité : P1
- Statut : bloqué : ostrom-core


## GHCHECK : Check GitHub `ostrom-gate`

### E2E-GHCHECK-001 — PR vers une branche protégée : check en attente, fusion refusée

- Étapes : Faux GitHub avec ruleset ; PR ouverte vers `main`.
- Attendu : Check `ostrom-gate` `pending` « Waiting for a yes from ... » sur le sha de tête ; `gh pr merge` refusé (« base branch policy prohibits the merge »).
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/GATE-GITHUB.md tableau (19,1 s et 22,3 s) ; proto/COORD/ARCHI.md § check (PR #101)
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-e2e (faux GitHub)

### E2E-GHCHECK-002 — Oui : check vert avec le reçu, fusion acceptée

- Étapes : Un approbateur dit oui.
- Attendu : `success` « Approved by X · receipt ... », PR `clean`, fusion acceptée.
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/GATE-GITHUB.md tableau (34,1 à 44,6 s)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-003 — Non : check en échec, fusion bloquée

- Étapes : Un approbateur dit non.
- Attendu : `failure` « Refused by X » avec reçu ; la fusion reste bloquée.
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/GATE-GITHUB.md « le chemin du non » (PR #1, PR #4)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-004 — Nouveau commit sur la PR : nouvelle demande

- Étapes : Pousser un commit de plus sur la PR approuvée.
- Attendu : Nouveau sha, nouvelle demande `pending` ; l'ancien oui ne couvre que l'ancienne tête.
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/APPROBATION.md §3 ; proto/COORD/ARCHI.md § check
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-005 — Webhook falsifié refusé, Ostrom injoignable : fusion bloquée

- Étapes : Webhook sans bonne signature `X-Hub-Signature-256` ; serveur arrêté pendant qu'une PR s'ouvre.
- Attendu : 401 pour le faux ; sans serveur aucun check n'est créé et GitHub considère le check requis absent : fusion refusée (échec fermé) ; au redémarrage les livraisons sont rejouées.
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/ARCHI.md § check (prototype `check-sim.mjs`, 9 étapes) ; proto/COORD/GATE-GITHUB.md « Non-régression du check run »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-006 — Check « Logged » (workflow proposé) redemandé à l'acceptation

- Étapes : Check vert « Logged (gate not decided yet) » vu par le relevé, puis par le webhook ; le workflow passe `accepted`.
- Attendu : Nouveau check run, « Waiting for a yes » ; une PR fermée, fusionnée ou passée à un autre sha n'est pas redemandée ; jamais deux fois le même check.
- Surfaces : serveur, faux GitHub
- Source : proto/server/src/yes/approval.test.ts « a green "Logged" check (gate of a proposed workflow) is asked again once the workflow is accepted » et « ... seen by the webhook (no PR poll) goes back to pending as soon as its workflow is accepted » ; proto/COORD/CORRECTIFS.md passe 1 §1
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-007 — Deux modes de publication et relevé sans webhook

- Étapes : Mode check run (app) ; mode commit status (jeton) ; relevé des PR toutes les 4 s.
- Attendu : Les deux modes bloquent la fusion ; un commit déjà tenu n'est pas redemandé ; le oui ou le non met à jour le check ; `OSTROM_GITHUB_GATE_MODE` force le mode.
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/GATE-GITHUB.md « Ce qui a changé dans le code » et « Ce qui manque » 1 et 2
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-GHCHECK-008 — Film à deux personnes de bout en bout

- Étapes : Dev (faux agent) : push, PR, `gh pr merge` ; auto-oui refusé ; `reviewer-local` dit oui ; relance.
- Attendu : Hook et check partagent une demande ; auto-oui refusé 403 ; oui signé ; check vert ; PR fusionnée ; `ostrom verify` hors ligne 0 ; fin : « requests for PR ... : 1 · asked via hook + ci ».
- Surfaces : CLI, serveur, web, faux GitHub, faux agent
- Source : proto/COORD/APPROBATION.md §5 (tableau t=3 à 62,2 s) ; proto/launcher/dev/film-gate-2p.py (arrêts de cohérence)
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli + ostrom-e2e


## FOREIGN : Dépôt étranger

### E2E-FOREIGN-001 — Commande gardée dans un autre clone : refusée, deux dépôts nommés

- Étapes : Session ouverte pour le dépôt A ; commande gardée dont le cwd (ou un `cd` de tête, ou `git -C`) est le dépôt B.
- Attendu : Refus qui nomme les deux dépôts (`owner/name`) et le dossier ; personne n'est demandé ; le diff d'un push est lu là où la commande tourne.
- Surfaces : CLI, faux agent
- Source : proto/launcher/tests/foreign_repo.rs `a_guarded_command_in_another_repository_is_refused_and_the_yes_shows_the_real_repository` ; proto/bridge/test/repo-guard.test.mjs « a guarded command run in another clone is refused, both repositories named, nobody asked » ; proto/COORD/CORRECTIFS.md passe 1 §2
- Priorité : jalon
- Statut : bloqué : ostrom-cli

### E2E-FOREIGN-002 — Dans le dépôt de la session : porte demandée avec le dépôt réel

- Étapes : Même commande dans le bon clone.
- Attendu : La porte est demandée, `realRepo` est envoyé.
- Surfaces : CLI, serveur
- Source : proto/bridge/test/repo-guard.test.mjs « in the session's own repository the gate is asked, with the repository the command really runs in »
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-FOREIGN-003 — Lecture du dépôt de la commande : `cd`, `git -C`, toutes les écritures de remote

- Étapes : `cd ../b && git push`, `git -C ../b push`, remotes `https://`, `git@`, `ssh://`, avec `.git` ou non.
- Attendu : Le dépôt est nommé comme `owner/name` ; `commandDir` et `slugOfUrl` donnent la même chose dans toutes les implémentations.
- Surfaces : CLI
- Source : proto/launcher/src/main.rs tests `foreign_repo_sees_a_command_run_in_another_clone`, `foreign_repo_reads_git_dash_c_and_names_both_repositories`, `slug_of_url_reads_every_remote_spelling`, `outgoing_diff_shows_unpushed_commits_and_is_cut` ; proto/bridge/test/repo-guard.test.mjs `slugOfUrl and commandDir read like the native launcher`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-FOREIGN-004 — Le serveur refuse une demande dont le dépôt réel diffère

- Étapes : Un client forge une demande de porte avec `realRepo` différent du dépôt de la session.
- Attendu : Refus côté serveur (recommandation de CORRECTIFS : aujourd'hui seulement affiché) ; le test dépend d'une décision de Lyes.
- Surfaces : serveur
- Source : proto/COORD/CORRECTIFS.md passe 1 « Questions pour Lyes » 1
- Priorité : P1
- Statut : bloqué : ostrom-server


## CACHE : Cache des checks

### E2E-CACHE-001 — Check passé, mis en cache par commit poussé

- Étapes : Deux pushs du même commit, entre les deux aucun changement.
- Attendu : Le second ne relance pas le script (cache) ; le résultat est tout de même envoyé ; le cache est sur le commit poussé, pas sur l'état de l'arbre.
- Surfaces : CLI, faux agent
- Source : proto/COORD/HOOK-DISPATCH.md §2 et §3 ; proto/COORD/CORRECTIFS.md passe 2 bug 1 (succès mis en cache par commit)
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CACHE-002 — Seconde édition d'un fichier déjà modifié : le check repasse

- Étapes : Modifier `a.py`, check passe ; modifier `a.py` à nouveau.
- Attendu : Le check est relancé (la clé regarde le contenu, pas la liste de fichiers).
- Surfaces : CLI, faux agent
- Source : proto/launcher/tests/check_cache.rs `a_second_edit_of_an_already_modified_file_runs_the_passed_check_again` ; proto/COORD/HOOK-DISPATCH.md §6.1
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CACHE-003 — Seconde édition cassée d'un fichier suivi : refusée

- Étapes : Même cas avec une seconde édition qui casse un test.
- Attendu : Refus avec la sortie du test.
- Surfaces : CLI, faux agent
- Source : proto/launcher/tests/check_cache.rs `a_broken_second_edit_of_a_modified_tracked_file_is_refused`
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-CACHE-004 — Contenu des chemins renommés, avec espaces, non suivis, gros fichiers, liens

- Étapes : Modifier un fichier renommé, un chemin à espaces/guillemets, un fichier non suivi, un fichier de plus de 1 Mio, un lien symbolique, supprimer un fichier.
- Attendu : Chaque changement change la clé ; plus de 1 Mio : taille, inode et dates en ns ; lien : sa cible ; supprimé : `gone` ; un seul `git status -z`.
- Surfaces : CLI
- Source : proto/launcher/src/package.rs tests `tree_state_reads_the_content_of_renamed_spaced_and_untracked_paths`, `tree_state_reads_head_and_tree_from_one_git_status_and_sees_a_change` ; proto/COORD/HOOK-DISPATCH.md §6.1
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CACHE-005 — Catalogue des portes : servi, rafraîchi en fond avant l'échéance, jamais plus vieux que le délai

- Étapes : Faux serveur qui répond au catalogue en 1,5 s avec une porte ajoutée sur `deploy-x` ; appels à 10 %, 75 % et 120 % du délai de 30 s.
- Attendu : Copie fraîche : aucune demande ; entre TTL/6 et TTL : réponse sans attendre, copie réécrite en fond (écriture atomique, un rafraîchissement à la fois), l'action suivante est arrêtée par la nouvelle porte ; copie plus vieille que le délai : relue dans l'appel et l'action est arrêtée (code 2).
- Surfaces : CLI, serveur
- Source : proto/launcher/tests/gates_catalogue.rs ; proto/COORD/HOOK-DISPATCH.md §6.2 (garantie : une porte ajoutée n'est jamais manquée) et §4
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-CACHE-006 — Paquet révoqué : refus au lancement suivant, hooks en cours relisent sous 30 s

- Étapes : Révoquer le paquet depuis la console pendant une session.
- Attendu : Lancement suivant : 409 ; hooks de la session en cours : état relu au plus toutes les 30 s.
- Surfaces : serveur, CLI, web
- Source : proto/COORD/COMPILATEUR.md §5 (révocation)
- Priorité : P1
- Statut : bloqué : ostrom-server


## NOTIFY : Notifications Discord et Slack

### E2E-NOTIFY-001 — Notify Discord après l'action, message court sans secret

- Étapes : Nœud notify `discord:#release` ; push réel par le faux agent ; faux récepteur Discord.
- Attendu : Message posté après le push (jamais avant) : ≤ 300 caractères, lien vers la session, reçu signé à la fin, aucune mention, secrets de la commande masqués ; le gabarit n'a que `{dev} {repo} {command} {session}`.
- Surfaces : serveur, CLI, faux Discord
- Source : proto/server/src/discord/discord.test.ts « channel names and webhook URLs » ; « secrets in the text are masked; the message is short and pings nobody » ; « a decided notify node to discord:#release: Ostrom posts it ... » ; proto/COORD/NOTIFY-DISCORD.md tableau
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-002 — Le webhook est un secret : jamais rendu, jamais dans le paquet, jeton de poste refusé

- Étapes : Coller le webhook en opérateur, relire l'API, le workflow, le paquet ; essayer avec un jeton `ost_`.
- Attendu : On ne voit que les 4 derniers chiffres de l'identifiant ; paquet sans URL ni jeton ; jeton de poste : 403.
- Surfaces : serveur
- Source : proto/server/src/discord/discord.test.ts « a device token cannot set a webhook; an operator can, and the URL never comes back »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-003 — Pas de webhook : non envoyé avec la raison, rien ne casse

- Étapes : Notify vers un salon sans webhook.
- Attendu : `not-sent` avec la raison, visible dans la session ; l'agent n'est pas ralenti.
- Surfaces : serveur, faux Discord
- Source : proto/server/src/discord/discord.test.ts « no webhook for the channel: not sent, with the reason, and nothing breaks »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-004 — Webhook supprimé (404) et limite de débit (429)

- Étapes : Faux récepteur : jeton `gone`, jeton `slow`.
- Attendu : 404 : « paste a new one », pas de nouvel essai ; 429 : un seul nouvel essai après `retry_after` plafonné.
- Surfaces : serveur, faux Discord
- Source : proto/server/src/discord/discord.test.ts « webhook deleted on Discord (404) and rate limit (429, retried once) » et « a 429 is retried after the retry_after Discord gives (capped at the last delay of the series), then goes »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-005 — Le hook est répondu avant Discord

- Étapes : Discord met 2 s à répondre.
- Attendu : La route du hook répond sans attendre Discord ; l'agent n'est pas retenu.
- Surfaces : serveur, faux Discord
- Source : proto/server/src/discord/discord.test.ts « the hook is answered before Discord: a Discord that takes 2 s does not hold the route » ; proto/COORD/NOTIFY-DISCORD.md « Suites »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-006 — Échecs passagers (500) réessayés en fond ; essais épuisés

- Étapes : Faux récepteur qui répond 500 plusieurs fois.
- Attendu : Réessais en arrière-plan, la session dit à quel essai c'est parti ; essais épuisés : non envoyé, avec raison et nombre d'essais.
- Surfaces : serveur, faux Discord
- Source : proto/server/src/discord/discord.test.ts « passing failures (500) are retried in the background; the session says on which attempt it went » et « retries used up: not sent, with the reason and the number of attempts; a deleted webhook is not retried »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-007 — Notification en file au redémarrage

- Étapes : Arrêter le serveur avec une notification en file, le relancer.
- Attendu : Elle part au démarrage, une seule fois.
- Surfaces : serveur
- Source : proto/server/src/discord/discord.test.ts « a notification still queued when the server stopped is sent when it starts again »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-008 — Bouton de test et suppression du webhook

- Étapes : Console : Send a test, Replace, suppression.
- Attendu : Test posté dans le faux salon ; remplacement ; suppression : la ligne disparaît.
- Surfaces : web, serveur, faux Discord
- Source : proto/server/src/discord/discord.test.ts « test button and removal » ; proto/COORD/NOTIFY-DISCORD.md (console)
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-NOTIFY-009 — Lot de notifications dans l'ordre, une défaillante n'arrête pas les autres

- Étapes : Action avec 3 notifications, la deuxième échoue.
- Attendu : Ordre du paquet gardé ; les autres partent ; ancien serveur : repli un par un.
- Surfaces : serveur, CLI
- Source : proto/server/src/compiler/batch.test.ts « notify: the notifications of one action in one call, in order; one that fails does not stop the others » et « notify: an older Ostrom answers a batch... »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-010 — Canal Slack d'un notify et porte dans Discord (non faits dans le prototype)

- Étapes : Notify `slack:#release` ; demande de oui avec boutons dans Discord.
- Attendu : Message posté dans le salon Slack (bot invité) ; la porte peut se répondre depuis Discord (étude).
- Surfaces : serveur, faux Slack, faux Discord
- Source : proto/COORD/NOTIFY-DISCORD.md « Ce qui n'est pas fait » et « Étude : la porte (`gate`) qui demande son oui dans Discord »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-NOTIFY-011 — File d'envoi : 202 immédiat, reprises, au moins une fois, anti-doublon

- Étapes : Notify Discord avec Discord lent puis en échec ; relance du serveur pendant un envoi.
- Attendu : La route répond 202 `queued` (200 pour `log:`, ombre, Slack) ; essais après 2, 10, 60, 300 s ; l'état « queued ... attempt 2 failed ... sent (attempt 3) » est visible dans la session ; un message peut partir deux fois si le serveur est coupé en plein appel ; une notification `queued` ou `sent` ne repart pas au passage suivant.
- Surfaces : serveur, CLI, faux Discord
- Source : proto/COORD/NOTIFY-DISCORD.md « Suites (agent SUITES) » ; proto/COORD/HOOK-DISPATCH.md §6.3
- Priorité : P1
- Statut : bloqué : ostrom-server


## MCP : Relais MCP et MCP du harnais

### E2E-MCP-001 — MCP `ostrom` : `rules_for`, `request_approval`, `get_receipt`

- Étapes : Le faux agent appelle les trois outils en HTTP sans session, puis en stdio via `ostrom mcp`.
- Attendu : `rules_for(path)` classe les règles décidées du dépôt par recouvrement ; `request_approval` ouvre une demande (coopératif) ; `get_receipt` rend le reçu ; stdio et HTTP : même implémentation.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/PONT.md « Ce que contient un harnais exporté » (Serveur MCP) et « L'idée de départ, challengée » ; fusion/COORD/FUSION-TEAMCODE.md T5
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-MCP-002 — `node_done` : un outil par session, résumé au reçu

- Étapes : Sous-agent d'un nœud agent appelle `node_done`.
- Attendu : Résumé inscrit au reçu de workflow ; nœud hors paquet refusé.
- Surfaces : serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (c3) ; voir aussi E2E-BYPASS-012
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-MCP-003 — MCP d'équipe relayés avec un jeton éphémère par run

- Étapes : Un serveur MCP d'équipe configuré ; `ostrom claude` ; le faux agent appelle un outil du serveur.
- Attendu : L'outil répond par le relais du serveur ; aucun secret du serveur MCP n'arrive sur le poste ; le jeton est propre au run et rien n'est écrit en clair.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 « MCP de l'équipe » ; fusion/COORD/FUSION-TEAMCODE.md 1a (Passerelle MCP)
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-MCP-004 — Outils autorisés par variante, limites et journal

- Étapes : Deux variantes, outil non autorisé, volume d'appels.
- Attendu : Outil hors variante refusé ; limites respectées ; appels journalisés.
- Surfaces : serveur, faux agent
- Source : proto/COORD/PLATEFORME.md #10 et #11 ; fusion/COORD/FUSION-TEAMCODE.md 1a (Variantes ENV et MCP)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-MCP-005 — Porte sur un appel d'outil MCP

- Étapes : Un outil dangereux (rembourser, déployer) est couvert par une porte.
- Attendu : L'appel attend un oui humain et se débloque après lui.
- Surfaces : serveur, faux agent
- Source : proto/COORD/PLATEFORME.md #10 (« une porte sur un appel d'outil »)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-MCP-006 — Outils MCP du pont dans une session close

- Étapes : Appel `rules_for`/`request_approval` après fermeture pour silence.
- Attendu : Aucun appel n'est inscrit dans la session close.
- Surfaces : serveur
- Source : corr/COORD/CORRECTIFS.md passe 4 point 1
- Priorité : P2
- Statut : bloqué : ostrom-server


## SECRETS : Secrets

### E2E-SECRETS-001 — Fichiers en clair relus puis réécrits chiffrés

- Étapes : Poser `slack.json` en clair ; démarrer.
- Attendu : Lu, réécrit chiffré (0600, rien de lisible), log « was stored in clear: rewritten encrypted ».
- Surfaces : serveur
- Source : proto/server/src/secrets.test.ts « Slack vendor and bot files in clear are read, then rewritten encrypted (0600, nothing readable left) »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SECRETS-002 — Toute écriture est chiffrée aussitôt

- Étapes : Enregistrer app Slack, app GitHub, installation.
- Attendu : Aucun contenu en clair sur disque.
- Surfaces : serveur
- Source : proto/server/src/secrets.test.ts « a write is encrypted at once: Slack vendor, GitHub app and installation »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SECRETS-003 — Dossier de l'app du check : clé propre

- Étapes : `OSTROM_GATE_APP_DIR` partagé entre deux instances jetables.
- Attendu : Clé `secret.key` du dossier de l'app, format partagé avec l'outil d'installation.
- Surfaces : serveur
- Source : proto/server/src/secrets.test.ts « the check app's folder (OSTROM_GATE_APP_DIR) has its own key ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-SECRETS-004 — Mauvaise clé ou clé absente : erreur claire, fichier intact

- Étapes : Démarrer avec une autre `OSTROM_SECRET_KEY`, puis sans clé.
- Attendu : Erreur nommant le fichier (« wrong key, or the file was changed »), rien modifié, aucune nouvelle clé par-dessus une clé perdue ; le serveur ne tombe pas.
- Surfaces : serveur
- Source : proto/server/src/secrets.test.ts « a wrong key or a missing key is a clear error, and the file is left as it is » ; proto/COORD/CORRECTIFS.md passe 1 §3
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SECRETS-005 — Webhooks Discord avec la même clé

- Étapes : Webhook Discord enregistré.
- Attendu : Même fonction de chiffrement, fichier sans l'URL ni le jeton, 0600.
- Surfaces : serveur
- Source : proto/server/src/secrets.test.ts « Discord webhooks still use the same key and function »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-SECRETS-006 — Aucun secret dans les journaux

- Étapes : Parcours complet (login, Slack, GitHub, notify) puis recherche de motifs `gh[opsu]_`, `xox`, `xapp-`, `BEGIN ... PRIVATE KEY`, URL de webhook dans tous les journaux et sorties du banc.
- Attendu : Aucun résultat.
- Surfaces : serveur, CLI
- Source : proto/server/src/secrets.test.ts « no secret in any log line of this run » ; proto/COORD/GATE-GITHUB.md « Aucun jeton dans les journaux »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-e2e

### E2E-SECRETS-007 — Variables d'équipe sans fichier en clair

- Étapes : Variante ENV avec une variable sensible ; `ostrom claude`.
- Attendu : La variable arrive à l'agent par l'environnement du run, relue périodiquement ; rien en clair dans un fichier du plugin.
- Surfaces : CLI, serveur
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Variables d'environnement assignées) ; proto/COORD/PLATEFORME.md #11
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-SECRETS-008 — Clé de signature des reçus en hébergé

- Étapes : Instance hébergée : clé de signature fournie par un gestionnaire de secrets.
- Attendu : Le serveur signe sans la lire d'un fichier en clair ; le `kid` est stable.
- Surfaces : serveur
- Source : proto/COORD/CORRECTIFS.md « Questions pour Lyes » 2 ; proto/COORD/CORRECTIFS.md « Pas chiffrés, volontairement »
- Priorité : P2
- Statut : bloqué : ostrom-server


## GW : Passerelle d'inférence, politique et budgets

### E2E-GW-001 — Inférence par la passerelle de l'équipe, clés du dev retirées

- Étapes : `ostrom claude` ; le faux agent appelle `ANTHROPIC_BASE_URL` ; faux fournisseur Anthropic en SSE.
- Attendu : Les requêtes passent par la passerelle avec un jeton propre au run ; les clés Anthropic/OpenAI du dev sont retirées de l'environnement ; le flux SSE arrive intact.
- Surfaces : CLI, serveur, faux fournisseur
- Source : proto/COORD/VERIF-LANCEUR.md §2 « Inférence, comptes, quotas » ; fusion/COORD/FUSION-TEAMCODE.md 1a (Passerelle d'inférence) et J1
- Priorité : P1
- Statut : bloqué : ostrom-server (passerelle) + ostrom-cli

### E2E-GW-002 — Politique de modèle et d'effort à chaque requête

- Étapes : Modèle autorisé, puis modèle hors liste, par requête.
- Attendu : Hors liste : refus de la requête avec la raison ; effort au-delà du plafond : refusé ou ramené.
- Surfaces : serveur, faux fournisseur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Politique modèle et effort) ; proto/COORD/PONT.md (couche Inférence)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GW-003 — Budget membre, groupe, pool : admission et dérogation

- Étapes : Budget d'un membre épuisé ; dérogation ; budget du groupe ; budget du pool.
- Attendu : Au plafond : refus clair ; avec dérogation : passe ; chaque budget indépendant ; rien n'est brûlé après le refus.
- Surfaces : serveur, CLI
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Admission, budgets pool/membre/groupe, dérogations) ; proto/COORD/PLATEFORME.md #15
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GW-004 — Coût réel par run, dans le reçu de session

- Étapes : Une session de deux requêtes avec usage connu.
- Attendu : `costUsd` du reçu = somme mesurée ; modèle exact (pas l'alias) ; le budget du mois se base sur ces coûts.
- Surfaces : serveur
- Source : proto/COORD/PONT.md (« Pas de coût dans le reçu de session ») ; proto/COORD/VERIF-LANCEUR.md §2 (Enregistrement de la session : modèle en alias) ; proto/server/src/selftest.ts (coût gardé)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GW-005 — Rapprochement d'usage, prévisions et rythme

- Étapes : Usage déclaré par le fournisseur différent de l'usage compté.
- Attendu : Écart détecté et rapproché ; prévision de capacité et conseil de rythme cohérents.
- Surfaces : serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (UsageReconciliation, Forecast, Pacing)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-GW-006 — Annulation de requête et affinité de session

- Étapes : Le client coupe en plein flux ; deux requêtes de la même session.
- Attendu : L'amont est annulé ; les requêtes d'une session vont au même compte.
- Surfaces : serveur, faux fournisseur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Affinité de session, annulation de requête)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-GW-007 — Codex via la passerelle (fournisseur `-c`)

- Étapes : `ostrom codex` ; faux fournisseur OpenAI.
- Attendu : Codex passe par le fournisseur de l'équipe ; mêmes règles de politique et de budget.
- Surfaces : CLI, serveur, faux fournisseur
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Codex : « tout par -c ») ; fusion/COORD/FUSION-TEAMCODE.md 1a (OpenAI)
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-GW-008 — Guidance de capacité dans le contexte de l'agent

- Étapes : Quota proche du plafond.
- Attendu : Un `additionalContext` de capacité apparaît à chaque prompt/outil ; absent si `--no-guidance`.
- Surfaces : CLI, serveur
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Guidance de session)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-GW-009 — Pool injoignable ou politique inconnue : fail-closed

- Étapes : Passerelle en erreur au lancement.
- Attendu : Refus avec un message ; jamais de lancement avec les clés du dev par défaut.
- Surfaces : CLI, serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1b (« Politique au lancement (fail-open) : Jeter »)
- Priorité : P1
- Statut : bloqué : ostrom-server


## SHARE : Partage d'abonnement (comptes mis en commun)

### E2E-SHARE-001 — Un membre lance sans login Claude : le serveur choisit un compte du pool

- Étapes : Pool de deux comptes d'abonnement simulés ; `ostrom claude` sans identifiants Claude.
- Attendu : La requête part avec un compte choisi par le serveur ; le dev ne voit jamais les identifiants. (À arbitrer : PLATEFORME disait « ne refait pas » ; FUSION du 29/10 garde la mise en commun.)
- Surfaces : CLI, serveur, faux fournisseur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Routage des comptes, SelectPoolAccountUseCase) ; proto/COORD/PLATEFORME.md #13 et #16 (contradiction à lever) ; proto/COORD/VERIF-LANCEUR.md §4
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SHARE-002 — Rafraîchissement OAuth d'un compte et quotas par fenêtre

- Étapes : Jeton d'un compte expire ; quota de 5 h atteint.
- Attendu : Rafraîchissement transparent ; le compte épuisé est écarté jusqu'à la remise à zéro.
- Surfaces : serveur, faux fournisseur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (rafraîchissement OAuth, quotas, SqlCredentialSource)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-SHARE-003 — Débordement partagé, file d'admission, tous comptes épuisés

- Étapes : Tous les comptes proches du plafond ; puis tous épuisés.
- Attendu : Bascule sur un autre compte ; file d'admission ordonnée ; tous épuisés : erreur claire et prévisible, pas de requête perdue en silence.
- Surfaces : serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Admission, Pacing, Forecast) ; proto/COORD/PLATEFORME.md #16
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-SHARE-004 — Ajout, import et transfert d'un compte

- Étapes : `accounts add`, `import --from teamclaude`, `handover`.
- Attendu : Le compte est utilisable ; rien d'affiché en clair ; un membre non admin ne peut pas ajouter de compte.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §1c (accounts) ; fusion/COORD/FUSION-TEAMCODE.md 1a (Comparatif et import TeamClaude)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-SHARE-005 — Conditions des fournisseurs : un seul abonnement par personne

- Étapes : Deux membres, un abonnement individuel chacun, mis en commun.
- Attendu : L'option est visible comme réglage d'organisation avec avertissement ; le BYOK opt-in (clé de l'organisation) fonctionne sans mise en commun.
- Surfaces : serveur, web
- Source : proto/COORD/PLATEFORME.md #13 (« We never resell model access », BYOK) ; cli/COORD/CLI.md §0 point 6 (conditions d'Anthropic et d'OpenAI à vérifier)
- Priorité : P2
- Statut : bloqué : ostrom-server


## CLOUD : Agents cloud et attentes (waits)

### E2E-CLOUD-001 — Session cloud lancée depuis le terminal et rattachée

- Étapes : `ostrom claude --cloud`, `ostrom attach <session>` ; faux orchestrateur de pods.
- Attendu : La session tourne dans un conteneur, le terminal affiche flux, `send`, `interrupt`, `answer` ; fermer le terminal ne tue pas la session.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §0 point 6 et §1c (cloud, attach) ; fusion/COORD/FUSION-TEAMCODE.md 1a (Sessions cloud Kubernetes)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-CLOUD-002 — Pause, reprise, volume, transfert local <-> cloud

- Étapes : Pauser, reprendre, transférer une session locale dans le cloud et retour.
- Attendu : L'état et les fichiers suivent ; reçus chaînés par segment.
- Surfaces : CLI, serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (CloudSessionService, transferts) ; proto/COORD/PLATEFORME.md #20
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CLOUD-003 — Jeton GitHub du pod limité au dépôt et à une branche

- Étapes : L'agent cloud tente de pousser sur `main` ou sur un autre dépôt.
- Attendu : Refus par GitHub (jeton d'installation limité au dépôt, poussée sur une branche seulement).
- Surfaces : serveur, faux GitHub
- Source : proto/COORD/PLATEFORME.md #20
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CLOUD-004 — Harnais et porte dans le pod

- Étapes : Session cloud avec paquet signé ; l'agent tente une action frontière.
- Attendu : Même paquet, mêmes hooks, mêmes portes que sur le poste ; la demande arrive en `Waiting for you` ; la réponse réveille la session.
- Surfaces : serveur, app, web
- Source : proto/COORD/PONT.md « Les cas (Cloud) » ; amont/COORD/AMONT-TEAMCODE.md §2
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CLOUD-005 — `ask_human` : demande de l'agent, réponse humaine, réveil

- Étapes : L'agent appelle `ask_human` ; un humain répond depuis l'app, le web et le CLI.
- Attendu : La session attend ; la première réponse gagne ; la session reprend avec la réponse.
- Surfaces : serveur, app, web, CLI, faux agent
- Source : amont/COORD/AMONT-TEAMCODE.md §2.3 ; fusion/COORD/FUSION-TEAMCODE.md 1a (Waits)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CLOUD-006 — Wait sans session cloud (run local)

- Étapes : Wait créée par un run local.
- Attendu : Possible sans session cloud (la prototype exigeait `waits.session_id`) ; supprimée avec le run sans casser les autres.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 2 (extension E2)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CLOUD-007 — Contexte de porte structuré dans une wait

- Étapes : Wait de classe `gate` avec dépôt, sha, commits, diff.
- Attendu : La réponse porte l'empreinte de ce qui a été montré et une signature ; une wait ordinaire reste inchangée.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 1 (extension E1)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CLOUD-008 — Harnais pour un agent sans adaptateur ni lanceur (CI, cloud tiers)

- Étapes : `ostrom sync` (ou son remplaçant) dans un dépôt ; une CI sans `ostrom`.
- Attendu : Le harnais atterrit dans le dépôt (bloc AGENTS.md, `.mcp.json`) ; le check GitHub reste la garantie.
- Surfaces : CLI, serveur
- Source : proto/COORD/PONT.md « Les cas » ; fusion/COORD/FUSION-TEAMCODE.md 1b (`ostrom sync` jeté à T14)
- Priorité : P2
- Statut : bloqué : ostrom-cli


## WF : Compilation des workflows en harnais (nœuds)

### E2E-WF-001 — Nœud déclencheur : une ligne de contexte

- Étapes : Session sous paquet avec un `trigger`.
- Attendu : Le contexte « Workflows compiled into this session » contient la ligne ; au reçu : « in the session context ».
- Surfaces : CLI, serveur
- Source : proto/COORD/COMPILATEUR.md §1 (trigger) ; proto/COORD/VERIF-LANCEUR.md §1 (trigger)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WF-002 — Nœud étape : un skill, listé à l'init

- Étapes : Paquet avec une étape ; le faux agent liste ses skills.
- Attendu : Skill `ostrom-wf-<workflow>` listé ; reçu « delivered as a skill » ; la consigne n'existe que dans le skill.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/COMPILATEUR.md §1 (step) ; proto/COORD/VERIF-LANCEUR.md §1 (c1, c2)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WF-003 — Skill ouvert ou seulement livré

- Étapes : Le faux agent ouvre le skill (`Skill`, ou lecture d'un `SKILL.md` du paquet) ; une autre session ne l'ouvre pas.
- Attendu : Reçu « skill opened at HH:MM (whether it was followed is not checked) » vs « delivered as a skill; no sign it was opened » ; seul le dev de la session peut le signaler (jeton).
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/CORRECTIFS.md passe 2 bug 8b ; proto/server/src/bridge/gate-integrity.test.ts « 8: the receipt tells a skill delivered from a skill opened ... » ; proto/launcher/src/main.rs `seen_of_reads_skills_opened_and_sub_agents_started`
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-WF-004 — Nœud check avec commande : refus, correction, passage

- Étapes : Check `test_versions` sur `git push` ; le faux agent corrige sans toucher au test.
- Attendu : Hook PreToolUse + script en bac à sable (`sandbox-exec` sur macOS) ; refus avec la sortie ; repasse ; reçu « passed after 1 failure ».
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (c1, check) ; proto/COORD/COMPILATEUR.md §1
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-WF-005 — Déclencheur d'un check ou notify : déclaré, hérité de la porte, ou lu dans les mots

- Étapes : Trois nœuds : `run.on` explicite ; sans `run.on` relié à une porte ; sans rien.
- Attendu : Le check prend la porte en aval, le notify celle en amont ; à défaut motif tiré des mots (push, merge, deploy).
- Surfaces : serveur
- Source : proto/COORD/COMPILATEUR.md §1 (déclencheur)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WF-006 — Check sans commande : skill seulement

- Étapes : Nœud check sans `run.command`.
- Attendu : Aucun hook ; une section de skill « vérifie toi-même ».
- Surfaces : serveur, CLI
- Source : proto/COORD/COMPILATEUR.md §1 (check sans commande)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WF-007 — Nœud agent : sous-agent et `node_done`

- Étapes : Claude Code : sous-agent de plugin ; Codex : rôle `ostrom_<slug>`.
- Attendu : Résumé au reçu (« done: ... (sub-agent started at ...) ») ; un sous-agent jamais lancé n'est pas déclaré fait ; hors Claude Code/OpenCode/Codex le nœud devient une section de skill.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §1 (c3, x1) ; proto/COORD/COMPILATEUR.md §2 ; proto/server/src/bridge/gate-integrity.test.ts « bug 4 ... »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-WF-008 — Nœud agent exigé avant une classe de porte (proposé)

- Étapes : Option `required before <classe>` sur un nœud agent ; la porte est demandée sans `node_done`.
- Attendu : La porte refuse tant que `node_done` n'est pas arrivé pour cette session (comme un check). À confirmer par Lyes : proposition non décidée.
- Surfaces : CLI, serveur, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §3 bug 8 (proposition)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli

### E2E-WF-009 — Nœud notify : message après l'action réelle, une ligne par push

- Étapes : Quatre pushs réels ; journal `log:release`.
- Attendu : Une ligne par push, toujours après le push ; jamais pour un push refusé.
- Surfaces : serveur, CLI
- Source : proto/COORD/VERIF-LANCEUR.md § Preuves (4 lignes du journal) ; proto/COORD/COMPILATEUR.md §1 (notify)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WF-010 — Un workflow proposé ne produit que de l'ombre ; un notify sans canal choisi aussi

- Étapes : Workflow proposé avec check, notify sans canal.
- Attendu : Hooks journalisent, scripts `would have run`, messages vers `<canal>-shadow` ; rien de réel tant qu'un humain n'a pas réglé le nœud.
- Surfaces : serveur, CLI
- Source : proto/COORD/COMPILATEUR.md §5 (« Un workflow proposé ne produit que de l'ombre »)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WF-011 — Suggestion IA : ombre même dans un workflow décidé ; une fois prise et enregistrée, elle s'applique

- Étapes : Workflow accepté avec commande et canal suggérés par l'IA ; puis un humain « Use this » et enregistre.
- Attendu : Tant que non pris : ombre ; après décision signée : appliqué.
- Surfaces : web, serveur
- Source : proto/server/src/compiler/suggest.test.ts « table: a suggestion only produces shadow, even in a decided workflow », « compiler: suggested command and channel stay in shadow ... », « compiler: once a person takes the suggestion and saves (signed decision), it applies »
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-WF-012 — Suggestions écartées et nouvelle analyse

- Étapes : Écarter une suggestion ; relancer l'analyse ; workflow décidé et workflow proposé.
- Attendu : L'écartée ne revient pas ; un workflow décidé garde tous les réglages humains, un proposé garde les actions de porte déclarées ; une mise à jour acceptée garde ce qu'une personne a réglé ensuite.
- Surfaces : serveur
- Source : proto/server/src/compiler/suggest.test.ts « dismiss ... », « new analysis: a decided workflow keeps every human setting ... », « new analysis: a proposed workflow keeps the gate actions a person declared », « keepHumanSettings ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WF-013 — Commande suggérée : lue sur une ligne du clone, workflow réutilisable, règles liées

- Étapes : Analyse d'un clone avec CI, workflow appelé, règles.
- Attendu : Une commande n'est gardée que si elle est écrite dans le clone (ligne relue) ; pour un workflow réutilisable : programme appelé + entrée de l'appelant ; règles liées à un step par la session puis par fichier et mots ; catalogue de suggestions = actions du pont.
- Surfaces : serveur
- Source : proto/server/src/compiler/suggest.test.ts « the catalogue of shared/suggest matches the bridge (ACTIONS) », « engine: a command is kept only when written on a line of the clone, line re-read », « engine: a command from a reusable workflow ... », « engine: rules linked to a step ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WF-014 — Paquet : épinglage, publieurs de code, audit

- Étapes : Épinglage auto puis manuel ; workflow avec nœud code décidé par un non-publieur ; lecture de l'audit.
- Attendu : Auto/manuel respectés ; un nœud qui exécute du code n'est appliqué que si la dernière décision vient d'un publieur (sinon ombre) ; événements d'audit en métadonnées seules (`package.compiled`, `.pinned`, `.served`, `.revoked`, `script.ran`, `notify.sent`, `node.done`, `receipt.signed`).
- Surfaces : serveur, web
- Source : proto/COORD/COMPILATEUR.md §5
- Priorité : P1
- Statut : bloqué : ostrom-server


## WFRUN : Exécution de workflows : nœuds étape, check, porte, notification, agent, attente

### E2E-WFRUN-001 — Nœud étape dans un workflow exécuté

- Étapes : Workflow `purpose=run` à une étape humaine puis une étape agent.
- Attendu : L'étape s'exécute dans l'ordre, la transition `next` est suivie, la sortie `to = null` termine le run.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §3.1 et §3.3 (WorkflowRules, WorkflowEngine)
- Priorité : P2
- Statut : bloqué : ostrom-server (moteur de runs de workflows non branché dans l'amont)

### E2E-WFRUN-002 — Nœud check dans un workflow exécuté

- Étapes : Check qui échoue puis réussit ; transition par résultat.
- Attendu : Échec : transition d'échec ; la sortie du check est conservée au run.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 5 et §3.4 (check absent chez Nathan)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WFRUN-003 — Nœud porte dans un workflow exécuté

- Étapes : Porte à deux approbateurs.
- Attendu : Une wait de classe `gate` par approbateur, premier oui gagne, auteur et administrateur exclus, reçu signé ; le run continue au oui, s'arrête au non.
- Surfaces : serveur, app, web
- Source : amont/COORD/AMONT-TEAMCODE.md §2.4 et §3.4 (E1 à E5)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WFRUN-004 — Nœud notification dans un workflow exécuté

- Étapes : Notification Discord/Slack en fin de run.
- Attendu : Message posté après l'étape précédente ; échec non bloquant, visible.
- Surfaces : serveur, faux Discord, faux Slack
- Source : amont/COORD/AMONT-TEAMCODE.md §3.4 (notify) ; proto/COORD/NOTIFY-DISCORD.md
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WFRUN-005 — Nœud agent (session cloud avec livrable)

- Étapes : Nœud agent qui doit produire un livrable.
- Attendu : Une session cloud est lancée ; sans livrable le run échoue ; avec livrable la transition suit.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 5 (livrable obligatoire chez Nathan) et §3.3
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WFRUN-006 — Nœud attente (humain) : le run dort, répond, reprend

- Étapes : Nœud `human` assigné à un membre.
- Attendu : Run en attente, apparaît dans « Waiting for you », la réponse choisit la transition ; annulation et expiration gérées.
- Surfaces : serveur, app, web
- Source : amont/COORD/AMONT-TEAMCODE.md §2 et §3.3 (WorkflowWaits)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-WFRUN-007 — Un workflow de harnais ne se lance jamais

- Étapes : `purpose=harness` ; démarrage par l'API.
- Attendu : 409 `workflow_not_runnable` ; le compilateur seul le lit.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §3.4 (E5)
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-WFRUN-008 — Reprise après redémarrage du serveur, réplicas sans état

- Étapes : Redémarrer le serveur en plein run ; deux instances derrière un répartiteur.
- Attendu : Aucun run perdu ni dupliqué ; travaux planifiés en base.
- Surfaces : serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Réplicas sans état, SqlScheduledWork)
- Priorité : P1
- Statut : bloqué : ostrom-server


## AUTO : Automations : déclencheurs cron et webhook

### E2E-AUTO-001 — Cron : une session cloud au nom du propriétaire

- Étapes : Automation `0 9 * * 1-5` avec fuseau ; horloge simulée.
- Attendu : Une session est lancée à l'heure, le prompt rendu en premier message ; rattrapage `skip` ou `once` avec délai de grâce ; chevauchement `skip`, `queue`, `allow` ; `maxRunsPerDay` respecté.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §4 (Modèle, Ce qu'elle lance)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-AUTO-002 — Webhook signé : HMAC, âge, rotation, débit, idempotence

- Étapes : Appels avec `TeamCode-Signature: v1=<hmac>` (marque réglable), horodatage, ancien secret, 31 requêtes en 1 min, même `Idempotency-Key`.
- Attendu : Signature valide et âge ≤ 5 min acceptés ; falsifié ou périmé refusé ; ancien secret valable 10 min ; 30 requêtes/min ; un déclenchement par clé d'idempotence ; URL à secret acceptée.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §4 (Webhook signé)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-AUTO-003 — Variables d'automation typées

- Étapes : Variables `string/int/number/boolean/enum`, sensibles, longueur max, requises.
- Attendu : Valeurs validées et injectées dans le prompt ; sensibles masquées dans les journaux.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §4 (AutomationVariableView)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-AUTO-004 — Test à sec, annulation, limites par membre

- Étapes : `run` en `dryRun` ; annuler un run ; dépasser 20 automations, 2 en cours.
- Attendu : Le test ne lance rien de réel ; l'annulation arrête ; limites refusées avec la raison.
- Surfaces : serveur, CLI
- Source : amont/COORD/AMONT-TEAMCODE.md §4 (routes, réglages)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-AUTO-005 — Un déclencheur d'automation qui démarre un workflow

- Étapes : Automation reliée au nœud `trigger` d'un workflow `run` (après le jalon).
- Attendu : Le workflow démarre, ses nœuds s'enchaînent (voir E2E-WFRUN) ; l'automation n'a pas d'effet sur un workflow de harnais.
- Surfaces : serveur
- Source : amont/COORD/AMONT-TEAMCODE.md §4 (tableau, `automationId`) ; fusion/COORD/FUSION-TEAMCODE.md 1a (Automations)
- Priorité : P2
- Statut : bloqué : ostrom-server


## ARTIFACT : Artefacts

### E2E-ARTIFACT-001 — Publier une page avec ses fichiers

- Étapes : `ostrom artifacts publish` d'une page HTML et d'une image.
- Attendu : URL rendue, page lisible derrière le login de l'équipe ; republier le même artefact ajoute une version.
- Surfaces : CLI, serveur, web
- Source : fusion/COORD/FUSION-TEAMCODE.md 1a (Artefacts, ArtifactPublication) ; cli/COORD/CLI.md §1c (artifacts)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ARTIFACT-002 — Accès personnel par défaut et partage

- Étapes : Publier en `personal`, puis partager avec un membre/groupe ; un tiers ouvre le lien.
- Attendu : Non partagé : refus ; partagé : lisible ; retrait du partage : refus.
- Surfaces : CLI, serveur, web
- Source : proto/SPEC.md « Livrable de 12 h » (`access: "personal"` écrit explicitement) ; fusion/COORD/FUSION-TEAMCODE.md 1a (Artefacts)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ARTIFACT-003 — Bac à sable de la page

- Étapes : Page avec script externe, formulaire, cadre, `fetch` externe, cookies.
- Attendu : Politique de contenu appliquée : scripts seulement des fichiers publiés ou de la liste de CDN, aucun formulaire ni cadre ni image externe.
- Surfaces : web (Playwright), serveur
- Source : instructions du serveur MCP `teamcode_artifacts` (politique de contenu) ; fusion/COORD/FUSION-TEAMCODE.md 1a
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ARTIFACT-004 — MCP artefacts et outils natifs interdits dans le run

- Étapes : `ostrom claude` ; le faux agent liste ses outils.
- Attendu : `teamcode_artifacts` (nom réglable par la marque) en stdio présent ; `Artifact*` natifs interdits (`--disallowedTools`).
- Surfaces : CLI, faux agent
- Source : proto/COORD/VERIF-LANCEUR.md §2 (MCP artefacts) ; fusion/COORD/FUSION-TEAMCODE.md T8
- Priorité : P2
- Statut : bloqué : ostrom-cli


## ONBOARD : Onboarding web et analyse de l'organisation

### E2E-ONBOARD-001 — Parcours web de bout en bout : connexion, attente, premiers workflows

- Étapes : Faux GitHub avec une petite organisation ; navigateur sur `/connect` puis l'attente.
- Attendu : Stats et technologies en secondes, carte en direct, premiers workflows vers 3 min (moteur simulé), règles en continu, « ready » ; aucun chiffre inventé, la simulation est marquée.
- Surfaces : web (Playwright), serveur, faux GitHub
- Source : proto/SPEC.md « Ce que Lyes veut » 1 à 4 ; proto/COORD/ONBOARDING.md ; proto/COORD/MOTEUR.md
- Priorité : P1
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-ONBOARD-002 — Questions de réglage, invitations, packs, clés

- Étapes : Dans l'attente : qui valide la prod, quand déranger, inviter l'équipe, choisir des packs, brancher les clés.
- Attendu : Chaque réponse est enregistrée et préremplit les responsables par dépôt d'après les commits ; invitation créée ; clé de modèle gardée chiffrée.
- Surfaces : web, serveur
- Source : proto/SPEC.md « Ce que Lyes veut » 2 ; proto/COORD/ONBOARDING.md
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-ONBOARD-003 — Aha : règles groupées et éditeur de workflow

- Étapes : Premier workflow arrivé ; ouvrir.
- Attendu : Règles groupées avec sources, nœuds éditables, choix du responsable de chaque porte parmi les vrais membres.
- Surfaces : web (Playwright)
- Source : proto/SPEC.md « Ce que Lyes veut » 3 ; proto/COORD/ONBOARDING.md « Reprendre »
- Priorité : P1
- Statut : bloqué : ostrom-web

### E2E-ONBOARD-004 — Rejeu des 30 derniers jours, marqué simulation

- Étapes : Lancer le rejeu.
- Attendu : PR par PR : règles appliquées, règles enfreintes vues par un juge IA, portes qui auraient demandé un oui et à qui ; totaux comptables ; aucun « temps gagné » inventé.
- Surfaces : web, serveur
- Source : proto/SPEC.md « Ce que Lyes veut » 4
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-ONBOARD-005 — Tâches autonomes : diff, reçu, demande de oui, rien de poussé

- Étapes : Lancer une tâche proposée (faux agent headless).
- Attendu : Un diff et un reçu provisoire, puis une demande de oui ; au oui la tâche est `approved` ; rien n'est poussé sur GitHub sans la porte.
- Surfaces : web, serveur, faux agent
- Source : proto/SPEC.md « Ce que Lyes veut » 5 ; proto/server/src/selftest.ts étapes « task stored through the bus » et « decision signs a receipt and closes the task »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ONBOARD-006 — Événements du flux : retrait de workflows, statut `no-change`, statistiques par dépôt

- Étapes : Émettre `workflow.retired`, un workflow accepté, `task` `no-change`, `stats.updated` partiels.
- Attendu : Un workflow proposé retiré disparaît et revient avec `workflow.found` ; un workflow accepté ou édité n'est jamais caché ; `no-change` est gardé ; les chiffres par dépôt fusionnent champ par champ (un champ absent n'est pas un zéro).
- Surfaces : serveur
- Source : proto/server/src/selftest.ts étapes « workflow.retired hides ... », « workflow.retired never hides a workflow a human accepted or edited », « task status 'no-change' is stored as is », « per-repo stats merge by field »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-ONBOARD-007 — Chaque événement porte son heure ISO ; le magasin web applique les mêmes règles

- Étapes : Lire l'historique ; rejouer les événements dans le magasin du web.
- Attendu : Tous les événements ont `at` (ISO UTC en ms) ; règles et workflows retirés quittent les listes ; fusion par champ des statistiques.
- Surfaces : serveur, web
- Source : proto/server/src/selftest.ts étapes « every logged event has its ISO emission time (at) » et « useOstrom() store: retired rules and workflows leave the lists ... »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-ONBOARD-008 — Échec d'analyse : arrêt des agents, relance

- Étapes : Événement `analysis.failed` (inférence indisponible) puis nouveau run.
- Attendu : L'échec est stocké, les agents en cours passent `failed` dans le web, la raison et le chemin de reprise s'affichent ; un nouveau run efface l'échec.
- Surfaces : serveur, web
- Source : proto/server/src/selftest.ts étape « analysis.failed is stored, stops every running agent in useOstrom(), and a new run clears it »
- Priorité : P1
- Statut : bloqué : ostrom-server + ostrom-web

### E2E-ONBOARD-009 — Serveur absent : l'écran le dit

- Étapes : Ouvrir la connexion sans serveur.
- Attendu : Avis « The Ostrom server is not answering on this machine », aucune erreur console inattendue.
- Surfaces : web (Playwright)
- Source : proto/COORD/ONBOARDING.md (captures de connexion)
- Priorité : P2
- Statut : bloqué : ostrom-web

### E2E-ONBOARD-010 — Rejeu d'un enregistrement d'analyse (démo)

- Étapes : Charger l'enregistrement MOTEUR et le rejouer.
- Attendu : Badge « Replay of a real run », compteur de règles cohérent (200 pour 200), langages sous 0,05 % dans « Other », couleurs de domaine stables.
- Surfaces : web (Playwright)
- Source : proto/COORD/ONBOARDING.md « État (27/10 07 h 20) »
- Priorité : P2
- Statut : bloqué : ostrom-web


## CONSOLE : Console web : règles, décisions, responsables

### E2E-CONSOLE-001 — Règles : accepter, modifier, refuser = décision signée avec reçu

- Étapes : Écran Rules : trois décisions ; vérifier un reçu.
- Attendu : Chaque décision a un reçu dont la signature vérifie ; historique avec totaux mesurés.
- Surfaces : web (Playwright), serveur
- Source : proto/COORD/BOUCLE.md « Fait (27/10 matin) » (registre des décisions) et « Fait (deuxième passe) »
- Priorité : P1
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-CONSOLE-002 — Une nouvelle analyse ne touche pas aux règles décidées

- Étapes : 12 règles décidées + 1 workflow ; relancer l'analyse.
- Attendu : Règles `accepted/edited/rejected` et workflows `accepted/edited` gardés à l'identique ; les changements proposés arrivent dans « This week ».
- Surfaces : serveur, web
- Source : proto/COORD/BOUCLE.md « Le harnais décidé survit à une nouvelle analyse »
- Priorité : P1
- Statut : bloqué : ostrom-server

### E2E-CONSOLE-003 — Revue de la semaine

- Étapes : Lancer la revue sur des PR fixes (faux GitHub).
- Attendu : Propositions de delta (nouvelles règles ou mises à jour) avec preuves, groupées par responsable, accept/edit/reject.
- Surfaces : web, serveur
- Source : proto/COORD/BOUCLE.md « Passe What changed this week »
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-CONSOLE-004 — Qui valide quoi : confirmer ou désigner un responsable

- Étapes : Graphe des responsables ; confirmer, désigner.
- Attendu : Décision signée `owner-change` ; la porte proposée reprend le responsable ; casse sans effet sur les portes décidées.
- Surfaces : web, serveur
- Source : proto/COORD/BOUCLE.md « Graphe « qui valide quoi »  »
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-CONSOLE-005 — Dates de revue des règles

- Étapes : Une règle décidée ; avancer le temps de 90 jours.
- Attendu : `reviewBy` = décision + 90 j ; la règle due apparaît dans « Review dates » ; « Keep 90 days » signe un reçu.
- Surfaces : web, serveur
- Source : proto/COORD/BOUCLE.md « Dates de revue »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-CONSOLE-006 — Éditeur de workflow : porte, approbateurs, actions, canal

- Étapes : Modifier une porte (approbateurs, actions déclarées), un notify (canal), enregistrer.
- Attendu : Décision signée ; nouveau paquet compilé et épinglé ; les actions déclarées par une personne survivent à une nouvelle analyse.
- Surfaces : web, serveur
- Source : proto/COORD/CONSOLE.md ; proto/COORD/NOTIFY-DISCORD.md (sélecteur de canal) ; proto/server/src/compiler/suggest.test.ts « new analysis: a proposed workflow keeps the gate actions a person declared »
- Priorité : P1
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-CONSOLE-007 — Politique éditée dans la console

- Étapes : Changer les agents et modèles autorisés, le budget du mois.
- Attendu : Décision signée ; le lancement suivant applique la politique (voir E2E-CLAUDE-012).
- Surfaces : web, serveur
- Source : proto/COORD/PONT.md « Ce qui reste à concevoir pour la couche « au quotidien »
- Priorité : P2
- Statut : bloqué : ostrom-web + ostrom-server

### E2E-CONSOLE-008 — Arrêt général ('tout arrêter')

- Étapes : Bouton d'arrêt général en session active.
- Attendu : Les portes refusent toute action frontière ; reçu d'arrêt ; levée possible.
- Surfaces : web, serveur, faux agent
- Source : proto/COORD/PLATEFORME.md « Ce qu'Ostrom ajoute » (arrêt général)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-web


## ANA : Travailleur d'analyse : essaim et fusion des règles

### E2E-ANA-001 — Modes d'analyse, configuration et garde-fous

- Étapes : Modes `full` (défaut), `essaim`, `swarm`, `combo`, `quick`, inconnu ; états TeamCode lus ; coût OpenRouter lu entre deux estampilles.
- Attendu : Mode inconnu = full ; paramètres selon les configs de recherche (P48, P96), lecteur DeepSeek par défaut ; comptes utilisables et points hebdomadaires lus ; coût mesuré dans le journal du relais.
- Surfaces : serveur
- Source : proto/server/src/engine/swarm.test.ts « mode: full by default ... », « swarm parameters follow the research configs (P48, P96) ... », « guards: TeamCode status parsing ... », « OpenRouter cost is read from the relay log between two stamps »
- Priorité : P2
- Statut : bloqué : ostrom-server (travailleur d'analyse)

### E2E-ANA-002 — Découpage en tranches du code et de l'historique

- Étapes : Partition, unités de lignes, unités de code, groupes, découpe réelle sur disque.
- Attendu : N tranches contiguës et équilibrées ; lignes chronologiques bornées ; gros répertoires coupés ; groupes de ⌈brut/600⌉ ; chaque vue ne contient que ses PR, commits et code.
- Surfaces : serveur
- Source : proto/server/src/engine/swarm.test.ts « partition ... », « line units ... », « code units ... », « groups ... », « slicing on disk ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ANA-003 — Doublons entre groupes, plan de fusion, combo, règles humaines

- Étapes : Candidats de contre-vérification, plan de fusion, mode combo, consolidation de groupe.
- Attendu : Doublons proches entre groupes seulement ; ne retire que des ids vivants et distincts, jamais deux fois ; seuls les vrais doublons des deux côtés fusionnent ; une règle décidée par un humain n'est jamais retirée ; une consolidation ne touche que son groupe et annonce ses fusions.
- Surfaces : serveur
- Source : proto/server/src/engine/swarm.test.ts « cross-check candidates ... », « merge plan ... », « combo ... », « a rule decided by a human is never retired by a merge », « a group consolidation only touches the rules of its own group ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ANA-004 — Fusion des paraphrases : ordre, fenêtres, plan, rognage, invite

- Étapes : Chaîne de règles avec paraphrases.
- Attendu : Paraphrases voisines, chaque règle une fois ; fenêtres couvrantes avec passe décalée de W/2 et petite queue rattachée ; la plus ancienne règle à l'écran est gardée ; énoncé fusionné de plus de 400 caractères rogné sur une proposition ; invite à une ligne par règle, réponse JSON.
- Surfaces : serveur
- Source : proto/server/src/engine/fusion.test.ts « order ... », « windows ... », « plan ... », « clip ... », « prompt ... »
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-ANA-005 — Fusion complète : doublons réels, fenêtre muette, ancienne règle gardée

- Étapes : `fuseAll` avec une fenêtre en échec puis une fenêtre qui ne répond jamais.
- Attendu : Doublons fusionnés dans la plus ancienne (preuves et portée jointes), fenêtre en échec retentée une fois ; une fenêtre muette ne retire rien ; consolidation et arbitrage gardent la plus ancienne.
- Surfaces : serveur
- Source : proto/server/src/engine/fusion.test.ts « fuseAll: true duplicates ... », « fuseAll: a window that never answers retires nothing », « consolidation and arbitration keep the oldest rule on screen ... »
- Priorité : P2
- Statut : bloqué : ostrom-server


## HARNESS : CLI : harnais, administration, installation

### E2E-HARNESS-001 — Poser un harnais en observation puis l'imposer

- Étapes : `ostrom harness add git-safety --scope team:payments`, 7 jours simulés, `harness show --impact`, `harness enforce`.
- Attendu : D'abord `shadow` (journalisé, rien bloqué) ; l'impact chiffre les oui qu'il aurait demandés (mesure, pas maquette) ; `enforce` rend la porte bloquante pour les sessions suivantes (sous 30 s pour celles en cours).
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §3.2 et §0 point 3
- Priorité : P1
- Statut : bloqué : ostrom-cli + ostrom-server

### E2E-HARNESS-002 — Commandes d'admin refusées sans le rôle

- Étapes : Un membre lance `harness add`, `invite`, `policy`.
- Attendu : 77 avec le nom de qui peut ; la section Admin de l'aide n'apparaît que pour un admin.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §0 point 1
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-003 — Bibliothèque signée et registre privé

- Étapes : `harness list --available`, `show`.
- Attendu : Presets signés par Ostrom et règles privées de l'organisation séparés ; aucun registre public de tiers.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §0 point 2 et §3.2
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-004 — `ostrom invite`, `inbox`, `receipts`, `logs`, `doctor`, `status`, `config`

- Étapes : Chaque commande de l'arbre cible sur un serveur de test.
- Attendu : Chaque sortie correspond au texte de la spec ; `doctor` sort 1 s'il y a un ✗.
- Surfaces : CLI, serveur
- Source : cli/COORD/CLI.md §2.1 et §2.2
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-005 — Aide courte, plomberie cachée, sous-commandes inconnues

- Étapes : `ostrom --help`, `ostrom help plumbing`, `ostrom updat`.
- Attendu : `wait`, `hook`, `mcp`, `check` absents de l'aide et listés par `help plumbing` ; une sous-commande inconnue n'est jamais transmise à l'aveugle à l'agent.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §2.4 et §5.2
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-006 — Sans réseau : refus par défaut, délai de grâce par réglage

- Étapes : `ostrom claude` hors ligne, avec et sans `offline_grace`.
- Attendu : Par défaut 69 ; avec le réglage : dernier paquet vérifié non expiré/révoqué, portes qui refusent, journal signé au retour (« recorded offline »).
- Surfaces : CLI
- Source : cli/COORD/CLI.md §0 point 4
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-007 — `ostrom demo` : premier reçu en 5 minutes, sans compte

- Étapes : Après le jalon : `ostrom demo` hors ligne.
- Attendu : Dépôt d'exemple, serveur local jetable, porte approuvée dans un second terminal, reçu vérifié hors ligne ; rien n'est envoyé.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §0 point 5
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-HARNESS-008 — `ostrom check <nœud>` à la main

- Étapes : Lancer un check du paquet de la session en bac à sable.
- Attendu : `check "<label>": passed in N ms (<sandbox>)`.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §1a (`check`)
- Priorité : P2
- Statut : bloqué : ostrom-cli


## DIST : Distribution et mise à jour

### E2E-DIST-001 — Installation signée en une ligne

- Étapes : `curl ... | sh` sur un poste vierge (conteneur).
- Attendu : Binaire téléchargé, signature vérifiée contre la clé d'éditeur épinglée, lien dans le PATH ; une signature fausse refuse l'installation.
- Surfaces : CLI
- Source : cli/COORD/CLI.md §3.1 écran 2 ; proto/COORD/PLATEFORME.md #3
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-DIST-002 — `ostrom update`, `--check`, `--rollback`, `verify-release`

- Étapes : Publier une release signée de test, puis une altérée.
- Attendu : La signature est vérifiée avant installation ; `--rollback` revient ; la mise à jour automatique est désactivée par défaut ; les deux binaires (Kotlin natif, hooks) sont dans un même manifeste.
- Surfaces : CLI
- Source : proto/COORD/VERIF-LANCEUR.md §2 (Mise à jour : `unknown agent update`) ; fusion/COORD/FUSION-TEAMCODE.md T11
- Priorité : P1
- Statut : bloqué : ostrom-cli

### E2E-DIST-003 — Binaire natif : démarrage et empreinte mémoire

- Étapes : Mesurer `ostrom --version` et le hook sur 60 lancements.
- Attendu : Médianes proches du binaire vide (≈ 4 ms de CPU) ; pas de dépendance dynamique inattendue.
- Surfaces : CLI
- Source : proto/COORD/HOOK-DISPATCH.md §4
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-DIST-004 — Windows : lanceur et hook

- Étapes : Même parcours que E2E-GATE-001 sous Windows.
- Attendu : Le hook s'exécute et bloque.
- Surfaces : CLI
- Source : proto/COORD/PLATEFORME.md #24
- Priorité : P2
- Statut : bloqué : ostrom-cli


## TC : Migration depuis le prototype et compatibilité TeamCode

### E2E-TC-001 — Import unique d'une instance du prototype

- Étapes : Instance TS avec règles, décisions, reçus, paquets ; import.
- Attendu : Tout est relu (mêmes `kid`, mêmes digests) ; `ostrom verify` d'un ancien reçu réussit ; l'instance TS n'est plus utilisée.
- Surfaces : serveur
- Source : fusion/COORD/FUSION-TEAMCODE.md T13 et D3
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-TC-002 — Marque réglable : aucun nom de produit avant le lancement

- Étapes : Instance avec marque neutre.
- Attendu : Les sorties (hooks, en-têtes, MCP, textes des paquets) n'utilisent pas le nom de produit ; changer la marque ne change aucun octet signé non lié à la marque. (Dans la réécriture « tout est refait dans Ostrom » : à reconfirmer, voir note de l'intro.)
- Surfaces : serveur, CLI
- Source : fusion/COORD/FUSION-TEAMCODE.md D5, T8, §4-§5 ; amont/compat/README.md (`neutral/` sans nom de produit)
- Priorité : P2
- Statut : bloqué : ostrom-server + ostrom-cli


## LOAD : Charge (k6)

### E2E-LOAD-001 — Démarrage à froid du serveur de contrôle

- Étapes : 30 démarrages à froid avec base Postgres peuplée.
- Attendu : Temps jusqu'à `ready` médian et p95 relevés ; seuil fixé par QA sur la première série (la perf-langages donne l'ordre de grandeur par implémentation).
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-CONTROLE.md (démarrage à froid x30)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-002 — Débit de contrôle : check, porte, oui signé, reçu à 1 / 10 / 100 / 1000 clients

- Étapes : Scénario k6 mixte (demande de porte, oui, consume, reçu) à 4 paliers, 3 répétitions.
- Attendu : 0 erreur, aucun oui perdu ni doublon ; débit et p95 par palier consignés ; conformité fonctionnelle (170 cas de la spec de contrôle) verte avant la charge.
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-CONTROLE.md (débit 1/10/100/1000 ; 170/170 conformance)
- Priorité : P2
- Statut : codé : `load/smoke.js` (check, porte, oui à débit fixe, seuils p95/p99), en attente du serveur (bloqué : ostrom-server)

### E2E-LOAD-003 — Stress jusqu'à la dégradation

- Étapes : Montée au-delà de la capacité.
- Attendu : Dégradation propre (refus 429/503), aucune écriture partielle, aucun oui accordé sans reçu, reprise à la baisse.
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-CONTROLE.md (stress)
- Priorité : P2
- Statut : codé : `load/soak.js` (20 min + rampe à 2 000/s, nightly), en attente du serveur (bloqué : ostrom-server)

### E2E-LOAD-004 — Latence Postgres +20 ms

- Étapes : Même charge avec 20 ms ajoutées vers la base.
- Attendu : Débit et erreurs relevés ; pas d'erreur de pool.
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-CONTROLE.md (Postgres à +20 ms)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-005 — Profil conteneur « moyen » (2 CPU, 4 Go)

- Étapes : Image du serveur dans un conteneur à 2 CPU et 4 Go.
- Attendu : Mêmes mesures ; pas de mise en échange.
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-CONTROLE.md (conteneur « moyen »)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-006 — Rafale de oui : premier gagne, une seule décision

- Étapes : 1000 demandes de porte et, pour chacune, trois approbateurs qui répondent en même temps.
- Attendu : Exactement une décision et un reçu par demande ; les autres reçoivent « déjà décidé ».
- Surfaces : serveur (k6)
- Source : amont/COORD/AMONT-TEAMCODE.md §0 point 4 ; proto/server/src/selftest.ts (une seconde décision ne change rien)
- Priorité : P1
- Statut : codé : `load/race.js` (100 oui simultanés : 1 × 200, 99 × 409), en attente du serveur (bloqué : ostrom-server)

### E2E-LOAD-007 — Passerelle SSE : flux stables, TTFT, tempête de reconnexions, clients lents, stress

- Étapes : 50 flux en régime, tempête de connexions, clients lents, montée en charge, faux fournisseur Anthropic.
- Attendu : Surcoût de TTFT et débit par palier ; point de casse relevé ; aucune requête perdue ; annulation propagée.
- Surfaces : serveur (k6), faux fournisseur
- Source : proto/COORD/PERF-GATEWAY.md (steady, ttft, storm, slow, stress)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-008 — MCP : concurrence par session

- Étapes : Appels concurrents à `rules_for` et `node_done`, plusieurs sessions.
- Attendu : Bornes par session respectées (refus propre au-delà) ; démarrage à froid et mémoire relevés.
- Surfaces : serveur (k6)
- Source : proto/COORD/PERF-MCP.md (« État » : bornes des SDK)
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-009 — Coût du hook à 1, 5 et 20 nœuds

- Étapes : Banc de dispatch du hook.
- Attendu : Les comptes de processus et d'appels de E2E-CLAUDE-003/004 tiennent sous charge.
- Surfaces : CLI, faux agent
- Source : proto/COORD/HOOK-DISPATCH.md §3 et « Relancer la mesure »
- Priorité : P2
- Statut : bloqué : ostrom-cli

### E2E-LOAD-010 — Sessions muettes balayées sous charge

- Étapes : 1000 sessions dont 100 muettes.
- Attendu : Les 100 sont closes avec reçu « launcher lost » sans retarder les autres.
- Surfaces : serveur (k6)
- Source : proto/server/src/bridge/gate-integrity.test.ts « sign of life ... » ; proto/COORD/CORRECTIFS.md passe 2 bug 8a
- Priorité : P2
- Statut : bloqué : ostrom-server

### E2E-LOAD-011 — Fumée de charge sur les routes publiques servies

- Étapes : k6 `load/smoke.js` avec `OSTROM_LOAD_SCENARIOS=health,instance` contre l'image du serveur (main) et PostgreSQL 18 : 50 req/s sur `/health` et 50 req/s sur `/api/v1/instance`, 60 s chacun, dans le job `ci` du banc.
- Attendu : p95 < 50 ms et p99 < 100 ms par route, `http_req_failed` < 1 %, `checks` > 99 % (clé `ed25519` dans chaque réponse d'instance) ; un seuil franchi fait échouer le job.
- Surfaces : serveur (image), PostgreSQL (k6)
- Source : consigne QA du 30/10 (reprise après ostrom-server#1) ; seuils de `load/smoke.js`
- Priorité : P1
- Statut : codé : `load/smoke.js` (scénarios `health` et `instance`), job `ci` d'ostrom-e2e


## DOGFOOD : Le harnais ControlResell en workflows Ostrom (dogfood)

### E2E-DOGFOOD-001 — Les 8 workflows du harnais CR compilent en paquets signés

- Étapes : compiler les 8 workflows `wf-cr-*.ts` du dogfood (db-perf, deploy, fix-ticket, mcp-guards, pr-workflow, push-guard, review, station) par le compilateur de la réécriture, publier les paquets, `ostrom verify` sur chacun.
- Attendu : 4 paquets (au moins) signés et vérifiés hors ligne ; le résumé de chaque paquet liste les nœuds compilés ; aucune porte sans action ne compile.
- Surfaces : serveur, CLI
- Source : dogfood/examples/controlresell/README et COUVERTURE.md (`out/`, `summary.json`) ; JOURNAL du 30/10 02:05
- Priorité : P1
- Statut : bloqué : ostrom-server (compilateur) + ostrom-core (modèle de workflow)

### E2E-DOGFOOD-002 — `behave.mjs` porté : chaque hook CR rejoué par le faux agent donne la décision attendue

- Étapes : sur des dépôts jetables, le faux agent rejoue les actions de `behave.mjs` (push, deploy, merge, appels MCP gardés…) sous `ostrom claude` avec les paquets du dogfood.
- Attendu : les 27 cas de `out/behave.json` donnent la même décision qu'au prototype ; puis la cible de la réécriture : 85 % des hooks CR appliqués (contre 40 % au prototype), mesurée et publiée dans RAPPORT.md.
- Surfaces : CLI, serveur, faux agent
- Source : dogfood/examples/controlresell/behave.mjs, COUVERTURE.md § « Ce que le hook fait vraiment » et § 4 (5 extensions)
- Priorité : P1
- Statut : bloqué : ostrom-cli (hooks) + ostrom-server (paquets)

### E2E-DOGFOOD-003 — Les bugs du prototype vus au dogfood ne reviennent pas

- Étapes : (a) un check sur `Bash` n'est pas joué pour un `Edit` ; (b) une porte sans action déclarée est refusée à la compilation ; (c) un workflow sans dépôt s'applique à tous les dépôts de l'organisation.
- Attendu : (a) le hook filtre toujours par outil ; (b) erreur de compilation lisible ; (c) le workflow est dans le paquet de chaque dépôt de l'org.
- Surfaces : serveur, CLI, faux agent
- Source : JOURNAL du 30/10 02:05 (« Bugs du prototype à ne pas reproduire ») ; dogfood COUVERTURE.md
- Priorité : P1
- Statut : bloqué : ostrom-server (compilateur) + ostrom-cli (hooks)

## OBS : Observabilité (traces, télémétrie opt-in)

### E2E-OBS-001 — Une trace CLI → serveur → passerelle

- Étapes : banc avec un collecteur `otel/opentelemetry-collector-contrib` (exportateur fichier, modèle `ostrom-server/ci/otel-collector.yaml`) ; serveur lancé avec `OTEL_EXPORTER_OTLP_ENDPOINT` ; une commande CLI qui appelle l'API, puis un appel de modèle par la passerelle vers le faux fournisseur SSE.
- Attendu : un seul `traceId` sur le span CLI (en-tête `traceparent`), le span SERVER `<méthode> <gabarit de route>` et le span CLIENT `gen_ai.chat` ; aucun prompt dans le fichier des traces.
- Surfaces : CLI, serveur, passerelle, collecteur OTel
- Source : JOURNAL du 30/10 04:20 (OBS)
- Priorité : P1
- Statut : bloqué : ostrom-server (observability, après socle) + ostrom-cli#8 + RELAY (passerelle)

### E2E-OBS-002 — Rien ne part sans configuration

- Étapes : serveur sans `OTEL_*`, `OSTROM_LANGFUSE_*` ni `OSTROM_POSTHOG_*` ; CLI sans `ostrom telemetry enable` ; un parcours complet (login, `ostrom claude`, porte, oui).
- Attendu : zéro connexion sortante (faux DNS ou proxy qui compte les connexions).
- Surfaces : CLI, serveur
- Source : JOURNAL du 30/10 04:20 (OBS)
- Priorité : P1
- Statut : bloqué : ostrom-server (observability, après socle) + ostrom-cli#8 + RELAY (passerelle)

### E2E-OBS-003 — Statistiques CLI opt-in

- Étapes : `DO_NOT_TRACK=1`, puis `ostrom telemetry enable`, puis `ostrom telemetry status`.
- Attendu : rien n'est envoyé ; `status` dit pourquoi (`DO_NOT_TRACK`).
- Surfaces : CLI
- Source : JOURNAL du 30/10 04:20 (OBS)
- Priorité : P2
- Statut : bloqué : ostrom-server (observability, après socle) + ostrom-cli#8 + RELAY (passerelle)

## SRV : Socle du serveur (santé, instance, erreurs, en-têtes)

Servi par ostrom-server#1 (4fe38dd). Testé de l'extérieur sur l'image distroless du serveur (son `Dockerfile` sur main, autour du binaire natif `linuxX64`) et un vrai PostgreSQL 18, dans le job `ci` du banc : `scenarios/server.e2e.ts`.

### E2E-SRV-001 — Santé : `/health` et `/api/v1/health`

- Étapes : `GET /health`, puis `GET /api/v1/health` (chemin du contrat), sur l'image fraîchement démarrée.
- Attendu : 200, `application/json`, `{"status":"ok","version":"<semver>","checks":{"database":"ok"}}` sur les deux chemins.
- Surfaces : serveur (image), PostgreSQL
- Source : ostrom-server `kernel/http/Health.kt` ; JOURNAL du 30/10 04:40 (SERVER-SOCLE)
- Priorité : jalon
- Statut : codé : `scenarios/server.e2e.ts`

### E2E-SRV-002 — Instance et clé de signature

- Étapes : `GET /api/v1/instance` deux fois, puis `GET /api/v1/instance/keys`.
- Attendu : 200 ; les deux réponses sont identiques (id stable) ; `id` est un UUID, `createdAt` une date ISO ; `signingKey.algorithm` = `ed25519`, `publicKeyPem` se charge comme clé publique Ed25519 (SPKI) ; la clé courante figure dans la liste des clés.
- Surfaces : serveur (image), PostgreSQL
- Source : ostrom-server `modules/instance` ; c'est la clé avec laquelle les reçus se vérifient hors ligne (RECEIPT)
- Priorité : jalon
- Statut : codé : `scenarios/server.e2e.ts`

### E2E-SRV-003 — Corps d'erreur uniforme

- Étapes : `GET /nowhere`, `GET /api/v1/nowhere`, `GET /api/v1/instance/nowhere` ; `POST /health` et `POST /api/v1/instance`.
- Attendu : 404 `{"error":{"type":"not_found","message":"Not found."}}` et 405 `{"error":{"type":"method_not_allowed","message":"Method not allowed."}}`, toujours en `application/json`, jamais une page HTML ni une trace.
- Surfaces : serveur (image)
- Source : ostrom-server `kernel/http/Errors.kt` (CONVENTIONS § 3.3) ; JOURNAL du 30/10 04:40 point 3
- Priorité : P1
- Statut : codé : `scenarios/server.e2e.ts`

### E2E-SRV-004 — En-tête `X-Request-Id`

- Étapes : requête avec `X-Request-Id: e2e-srv_004` ; sans en-tête ; avec une valeur à espaces, de 129 caractères, ou avec `;`.
- Attendu : l'id valide revient tel quel ; sinon un id généré (32 caractères hexadécimaux) le remplace, différent à chaque requête ; aucune valeur du client hors de `[A-Za-z0-9_-]{1,128}` ne revient (elle n'entre donc pas dans les journaux).
- Surfaces : serveur (image)
- Source : ostrom-server `kernel/http/Http.kt` (`isValidRequestId`)
- Priorité : P1
- Statut : codé : `scenarios/server.e2e.ts`

## Récapitulatif

| Famille | Intitulé | Scénarios | dont jalon | P1 | P2 |
|---|---|---|---|---|---|
| LOGIN | Login et premier lancement | 8 | 1 | 6 | 1 |
| CONN | Connexion GitHub et Slack (onboarding) | 15 | 0 | 7 | 8 |
| CLAUDE | `ostrom claude` : lancement, hooks, budget du hook | 19 | 4 | 9 | 6 |
| CODEX | `ostrom codex` et les autres agents | 9 | 0 | 4 | 5 |
| GATE | Porte qui bloque un push | 15 | 5 | 9 | 1 |
| BYPASS | Contournements de la porte (audit du 30/10 et trous connus) | 33 | 12 | 18 | 3 |
| YES | Oui lié au SHA, au dépôt, aux commits montrés ; auteur et approbateurs | 13 | 5 | 6 | 2 |
| YESCLI | Oui depuis le terminal | 4 | 1 | 2 | 1 |
| SLACK | Oui depuis Slack | 5 | 0 | 4 | 1 |
| WEB | Oui et console web | 6 | 1 | 3 | 2 |
| APP | Oui depuis l'app mobile | 6 | 0 | 4 | 2 |
| RESUME | Reprise de session | 5 | 0 | 3 | 2 |
| WAKE | Réveil : signe de vie, session close, fenêtre de réveil | 9 | 0 | 6 | 3 |
| RECEIPT | Reçu signé et vérification hors ligne | 11 | 4 | 5 | 2 |
| COMPAT | Compatibilité à l'octet avec les vecteurs d'or | 12 | 6 | 4 | 2 |
| GHCHECK | Check GitHub `ostrom-gate` | 8 | 0 | 7 | 1 |
| FOREIGN | Dépôt étranger | 4 | 1 | 3 | 0 |
| CACHE | Cache des checks | 6 | 0 | 4 | 2 |
| NOTIFY | Notifications Discord et Slack | 11 | 0 | 6 | 5 |
| MCP | Relais MCP et MCP du harnais | 6 | 0 | 4 | 2 |
| SECRETS | Secrets | 8 | 0 | 4 | 4 |
| GW | Passerelle d'inférence, politique et budgets | 9 | 0 | 7 | 2 |
| SHARE | Partage d'abonnement (comptes mis en commun) | 5 | 0 | 2 | 3 |
| CLOUD | Agents cloud et attentes (waits) | 8 | 0 | 4 | 4 |
| WF | Compilation des workflows en harnais (nœuds) | 14 | 0 | 8 | 6 |
| WFRUN | Exécution de workflows : nœuds étape, check, porte, notification, agent, attente | 8 | 0 | 3 | 5 |
| AUTO | Automations : déclencheurs cron et webhook | 5 | 0 | 0 | 5 |
| ARTIFACT | Artefacts | 4 | 0 | 0 | 4 |
| ONBOARD | Onboarding web et analyse de l'organisation | 10 | 0 | 5 | 5 |
| CONSOLE | Console web : règles, décisions, responsables | 8 | 0 | 3 | 5 |
| ANA | Travailleur d'analyse : essaim et fusion des règles | 5 | 0 | 0 | 5 |
| HARNESS | CLI : harnais, administration, installation | 8 | 0 | 2 | 6 |
| DIST | Distribution et mise à jour | 4 | 0 | 2 | 2 |
| TC | Migration depuis le prototype et compatibilité TeamCode | 2 | 0 | 0 | 2 |
| LOAD | Charge (k6) | 11 | 0 | 2 | 9 |
| DOGFOOD | Le harnais ControlResell en workflows Ostrom | 3 | 0 | 3 | 0 |
| OBS | Observabilité (traces, télémétrie opt-in) | 3 | 0 | 2 | 1 |
| SRV | Socle du serveur (santé, instance, erreurs, en-têtes) | 4 | 2 | 2 | 0 |
| **Total** | | **324** | **42** | **163** | **119** |

Scénarios `jalon` : E2E-BYPASS-001, E2E-BYPASS-005, E2E-BYPASS-006, E2E-BYPASS-007, E2E-BYPASS-008, E2E-BYPASS-015, E2E-BYPASS-020, E2E-BYPASS-021, E2E-BYPASS-023, E2E-BYPASS-024, E2E-BYPASS-026, E2E-BYPASS-028, E2E-CLAUDE-001, E2E-CLAUDE-002, E2E-CLAUDE-003, E2E-CLAUDE-010, E2E-COMPAT-001, E2E-COMPAT-002, E2E-COMPAT-003, E2E-COMPAT-004, E2E-COMPAT-005, E2E-COMPAT-007, E2E-FOREIGN-001, E2E-GATE-001, E2E-GATE-002, E2E-GATE-007, E2E-GATE-010, E2E-GATE-012, E2E-LOGIN-001, E2E-RECEIPT-001, E2E-RECEIPT-002, E2E-RECEIPT-003, E2E-RECEIPT-004, E2E-WEB-001, E2E-YES-001, E2E-YES-002, E2E-YES-003, E2E-YES-006, E2E-YES-012, E2E-YESCLI-002.

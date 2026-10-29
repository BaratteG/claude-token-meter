# token-meter

Mod Claude Code : affiche en temps réel, tout en bas, sous la ligne d'aide du prompt (`? for shortcuts`, le mode auto et ses pastilles), après une ligne vide :

```
🧠 ctx ━━━━━━──── 182k   🕔 5h ────────── 3%  🔄 ━━━━━━──── 2h04   📅 7j ━───────── 10%  🔄 ━━━━━───── 3j3h
🤖 Opus 5.5 · high   💬 session 45k tokens · 1,23 $ API   📈 global 4,07Md tokens
👥 scout Haiku 5.5 · low   worker Sonnet 5.5 · medium
```

Les barres comptent une case par tranche de 10 %. La partie remplie passe du vert au rouge à mesure qu'elle se remplit, le reste est grisé ; le chiffre qui suit, en gras, prend la même couleur. Les libellés sont en gris clair, les icônes dans un gris un peu plus sombre (`#7a7a7a`), sauf 🧠 qui garde ses couleurs. Un emoji ne prend cette couleur que si la police le dessine en monochrome ; une police d'emojis en couleur l'affiche dans ses propres couleurs.

- **ctx** : la taille actuelle de la conversation, relue à chaque requête. La barre se remplit jusqu'au seuil d'autocompact, celui que `/context` indique : pleine, Claude Code compacte la conversation. Sans autocompact, elle se remplit jusqu'à la taille maximale de la fenêtre. C'est le chiffre à surveiller pour savoir quand faire `/clear` ou `/compact`.
- **5h**, **7j** : part consommée des quotas 5 heures et hebdomadaire. La seconde barre, après 🔄, de couleur fixe, avance avec le temps écoulé dans la fenêtre jusqu'à la remise à zéro, suivie du temps restant ; rafraîchie chaque minute. Une barre de quota plus longue que celle du temps : tu consommes plus vite que le rythme qui tiendrait jusqu'à la remise à zéro. Absents en mode API.
- **🤖** : le modèle et l'effort de la dernière requête de la conversation principale (après un `/model` ou `/effort`, à la requête suivante). L'effort manque pour un modèle qui n'en prend pas.
- **👥** : une ligne de plus tant que des sous-agents tournent, lancés en parallèle ou non : leur type, leur modèle et leur effort. Un agent quitte la ligne quand il a fini.
- **session** : tous les tokens traités dans cette session (envoyés, générés, cache), sous-agents compris, mis à jour à chaque requête, et ce qu'ils coûteraient au prix API, le même total que `/cost`.
- **global** : le cumul des tokens de toutes tes sessions, historique importé compris (voir plus bas).

Presque tous ces tokens sont des relectures du cache de prompt : Claude relit tout le contexte à chaque requête, à environ un dixième du prix.

## Installer

Depuis ce dossier, une fois pour toutes :

```
claude plugin marketplace add ~/Documents/DEV/claude-token-meter
claude plugin install token-meter@claude-token-meter
```

Ou pour une seule session : `claude --plugin-dir ~/Documents/DEV/claude-token-meter`.

## Importer l'historique

```
python3 import_history.py
```

Le script additionne les tokens de toutes les requêtes enregistrées dans `~/.claude/projects` (chaque requête comptée une fois) et écrit le total dans `hooks/history.ts`. Le mod y ajoute ensuite le comptage en direct. Tu peux le relancer quand tu veux, par exemple après avoir installé le mod : le comptage en direct repart alors de la nouvelle date de coupure. Claude Code supprime les vieilles sessions au bout de 30 jours par défaut (`cleanupPeriodDays`) : relance l'import avant si tu veux tout garder.

## Limites

- Les tokens comptent depuis le chargement du mod ; après un `--resume` le compteur peut repartir de zéro, alors que le coût API couvre toute la session.
- Deux sessions qui écrivent le total global au même instant peuvent perdre le compte d'une requête.

## Tests

```
claude plugin validate .
claude plugin test .
```

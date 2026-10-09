# token-meter

Mod Claude Code : affiche en temps réel, dans la ligne de statut sous le prompt :

```
Tokens session : 45,2 k · global : 3,12 M · coût API session : 1,23 $ · abonnement utilisé : 3 % (5 h), 10 % (semaine) · ≈ 2,31 $ d'abonnement
```

- **Tokens session** : tous les tokens traités dans cette session (envoyés, générés, cache), sous-agents compris, mis à jour à chaque requête.
- **global** : le même cumul sur toutes tes sessions, historique importé compris (voir plus bas).
- **coût API session** : ce que la session coûterait au prix API, le même total que `/cost`.
- **abonnement utilisé** : part consommée des quotas 5 h et hebdo (absent en mode API).
- **≈ $ d'abonnement** : coût estimé de la session sur ton abonnement, soit les points de quota hebdo consommés × (prix mensuel × 12/52). Il ne s'affiche que si le prix est réglé.

## Installer

Depuis ce dossier, une fois pour toutes :

```
claude plugin marketplace add ~/Documents/DEV/claude-token-meter
claude plugin install token-meter@claude-token-meter
```

Ou pour une seule session : `claude --plugin-dir ~/Documents/DEV/claude-token-meter`.

Prix de l'abonnement : `/config`, ligne *Subscription price (USD/month)* (Pro 20, Max 5x 100, Max 20x 200).

## Importer l'historique

```
python3 import_history.py
```

Le script additionne les tokens de toutes les requêtes enregistrées dans `~/.claude/projects` (chaque requête comptée une fois) et écrit le total dans `hooks/history.ts`. Le mod y ajoute ensuite le comptage en direct. Tu peux le relancer quand tu veux, par exemple après avoir installé le mod : le comptage en direct repart alors de la nouvelle date de coupure. Claude Code supprime les vieilles sessions au bout de 30 jours par défaut (`cleanupPeriodDays`) : relance l'import avant si tu veux tout garder.

## Limites

- Le % hebdo est celui du compte entier : des sessions en parallèle gonflent l'estimation d'abonnement.
- Les tokens comptent depuis le chargement du mod ; après un `--resume` le compteur peut repartir de zéro, alors que le coût API couvre toute la session.
- Deux sessions qui écrivent le total global au même instant peuvent perdre le compte d'une requête.

## Tests

```
claude plugin validate .
claude plugin test .
```

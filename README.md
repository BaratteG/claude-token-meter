# token-meter

Mod Claude Code : affiche en temps réel, dans la ligne de statut sous le prompt :

```
12.4k tokens (in 2.0k · out 400 · cache 10.0k) · API $1.50 · 5h 3% · 7j 10% · Abo ≈ $2.31
```

- **tokens** : cumul de la session, mis à jour à chaque requête au modèle (sous-agents compris).
- **API $** : coût de la session au prix API, le même total que `/cost`.
- **5h / 7j** : part utilisée des fenêtres de limite de l'abonnement (absent en mode API).
- **Abo ≈ $** : coût estimé de la session sur ton abonnement, soit les points de quota hebdo consommés × (prix mensuel × 12/52). Il ne s'affiche que si le prix est réglé.

## Installer

Depuis ce dossier, une fois pour toutes :

```
claude plugin marketplace add ~/Documents/DEV/claude-token-meter
claude plugin install token-meter@claude-token-meter
```

Ou pour une seule session : `claude --plugin-dir ~/Documents/DEV/claude-token-meter`.

Prix de l'abonnement : `/config`, ligne *Subscription price (USD/month)* (Pro 20, Max 5x 100, Max 20x 200).

## Limites

- Le % hebdo est celui du compte entier : des sessions en parallèle gonflent « Abo ».
- Les tokens comptent depuis le chargement du mod ; après un `--resume` le compteur peut repartir de zéro, alors que le coût API couvre toute la session.

## Tests

```
claude plugin validate .
claude plugin test .
```

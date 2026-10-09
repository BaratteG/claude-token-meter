# token-meter

Mod Claude Code (hooks module, API « function hooks », early access, Claude Code 2.1.296).
Ce qu'il affiche et comment l'installer : voir README.md. Répondre en français.

## Vérifier

```
claude plugin validate .
claude plugin test .
```

Types de l'API : `.claude-plugin/types/claude-code/index.d.ts` (écrit par le moteur au chargement, ignoré par git).
Chercher dedans le nom exact (`'turn.step'`, `SessionUsage`, `AbovePrompt: {`) plutôt que deviner.

## Pièges déjà rencontrés

- Une fonction qui reçoit `$` doit être déclarée au niveau du fichier, sinon `validate` refuse le module.
- Tests : une réponse simulée à un appel `$` (`session.usage`, `ui.status`, …) s'enveloppe dans `{ value }`.
  `$.store` n'est pas lisible depuis le test ; on vérifie via ce qui est dessiné.
- `$.ui.status` n'affiche que du texte brut : la couleur exige le bandeau `AbovePrompt` (ui.render).
- `turn.step` est un flux : `async function*` et `const r = yield* next(e)`.
- Changer la forme d'une valeur de `$.state` : renommer sa clé (sinon l'ancienne forme reste en mémoire après un rechargement à chaud).

## Données

- `hooks/history.ts` est généré par `import_history.py` (historique de `~/.claude/projects`,
  chaque requête une fois, valeur max). Relancer l'import remet le compteur direct (`$.store` `total`) à zéro
  via `through` : pas de double comptage.
- 98,8 % des tokens historiques sont des relectures de cache ; contexte moyen 400 k par requête.

## État au 2026-10-10

- Remote : Gitea du NAS (`ssh://git@192.168.1.11:2222/gbaratte/claude-token-meter.git`). Installé au niveau utilisateur (`token-meter@claude-token-meter`), lu directement
  depuis ce dossier : une modification s'applique avec `/reload-plugins`, sans réinstaller.
- `subscriptionUsd` pas encore réglé (`/plugin configure token-meter@claude-token-meter`).
- Idée proposée, non faite : `/compact` automatique au-delà d'un seuil (`$.session.compact()`).
- Non vérifié : rendu réel des couleurs dans le terminal de l'utilisateur.

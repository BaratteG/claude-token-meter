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
  Elle écrase aussi les retours à la ligne (vérifié par l'utilisateur, 2026-10-29).
- Plusieurs lignes en bas de l'écran : `ui.render` sur `PromptHint`, en enveloppant `await next(e)` (la ligne d'aide du moteur)
  dans une `Box` en colonne. Choix de l'utilisateur : le compteur tout en bas, pas dans le bandeau `AbovePrompt`.
  Vérifié sur capture (2026-10-30) : lignes, couleurs, pastilles des agents sur la ligne du moteur. Le compteur a
  `marginTop={1}` et `paddingLeft={2}` pour s'aligner sous cette ligne.
- La police de l'utilisateur dessine la plupart des emojis en monochrome : ils prennent `color` (sauf 🧠, en couleur).
  Elle n'a pas `⏵` (le moteur l'affiche en carrés vides) : vérifier un nouveau symbole sur capture.
- Barres : l'utilisateur veut le trait fin `━` ; les blocs `█▏▎…` (huitièmes, plus précis) sont trop épais, refusés
  (2026-10-30). D'où des demi-cases `╾`, 5 % par cran ; `╾` vérifié dans sa police.
- `turn.step` est un flux : `async function*` et `const r = yield* next(e)`.
- `$.state` se lit figé : toutes les lectures d'un même hook voient l'état du début de ce hook. Une requête du fil
  principal commencée avant celle d'un sous-agent ne voit pas ce qu'il a écrit. Ce qui doit être lu à l'instant
  (les modèles des agents) va dans une variable du module.
- Le `turn.complete` d'un sous-agent ne marque pas sa fin : il termine un tour pour attendre son propre travail en
  arrière-plan (statut `waiting` dans `$.agent.list()`) et en reprend un autre ensuite. C'est le statut qui fait foi.
- Changer la forme d'une valeur de `$.state` : renommer sa clé (sinon l'ancienne forme reste en mémoire après un rechargement à chaud).

## Données

- `hooks/history.ts` est généré par `import_history.py` (historique de `~/.claude/projects`,
  chaque requête une fois, valeur max). Relancer l'import remet le compteur direct (`$.store` `total`) à zéro
  via `through` : pas de double comptage.
- 98,8 % des tokens historiques sont des relectures de cache ; contexte moyen 400 k par requête.
- `reference/claude-config/` : copies de `~/.claude/CLAUDE.md` et `~/.claude/agents/*.md`, à partager avec une autre machine.
  Ne pas les remonter à la racine : un `agents/` à la racine du plugin serait chargé comme agents du mod.

## État au 2026-10-30

- Remote : Gitea du NAS (`ssh://git@192.168.1.11:2222/gbaratte/claude-token-meter.git`). Installé au niveau utilisateur (`token-meter@claude-token-meter`), lu directement
  depuis ce dossier : une modification s'applique avec `/reload-plugins`, sans réinstaller.
- Estimation du coût sur l'abonnement retirée (2026-10-29) : l'utilisateur la jugeait sans intérêt.
- Idée proposée, non faite : `/compact` automatique au-delà d'un seuil (`$.session.compact()`).

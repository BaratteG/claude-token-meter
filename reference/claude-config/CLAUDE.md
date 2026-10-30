# Délégation
- Délègue les sous-tâches à des sous-agents pour garder le contexte principal petit :
  scout pour la recherche/lecture, worker pour l'implémentation cadrée, deep pour les problèmes difficiles.
- Tu es autorisé à choisir l'effort de chaque sous-agent selon la tâche
  (low : recherche simple, medium : implémentation cadrée, high : debug difficile).
- Fais les tâches triviales (1-3 appels d'outils) toi-même plutôt que de déléguer.

| Agent | Modèle | Effort par défaut | Outils |
|---|---|---|---|
| **scout** | Haiku | low | lecture seule (Read, Grep, Glob, Bash) |
| **worker** | Sonnet | medium | tous |
| **deep** | Opus | high | tous |

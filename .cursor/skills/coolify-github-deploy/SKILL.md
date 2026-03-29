---
name: coolify-github-deploy
description: >-
  Connecte un dépôt GitHub à Coolify pour déploiements automatiques (webhook),
  complété par déclenchement manuel via SSH sur le serveur Coolify (artisan tinker).
  USE FOR: Coolify, GitHub auto deploy, webhook push main, SSH deploy SerresV2,
  queue_application_deployment, Hetzner self-hosted, intégration Git source.
---

# Coolify + GitHub — déploiement automatique et SSH

## Contexte typique (ex. SerresV2)

- **Hébergement** : Coolify sur VPS (ex. Hetzner), accès **SSH** `root@<IP>`.
- **Code** : dépôt **GitHub** (ex. `BillyBob36/serresv2`), branche `main`.
- **Coolify** : déploiement par **webhook** sur push ou **forcé** via `docker exec coolify php artisan tinker`.

## 1. Lier GitHub à Coolify (interface)

1. Coolify → **Application** → source **Git** → **GitHub**.
2. App GitHub Coolify ou **PAT** / **deploy key** (selon doc Coolify).
3. Choisir repo + branche **`main`**, activer **Auto Deploy on commit**.
4. Vérifier le **répertoire racine** du build (ex. `app/`).

## 2. SSH côté serveur

Le clone s’exécute sur le VPS : clés / accès configurés dans Coolify.

## 3. Forcer un déploiement (ex. SerresV2)

```bash
ssh root@65.21.146.193 'docker exec coolify php artisan tinker --execute="queue_application_deployment(\App\Models\Application::where(\"uuid\",\"vkwgcwc4ggco0sc8ko8wsw4k\")->first(),\"main\"); echo \"ok\";"'
```

## 4. Après un `git push`

1. Vérifier le build dans Coolify.
2. Appliquer les **migrations SQL** sur PostgreSQL si besoin (ex. `migrations/019_*.sql`).

## 5. Dépannage

Webhooks GitHub (livraisons), logs Coolify, droits Git (token / clé).

Voir `CLAUDE.md` pour Postgres et enrichissement.

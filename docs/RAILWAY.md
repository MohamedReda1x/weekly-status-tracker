# Déployer Weekly Process Status Report sur Railway

Ce guide déploie une base Railway neuve et indépendante. Il ne transfère
pas les données locales. Ne pas lancer seed.py, start-local.ps1 ni les scripts
locaux de restauration pour ce déploiement. Ne pas modifier .env.

## 1. Préparer le dépôt

Publier le code dans un dépôt GitHub privé, avec Dockerfile et railway.json
à la racine du dossier applicatif. Exclure .env, .venv, node_modules,
backups et les dumps ; vérifier le contenu avant de pousser.
Les fichiers .gitignore et .dockerignore existants excluent ces dossiers.
Conserver une référence du commit V4 précédent pour le retour arrière.
Aucune nouvelle dépendance n'est nécessaire.

## 2. Créer les services

1. Créer votre compte Railway et un projet vide (New Project / Empty Project).
2. Dans ce projet, ajouter Database / PostgreSQL. Attendre qu'il soit actif.
3. Ajouter le service applicatif depuis votre dépôt GitHub.
4. Si le dépôt contient wsr comme sous-dossier, définir Root Directory
   sur /wsr ; si wsr est la racine du dépôt, laisser la racine par défaut.
   Vérifier que Railway charge railway.json depuis le dossier applicatif ;
   si nécessaire, définir Config File Path sur /wsr/railway.json.
5. Le builder doit être DOCKERFILE, chemin Dockerfile. Laisser Start Command
   et Pre-deploy Command vides : le CMD exécute déjà alembic upgrade head,
   puis Uvicorn sur 0.0.0.0 et le PORT injecté par Railway.
6. Conserver une seule réplique, une seule région et un seul worker Uvicorn.
   Les compteurs de connexion sont en mémoire, par processus : 20 tentatives
   par IP en 15 minutes (succès compris), plus 5 échecs par e-mail.
   Le compteur IP est protégé contre les appels concurrents et expire après
   15 minutes ; tous les compteurs disparaissent au redémarrage.

## 3. Variables et domaine HTTPS

Dans Variables du service applicatif, ajouter :

- DATABASE_URL : référence au DATABASE_URL privé du service PostgreSQL.
  Utiliser Add Reference ; avec un service nommé Postgres, la valeur est
  ${{Postgres.DATABASE_URL}}. Adapter le nom au service réellement créé.
- COOKIE_SECURE : true (exactement, en minuscules).
- EMAIL_MODE : console.
- ADMIN_EMAIL : votre adresse d'administration.
- ADMIN_PASSWORD : mot de passe unique d'au moins 12 caractères ;
  ni ChangeMe-12345 ni Demo-12345. Utiliser de préférence un secret généré.
- APP_URL : https:// suivi du domaine généré à l'étape suivante.

Dans Settings / Networking / Public Networking du service applicatif,
cliquer Generate Domain. Railway fournit le certificat HTTPS.
Reporter le domaine complet dans APP_URL, par exemple
https://votre-service.up.railway.app, puis appliquer les variables et déployer.
Si Railway exige un premier déploiement pour générer le domaine, utiliser
temporairement APP_URL=https://pending.invalid ; générer ensuite le domaine,
remplacer APP_URL et redéployer avant toute connexion ou invitation.
Laisser Railway injecter PORT et utiliser ce port comme port cible du domaine.

La validation HTTPS/mot de passe intervient au démarrage FastAPI, avant init().
Les migrations s'exécutent auparavant, conformément au CMD du Dockerfile.
Sur une base neuve, les migrations créent le schéma jusqu'à 0003 ; init()
crée le calendrier et le premier administrateur si users est vide.
Modifier ADMIN_PASSWORD ensuite ne change pas le mot de passe d'un compte
déjà créé : utiliser le changement de mot de passe dans l'application.
EMAIL_MODE=console n'envoie aucun e-mail : récupérer les liens d'invitation
dans l'interface administrateur et les transmettre manuellement.

## 4. Vérifier le déploiement

1. Consulter les logs : migrations réussies, puis démarrage Uvicorn.
2. Le healthcheck configuré dans railway.json est /api/health.
   Il doit renvoyer HTTP 200 et {"ok":true} ; il vérifie la connexion SQL.
3. Depuis PowerShell, sans charger .env :

   ```powershell
   $appUrl = 'https://votre-service.up.railway.app'
   $r = Invoke-WebRequest -UseBasicParsing -Uri "$appUrl/api/health"
   $r.StatusCode
   $r.Content
   $r.Headers
   ```

4. Vérifier nosniff, X-Frame-Options=DENY, Referrer-Policy=same-origin,
   Cache-Control=no-store et Strict-Transport-Security=max-age=31536000.
   /docs, /redoc et /openapi.json doivent répondre 404.
5. Ouvrir APP_URL et se connecter avec ADMIN_EMAIL / ADMIN_PASSWORD.
   Vérifier dans le navigateur que le cookie sid est Secure et HttpOnly.
   Les en-têtes de proxy sont pris en charge par Uvicorn ; le code utilise
   request.client.host pour l'IP et ne lit pas lui-même X-Forwarded-For.
   La fiabilité de l'IP transmise par le proxy doit être vérifiée sur Railway.

## 5. Sauvegarder uniquement la base distante

Dans le service PostgreSQL, Settings / Networking, activer Public Access
(TCP Proxy) si nécessaire. Relever l'hôte, le port public, l'utilisateur,
le nom de base et le mot de passe depuis DATABASE_PUBLIC_URL / Variables.
Ne pas utiliser l'hôte privé railway.internal depuis votre ordinateur.
Utiliser pg_dump et pg_restore d'une version majeure égale ou supérieure
à celle du serveur Railway ; PostgreSQL 16 local ne convient pas à un
serveur Railway plus récent. Ne rien installer sans votre accord.

Dans une nouvelle fenêtre PowerShell, saisir exclusivement les coordonnées
distantes Railway :

```powershell
$pgBinRemote = 'C:\Program Files\PostgreSQL\18\bin' # adapter à la version disponible
$dbHostRemote = Read-Host 'Hôte PUBLIC Railway'
$dbPortRemote = Read-Host 'Port PUBLIC Railway'
$dbUserRemote = Read-Host 'Utilisateur Railway'
$dbNameRemote = Read-Host 'Base Railway'
$dbSecretRemote = Read-Host 'Mot de passe Railway' -AsSecureString
$remoteDump = Join-Path $env:USERPROFILE ('railway-backups\before-deploy_{0}.dump' -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
New-Item -ItemType Directory -Force (Split-Path $remoteDump) | Out-Null
try {
    $env:PGPASSWORD = [System.Net.NetworkCredential]::new('', $dbSecretRemote).Password
    & "$pgBinRemote\pg_dump.exe" -h $dbHostRemote -p $dbPortRemote -U $dbUserRemote -d $dbNameRemote -Fc -f $remoteDump
    if ($LASTEXITCODE -ne 0) { throw 'Échec pg_dump distant : ne pas poursuivre le déploiement' }
    & "$pgBinRemote\pg_restore.exe" --list $remoteDump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Dump illisible : ne pas poursuivre le déploiement' }
    Get-Item -LiteralPath $remoteDump | Select-Object FullName,Length
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
}
```

pg_dump écrit directement le fichier, sans pipe binaire PowerShell.
Conserver le dump hors du dépôt, dans un emplacement protégé ; il contient
des données sensibles. La lecture --list vérifie le format, pas une
restauration complète. Tester la restauration dans une base distante
séparée avant de considérer le plan de restauration validé.
Fermer l'accès public PostgreSQL après usage s'il n'est plus nécessaire.

## 6. Retour arrière

Avant chaque mise à jour distante, sauvegarder la base et noter le commit,
le déploiement réussi et les variables du service applicatif.

Pour cette modification, aucune migration nouvelle n'est ajoutée :
le schéma reste 0003. Dans le service applicatif / Deployments, ouvrir
le menu du déploiement réussi précédent, choisir Rollback et confirmer.
Railway restaure son image et ses variables personnalisées ; vérifier
DATABASE_URL, APP_URL et COOKIE_SECURE, puis /api/health et la connexion.
La base PostgreSQL n'est pas restaurée par ce rollback applicatif.
Si aucun déploiement précédent n'est disponible, redéployer le commit V4
conservé avec les variables distantes appropriées.

Si une future migration rend le code précédent incompatible, arrêter
les écritures et ne pas improviser un downgrade. Restaurer d'abord le dump
dans un NOUVEAU service PostgreSQL Railway, vérifier le schéma et les données,
puis relier DATABASE_URL du code compatible à ce service et redéployer.
Conserver la base actuelle jusqu'à validation. Toute restauration nécessite
une décision explicite ; les données postérieures au dump ne sont pas incluses.
Ne jamais utiliser les scripts locaux de restauration pour Railway.

## 7. Tests et limites

Tests de sécurité sans PostgreSQL :

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_security_unit.py -v
```

Le fichier simule les accès SQL et interdit toute connexion psycopg réelle.
Il couvre les limites IP/e-mail, l'expiration, la concurrence, les en-têtes,
les routes de documentation désactivées et la validation avant init().
Ne pas lancer la suite pytest existante : sa fixture recrée le schéma.
Les tests d'intégration exigent votre accord et TEST_DATABASE_URL pointant
vers une base séparée explicitement identifiée.
Le build Docker, les migrations distantes, HTTPS, le proxy Railway et la
restauration réelle restent à vérifier dans l'environnement de déploiement.

Sources officielles :
- https://docs.railway.com/config-as-code/reference
- https://docs.railway.com/databases/postgresql
- https://docs.railway.com/networking/public-networking
- https://docs.railway.com/deployments/deployment-actions

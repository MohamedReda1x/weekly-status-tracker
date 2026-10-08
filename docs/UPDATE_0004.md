# Mise à jour 0004 : présentation, affiliations et dates de congé

La mise à jour 0005 remplace la règle de suppression décrite ici :
Delete accepte désormais les activités renseignées et les place dans Trash,
avec leurs jours exclus des totaux. Lire UPDATE_0005.md pour ce déploiement.

Cette mise à jour est préparée dans les fichiers. Aucune migration ni écriture
sur une base réelle n'a été exécutée pendant sa préparation.

## Fonctionnement

- Logo SEGULA identique au fichier fourni ; progression numérique affichée avec %.
- « Alstom Estimation », intervalle From / To appliqué en une fois.
  La grille conserve ses colonnes hebdomadaires : elle montre les périodes
  qui intersectent l'intervalle, sans découper leurs valeurs enregistrées.
- Les semaines anciennes sont modifiables, sans hachures. Les activités
  archivées restent non modifiables ; Restore les réactive.
- Leave / PH et totaux restent visibles en bas de la grille pendant le
  défilement des activités, nombres Leave / PH rouges. En-têtes et totaux :
  fond bleu foncé et texte blanc. Undo / Redo restent disponibles.
  Add activity et le commentaire sont séparés sans chevauchement.
  La corbeille reste visible mais désactivée si des jours sont enregistrés,
  avec une explication au survol ; Archive conserve ces jours et les totaux.
- Sous la grille : saisie et dix derniers commentaires de la semaine courante.
  L'enregistrement peut contenir un commentaire sans modification de cellule.
  Les anciens commentaires restent dans Comments & history.
- Monthly BL et Accounts sont réservés au manager dans la navigation.
- Leave dates apparaît après Comments & history. Enregistrer d'abord les durées
  dans la grille ; puis sélectionner les dates ouvrées correspondantes.
  Chaque clic enregistre immédiatement la sélection, avec contrôle des conflits.
  Les dates ne modifient jamais les durées. Une date peut représenter une journée
  partielle ; aucune répartition quotidienne des durées n'est inventée.
  Les dates existantes restent conservées si la durée passe à zéro, avec indication.
- Accounts : choisir métier, rôle professionnel et client lors de la création
  d'un employé ou ouvrir Affiliation sous son nom pour modifier ces choix.
  Le métier limite les rôles proposés ; changer de métier remet le rôle à zéro.
  Le serveur et une contrainte SQL vérifient cette correspondance.
  Le client est indépendant. Les droits Manager/Employee sont distincts.
  Le métier/rôle/client du propriétaire du tracker sont visibles au-dessus du contenu.
- Le manager peut combiner les filtres Trade / Professional role / Client
  pour sélectionner les employés. Le rôle proposé dépend du métier choisi.
  Un filtre sans résultat ne conserve pas l'ancien tracker à l'écran.
  Les modifications non enregistrées sont protégées avant de changer d'employé.
- Accounts / Manage trades, professional roles and clients permet d'ajouter des choix.

## Fichiers de la mise à jour

Backend : app.py, export_xlsx.py, migrations/versions/0004_affiliations_leave_dates.py.
Frontend : src/App.jsx, src/Grid.jsx, src/Accounts.jsx, src/style.css,
src/DateRangePicker.jsx, src/CurrentWeekComments.jsx, src/LeaveDates.jsx,
src/Affiliations.jsx et src/assets/segula-logo.png.
Tests : tests/test_security_unit.py, tests/test_app.py,
frontend/tests/undo.test.jsx, frontend/tests/ui.test.jsx,
frontend/tests/branding.test.jsx, frontend/tests/affiliations-leave.test.jsx.
Documentation : docs/RAILWAY.md et ce guide.

## Référentiels initiaux

Train Control : VTE, CE, SDE, SwQA.
Train System : SE, Sub-SE, RM.
Client : Alstom Petite-Forêt.

Les affiliations des utilisateurs existants ne sont pas choisies automatiquement.
Le champ client historique des trackers est conservé.

## Déploiement Railway

1. Sauvegarder la base DISTANTE avec la procédure pg_dump de RAILWAY.md.
   Noter le commit et le déploiement actif avant mise à jour.
2. Vérifier le diff, puis committer les fichiers de cette mise à jour et pousser
   la branche reliée à Railway. Aucun fichier .env ou dump ne doit être ajouté.
3. Le Dockerfile existant exécute alembic upgrade head avant Uvicorn.
   Ce déploiement appliquera donc 0004 à la base Railway référencée par DATABASE_URL.
   Ne pas lancer start-local.ps1 ou Alembic localement pour cette mise à jour.
4. Vérifier les logs de migration 0003 → 0004 puis /api/health.
5. Vérifier avec un manager les référentiels et l'affiliation d'un employé ;
   vérifier avec un employé les onglets visibles, la grille, Undo/Redo,
   le commentaire courant et les dates de congé.

Rollback : redéployer l'image/commit précédent selon RAILWAY.md, en gardant
le schéma 0004. Les ajouts sont compatibles avec le code précédent.
Ne pas faire de downgrade SQL : il supprimerait les nouvelles dates et affiliations.
Une restauration distante relève d'une décision séparée et d'une sauvegarde validée.

## Validation locale sans base

Tests frontend ciblés (fetch simulé) :
npm --prefix frontend run test -- tests/undo.test.jsx tests/branding.test.jsx tests/affiliations-leave.test.jsx

Tests backend (SQL simulé, connexion psycopg réelle interdite) :
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p test_security_unit.py -v

Build frontend :
npm --prefix frontend run build

Ne pas lancer frontend/tests/ui.test.jsx ni la suite pytest sur la base réelle.
Le build Docker, l'application effective de 0004 sur PostgreSQL, la vérification
visuelle dans un navigateur et le déploiement Railway ne sont pas validés ici.

# Mise à jour 0005 : suppression récupérable sans jours dans les totaux

## Comportement

Delete déplace une activité dans Trash, même si des jours sont enregistrés.
Elle disparaît de la grille, des totaux hebdomadaires/mensuels, du total de
mission, des calculs de capacité et des exports Excel. Les jours de toutes
les périodes de cette activité sont concernés.

Les données et l'historique sont conservés. Trash, sous la grille, permet de
restaurer l'activité : ses jours sont alors recomptés. Son ancien état
archivé reste conservé. Une restauration est refusée si elle dépasse la
capacité d'une semaine ; corriger les jours des autres activités avant de réessayer.

Archive reste distinct : ses jours restent dans les totaux.
Les congés et jours fériés du tracker ne sont pas modifiés par la suppression
d'une activité. Les modifications en cours de la ligne doivent être
enregistrées ou abandonnées avant Delete ; toutes les modifications de grille
doivent l'être avant une restauration.

## Déploiement

La migration 0005 ajoute activities.deleted, avec 0 par défaut.
Elle ne supprime aucun enregistrement et toutes les activités existantes
restent actives jusqu'à une suppression explicite.

1. Faire une nouvelle sauvegarde de la base Railway avec pg_dump compatible.
2. Commiter et pousser les fichiers de cette mise à jour.
3. Le Dockerfile applique 0005 avant le démarrage de l'application.
4. Vérifier les logs 0004 → 0005, /api/health, une suppression et une restauration.
   Vérifier aussi les totaux et un export Excel.
5. Ne pas lancer de migration ni start-local.ps1 sur la base locale.

Le code antérieur à 0005 ignore le drapeau deleted : un rollback vers cette
ancienne version ferait réapparaître les activités supprimées et leurs totaux.
Ne pas revenir à cette version sans décision explicite. Privilégier une
correction compatible avec 0005. Le downgrade refuse de retirer la colonne
si la corbeille contient des activités. Aucune restauration automatique de base.

## Fichiers et validation

Modifiés : app.py, frontend/src/Grid.jsx, frontend/src/style.css,
frontend/tests/undo.test.jsx, frontend/tests/ui.test.jsx,
tests/test_security_unit.py, docs/RAILWAY.md et docs/UPDATE_0004.md.
Ajoutés : migrations/versions/0005_recoverable_activity_deletion.py et ce guide.

32 tests frontend avec API simulée et 20 tests backend avec SQL simulé réussis.
Le test backend interdit toute connexion psycopg réelle. Le build frontend réussit.
Les tests d'intégration, le build Docker, le rendu navigateur et la migration
réelle PostgreSQL n'ont pas été exécutés. Aucune nouvelle dépendance.

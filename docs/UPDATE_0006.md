# Mise à jour 0006 : statuts, comptes et filtres

Les statuts Not started et Stand-by sont ajoutés à WIP et Completed.
Les activités existantes conservent leur statut. Les couleurs sont distinctes
dans la grille, sur mobile et dans Excel.

Delete supprime désormais définitivement une activité, ses jours et son
historique lié. Une confirmation explique que cette action ne peut pas être
annulée par Undo. Archive conserve les jours et permet de rétablir l'édition.
La corbeille et l'API de restauration sont retirées. Les activités déjà
masquées par 0005 restent masquées et exclues des totaux : cette migration
ne purge pas automatiquement les anciennes données de corbeille.

Accounts propose Deactivate / Reactivate et Delete account :

- Désactiver bloque l'accès, révoque sessions et liens, conserve les données.
  Le profil disparaît du sélecteur ; sa réactivation est disponible dans Accounts.
- Supprimer définitivement un employé efface son tracker, ses activités/jours,
  congés et dates, commentaires/historique et messages associés. Ses commentaires
  et événements d'historique sur d'autres trackers sont aussi supprimés.
  Les référentiels métier/rôle/client et le calendrier commun sont conservés.
- La suppression est réservée au manager, et ne permet pas de supprimer un manager.
  Personne ne peut désactiver son propre compte.
- Les suppressions et désactivations sont transactionnelles.
Le sélecteur de profil est regroupé avec les trois filtres. Les changements
non enregistrés sont protégés avant l'ouverture d'Accounts et le changement de profil.

## Déployer sur Railway

1. Faire une nouvelle sauvegarde distante avec PostgreSQL 18 selon la section 5
   de RAILWAY.md ; ne poursuivre que si pg_dump et la lecture du dump réussissent.
2. Examiner les fichiers avant de commiter :

```powershell
git add app.py export_xlsx.py
git add frontend/src/App.jsx frontend/src/Grid.jsx frontend/src/Accounts.jsx frontend/src/style.css
git add frontend/tests/undo.test.jsx frontend/tests/ui.test.jsx frontend/tests/branding.test.jsx frontend/tests/accounts.test.jsx tests/test_security_unit.py
git add migrations/versions/0006_activity_statuses.py docs/UPDATE_0006.md docs/RAILWAY.md
git --no-pager diff --cached --stat
git commit -m "Statuts, suppression definitive et gestion des comptes"
git push origin main
git rev-parse --short HEAD
```

3. Vérifier le commit dans Railway et les logs de migration 0005 → 0006
   (les migrations antérieures sont appliquées si nécessaires), puis /api/health.
4. Ctrl+F5 et vérifier les quatre statuts, l'export et le filtrage.
   Tester les suppressions seulement sur des activités/comptes créés pour cela.
   Tester la désactivation et l'impossibilité de connexion avec un compte de test.
5. Ne pas appliquer de migration à la base locale et ne pas lancer start-local.ps1.

La migration 0006 remplace uniquement la contrainte de statut.
Elle ne supprime ni ne réécrit de données.

## Retour arrière

Un rollback applicatif ne récupère aucune suppression définitive.
Une récupération exige une sauvegarde antérieure et une restauration dans
une base distante séparée, avec décision explicite avant bascule.
Les nouvelles écritures après la sauvegarde doivent être prises en compte.

Le code antérieur ne sait pas modifier les nouveaux statuts et la version 0005
réintroduirait la suppression récupérable. Privilégier une correction compatible.
Ne pas improviser un downgrade : celui de 0006 échoue si des activités utilisent
encore les nouveaux statuts, sans les convertir automatiquement.

## Vérifications

38 tests frontend ciblés avec API simulée et 25 tests de sécurité avec SQL simulé réussis.
Aucune connexion à PostgreSQL réel n'est autorisée dans ces tests.
Build frontend exécuté. La suite ui.test.jsx qui utilise un backend réel
n'est pas exécutée, ni pytest.

La migration réelle PostgreSQL, les cascades sur une base réelle, le build Docker,
le rendu visuel dans un navigateur et Railway restent à vérifier.
Aucune modification de .env, seed.py ou de la base locale. Aucune dépendance ajoutée.

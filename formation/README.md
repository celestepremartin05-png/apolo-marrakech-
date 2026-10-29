# Espace membre · Formation Apolo

Plateforme de formation en ligne (page unique, sans compilation) servie à l'adresse `/formation/`.

- `index.html`, `app.js`, `app.css` : l'application.
- `config.js` : adresse du projet Supabase de la formation et sa clé publique.
- `supabase/setup.sql` : installation de la base (à coller une fois dans Supabase > SQL Editor).

Les comptes, vidéos, progressions et messages sont dans Supabase, protégés par la connexion
(e-mail + mot de passe). Seules les adresses ajoutées par l'admin (onglet Élèves) peuvent créer un compte.
Base séparée de Pégase.

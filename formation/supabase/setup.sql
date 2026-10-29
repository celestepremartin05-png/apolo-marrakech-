-- =====================================================================
-- Formation Apolo — installation de la base Supabase
-- À coller une seule fois dans Supabase > SQL Editor > New query > Run
-- Peut être relancé sans risque : il ne supprime aucune donnée.
-- =====================================================================

-- 1. Les membres autorisés (élèves et admin) ---------------------------
create table if not exists public.members (
  email      text primary key,
  full_name  text,
  role       text not null default 'student' check (role in ('admin','student')),
  formule    text not null default 'Accès complet',
  created_at timestamptz not null default now()
);
alter table public.members enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(auth.jwt() ->> 'email') and role = 'admin'
  )
$$;

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members
    where lower(email) = lower(auth.jwt() ->> 'email')
  )
$$;

drop policy if exists members_read on public.members;
create policy members_read on public.members for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or public.is_admin());
drop policy if exists members_admin_insert on public.members;
create policy members_admin_insert on public.members for insert to authenticated
  with check (public.is_admin());
drop policy if exists members_admin_update on public.members;
create policy members_admin_update on public.members for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists members_admin_delete on public.members;
create policy members_admin_delete on public.members for delete to authenticated
  using (public.is_admin() and lower(email) <> lower(auth.jwt() ->> 'email'));

-- 2. Personne d'autre ne peut créer de compte --------------------------
create or replace function public.only_members_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where lower(email) = lower(new.email)) then
    raise exception 'Adresse non autorisée';
  end if;
  return new;
end $$;
drop trigger if exists only_members_signup on auth.users;
create trigger only_members_signup before insert on auth.users
  for each row execute function public.only_members_signup();

-- 3. Les vidéos de la formation ----------------------------------------
create table if not exists public.lessons (
  id           text primary key,          -- ex. m01-03
  module_no    int  not null,
  module_title text not null,
  level        int  not null check (level between 1 and 4),
  position     int  not null,
  title        text not null,
  video_old    text,                       -- lien Vimeo, ancienne version
  video_new    text,                       -- lien Vimeo, nouvelle version
  use_new      boolean not null default false, -- les élèves voient la nouvelle version
  summary      text,
  practice     text,
  updated_at   timestamptz not null default now()
);
alter table public.lessons enable row level security;
drop policy if exists lessons_read on public.lessons;
create policy lessons_read on public.lessons for select to authenticated
  using (public.is_member());
drop policy if exists lessons_admin_write on public.lessons;
create policy lessons_admin_write on public.lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 4. La progression de chaque élève ------------------------------------
create table if not exists public.progress (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  email     text not null default lower(auth.jwt() ->> 'email'),
  lesson_id text not null references public.lessons on delete cascade,
  done_at   timestamptz not null default now(),
  primary key (user_id, lesson_id)
);
alter table public.progress enable row level security;
drop policy if exists progress_own on public.progress;
create policy progress_own on public.progress for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.is_member()
              and lower(email) = lower(auth.jwt() ->> 'email'));
drop policy if exists progress_admin_read on public.progress;
create policy progress_admin_read on public.progress for select to authenticated
  using (public.is_admin());

-- 5. La messagerie élève <-> admin -------------------------------------
create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  student_email   text not null,
  from_admin      boolean not null default false,
  body            text not null check (char_length(body) between 1 and 4000),
  context         text,
  read_by_admin   boolean not null default false,
  read_by_student boolean not null default false,
  created_at      timestamptz not null default now()
);
create index if not exists messages_student_idx on public.messages (lower(student_email), created_at);
alter table public.messages enable row level security;
drop policy if exists messages_read on public.messages;
create policy messages_read on public.messages for select to authenticated
  using (lower(student_email) = lower(auth.jwt() ->> 'email') or public.is_admin());
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    public.is_admin()
    or (from_admin = false and public.is_member()
        and lower(student_email) = lower(auth.jwt() ->> 'email'))
  );
drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages for update to authenticated
  using (lower(student_email) = lower(auth.jwt() ->> 'email') or public.is_admin())
  with check (lower(student_email) = lower(auth.jwt() ->> 'email') or public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;

-- 6. Le programme (12 modules) — n'écrase pas les liens déjà saisis ----
insert into public.lessons (id, module_no, module_title, level, position, title) values
('m01-01',1,'Les fondations',1,1,'Bienvenue : présentation de Catherine et de la formation'),
('m01-02',1,'Les fondations',1,2,'Comprendre le cheval'),
('m01-03',1,'Les fondations',1,3,'Lire le langage du cheval : oreilles, regard, stress et détente'),
('m01-04',1,'Les fondations',1,4,'Présentation des chevaux'),
('m01-05',1,'Les fondations',1,5,'Présentation du matériel'),
('m01-06',1,'Les fondations',1,6,'Les nœuds : attache-barrière et anneau'),
('m01-07',1,'Les fondations',1,7,'La récompense : friandise et renforcement positif'),
('m02-01',2,'Sécurité au box & premières manipulations',1,1,'Aborder le cheval au box'),
('m02-02',2,'Sécurité au box & premières manipulations',1,2,'Mettre et enlever le licol'),
('m02-03',2,'Sécurité au box & premières manipulations',1,3,'Entrer et sortir du box en sécurité'),
('m02-04',2,'Sécurité au box & premières manipulations',1,4,'Mener son cheval en main'),
('m02-05',2,'Sécurité au box & premières manipulations',1,5,'Attacher son cheval en sécurité'),
('m03-01',3,'Leadership & espace personnel',1,1,'Définir son espace personnel'),
('m03-02',3,'Leadership & espace personnel',1,2,'Pression et relâcher de la pression'),
('m03-03',3,'Leadership & espace personnel',1,3,'Manipulations de base en carrière'),
('m03-04',3,'Leadership & espace personnel',1,4,'Reculer par sensation avec le stick'),
('m03-05',3,'Leadership & espace personnel',1,5,'Marcher ensemble : s''arrêter, repartir, tourner'),
('m03-06',3,'Leadership & espace personnel',1,6,'Déplacer les hanches et les épaules'),
('m04-01',4,'Soins & vie quotidienne',1,1,'Le pansage'),
('m04-02',4,'Soins & vie quotidienne',1,2,'Donner les pieds et contrôle des pieds'),
('m04-03',4,'Soins & vie quotidienne',1,3,'Exercice barre au sol'),
('m04-04',4,'Soins & vie quotidienne',1,4,'Zones sensibles : bouche et oreilles'),
('m04-05',4,'Soins & vie quotidienne',1,5,'Zones sensibles : parties intimes'),
('m04-06',4,'Soins & vie quotidienne',1,6,'Préparer son cheval au vétérinaire et au maréchal'),
('m05-01',5,'Connexion & confiance',2,1,'Introduction'),
('m05-02',5,'Connexion & confiance',2,2,'Le rôle de l''humain : stabilité, posture, respiration'),
('m05-03',5,'Connexion & confiance',2,3,'Créer le lien : passer du temps sans rien demander'),
('m05-04',5,'Connexion & confiance',2,4,'Gagner la confiance de son cheval'),
('m05-05',5,'Connexion & confiance',2,5,'Avoir confiance en son cheval'),
('m05-06',5,'Connexion & confiance',2,6,'Les signes que la confiance s''installe'),
('m06-01',6,'Désensibilisation : stick & cordelette',2,1,'Le principe : approche, retrait, seuil de tolérance'),
('m06-02',6,'Désensibilisation : stick & cordelette',2,2,'Stick : désensibilisation zones 1, 2, 3'),
('m06-03',6,'Désensibilisation : stick & cordelette',2,3,'Socle stick : base 1'),
('m06-04',6,'Désensibilisation : stick & cordelette',2,4,'Socle stick : base 2'),
('m06-05',6,'Désensibilisation : stick & cordelette',2,5,'Cordelette : passage au-dessus'),
('m06-06',6,'Désensibilisation : stick & cordelette',2,6,'Cordelette : mouvement, bruit, lancer'),
('m07-01',7,'Objets difficiles & passages',2,1,'Plastique (1)'),
('m07-02',7,'Objets difficiles & passages',2,2,'Plastique (2)'),
('m07-03',7,'Objets difficiles & passages',2,3,'Gros plastique'),
('m07-04',7,'Objets difficiles & passages',2,4,'Bâche au sol'),
('m07-05',7,'Objets difficiles & passages',2,5,'Désensibilisation à la longe'),
('m07-06',7,'Objets difficiles & passages',2,6,'Passage étroit'),
('m07-07',7,'Objets difficiles & passages',2,7,'Résultat final'),
('m08-01',8,'La peur',2,1,'Comprendre la peur chez le cheval : l''instinct de fuite'),
('m08-02',8,'La peur',2,2,'Repérer les signes avant la réaction'),
('m08-03',8,'La peur',2,3,'Réagir en sécurité quand le cheval panique'),
('m08-04',8,'La peur',2,4,'Le cheval qui a peur de tout : plan de travail progressif'),
('m08-05',8,'La peur',2,5,'Situations courantes : vent, flaque, voiture, chien, nouveau lieu'),
('m08-06',8,'La peur',2,6,'Rassurer sans renforcer la peur'),
('m08-07',8,'La peur',2,7,'Gérer sa propre peur face aux réactions du cheval'),
('m09-01',9,'Contrôle à distance',3,1,'Introduction'),
('m09-02',9,'Contrôle à distance',3,2,'Le contrôle'),
('m09-03',9,'Contrôle à distance',3,3,'Préparation : vérifier les bases'),
('m09-04',9,'Contrôle à distance',3,4,'Cercle proche'),
('m09-05',9,'Contrôle à distance',3,5,'Faire venir le cheval'),
('m09-06',9,'Contrôle à distance',3,6,'Gestion émotionnelle'),
('m10-01',10,'Directions, impulsion & allures',3,1,'Directions : gauche et droite'),
('m10-02',10,'Directions, impulsion & allures',3,2,'Impulsion et engagement'),
('m10-03',10,'Directions, impulsion & allures',3,3,'Rappel et changement de direction'),
('m10-04',10,'Directions, impulsion & allures',3,4,'Contrôle des allures'),
('m11-01',11,'Accès liberté',3,1,'Les conditions pour passer en liberté'),
('m11-02',11,'Accès liberté',3,2,'Premiers exercices en liberté'),
('m11-03',11,'Accès liberté',3,3,'Démonstration finale'),
('m12-01',12,'Débourrage',4,1,'Avertissement sécurité et prérequis'),
('m12-02',12,'Débourrage',4,2,'Vérifier les bases à pied du jeune cheval'),
('m12-03',12,'Débourrage',4,3,'Découverte du tapis et du surfaix'),
('m12-04',12,'Débourrage',4,4,'Découverte de la selle'),
('m12-05',12,'Débourrage',4,5,'Le filet et le mors'),
('m12-06',12,'Débourrage',4,6,'Travail à la longe sellé'),
('m12-07',12,'Débourrage',4,7,'Préparer au poids : s''appuyer, le montoir'),
('m12-08',12,'Débourrage',4,8,'Premier contact sur le dos'),
('m12-09',12,'Débourrage',4,9,'Les erreurs à éviter')
on conflict (id) do nothing;

-- 7. Ton compte admin : remplace l'adresse ci-dessous par la tienne (en minuscules),
--    puis crée ton compte sur la page de connexion avec cette adresse.
insert into public.members (email, full_name, role)
values ('ton-adresse@exemple.com', 'Admin Apolo', 'admin')
on conflict (email) do update set role = 'admin';

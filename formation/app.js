/* Espace membre Apolo — formation en ligne
   Comptes, vidéos, progression et messages : tout est dans Supabase, protégé par la connexion. */
(function () {
  'use strict';

  var CFG = window.FORMATION_CONFIG || {};
  var root = document.getElementById('app');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var LEVEL_NAME = { 1: 'Fondations', 2: 'Connexion', 3: 'Maîtrise', 4: 'Expert' };
  var LEVEL_FILL = { 1: '#D8C3A0', 2: '#D98E5E', 3: '#9E4F26', 4: '#B28A45' };
  // Stages au domaine : [année, mois (0 = janvier), premier jour, dernier jour]
  var STAGES = [[2026, 10, 23, 26], [2026, 11, 7, 10], [2027, 0, 11, 14]];
  var MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  var DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  var ICON = {
    chevron: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    check: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg>',
    play: '<svg width="30" height="30" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>'
  };

  if (!CFG.url || !CFG.anonKey || !window.supabase) {
    root.innerHTML = '<div class="auth"><div class="auth-card">' + brandBlock() +
      '<h1>Bientôt disponible</h1><p class="lead">L\'espace membre est en cours d\'installation. Reviens un peu plus tard.</p></div></div>';
    return;
  }

  var sb = window.supabase.createClient(CFG.url, CFG.anonKey);

  var today = new Date();
  var firstStage = STAGES.find(function (s) { return new Date(s[0], s[1], s[3]) >= new Date(today.getFullYear(), today.getMonth(), today.getDate()); });

  var S = {
    session: null, me: null, loading: true, notAllowed: false,
    authMode: 'login', authErr: '', authInfo: '', busy: false, recovery: false,
    lessons: [], done: {}, tab: 'formation', open: null, curId: null,
    preview: false, version: null,
    calY: firstStage ? firstStage[0] : today.getFullYear(), calM: firstStage ? firstStage[1] : today.getMonth(),
    msgs: [], members: [], allProgress: [], inboxSel: null,
    f: {}, toast: '', channel: null, marking: false
  };

  function brandBlock() {
    return '<div class="auth-brand"><img src="../embleme_apolo.png" alt=""><span class="name">APOLO</span><span class="sub">ESPACE MEMBRE</span></div>';
  }

  /* ---------- Règles d'affichage ---------- */
  function isAdmin() { return !!(S.me && S.me.role === 'admin'); }
  function asStudent() { return !isAdmin() || S.preview; }
  function studentVideo(l) { return l.use_new ? l.video_new : l.video_old; }
  function videoFor(l) {
    if (asStudent()) return studentVideo(l);
    var v = S.version || (l.use_new ? 'new' : 'old');
    return v === 'new' ? l.video_new : l.video_old;
  }
  function visibleLessons() {
    return asStudent() ? S.lessons.filter(function (l) { return !!studentVideo(l); }) : S.lessons;
  }
  function modules() {
    var map = {}, out = [];
    visibleLessons().forEach(function (l) {
      if (!map[l.module_no]) { map[l.module_no] = { no: l.module_no, title: l.module_title, level: l.level, lessons: [] }; out.push(map[l.module_no]); }
      map[l.module_no].lessons.push(l);
    });
    return out;
  }
  function current() {
    var vis = visibleLessons();
    if (!vis.length) return null;
    var c = vis.find(function (l) { return l.id === S.curId; });
    if (!c) c = vis.find(function (l) { return !S.done[l.id]; }) || vis[0];
    S.curId = c.id;
    return c;
  }
  function unreadCount() {
    if (!S.me) return 0;
    if (isAdmin() && !S.preview) return S.msgs.filter(function (m) { return !m.from_admin && !m.read_by_admin; }).length;
    var me = S.me.email.toLowerCase();
    return S.msgs.filter(function (m) { return m.from_admin && !m.read_by_student && m.student_email.toLowerCase() === me; }).length;
  }

  function vimeoEmbed(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    var m = s.match(/player\.vimeo\.com\/video\/(\d+)/i) || s.match(/vimeo\.com\/(?:[^\s"']*?\/)?(\d{6,})(?:\/([0-9a-f]{6,}))?/i);
    if (!m) return null;
    var hash = m[2] || (s.match(/[?&]h=([0-9a-f]+)/i) || [])[1];
    return 'https://player.vimeo.com/video/' + m[1] + '?' + (hash ? 'h=' + hash + '&' : '') + 'dnt=1&title=0&byline=0&portrait=0&color=C87342';
  }

  function fmtDate(d) {
    var x = new Date(d);
    return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function fmtTime(d) {
    var x = new Date(d);
    return x.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) + ' · ' + x.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Données ---------- */
  async function loadAll() {
    S.loading = true; render();
    var email = (S.session.user.email || '').toLowerCase();
    var r = await sb.from('members').select('*').eq('email', email).maybeSingle();
    if (r.error || !r.data) { S.me = null; S.notAllowed = true; S.loading = false; render(); return; }
    S.me = r.data; S.notAllowed = false;
    var res = await Promise.all([
      sb.from('lessons').select('*').order('module_no').order('position'),
      sb.from('progress').select('lesson_id').eq('user_id', S.session.user.id)
    ]);
    S.lessons = res[0].data || [];
    S.done = {};
    (res[1].data || []).forEach(function (p) { S.done[p.lesson_id] = true; });
    await loadMsgs();
    if (isAdmin()) await loadMembers();
    var c = current();
    if (c && S.open == null) S.open = c.module_no;
    subscribe();
    S.loading = false;
    render();
  }
  async function loadMsgs() {
    var r = await sb.from('messages').select('*').order('created_at', { ascending: true });
    S.msgs = r.data || [];
  }
  async function loadMembers() {
    var res = await Promise.all([
      sb.from('members').select('*').order('created_at', { ascending: false }),
      sb.from('progress').select('email, lesson_id')
    ]);
    S.members = res[0].data || [];
    S.allProgress = res[1].data || [];
  }
  function subscribe() {
    if (S.channel) return;
    S.channel = sb.channel('messages-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, function () {
        loadMsgs().then(render);
      })
      .subscribe();
  }

  /* ---------- Rendu ---------- */
  function render() {
    var a = document.activeElement, focusId = a && a.id, s1 = null, s2 = null;
    try { if (a && a.selectionStart != null) { s1 = a.selectionStart; s2 = a.selectionEnd; } } catch (e) { /* champ sans sélection */ }

    var html;
    if (S.recovery) html = viewNewPassword();
    else if (!S.session) html = viewAuth();
    else if (S.loading) html = '<div class="boot">Chargement…</div>';
    else if (S.notAllowed) html = viewNotAllowed();
    else html = shell();
    if (S.toast) html += '<div class="toast" role="status">' + esc(S.toast) + '</div>';
    root.innerHTML = html;

    if (focusId) {
      var el = document.getElementById(focusId);
      if (el) { el.focus(); try { if (s1 != null) el.setSelectionRange(s1, s2); } catch (e) { /* ignore */ } }
    }
    afterRender();
  }

  function afterRender() {
    // Marque comme lus les messages affichés
    if (S.marking || !S.me) return;
    var ids = [];
    var studentView = asStudent() && (S.tab === 'perso');
    if (studentView) {
      var me = S.me.email.toLowerCase();
      ids = S.msgs.filter(function (m) { return m.from_admin && !m.read_by_student && m.student_email.toLowerCase() === me; }).map(function (m) { return m.id; });
      if (ids.length) markRead(ids, { read_by_student: true });
    } else if (isAdmin() && !S.preview && S.tab === 'inbox' && S.inboxSel) {
      ids = S.msgs.filter(function (m) { return !m.from_admin && !m.read_by_admin && m.student_email.toLowerCase() === S.inboxSel; }).map(function (m) { return m.id; });
      if (ids.length) markRead(ids, { read_by_admin: true });
    }
    var th = document.querySelector('.thread');
    if (th) th.scrollTop = th.scrollHeight;
  }
  async function markRead(ids, patch) {
    S.marking = true;
    await sb.from('messages').update(patch).in('id', ids);
    S.msgs.forEach(function (m) { if (ids.indexOf(m.id) >= 0) Object.assign(m, patch); });
    S.marking = false;
    render();
  }

  function input(id, type, label, extra) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input class="input" id="' + id + '" type="' + type + '" data-model="' + id + '" value="' + esc(S.f[id] || '') + '" ' + (extra || '') + '></div>';
  }

  function viewAuth() {
    var m = S.authMode, h = '<div class="auth"><form class="auth-card" data-form="auth" novalidate>' + brandBlock();
    if (m === 'login') {
      h += '<h1>Bienvenue</h1><p class="lead">Connecte-toi pour accéder à ta formation.</p>' +
        input('email', 'email', 'Adresse e-mail', 'autocomplete="email" required') +
        input('password', 'password', 'Mot de passe', 'autocomplete="current-password" required');
    } else if (m === 'signup') {
      h += '<h1>Créer mon compte</h1><p class="lead">Utilise l\'adresse e-mail donnée lors de ton inscription.</p>' +
        input('email', 'email', 'Adresse e-mail', 'autocomplete="email" required') +
        input('password', 'password', 'Choisis un mot de passe (8 caractères minimum)', 'autocomplete="new-password" minlength="8" required');
    } else {
      h += '<h1>Mot de passe oublié</h1><p class="lead">Tu vas recevoir un e-mail pour en choisir un nouveau.</p>' +
        input('email', 'email', 'Adresse e-mail', 'autocomplete="email" required');
    }
    if (S.authErr) h += '<span class="err" role="alert">' + esc(S.authErr) + '</span>';
    if (S.authInfo) h += '<span class="ok" role="status">' + esc(S.authInfo) + '</span>';
    var label = m === 'login' ? 'Se connecter' : (m === 'signup' ? 'Créer mon compte' : 'Envoyer le lien');
    h += '<button class="btn" type="submit"' + (S.busy ? ' disabled' : '') + '>' + (S.busy ? 'Un instant…' : label) + '</button>';
    h += '<div class="switch">';
    if (m !== 'login') h += '<button type="button" class="linkbtn" data-a="authmode" data-v="login">J\'ai déjà un compte</button>';
    if (m !== 'signup') h += '<button type="button" class="linkbtn" data-a="authmode" data-v="signup">Première connexion ? Créer mon compte</button>';
    if (m !== 'forgot') h += '<button type="button" class="linkbtn" data-a="authmode" data-v="forgot">Mot de passe oublié</button>';
    h += '</div></form></div>';
    return h;
  }
  function viewNewPassword() {
    return '<div class="auth"><form class="auth-card" data-form="newpass">' + brandBlock() +
      '<h1>Nouveau mot de passe</h1>' +
      input('newpass', 'password', 'Nouveau mot de passe (8 caractères minimum)', 'autocomplete="new-password" minlength="8" required') +
      (S.authErr ? '<span class="err" role="alert">' + esc(S.authErr) + '</span>' : '') +
      '<button class="btn" type="submit">Enregistrer</button></form></div>';
  }
  function viewNotAllowed() {
    return '<div class="auth"><div class="auth-card">' + brandBlock() +
      '<h1>Accès non actif</h1><p class="lead">Ton adresse n\'a pas (ou plus) accès à la formation. Contacte-nous si c\'est une erreur.</p>' +
      '<button class="btn ghost" type="button" data-a="logout">Se déconnecter</button></div></div>';
  }

  function shell() {
    var tabs = [['formation', 'Formation'], ['calendar', 'Calendrier des stages'], ['parcours', 'Mon parcours']];
    if (isAdmin() && !S.preview) { tabs.push(['students', 'Élèves']); tabs.push(['inbox', 'Messages']); }
    var unread = unreadCount();
    var h = '<header class="top"><div class="top-in">' +
      '<a class="brand" href="../index.html"><img src="../embleme_apolo.png" alt=""><span><span class="name">APOLO</span><span class="sub">ESPACE MEMBRE</span></span></a>' +
      '<nav class="nav" aria-label="Espace membre">';
    tabs.forEach(function (t) {
      var badge = (t[0] === 'inbox' && unread) ? '<span class="dot">' + unread + '</span>' : '';
      h += '<button type="button" data-a="tab" data-v="' + t[0] + '"' + (S.tab === t[0] ? ' aria-current="page"' : '') + '>' + t[1] + badge + '</button>';
    });
    h += '</nav><div class="top-right">';
    if (isAdmin()) {
      h += '<span class="badge-admin">ADMIN</span><button type="button" class="pill quiet" data-a="preview" aria-pressed="' + S.preview + '">' + (S.preview ? 'Quitter l\'aperçu élève' : 'Aperçu élève') + '</button>';
    }
    var persoBadge = (asStudent() && unread) ? '<span class="dot">' + unread + '</span>' : '';
    h += '<button type="button" class="pill" data-a="tab" data-v="perso" aria-pressed="' + (S.tab === 'perso') + '">Espace perso' + persoBadge + '</button>' +
      '<button type="button" class="pill quiet" data-a="logout">Déconnexion</button></div></div></header>';
    if (S.preview) h += '<div class="preview-bar">Aperçu élève : tu vois la plateforme exactement comme tes élèves.</div>';

    var v = S.tab;
    if (!isAdmin() || S.preview) { if (v === 'students' || v === 'inbox') v = 'formation'; }
    h += { formation: viewFormation, calendar: viewCalendar, parcours: viewParcours, perso: viewPerso, students: viewStudents, inbox: viewInbox }[v]();
    return h;
  }

  /* ----- Formation ----- */
  function viewFormation() {
    var mods = modules(), vis = visibleLessons(), cur = current();
    var doneCount = vis.filter(function (l) { return S.done[l.id]; }).length;
    var pct = vis.length ? Math.round(doneCount / vis.length * 100) : 0;

    var h = '<div class="page"><aside class="aside" aria-label="Modules">' +
      '<div class="card" style="padding:16px 18px"><div class="row between" style="font-size:13px"><b>Progression globale</b><span class="note">' + doneCount + ' / ' + vis.length + ' vidéos</span></div>' +
      '<div class="bar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="legend"><span class="chip lv1">Fondations</span><span class="chip lv2">Connexion</span><span class="chip lv3">Maîtrise</span><span class="chip lv4">Expert</span></div></div>';

    if (!mods.length) h += '<div class="card"><p class="prose">Les vidéos arrivent très bientôt.</p></div>';
    mods.forEach(function (m) {
      var open = S.open === m.no;
      h += '<div class="mod"><button type="button" class="mod-head lv' + m.level + '" data-a="mod" data-v="' + m.no + '" aria-expanded="' + open + '">' +
        '<span><span class="lvl">' + LEVEL_NAME[m.level] + '</span><span class="t">' + esc(m.title) + '</span><span class="c">' + m.lessons.length + ' vidéo' + (m.lessons.length > 1 ? 's' : '') + '</span></span>' + ICON.chevron + '</button>';
      if (open) {
        h += '<div class="lessons">';
        m.lessons.forEach(function (l, i) {
          var tag = '';
          if (!asStudent()) {
            var sv = studentVideo(l);
            tag = !sv ? '<span class="tag none">Masquée</span>' : (l.use_new ? '<span class="tag new">Nouvelle</span>' : '<span class="tag old">Ancienne</span>');
          }
          h += '<button type="button" class="lesson" data-a="pick" data-v="' + l.id + '"' + (cur && cur.id === l.id ? ' aria-current="true"' : '') + '>' +
            '<span class="tick' + (S.done[l.id] ? ' done' : '') + '">' + (S.done[l.id] ? ICON.check : '') + '</span>' +
            '<span class="lbl">' + (i + 1) + '. ' + esc(l.title) + '</span>' + tag + '</button>';
        });
        h += '</div>';
      }
      h += '</div>';
    });
    h += '</aside><main class="main">';

    if (!cur) { h += '<div class="card"><h1 class="title-xl">Bienvenue</h1><p class="prose">Les premières vidéos seront en ligne très bientôt.</p></div></main></div>'; return h; }

    var mod = mods.find(function (m) { return m.no === cur.module_no; });
    var idx = mod.lessons.indexOf(cur);
    var flatIdx = vis.indexOf(cur);
    var src = vimeoEmbed(videoFor(cur));

    h += '<div><div class="eyebrow">Vidéo ' + (idx + 1) + ' sur ' + mod.lessons.length + '</div>' +
      '<h1 class="title-xl">' + esc(cur.title) + '</h1><div class="note" style="font-size:15px">' + esc(cur.module_title) + '</div></div>';

    h += '<div class="player">';
    if (src) h += '<iframe src="' + esc(src) + '" title="' + esc(cur.title) + '" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>';
    else h += '<div class="empty"><span class="mark">AO · APOLO</span><span style="width:84px;height:84px;border-radius:50%;background:#C87342;display:flex;align-items:center;justify-content:center">' + ICON.play + '</span><span style="color:#D9CDB8">' + (asStudent() ? 'Vidéo bientôt disponible' : 'Pas encore de vidéo pour cette version') + '</span></div>';
    h += '</div>';

    if (!asStudent()) {
      var v = S.version || (cur.use_new ? 'new' : 'old');
      h += '<div class="row"><span class="note">Version affichée :</span><div class="seg" role="group" aria-label="Version de la vidéo">' +
        '<button type="button" data-a="version" data-v="old" aria-pressed="' + (v === 'old') + '">Ancienne</button>' +
        '<button type="button" data-a="version" data-v="new" aria-pressed="' + (v === 'new') + '">Nouvelle</button></div></div>';
    }

    h += '<div class="row between">' +
      '<button type="button" class="btn ghost" data-a="prev"' + (flatIdx <= 0 ? ' disabled' : '') + '>← Vidéo précédente</button>' +
      '<div class="row"><button type="button" class="btn ghost" data-a="done" aria-pressed="' + !!S.done[cur.id] + '">' + (S.done[cur.id] ? '✓ Vue' : 'Marquer comme vue') + '</button>' +
      '<button type="button" class="btn" data-a="next"' + (flatIdx >= vis.length - 1 ? ' disabled' : '') + '>Vidéo suivante →</button></div></div>';

    if (cur.summary || cur.practice) {
      h += '<div class="grid2">';
      if (cur.summary) h += '<section class="card"><h2>Résumé de la vidéo</h2><p class="prose">' + esc(cur.summary) + '</p></section>';
      if (cur.practice) h += '<section class="card"><h2>À pratiquer avec ton cheval</h2><p class="prose">' + esc(cur.practice) + '</p></section>';
      h += '</div>';
    }

    if (!asStudent()) h += lessonEditor(cur);
    h += '</main></div>';
    return h;
  }

  function lessonEditor(l) {
    var k = 'ed_' + l.id;
    function val(f, d) { return S.f[k + '_' + f] != null ? S.f[k + '_' + f] : (d || ''); }
    var useNew = S.f[k + '_use'] != null ? S.f[k + '_use'] === 'new' : l.use_new;
    return '<form class="card admin-box" data-form="lesson" data-id="' + l.id + '"><span class="eyebrow">Réglages admin · visible seulement par toi</span>' +
      '<div class="grid2">' +
      '<div class="field"><label for="' + k + '_old">Lien Vimeo · ancienne version</label><input class="input" id="' + k + '_old" data-model="' + k + '_old" value="' + esc(val('old', l.video_old)) + '" placeholder="https://vimeo.com/…"></div>' +
      '<div class="field"><label for="' + k + '_new">Lien Vimeo · nouvelle version</label><input class="input" id="' + k + '_new" data-model="' + k + '_new" value="' + esc(val('new', l.video_new)) + '" placeholder="https://vimeo.com/…"></div></div>' +
      '<div class="field"><label for="' + k + '_use">Les élèves voient</label><select class="select" id="' + k + '_use" data-model="' + k + '_use">' +
      '<option value="old"' + (!useNew ? ' selected' : '') + '>L\'ancienne version</option><option value="new"' + (useNew ? ' selected' : '') + '>La nouvelle version</option></select>' +
      '<span class="note">Une vidéo sans lien pour la version choisie est masquée chez les élèves.</span></div>' +
      '<div class="grid2"><div class="field"><label for="' + k + '_sum">Résumé de la vidéo</label><textarea class="textarea" id="' + k + '_sum" data-model="' + k + '_sum">' + esc(val('sum', l.summary)) + '</textarea></div>' +
      '<div class="field"><label for="' + k + '_pra">À pratiquer avec ton cheval</label><textarea class="textarea" id="' + k + '_pra" data-model="' + k + '_pra">' + esc(val('pra', l.practice)) + '</textarea></div></div>' +
      '<div class="row"><button class="btn" type="submit">Enregistrer</button></div></form>';
  }

  /* ----- Calendrier ----- */
  function stageAt(y, m, d) { return STAGES.find(function (s) { return s[0] === y && s[1] === m && d >= s[2] && d <= s[3]; }); }
  function viewCalendar() {
    var y = S.calY, mo = S.calM, first = (new Date(y, mo, 1).getDay() + 6) % 7, days = new Date(y, mo + 1, 0).getDate();
    var h = '<div class="page"><main class="main"><section class="card" style="gap:16px">' +
      '<div class="row between"><div><div class="eyebrow">Calendrier des stages</div><h1 class="title-xl">' + MONTHS[mo] + ' ' + y + '</h1></div>' +
      '<div class="row"><button type="button" class="round" data-a="cal" data-v="-1" aria-label="Mois précédent">‹</button><button type="button" class="round" data-a="cal" data-v="1" aria-label="Mois suivant">›</button></div></div>' +
      '<div class="cal-head"><span>LUN</span><span>MAR</span><span>MER</span><span>JEU</span><span>VEN</span><span>SAM</span><span>DIM</span></div><div class="cal">';
    for (var i = 0; i < first; i++) h += '<div class="d blank"></div>';
    for (var d = 1; d <= days; d++) {
      var st = stageAt(y, mo, d);
      var isToday = y === today.getFullYear() && mo === today.getMonth() && d === today.getDate();
      h += '<div class="d' + (st ? ' stage' : (isToday ? ' today' : '')) + '">' + d + (st ? '<small>Stage · jour ' + (d - st[2] + 1) + '</small>' : '') + '</div>';
    }
    h += '</div></section></main><aside class="aside"><section class="card"><h2>Prochains stages</h2>';
    var upcoming = STAGES.filter(function (s) { return new Date(s[0], s[1], s[3]) >= new Date(today.getFullYear(), today.getMonth(), today.getDate()); });
    if (!upcoming.length) h += '<p class="note">Les prochaines dates arrivent bientôt.</p>';
    upcoming.forEach(function (s) {
      var range = 'Du ' + DAYS[new Date(s[0], s[1], s[2]).getDay()] + ' ' + s[2] + ' au ' + DAYS[new Date(s[0], s[1], s[3]).getDay()] + ' ' + s[3] + ' ' + MONTHS[s[1]].toLowerCase() + ' ' + s[0];
      h += '<div class="event"><div class="date"><b>' + s[2] + '–' + s[3] + '</b><span>' + MONTHS[s[1]].slice(0, 3).toUpperCase() + '.</span></div>' +
        '<div style="display:flex;flex-direction:column;gap:3px;min-width:0"><b>Stage au domaine Apolo</b><span class="note">' + range + '</span><span class="note">4 jours · Marrakech</span>' +
        '<div class="row" style="margin-top:6px"><button type="button" class="btn small" data-a="reserve" data-v="' + esc(range) + '">Réserver ma place</button>' +
        '<button type="button" class="btn ghost small" data-a="calshow" data-v="' + s[0] + '-' + s[1] + '">Voir le mois</button></div></div></div>';
    });
    h += '</section></aside></div>';
    return h;
  }

  /* ----- Mon parcours ----- */
  function viewParcours() {
    var vis = visibleLessons(), cur = current();
    var doneCount = vis.filter(function (l) { return S.done[l.id]; }).length;
    var pct = vis.length ? Math.round(doneCount / vis.length * 100) : 0;
    var h = '<div class="page narrow"><section class="card" style="gap:20px;padding:28px">' +
      '<div><div class="eyebrow">Mon parcours</div><h1 class="title-xl">Ta progression avec Catherine</h1></div>' +
      '<div class="row" style="gap:24px;align-items:center"><div style="flex:999 1 480px;min-width:0;display:flex;flex-direction:column;gap:10px"><div class="arrow">';
    var labels = '';
    [1, 2, 3, 4].forEach(function (k) {
      var ls = vis.filter(function (l) { return l.level === k; });
      var d = ls.filter(function (l) { return S.done[l.id]; }).length;
      var p = ls.length ? Math.round(d / ls.length * 100) : 0;
      h += '<div class="seg-a"><i style="width:' + p + '%;background:' + LEVEL_FILL[k] + '"></i></div>';
      labels += '<div style="padding-left:4px"><b>' + LEVEL_NAME[k] + '</b><span>' + (!ls.length ? 'À venir' : (p === 100 ? 'Terminé' : (p ? p + ' % fait' : 'À commencer'))) + '</span></div>';
    });
    h += '</div><div class="arrow-labels">' + labels + '</div></div>' +
      '<div style="flex:1 1 150px;display:flex;flex-direction:column;align-items:center"><span class="pct">' + pct + '%</span><span class="note">de la formation</span></div></div>';
    if (cur) h += '<div class="row between" style="background:var(--ivory);border-radius:12px;padding:14px 18px"><span>Prochaine vidéo : <b>' + esc(cur.module_title) + ' · ' + esc(cur.title) + '</b></span><button type="button" class="btn" data-a="resume">Reprendre</button></div>';
    h += '</section>';

    h += '<section class="formule"><div><div class="eyebrow">Ma formule</div><h2>' + esc(S.me.formule || 'Accès complet') + '</h2></div>' +
      '<span style="font-size:13px;color:#D9CDB8">Activée le ' + fmtDate(S.me.created_at) + '</span></section>';

    if (isAdmin() && !S.preview) {
      h += '<section class="card admin-box" style="gap:14px"><div class="row between"><div><h2>Ajouter un module</h2><span class="note">Débloquer la suite en un clic, sans rendez-vous téléphonique.</span></div>' +
        '<span class="tag none">Visible admin uniquement · bientôt disponible</span></div><div class="shop greyed" aria-hidden="true">' +
        '<div class="item dark"><b>Accès complet</b><span class="note" style="color:#D9CDB8">Tous les modules Maîtrise et Expert</span></div>' +
        '<div class="item"><b>Contrôle à distance</b><span class="note">6 vidéos</span></div><div class="item"><b>Accès liberté</b><span class="note">3 vidéos</span></div>' +
        '<div class="item dark"><b>Débourrage</b><span class="note" style="color:#D9CDB8">9 vidéos</span></div></div></section>';
    }

    h += '<section class="card" id="aide" style="padding:28px"><h2>Besoin d\'aide ?</h2><span class="note">Pose ta question à l\'équipe Apolo. Tes échanges sont aussi dans ton Espace perso.</span>' +
      composer('help', cur ? (cur.module_title + ' · ' + cur.title) : '') + '</section></div>';
    return h;
  }

  function composer(key, context) {
    var id = 'msg_' + key;
    return '<form data-form="send" data-ctx="' + esc(context) + '" style="display:flex;flex-direction:column;gap:10px">' +
      (context ? '<span class="chip" style="align-self:flex-start;background:var(--terra-soft);color:#7A3A1A;font-size:13px;padding:6px 12px">À propos de : ' + esc(context) + '</span>' : '') +
      '<div class="field"><label for="' + id + '">Ton message</label><textarea class="textarea" id="' + id + '" data-model="' + id + '" placeholder="Ex. : mon cheval recule mais se raidit, je ne sais pas si je relâche au bon moment…" required>' + esc(S.f[id] || '') + '</textarea></div>' +
      '<div class="row"><button class="btn" type="submit">Envoyer le message</button></div></form>';
  }

  function thread(email, adminSide) {
    var list = S.msgs.filter(function (m) { return m.student_email.toLowerCase() === email; });
    if (!list.length) return '<p class="note">' + (adminSide ? 'Aucun message pour l\'instant.' : 'Pas encore de message. Écris-nous ci-dessous, on te répond ici.') + '</p>';
    var h = '<div class="thread">';
    list.forEach(function (m) {
      var mine = adminSide ? m.from_admin : !m.from_admin;
      h += '<div class="msg ' + (mine ? 'me' : 'them') + '">' + (m.context ? '<span class="ctx">' + esc(m.context) + '</span>' : '') + esc(m.body) +
        '<span class="meta">' + (m.from_admin ? 'Équipe Apolo' : (adminSide ? 'Élève' : 'Toi')) + ' · ' + fmtTime(m.created_at) + '</span></div>';
    });
    return h + '</div>';
  }

  /* ----- Espace perso ----- */
  function viewPerso() {
    var me = S.me, name = me.full_name || me.email, initial = (name || '?').trim().charAt(0).toUpperCase();
    return '<div class="page narrow">' +
      '<div class="row" style="gap:18px"><div style="width:76px;height:76px;border-radius:50%;background:var(--terra);color:#fff;display:flex;align-items:center;justify-content:center;font-family:var(--f-display);font-size:34px;font-weight:700">' + esc(initial) + '</div>' +
      '<div><div class="eyebrow">Espace perso</div><h1 class="title-xl">' + esc(name) + '</h1><span class="note">Membre depuis le ' + fmtDate(me.created_at) + ' · ' + esc(me.formule || 'Accès complet') + '</span></div></div>' +
      '<div class="grid2"><section class="card"><h2>Mes informations</h2><span class="note">E-mail : ' + esc(me.email) + '</span><span class="note">Pour modifier tes informations, écris-nous ci-dessous.</span></section>' +
      '<section class="card"><h2>Mes stages</h2><span class="note">Pour réserver un stage au domaine, choisis une date dans le calendrier.</span><button type="button" class="btn small" style="align-self:flex-start" data-a="tab" data-v="calendar">Voir les dates</button></section></div>' +
      '<section class="card" style="padding:28px"><h2>Mes échanges</h2>' + thread(me.email.toLowerCase(), false) + composer('perso', '') + '</section></div>';
  }

  /* ----- Admin : élèves ----- */
  function viewStudents() {
    var link = location.origin + location.pathname;
    var lessonCount = S.lessons.filter(function (l) { return !!studentVideo(l); }).length;
    var h = '<div class="page narrow">' +
      '<div><div class="eyebrow">Admin</div><h1 class="title-xl">Élèves</h1></div>' +
      '<form class="card admin-box" data-form="member"><h2>Ajouter un élève</h2>' +
      '<div class="grid2">' + input('mem_name', 'text', 'Prénom et nom') + input('mem_email', 'email', 'Adresse e-mail', 'required') + '</div>' +
      '<div class="row"><button class="btn" type="submit">Donner l\'accès</button></div>' +
      '<span class="note">Ensuite, envoie-lui ce lien : <b>' + esc(link) + '</b>. Il clique sur « Première connexion ? Créer mon compte » et choisit son mot de passe avec cette adresse.</span>' +
      '<div class="row"><button type="button" class="btn ghost small" data-a="copy" data-v="' + esc(link) + '">Copier le lien</button></div></form>' +
      '<div class="table-wrap"><table><thead><tr><th>Élève</th><th>E-mail</th><th>Progression</th><th>Ajouté le</th><th><span class="sr">Actions</span></th></tr></thead><tbody>';
    if (!S.members.length) h += '<tr><td colspan="5" class="note">Aucun élève pour l\'instant.</td></tr>';
    S.members.forEach(function (m) {
      var e = m.email.toLowerCase();
      var d = S.allProgress.filter(function (p) { return (p.email || '').toLowerCase() === e; }).length;
      var p = lessonCount ? Math.min(100, Math.round(d / lessonCount * 100)) : 0;
      h += '<tr><td>' + esc(m.full_name || '—') + (m.role === 'admin' ? ' <span class="badge-admin">ADMIN</span>' : '') + '</td><td>' + esc(m.email) + '</td>' +
        '<td style="min-width:140px"><div class="bar"><span style="width:' + p + '%"></span></div><span class="note">' + p + ' %</span></td>' +
        '<td>' + fmtDate(m.created_at) + '</td><td>' +
        (m.role === 'admin' ? '' : '<div class="row" style="flex-wrap:nowrap"><button type="button" class="btn ghost small" data-a="openthread" data-v="' + esc(e) + '">Message</button><button type="button" class="btn ghost small" data-a="delmember" data-v="' + esc(e) + '">Retirer</button></div>') +
        '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  }

  /* ----- Admin : messages ----- */
  function viewInbox() {
    var students = S.members.filter(function (m) { return m.role !== 'admin'; });
    var withMsgs = {};
    S.msgs.forEach(function (m) { var e = m.student_email.toLowerCase(); withMsgs[e] = withMsgs[e] || { last: 0, unread: 0 }; withMsgs[e].last = new Date(m.created_at).getTime(); if (!m.from_admin && !m.read_by_admin) withMsgs[e].unread++; });
    var list = students.map(function (m) { var e = m.email.toLowerCase(); return { email: e, name: m.full_name || m.email, info: withMsgs[e] || { last: 0, unread: 0 } }; });
    list.sort(function (a, b) { return b.info.last - a.info.last; });

    var h = '<div class="page narrow"><div><div class="eyebrow">Admin</div><h1 class="title-xl">Messages</h1></div><div class="inbox"><div class="inbox-list">';
    if (!list.length) h += '<p class="note">Ajoute des élèves pour pouvoir échanger avec eux.</p>';
    list.forEach(function (s) {
      h += '<button type="button" data-a="inbox" data-v="' + esc(s.email) + '"' + (S.inboxSel === s.email ? ' aria-current="true"' : '') + '><span><b>' + esc(s.name) + '</b><br><span class="note">' + (s.info.last ? fmtTime(s.info.last) : 'Aucun message') + '</span></span>' + (s.info.unread ? '<span class="dot">' + s.info.unread + '</span>' : '') + '</button>';
    });
    h += '</div><div class="inbox-main">';
    if (!S.inboxSel) h += '<div class="card"><p class="note">Choisis un élève pour voir la conversation.</p></div>';
    else {
      var st = students.find(function (m) { return m.email.toLowerCase() === S.inboxSel; });
      h += '<section class="card"><h2>' + esc(st ? (st.full_name || st.email) : S.inboxSel) + '</h2>' + thread(S.inboxSel, true) +
        '<form data-form="reply" style="display:flex;flex-direction:column;gap:10px"><div class="field"><label for="reply_' + esc(S.inboxSel) + '">Ta réponse</label><textarea class="textarea" id="reply_' + esc(S.inboxSel) + '" data-model="reply_' + esc(S.inboxSel) + '" required>' + esc(S.f['reply_' + S.inboxSel] || '') + '</textarea></div>' +
        '<div class="row"><button class="btn" type="submit">Envoyer</button></div></form></section>';
    }
    h += '</div></div></div>';
    return h;
  }

  /* ---------- Actions ---------- */
  function toast(t) { S.toast = t; render(); clearTimeout(toast._t); toast._t = setTimeout(function () { S.toast = ''; render(); }, 3200); }
  function go(step) {
    var vis = visibleLessons(), cur = current(); if (!cur) return;
    var i = vis.indexOf(cur), n = vis[Math.min(vis.length - 1, Math.max(0, i + step))];
    if (step > 0 && !S.done[cur.id]) setDone(cur.id, true);
    S.curId = n.id; S.version = null; S.open = n.module_no; render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function setDone(id, on) {
    S.done[id] = on || undefined; if (!on) delete S.done[id]; render();
    var r = on ? await sb.from('progress').upsert({ lesson_id: id }, { onConflict: 'user_id,lesson_id' })
               : await sb.from('progress').delete().eq('user_id', S.session.user.id).eq('lesson_id', id);
    if (r.error) toast('La progression n\'a pas pu être enregistrée.');
  }

  root.addEventListener('input', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-model');
    if (k) S.f[k] = e.target.value;
  });
  root.addEventListener('change', function (e) {
    var k = e.target.getAttribute && e.target.getAttribute('data-model');
    if (k) S.f[k] = e.target.value;
  });

  root.addEventListener('click', async function (e) {
    var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
    var a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
    switch (a) {
      case 'authmode': S.authMode = v; S.authErr = ''; S.authInfo = ''; render(); break;
      case 'logout': await sb.auth.signOut(); break;
      case 'tab': S.tab = v; render(); window.scrollTo(0, 0); break;
      case 'preview': S.preview = !S.preview; S.version = null; if (S.preview && (S.tab === 'students' || S.tab === 'inbox')) S.tab = 'formation'; render(); break;
      case 'mod': S.open = S.open === +v ? null : +v; render(); break;
      case 'pick': S.curId = v; S.version = null; render(); if (window.innerWidth < 940) window.scrollTo({ top: 0, behavior: 'smooth' }); break;
      case 'prev': go(-1); break;
      case 'next': go(1); break;
      case 'done': var c = current(); if (c) setDone(c.id, !S.done[c.id]); break;
      case 'version': S.version = v; render(); break;
      case 'resume': S.tab = 'formation'; var cc = current(); if (cc) S.open = cc.module_no; render(); window.scrollTo(0, 0); break;
      case 'cal': S.calM += +v; if (S.calM < 0) { S.calM = 11; S.calY--; } if (S.calM > 11) { S.calM = 0; S.calY++; } render(); break;
      case 'calshow': var p = v.split('-'); S.calY = +p[0]; S.calM = +p[1]; render(); break;
      case 'reserve':
        S.tab = 'perso'; S.f.msg_perso = 'Bonjour, je souhaite réserver ma place pour le stage au domaine ' + v.charAt(0).toLowerCase() + v.slice(1) + '.';
        render(); var t = document.getElementById('msg_perso'); if (t) { t.scrollIntoView({ behavior: 'smooth', block: 'center' }); t.focus(); } break;
      case 'inbox': S.inboxSel = v; render(); break;
      case 'openthread': S.tab = 'inbox'; S.inboxSel = v; render(); window.scrollTo(0, 0); break;
      case 'copy': try { await navigator.clipboard.writeText(v); toast('Lien copié'); } catch (err) { toast('Copie impossible : sélectionne le lien à la main.'); } break;
      case 'delmember':
        if (!confirm('Retirer l\'accès de ' + v + ' ? Son compte ne pourra plus ouvrir la formation.')) return;
        var r = await sb.from('members').delete().eq('email', v);
        if (r.error) toast('Impossible de retirer cet élève.'); else { await loadMembers(); toast('Accès retiré'); }
        break;
    }
  });

  root.addEventListener('submit', async function (e) {
    var form = e.target.closest('form[data-form]'); if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute('data-form');

    if (kind === 'auth') {
      var email = (S.f.email || '').trim().toLowerCase(), pw = S.f.password || '';
      S.authErr = ''; S.authInfo = '';
      if (!email) { S.authErr = 'Indique ton adresse e-mail.'; render(); return; }
      S.busy = true; render();
      var r;
      if (S.authMode === 'login') {
        r = await sb.auth.signInWithPassword({ email: email, password: pw });
        if (r.error) S.authErr = /confirm/i.test(r.error.message) ? 'Confirme d\'abord ton adresse grâce à l\'e-mail reçu.' : 'E-mail ou mot de passe incorrect. Première connexion ? Clique sur « Créer mon compte ».';
      } else if (S.authMode === 'signup') {
        if (pw.length < 8) { S.authErr = 'Le mot de passe doit faire au moins 8 caractères.'; }
        else {
          r = await sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } });
          if (r.error) {
            var msg = r.error.message || '';
            S.authErr = /registered|exists/i.test(msg) ? 'Un compte existe déjà avec cette adresse : connecte-toi.' :
              (/database error|non autoris/i.test(msg) ? 'Cette adresse n\'est pas inscrite à la formation. Vérifie-la ou contacte-nous.' : 'Impossible de créer le compte : ' + msg);
          } else if (!r.data.session) {
            S.authInfo = 'Compte créé ! Confirme ton adresse grâce à l\'e-mail reçu, puis connecte-toi.'; S.authMode = 'login';
          }
        }
      } else {
        r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
        S.authInfo = 'Si cette adresse est inscrite, tu vas recevoir un e-mail.';
      }
      S.busy = false; render(); return;
    }

    if (kind === 'newpass') {
      var np = S.f.newpass || '';
      if (np.length < 8) { S.authErr = 'Au moins 8 caractères.'; render(); return; }
      var u = await sb.auth.updateUser({ password: np });
      if (u.error) { S.authErr = 'Impossible d\'enregistrer : ' + u.error.message; render(); return; }
      S.recovery = false; S.authErr = ''; S.f.newpass = '';
      toast('Mot de passe enregistré'); if (S.session) loadAll(); return;
    }

    if (kind === 'lesson') {
      var id = form.getAttribute('data-id'), k = 'ed_' + id, l = S.lessons.find(function (x) { return x.id === id; });
      function pick(f, d) { return S.f[k + '_' + f] != null ? S.f[k + '_' + f] : d; }
      var patch = {
        video_old: (pick('old', l.video_old) || '').trim() || null,
        video_new: (pick('new', l.video_new) || '').trim() || null,
        use_new: pick('use', l.use_new ? 'new' : 'old') === 'new',
        summary: (pick('sum', l.summary) || '').trim() || null,
        practice: (pick('pra', l.practice) || '').trim() || null,
        updated_at: new Date().toISOString()
      };
      if ((patch.video_old && !vimeoEmbed(patch.video_old)) || (patch.video_new && !vimeoEmbed(patch.video_new))) { toast('Lien Vimeo non reconnu. Copie le lien de la vidéo depuis Vimeo.'); return; }
      var res = await sb.from('lessons').update(patch).eq('id', id);
      if (res.error) { toast('Enregistrement impossible : ' + res.error.message); return; }
      Object.assign(l, patch);
      ['old', 'new', 'use', 'sum', 'pra'].forEach(function (f) { delete S.f[k + '_' + f]; });
      S.version = null; toast('Vidéo enregistrée'); return;
    }

    if (kind === 'send' || kind === 'reply') {
      var key = kind === 'reply' ? 'reply_' + S.inboxSel : form.querySelector('textarea').id;
      var body = (S.f[key] || '').trim(); if (!body) return;
      var row = kind === 'reply'
        ? { student_email: S.inboxSel, from_admin: true, body: body, read_by_admin: true }
        : { student_email: S.me.email.toLowerCase(), from_admin: false, body: body, context: form.getAttribute('data-ctx') || null };
      var ins = await sb.from('messages').insert(row);
      if (ins.error) { toast('Message non envoyé : ' + ins.error.message); return; }
      S.f[key] = ''; await loadMsgs(); toast(kind === 'reply' ? 'Réponse envoyée' : 'Message envoyé. Nous te répondons au plus vite.'); return;
    }

    if (kind === 'member') {
      var em = (S.f.mem_email || '').trim().toLowerCase(), nm = (S.f.mem_name || '').trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { toast('Adresse e-mail invalide'); return; }
      var ri = await sb.from('members').insert({ email: em, full_name: nm || null });
      if (ri.error) { toast(/duplicate/i.test(ri.error.message) ? 'Cet élève a déjà accès.' : 'Ajout impossible : ' + ri.error.message); return; }
      S.f.mem_email = ''; S.f.mem_name = ''; await loadMembers(); toast('Accès donné à ' + em);
    }
  });

  /* ---------- Démarrage ---------- */
  sb.auth.onAuthStateChange(function (event, session) {
    setTimeout(function () {
      if (event === 'PASSWORD_RECOVERY') S.recovery = true;
      var was = S.session && S.session.user.id;
      S.session = session;
      if (!session) {
        S.me = null; S.loading = false; S.notAllowed = false; S.tab = 'formation'; S.preview = false; S.msgs = []; S.lessons = []; S.done = {};
        if (S.channel) { sb.removeChannel(S.channel); S.channel = null; }
        render(); return;
      }
      if (S.recovery) { render(); return; }
      if (was !== session.user.id || !S.me) loadAll();
    }, 0);
  });
})();

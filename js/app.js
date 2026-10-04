/* AIN Paper Builder: user interface. Plain JavaScript, hash routes, data through window.Api. */
(function () {
  'use strict';
  const L = window.Logic;
  const esc = L.esc;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const main = () => document.getElementById('main');

  const QTYPES = { single: 'Single correct', assertion: 'Assertion–Reason', statement: 'Two statements', match: 'Match the lists', other: 'Other' };
  const SOURCES = { own: 'Our own', pyq: 'NEET previous year', book: 'Book', institute: 'Other institute', other: 'Other' };
  const DIFFS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' };
  const MARK_SVG = '<svg class="mark" viewBox="0 0 64 20" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="10" r="6.6"/><circle cx="24" cy="10" r="6.6" fill="var(--omr)" stroke="var(--omr)"/><circle cx="40" cy="10" r="6.6"/><circle cx="56" cy="10" r="6.6"/></g></svg>';

  const S = {
    session: null,
    me: null,
    loaded: false,
    settings: {},
    subjects: [],
    chapters: [],
    chapterById: new Map(),
    subjectById: new Map(),
    profiles: [],
    profileById: new Map(),
    meta: null,
    metaAt: 0,
    qcache: new Map(),
    actions: {},
    builder: {},
    bank: { subject: '', chapter: '', difficulty: '', qtype: '', source: '', mine: false, search: '', archived: false, samples: false, page: 0 },
    homeMentor: null,
    paperTab: 'paper',
    adminTab: 'people',
    imp: null,
    viewToken: 0,
  };

  /* ================= Helpers ================= */

  const rich = (text) => L.renderRich(text, window.katex);
  const isAdmin = () => S.me && S.me.role === 'admin';
  const settings = () => Object.assign({}, L.DEFAULT_SETTINGS, S.settings || {});
  const orgName = () => (S.settings && S.settings.org_name) || 'AIN';

  function fmtDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtDay(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }
  function initials(name) {
    const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((parts[0] || '?')[0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  }
  function personName(id) {
    const p = S.profileById.get(id);
    return p ? (p.full_name || p.email) : 'Removed account';
  }
  function chapterName(id) { const c = S.chapterById.get(id); return c ? c.name : 'Unknown chapter'; }
  function subjectOfChapter(id) { const c = S.chapterById.get(id); return c ? S.subjectById.get(c.subject_id) : null; }
  function subjectName(id) { const s = S.subjectById.get(id); return s ? s.name : ''; }
  function subjSortOfChapter(id) { const s = subjectOfChapter(id); return s ? s.sort : 99; }
  function chapterInfoMap() {
    return new Map(S.chapters.map((c) => [c.id, { subject_sort: (S.subjectById.get(c.subject_id) || {}).sort || 99, sort: c.sort }]));
  }
  function loadingHTML(text) { return '<div class="loading">' + esc(text || 'Loading…') + '</div>'; }
  function setTitle(t) { document.title = (t ? t + ' · ' : '') + 'AIN Paper Builder'; }
  function debounce(fn, ms) { let t; return function () { const a = arguments; clearTimeout(t); t = setTimeout(() => fn.apply(null, a), ms); }; }
  function chipDiff(d) { return '<span class="chip ' + esc(d) + '">' + esc(DIFFS[d] || d) + '</span>'; }
  function chipReason(r) {
    const label = { new: 'New', review: 'Revision', early: 'Early repeat' }[r] || r;
    return '<span class="chip ' + esc(r) + '">' + label + '</span>';
  }

  function toast(msg, kind) {
    const wrap = document.getElementById('toasts');
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'bad' ? ' bad' : '');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => el.remove(), kind === 'bad' ? 6000 : 3200);
  }
  function fail(e) { console.error(e); toast((e && e.message) || 'Something went wrong.', 'bad'); }

  function busy(btn, on, label) {
    if (!btn) return;
    if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; if (label) btn.textContent = label; }
    else { btn.disabled = false; if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
  }

  function imgTag(path, cls) {
    if (!path) return '';
    if (/^(blob:|data:image\/)/.test(path)) return '<img src="' + esc(path) + '" alt="" class="' + esc(cls || '') + '">';
    return '<img data-path="' + esc(path) + '" alt="" class="' + esc(cls || '') + '" loading="lazy">';
  }
  async function hydrateImages(root) {
    const scope = root || document;
    $$('ol.opts img', scope).forEach((img) => {
      if (img.dataset.fit) return;
      img.dataset.fit = '1';
      img.addEventListener('load', () => fitOptions(img.closest('ol.opts') ? img.closest('ol.opts').parentNode : scope));
    });
    fitOptions(scope);
    const imgs = $$('img[data-path]', scope).filter((i) => !i.getAttribute('src'));
    if (!imgs.length) return;
    try {
      const urls = await Api.signedUrls(imgs.map((i) => i.dataset.path));
      imgs.forEach((i) => { if (urls[i.dataset.path]) i.src = urls[i.dataset.path]; });
    } catch (e) { fail(e); }
    fitOptions(scope);
  }
  function waitForImages(root) {
    const imgs = $$('img', root);
    return Promise.all(imgs.map((i) => (i.complete && i.naturalWidth) || !i.getAttribute('src') ? null : new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 6000); })));
  }

  async function getMeta(force) {
    if (!force && S.meta && Date.now() - S.metaAt < 60000) return S.meta;
    S.meta = await Api.questionMeta();
    S.metaAt = Date.now();
    return S.meta;
  }
  function invalidateMeta() { S.meta = null; }

  async function loadQuestions(ids) {
    const need = ids.filter((id) => !S.qcache.has(id));
    if (need.length) (await Api.questionsByIds(need)).forEach((q) => S.qcache.set(q.id, q));
    return ids.map((id) => S.qcache.get(id)).filter(Boolean);
  }

  // First guess at the option layout; fitOptions() corrects it once the page is drawn.
  function optionLayout(options) {
    const max = Math.max.apply(null, options.map((o) => L.visibleLength(o.text)).concat([0]));
    if (options.some((o) => o.image)) return max <= 26 ? 'g2' : '';
    if (max <= 12) return 'g4';
    if (max <= 30) return 'g2';
    return '';
  }
  // If options did not fit in rows of 4 (or 2) at the drawn width, step down so each row is aligned.
  function fitOptions(scope) {
    $$('ol.opts', scope || document).forEach((ol) => {
      if (!ol.offsetParent) return;
      const lis = $$(':scope > li', ol);
      if (lis.length !== 4) return;
      const top = (li) => Math.round(li.getBoundingClientRect().top);
      const same = (a, b) => Math.abs(top(a) - top(b)) <= 3;
      if (ol.classList.contains('g4') && !(same(lis[0], lis[3]))) { ol.classList.remove('g4'); ol.classList.add('g2'); }
      if (ol.classList.contains('g2') && !(same(lis[0], lis[1]) && same(lis[2], lis[3]) && !same(lis[0], lis[2]))) ol.classList.remove('g2');
    });
  }

  // One question as it appears on screen or paper
  function questionHTML(q, opts) {
    const o = opts || {};
    const options = (q.options || []).slice(0, 4);
    while (options.length < 4) options.push({ text: '', image: null });
    const imgs = (q.images || []).length ? '<div class="q-imgs">' + q.images.map((p) => imgTag(p)).join('') + '</div>' : '';
    const optsHTML = '<ol class="opts ' + optionLayout(options) + '">' + options.map((op, i) =>
      '<li class="' + (o.showAnswer && Number(q.answer) === i + 1 ? 'correct' : '') + (op.image ? ' img-opt' : '') + '"><span class="on">(' + (i + 1) + ')</span><span>' +
      (op.text ? rich(op.text).replace(/^<p>|<\/p>$/g, '') : '') + (op.image ? imgTag(op.image) : '') + '</span></li>').join('') + '</ol>';
    return '<div class="rich">' + rich(q.body) + '</div>' + imgs + optsHTML;
  }

  async function prepareImage(file) {
    const isHeic = /heic|heif/i.test(file && (file.type || file.name || ''));
    if (!file || (!/^image\//.test(file.type) && !isHeic)) throw new Error('Choose an image file (PNG or JPG).');
    const extOf = (t) => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[t] || 'png');
    const webSafe = /^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type);
    if (file.type === 'image/svg+xml' || file.type === 'image/gif') return { blob: file, ext: extOf(file.type) };
    let bmp = null;
    try { bmp = await createImageBitmap(file); } catch (e) { bmp = null; }
    if (!bmp) {
      if (webSafe) return { blob: file, ext: extOf(file.type) };
      throw new Error('This photo format can’t be read in this browser. Take a screenshot of the diagram and add that instead.');
    }
    // Phone photos (HEIC) and very large images are redrawn as PNG or JPG so every browser and printer can show them.
    if (webSafe && bmp.width <= 1600 && file.size < 1500000) return { blob: file, ext: extOf(file.type) };
    const scale = Math.min(1, 1600 / bmp.width);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await new Promise((r) => c.toBlob(r, type, 0.9));
    return { blob, ext: extOf(type) };
  }
  async function uploadFile(file) {
    const { blob, ext } = await prepareImage(file);
    if (blob.size > 5 * 1024 * 1024) throw new Error('That image is larger than 5 MB. Crop it or save it smaller.');
    return Api.uploadImage(blob, S.session.user.id, ext);
  }

  function randomPassword() {
    const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const arr = new Uint32Array(10);
    crypto.getRandomValues(arr);
    return Array.from(arr, (n) => a[n % a.length]).join('');
  }

  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); toast('Copied'); }
    catch (e) {
      const pre = btn && btn.closest('.copy-box') && $('pre', btn.closest('.copy-box'));
      if (pre) { const r = document.createRange(); r.selectNodeContents(pre); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
      toast('Select the text and copy it.');
    }
  }

  /* ================= Shell ================= */

  function renderTopbar() {
    const bar = document.getElementById('topbar');
    if (!S.me) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    bar.innerHTML =
      '<div class="topbar-inner">' +
      '<a class="brand" href="#/">' + MARK_SVG + '<span>' + esc(orgName()) + ' Paper Builder<small>' + esc(S.settings.tagline || 'Question papers for mentees') + '</small></span></a>' +
      '<nav class="nav" aria-label="Main">' +
      '<a href="#/" data-nav="home">Mentees</a>' +
      '<a href="#/bank" data-nav="bank"><span class="nl">Question bank</span><span class="ns">Bank</span></a>' +
      '<a href="#/import" data-nav="import"><span class="nl">Add from PDF</span><span class="ns">PDF</span></a>' +
      (isAdmin() ? '<a href="#/admin" data-nav="admin">Admin</a>' : '') +
      '</nav>' +
      '<a class="who" href="#/account" title="Your account"><span class="avatar">' + esc(initials(S.me.full_name || S.me.email)) + '</span><span class="who-name">' + esc(S.me.full_name || S.me.email) + '</span></a>' +
      '</div>';
  }
  function setActiveNav(key) {
    $$('#topbar [data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }

  async function loadBasics() {
    const me = await Api.me(S.session.user.id);
    if (!me || !me.active) {
      await Api.signOut();
      S.session = null;
      S.me = null;
      return 'inactive';
    }
    S.me = me;
    const [settingsData, subjects, chapters, profiles] = await Promise.all([Api.settings(), Api.subjects(), Api.chapters(), Api.profiles()]);
    S.settings = settingsData || {};
    S.subjects = subjects;
    S.subjectById = new Map(subjects.map((s) => [s.id, s]));
    S.chapters = chapters;
    S.chapterById = new Map(chapters.map((c) => [c.id, c]));
    S.profiles = profiles;
    S.profileById = new Map(profiles.map((p) => [p.id, p]));
    S.loaded = true;
    return 'ok';
  }
  async function refreshProfiles() {
    S.profiles = await Api.profiles();
    S.profileById = new Map(S.profiles.map((p) => [p.id, p]));
  }
  async function refreshSyllabus() {
    const [subjects, chapters] = await Promise.all([Api.subjects(), Api.chapters()]);
    S.subjects = subjects; S.subjectById = new Map(subjects.map((s) => [s.id, s]));
    S.chapters = chapters; S.chapterById = new Map(chapters.map((c) => [c.id, c]));
  }

  const routes = [
    [/^#\/?$/, 'home', viewHome],
    [/^#\/m\/([\w-]+)$/, 'home', viewMentee],
    [/^#\/build\/([\w-]+)$/, 'home', viewBuilder],
    [/^#\/p\/([\w-]+)$/, 'home', viewPaper],
    [/^#\/p\/([\w-]+)\/mark$/, 'home', viewMark],
    [/^#\/bank$/, 'bank', viewBank],
    [/^#\/q\/new$/, 'bank', (token) => viewEditor(null, token)],
    [/^#\/q\/([\w-]+)$/, 'bank', viewEditor],
    [/^#\/import$/, 'import', viewImport],
    [/^#\/admin$/, 'admin', viewAdmin],
    [/^#\/account$/, '', viewAccount],
  ];

  async function route() {
    const token = ++S.viewToken;
    S.actions = {};
    const style = document.getElementById('pageStyle');
    if (style) style.remove();
    if (!S.session) { S.me = null; renderTopbar(); return viewLogin(); }
    if (!S.loaded || !S.me) {
      main().innerHTML = loadingHTML();
      try {
        const r = await loadBasics();
        if (r === 'inactive') { renderTopbar(); viewLogin('This account has been switched off. Ask the admin to turn it back on.'); return; }
      } catch (e) { fail(e); main().innerHTML = '<div class="empty"><h2>Could not load</h2><p>' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Try again</button></div>'; return; }
    }
    renderTopbar();
    const hash = location.hash || '#/';
    for (const [re, nav, fn] of routes) {
      const m = hash.match(re);
      if (m) {
        setActiveNav(nav);
        window.scrollTo(0, 0);
        try { await fn.apply(null, m.slice(1).concat([token])); }
        catch (e) { if (token === S.viewToken) { fail(e); main().innerHTML = '<div class="empty"><h2>Something went wrong</h2><p>' + esc(e.message) + '</p><a class="btn" href="#/">Go to mentees</a></div>'; } }
        return;
      }
    }
    location.hash = '#/';
  }
  const stale = (token) => token !== S.viewToken;

  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const fn = S.actions[b.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(b, e)).catch(fail); }
  });

  /* ================= Sign in ================= */

  async function viewLogin(message) {
    setTitle('Sign in');
    main().innerHTML =
      '<section class="auth"><div class="auth-card">' +
      '<div class="auth-brand">' + MARK_SVG + '<div><b>AIN Paper Builder</b><span class="muted small">Personal question papers for every mentee</span></div></div>' +
      (message ? '<div class="notice bad" style="margin-bottom:14px">' + esc(message) + '</div>' : '') +
      '<form id="loginForm" novalidate>' +
      '<label class="field">Email<input id="loginEmail" type="email" autocomplete="username" required></label>' +
      '<label class="field">Password<input id="loginPassword" type="password" autocomplete="current-password" required></label>' +
      '<button class="btn primary" type="submit" id="loginBtn">Sign in</button>' +
      '<p class="muted small">Forgot your password? Ask the admin to set a new one for you.</p>' +
      '</form><div id="setupArea"></div></div></section>';
    $('#loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#loginBtn');
      busy(btn, true, 'Signing in…');
      try {
        await Api.signIn($('#loginEmail').value, $('#loginPassword').value);
        S.session = await Api.getSession();
        S.loaded = false;
        if (!location.hash || location.hash === '#/login') location.hash = '#/';
        await route();
      } catch (err) { fail(err); busy(btn, false); }
    });
    try {
      if (await Api.setupNeeded()) renderSetup();
    } catch (e) { /* offline: the sign-in form still shows */ }
  }

  function renderSetup() {
    const area = $('#setupArea');
    if (!area) return;
    area.innerHTML =
      '<div class="divider"></div>' +
      '<h2>First-time setup</h2><p class="muted small" style="margin:6px 0 14px">No admin account exists yet. Create yours with the setup code you were given.</p>' +
      '<form id="setupForm" novalidate style="display:grid;gap:12px">' +
      '<label class="field">Setup code<input id="setupCode" type="text" autocomplete="off" placeholder="XXXX-XXXX-XXXX" required></label>' +
      '<label class="field">Your name<input id="setupName" type="text" autocomplete="name" required></label>' +
      '<label class="field">Email<input id="setupEmail" type="email" autocomplete="username" required></label>' +
      '<label class="field">Password<span class="hint">At least 8 characters</span><input id="setupPassword" type="password" autocomplete="new-password" required></label>' +
      '<button class="btn primary" type="submit" id="setupBtn">Create admin account</button></form>';
    $('#setupForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#setupBtn');
      busy(btn, true, 'Creating…');
      try {
        const email = $('#setupEmail').value.trim();
        const password = $('#setupPassword').value;
        await Api.manageUsers({ action: 'bootstrap', setup_code: $('#setupCode').value, full_name: $('#setupName').value, email, password });
        await Api.signIn(email, password);
        S.session = await Api.getSession();
        S.loaded = false;
        toast('Admin account created');
        location.hash = '#/admin';
        await route();
      } catch (err) { fail(err); busy(btn, false); }
    });
  }

  /* ================= Mentees ================= */

  async function viewHome(token) {
    setTitle('Mentees');
    main().innerHTML = loadingHTML();
    const [mentees, papers, meta] = await Promise.all([Api.mentees(), Api.recentPapers(), getMeta()]);
    if (stale(token)) return;
    const s = settings();
    const papersBy = new Map();
    papers.forEach((p) => { if (!papersBy.has(p.mentee_id)) papersBy.set(p.mentee_id, []); papersBy.get(p.mentee_id).push(p); });
    const active = meta.filter((q) => !q.archived);
    const samples = active.filter((q) => q.is_sample).length;
    if (S.homeMentor == null) S.homeMentor = isAdmin() ? 'all' : S.me.id;
    const mentorIds = [...new Set(mentees.map((m) => m.mentor_id))];
    const visible = mentees.filter((m) => !m.archived && (S.homeMentor === 'all' || m.mentor_id === S.homeMentor));

    const row = (m) => {
      const ps = papersBy.get(m.id) || [];
      const last = ps[0];
      const lastMarked = ps.find((p) => p.marked_at);
      return '<li class="mentee-row">' +
        '<a class="mentee-main" href="#/m/' + m.id + '"><span class="avatar">' + esc(initials(m.name)) + '</span><div><div class="name">' + esc(m.name) + '</div>' +
        '<div class="status">' + esc(m.status || 'No notes yet') + '</div></div></a>' +
        '<div class="mentee-stats"><span><b>' + ps.length + '</b> paper' + (ps.length === 1 ? '' : 's') + (last ? ' · last ' + esc(fmtDay(last.created_at)) : '') + '</span>' +
        (lastMarked ? '<span>Last score <b>' + lastMarked.score + '</b>/' + (lastMarked.question_ids.length * s.marks_correct) + '</span>' : '<span>No marked papers</span>') + '</div>' +
        '<a class="btn primary sm" href="#/build/' + m.id + '">New paper</a></li>';
    };

    let listHTML = '';
    if (!visible.length) {
      listHTML = '<div class="panel empty"><h2>' + (mentees.length ? 'No mentees here' : 'Add your first mentee') + '</h2><p>Each mentee gets their own papers, and the app remembers which questions they have already seen.</p>' +
        '<button class="btn primary" data-act="add-mentee">Add mentee</button></div>';
    } else if (isAdmin() && S.homeMentor === 'all') {
      const groups = new Map();
      visible.forEach((m) => { if (!groups.has(m.mentor_id)) groups.set(m.mentor_id, []); groups.get(m.mentor_id).push(m); });
      const order = [...groups.keys()].sort((a, b) => (a === S.me.id ? -1 : b === S.me.id ? 1 : personName(a).localeCompare(personName(b))));
      listHTML = order.map((mid) => '<div class="mentor-group-title">' + esc(mid === S.me.id ? 'Your mentees' : personName(mid)) + ' · ' + groups.get(mid).length + '</div><ul class="mentee-list">' + groups.get(mid).map(row).join('') + '</ul>').join('');
    } else {
      listHTML = '<ul class="mentee-list">' + visible.map(row).join('') + '</ul>';
    }

    const mentorOptions = (sel) => S.profiles.filter((p) => p.active).map((p) => '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + esc(p.full_name || p.email) + (p.id === S.me.id ? ' (you)' : '') + '</option>').join('');

    main().innerHTML =
      '<div class="page-head"><div><h1>Mentees</h1><p class="sub">Choose a mentee to make a new paper, print it, or mark their answers.</p></div>' +
      '<div class="row">' + (isAdmin() ? '<select id="mentorFilter" aria-label="Show mentees of"><option value="all">All mentors</option>' + mentorIds.map((id) => '<option value="' + id + '"' + (S.homeMentor === id ? ' selected' : '') + '>' + esc(id === S.me.id ? 'Your mentees' : personName(id)) + '</option>').join('') + '</select>' : '') +
      '<button class="btn primary" data-act="add-mentee">Add mentee</button></div></div>' +
      '<div class="stat-strip"><span>Question bank: <b>' + active.length + '</b> questions' + (samples ? ' (' + samples + ' samples)' : '') + '</span><a href="#/bank">Open bank</a><a href="#/q/new">Add a question</a><a href="#/import">Add from a PDF</a></div>' +
      '<form class="panel" id="menteeForm" hidden novalidate style="margin-bottom:16px"><h2 style="margin-bottom:12px">New mentee</h2><div class="form-grid">' +
      '<label class="field">Name<input id="mfName" type="text" required maxlength="120"></label>' +
      '<label class="field">Target NEET year<input id="mfYear" type="number" min="2025" max="2035" value="' + (new Date().getFullYear() + 1) + '"></label>' +
      (isAdmin() ? '<label class="field">Mentor<select id="mfMentor">' + mentorOptions(S.me.id) + '</select></label>' : '') +
      '</div><label class="field" style="margin-top:14px">Status and notes<span class="hint">What they are strong or weak in, current level. You see this while making papers.</span><textarea id="mfStatus" rows="3" maxlength="1000"></textarea></label>' +
      '<div class="form-actions"><button class="btn primary" type="submit" id="mfSave">Add mentee</button><button class="btn" type="button" data-act="cancel-mentee">Cancel</button></div></form>' +
      listHTML;

    const filter = $('#mentorFilter');
    if (filter) filter.addEventListener('change', () => { S.homeMentor = filter.value; viewHome(S.viewToken); });
    S.actions['add-mentee'] = () => { $('#menteeForm').hidden = false; $('#mfName').focus(); };
    S.actions['cancel-mentee'] = () => { $('#menteeForm').hidden = true; };
    $('#menteeForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#mfName').value.trim();
      if (!name) { toast('Enter the mentee’s name.', 'bad'); return; }
      const btn = $('#mfSave');
      busy(btn, true, 'Adding…');
      try {
        const m = await Api.saveMentee({ name, status: $('#mfStatus').value.trim() || null, target_year: Number($('#mfYear').value) || null, mentor_id: isAdmin() ? $('#mfMentor').value : S.me.id });
        toast(m.name + ' added');
        location.hash = '#/m/' + m.id;
      } catch (err) { fail(err); busy(btn, false); }
    });
  }

  async function viewMentee(id, token) {
    main().innerHTML = loadingHTML();
    const m = await Api.getMentee(id);
    if (stale(token)) return;
    if (!m) { main().innerHTML = '<div class="empty"><h2>Mentee not found</h2><p>They may have been removed, or they belong to another mentor.</p><a class="btn" href="#/">Back to mentees</a></div>'; return; }
    setTitle(m.name);
    const [papers, meta] = await Promise.all([Api.papersForMentee(id), getMeta()]);
    if (stale(token)) return;
    const s = settings();
    const hist = L.buildHistory(papers);
    const metaById = new Map(meta.map((q) => [q.id, q]));
    const now = Date.now();
    const agg = new Map();
    hist.forEach((h, qid) => {
      const q = metaById.get(qid);
      if (!q) return;
      const a = agg.get(q.chapter_id) || { seen: 0, correct: 0, wrong: 0, attempts: 0, due: 0 };
      a.seen += 1; a.correct += h.correct; a.wrong += h.wrong; a.attempts += h.correct + h.wrong;
      if (!q.archived && L.repStatus(h, now, s).state === 'due') a.due += 1;
      agg.set(q.chapter_id, a);
    });
    const chRows = [...agg.entries()].sort((a, b) => (subjSortOfChapter(a[0]) - subjSortOfChapter(b[0])) || ((S.chapterById.get(a[0]) || {}).sort - (S.chapterById.get(b[0]) || {}).sort));
    const accCell = (a) => {
      if (!a.attempts) return '<span class="muted small">Not marked</span>';
      const pct = Math.round((a.correct / a.attempts) * 100);
      return '<span class="acc"><span class="acc-bar"><i class="' + (pct < 50 ? 'low' : pct < 75 ? 'mid' : '') + '" style="width:' + pct + '%"></i></span><span class="num small">' + pct + '%</span></span>';
    };
    const totalMarked = papers.filter((p) => p.marked_at);
    const mentorOptions = S.profiles.filter((p) => p.active || p.id === m.mentor_id).map((p) => '<option value="' + p.id + '"' + (p.id === m.mentor_id ? ' selected' : '') + '>' + esc(p.full_name || p.email) + '</option>').join('');

    main().innerHTML =
      '<div class="page-head"><div><a class="crumb" href="#/">← Mentees</a><h1>' + esc(m.name) + '</h1>' +
      '<p class="sub">' + esc(m.status || 'No notes yet.') + '</p>' +
      '<p class="muted small" style="margin-top:6px">' + (m.target_year ? 'NEET ' + m.target_year + ' · ' : '') + 'Mentor: ' + esc(personName(m.mentor_id)) + ' · ' + papers.length + ' paper' + (papers.length === 1 ? '' : 's') + ', ' + totalMarked.length + ' marked</p></div>' +
      '<div class="row"><button class="btn" data-act="edit">Edit details</button><a class="btn primary" href="#/build/' + m.id + '">New paper</a></div></div>' +
      '<form class="panel" id="editForm" hidden novalidate style="margin-bottom:18px"><h2 style="margin-bottom:12px">Edit details</h2><div class="form-grid">' +
      '<label class="field">Name<input id="efName" type="text" value="' + esc(m.name) + '" maxlength="120"></label>' +
      '<label class="field">Target NEET year<input id="efYear" type="number" min="2025" max="2035" value="' + esc(m.target_year || '') + '"></label>' +
      (isAdmin() ? '<label class="field">Mentor<select id="efMentor">' + mentorOptions + '</select></label>' : '') +
      '</div><label class="field" style="margin-top:14px">Status and notes<textarea id="efStatus" rows="3" maxlength="1000">' + esc(m.status || '') + '</textarea></label>' +
      '<div class="form-actions"><button class="btn primary" type="submit" id="efSave">Save</button><button class="btn" type="button" data-act="cancel-edit">Cancel</button><span class="spacer"></span>' +
      '<button class="btn danger" type="button" data-act="ask-delete">Remove mentee</button></div>' +
      '<div class="notice bad" id="delConfirm" hidden style="margin-top:12px">Remove ' + esc(m.name) + ' and all ' + papers.length + ' of their papers and results? This cannot be undone.' +
      '<div class="form-actions" style="margin-top:10px"><button class="btn danger solid" type="button" data-act="do-delete">Yes, remove</button><button class="btn" type="button" data-act="no-delete">Keep</button></div></div></form>' +

      '<section class="section"><h2>Papers</h2>' +
      (papers.length ? '<div class="table-wrap"><table class="data"><thead><tr><th>Date</th><th>Paper</th><th class="num">Questions</th><th class="num">Score</th><th></th></tr></thead><tbody>' +
        papers.map((p) => '<tr><td class="num">' + esc(fmtDate(p.created_at)) + '</td><td><a href="#/p/' + p.id + '"><b>' + esc(p.title) + '</b></a><div class="muted small mono">' + esc(p.code) + '</div></td>' +
          '<td class="num">' + p.question_ids.length + '</td>' +
          '<td class="num">' + (p.marked_at ? '<b>' + p.score + '</b> / ' + (p.question_ids.length * s.marks_correct) : '<span class="muted small">Not marked</span>') + '</td>' +
          '<td style="text-align:right;white-space:nowrap"><a class="btn sm" href="#/p/' + p.id + '">Open</a> <a class="btn sm" href="#/p/' + p.id + '/mark">' + (p.marked_at ? 'Edit marks' : 'Mark answers') + '</a></td></tr>').join('') +
        '</tbody></table></div>'
        : '<div class="panel empty"><h2>No papers yet</h2><p>Make the first paper for ' + esc(m.name) + '. Questions they get will be held back from later papers for a while.</p><a class="btn primary" href="#/build/' + m.id + '">New paper</a></div>') +
      '</section>' +

      (chRows.length ? '<section class="section"><h2>Chapter record</h2><p class="muted small" style="margin:-6px 0 12px">Questions seen per chapter, and accuracy from marked papers. “Due” questions are ready to come back as revision.</p>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Chapter</th><th>Subject</th><th class="num">Seen</th><th class="num">Wrong</th><th>Accuracy</th><th class="num">Due</th></tr></thead><tbody>' +
        chRows.map(([cid, a]) => '<tr><td>' + esc(chapterName(cid)) + '</td><td class="muted">' + esc((subjectOfChapter(cid) || {}).name || '') + '</td><td class="num">' + a.seen + '</td><td class="num">' + a.wrong + '</td><td>' + accCell(a) + '</td><td class="num">' + (a.due || '–') + '</td></tr>').join('') +
        '</tbody></table></div></section>' : '');

    S.actions.edit = () => { $('#editForm').hidden = false; $('#efName').focus(); };
    S.actions['cancel-edit'] = () => { $('#editForm').hidden = true; };
    S.actions['ask-delete'] = () => { $('#delConfirm').hidden = false; };
    S.actions['no-delete'] = () => { $('#delConfirm').hidden = true; };
    S.actions['do-delete'] = async (b) => {
      busy(b, true, 'Removing…');
      try { await Api.deleteMentee(m.id); delete S.builder[m.id]; toast(m.name + ' removed'); location.hash = '#/'; }
      catch (e) { fail(e); busy(b, false); }
    };
    $('#editForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#efName').value.trim();
      if (!name) { toast('Enter a name.', 'bad'); return; }
      const btn = $('#efSave');
      busy(btn, true, 'Saving…');
      try {
        const patch = { id: m.id, name, status: $('#efStatus').value.trim() || null, target_year: Number($('#efYear').value) || null };
        if (isAdmin()) patch.mentor_id = $('#efMentor').value;
        await Api.saveMentee(patch);
        toast('Saved');
        viewMentee(m.id, S.viewToken);
      } catch (err) { fail(err); busy(btn, false); }
    });
  }

  /* ================= Paper builder ================= */

  async function viewBuilder(menteeId, token) {
    main().innerHTML = loadingHTML();
    const m = await Api.getMentee(menteeId);
    if (stale(token)) return;
    if (!m) { main().innerHTML = '<div class="empty"><h2>Mentee not found</h2><a class="btn" href="#/">Back to mentees</a></div>'; return; }
    setTitle('New paper for ' + m.name);
    const [papers, meta] = await Promise.all([Api.papersForMentee(menteeId), getMeta()]);
    if (stale(token)) return;
    const s = settings();
    const hist = L.buildHistory(papers);
    const now = Date.now();
    const visibleChapters = S.chapters.filter((c) => !c.hidden);
    const st = S.builder[menteeId] || (S.builder[menteeId] = {
      counts: {}, mix: 'any', review: 0.2, order: 'chapter', title: '', duration: '', tab: (S.subjects[0] || {}).id, search: '', draft: null,
    });

    const stats = new Map();
    meta.forEach((q) => {
      if (q.archived) return;
      const x = stats.get(q.chapter_id) || { bank: 0, fresh: 0, due: 0, resting: 0 };
      x.bank++;
      const r = L.repStatus(hist.get(q.id), now, s).state;
      if (r === 'new') x.fresh++; else if (r === 'due') x.due++; else x.resting++;
      stats.set(q.chapter_id, x);
    });

    main().innerHTML =
      '<div class="page-head"><div><a class="crumb" href="#/m/' + m.id + '">← ' + esc(m.name) + '</a><h1>New paper</h1>' +
      '<p class="sub">' + esc(m.status || 'Choose chapters and how many questions from each.') + '</p></div></div>' +
      '<div class="builder"><section class="panel" id="chapPanel"></section><aside class="panel summary" id="summary"></aside></div>' +
      '<section class="draft" id="draft"></section>';

    const subjCount = (sid) => visibleChapters.filter((c) => c.subject_id === sid).reduce((n, c) => n + (Number(st.counts[c.id]) || 0), 0);

    function renderChapters() {
      const q = st.search.trim().toLowerCase();
      const list = q ? visibleChapters.filter((c) => c.name.toLowerCase().includes(q)) : visibleChapters.filter((c) => c.subject_id === st.tab);
      $('#chapPanel').innerHTML =
        '<div class="tabs" role="tablist">' + S.subjects.map((sub) => '<button class="tab" role="tab" data-act="tab" data-id="' + sub.id + '" aria-selected="' + (!q && st.tab === sub.id) + '">' + esc(sub.name) +
          (subjCount(sub.id) ? '<span class="count">' + subjCount(sub.id) + '</span>' : '') + '</button>').join('') + '</div>' +
        '<div class="row" style="margin-bottom:12px"><input type="search" id="chapSearch" placeholder="Find a chapter in any subject" value="' + esc(st.search) + '" style="max-width:320px"></div>' +
        '<div class="table-wrap"><table class="data chap-table"><thead><tr><th>Chapter</th><th class="num hide-sm" title="Questions in the bank">Bank</th><th class="num hide-sm" title="Questions this mentee has not seen">Not seen</th><th class="num hide-sm" title="Seen before and ready to come back">Due</th><th>Questions</th></tr></thead><tbody>' +
        (list.length ? list.map((c) => {
          const x = stats.get(c.id) || { bank: 0, fresh: 0, due: 0 };
          const n = Number(st.counts[c.id]) || 0;
          return '<tr class="' + (n ? 'picked' : '') + (x.bank ? '' : ' nobank') + '"><td class="cname">' + esc(c.name) + (c.class_level ? '<span class="cls">' + esc(c.class_level) + '</span>' : '') +
            (q ? '<div class="muted small">' + esc(subjectName(c.subject_id)) + '</div>' : '') +
            '<div class="cstats">' + x.bank + ' in bank · ' + x.fresh + ' not seen' + (x.due ? ' · ' + x.due + ' due' : '') + '</div></td>' +
            '<td class="num hide-sm">' + x.bank + '</td><td class="num hide-sm">' + x.fresh + '</td><td class="num hide-sm">' + (x.due || '–') + '</td>' +
            '<td><span class="stepper"><button type="button" data-act="dec" data-ch="' + c.id + '" aria-label="Fewer"' + (x.bank ? '' : ' disabled') + '>−</button>' +
            '<input type="number" min="0" max="' + x.bank + '" inputmode="numeric" data-ch="' + c.id + '" id="cnt-' + c.id + '" value="' + (n || '') + '" placeholder="0" aria-label="Questions from ' + esc(c.name) + '"' + (x.bank ? '' : ' disabled') + '>' +
            '<button type="button" data-act="inc" data-ch="' + c.id + '" aria-label="More"' + (x.bank ? '' : ' disabled') + '>+</button></span></td></tr>';
        }).join('') : '<tr><td colspan="5" class="muted">No chapters match.</td></tr>') +
        '</tbody></table></div>';
      const search = $('#chapSearch');
      search.addEventListener('input', debounce(() => { st.search = search.value; renderChapters(); const s2 = $('#chapSearch'); s2.focus(); s2.setSelectionRange(s2.value.length, s2.value.length); }, 250));
      $$('#chapPanel input[data-ch]').forEach((inp) => inp.addEventListener('input', () => {
        const max = Number(inp.max) || 0;
        let v = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (v > max) { v = max; inp.value = v; toast('Only ' + max + ' question' + (max === 1 ? '' : 's') + ' in this chapter.'); }
        setCount(Number(inp.dataset.ch), v, false);
      }));
    }

    function setCount(ch, v, rerender) {
      if (v > 0) st.counts[ch] = v; else delete st.counts[ch];
      if (rerender) renderChapters();
      else {
        const tr = $('#cnt-' + ch) && $('#cnt-' + ch).closest('tr');
        if (tr) tr.classList.toggle('picked', v > 0);
        $$('#chapPanel .tab').forEach((t) => {
          const sid = Number(t.dataset.id);
          const n = subjCount(sid);
          let span = $('.count', t);
          if (n && !span) { span = document.createElement('span'); span.className = 'count'; t.appendChild(span); }
          if (span) { if (n) span.textContent = n; else span.remove(); }
        });
      }
      renderSummary();
    }

    function requestList() {
      return Object.entries(st.counts).map(([ch, n]) => ({ chapter_id: Number(ch), count: Number(n) }))
        .filter((r) => r.count > 0 && S.chapterById.has(r.chapter_id))
        .sort((a, b) => (subjSortOfChapter(a.chapter_id) - subjSortOfChapter(b.chapter_id)) || (S.chapterById.get(a.chapter_id).sort - S.chapterById.get(b.chapter_id).sort));
    }
    function defaultTitle(req) {
      const subs = [...new Set(req.map((r) => (subjectOfChapter(r.chapter_id) || {}).name))].filter(Boolean);
      if (!subs.length) return 'Practice Test';
      if (req.length === 1) return chapterName(req[0].chapter_id) + ' Test';
      if (subs.length === S.subjects.length) return 'Full Syllabus Test';
      if (subs.length <= 2) return subs.join(' + ') + ' Test';
      return 'Mixed Test';
    }

    function seg(name, value, opts) {
      return '<div class="seg" role="radiogroup">' + opts.map(([v, label]) => '<label><input type="radio" name="' + name + '" value="' + v + '"' + (String(value) === String(v) ? ' checked' : '') + '><span>' + label + '</span></label>').join('') + '</div>';
    }

    function renderSummary() {
      const req = requestList();
      const total = req.reduce((n, r) => n + r.count, 0);
      $('#summary').innerHTML =
        '<div><div class="total">' + total + ' <small>questions · ' + (total * s.marks_correct) + ' marks</small></div></div>' +
        '<div class="sel-list">' + (req.length ? req.map((r) => '<span class="chip">' + esc(chapterName(r.chapter_id)) + ' · ' + r.count + '<button type="button" data-act="unpick" data-ch="' + r.chapter_id + '" aria-label="Remove ' + esc(chapterName(r.chapter_id)) + '">×</button></span>').join('') : '<span class="muted small">Pick chapters and set how many questions from each.</span>') + '</div>' +
        '<label class="field">Paper title<input id="pTitle" type="text" maxlength="120" value="' + esc(st.title) + '" placeholder="' + esc(defaultTitle(req)) + '"></label>' +
        '<label class="field">Time allowed (minutes)<input id="pDur" type="number" min="1" max="600" value="' + esc(st.duration) + '" placeholder="' + (total || 60) + '"></label>' +
        '<div class="field">Difficulty' + seg('mix', st.mix, [['any', 'Any'], ['easier', 'Easier'], ['balanced', 'Balanced'], ['harder', 'Harder']]) + '</div>' +
        '<div class="field">Revision questions<span class="hint">Questions this mentee saw before that are due again</span>' + seg('review', st.review, [['0', 'None'], ['0.2', 'Up to 20%'], ['0.4', 'Up to 40%']]) + '</div>' +
        '<div class="field">Order' + seg('order', st.order, [['chapter', 'By chapter'], ['shuffle', 'Mixed in subject']]) + '</div>' +
        '<button class="btn primary" data-act="generate" ' + (total ? '' : 'disabled') + '>' + (st.draft ? 'Make again' : 'Make paper') + '</button>';
      $('#pTitle').addEventListener('input', (e) => { st.title = e.target.value; });
      $('#pDur').addEventListener('input', (e) => { st.duration = e.target.value; });
      $$('#summary input[type=radio]').forEach((r) => r.addEventListener('change', () => {
        if (r.name === 'mix') st.mix = r.value;
        if (r.name === 'review') st.review = Number(r.value);
        if (r.name === 'order') st.order = r.value;
      }));
    }

    async function renderDraft() {
      const box = $('#draft');
      if (!st.draft) { box.innerHTML = ''; return; }
      const items = st.draft.items;
      await loadQuestions(items.map((i) => i.id));
      if (stale(token)) return;
      const counts = items.reduce((acc, i) => (acc[i.reason] = (acc[i.reason] || 0) + 1, acc), {});
      const warn = st.draft.warnings.map((w) => w.early
        ? '<li><b>' + esc(chapterName(w.chapter_id)) + '</b>: ' + w.early + ' question' + (w.early > 1 ? 's were' : ' was') + ' repeated earlier than planned because the chapter ran out of unseen questions.</li>'
        : '<li><b>' + esc(chapterName(w.chapter_id)) + '</b>: asked for ' + w.wanted + ', only ' + w.got + ' available.</li>').join('');
      let lastSub = null;
      box.innerHTML =
        '<div class="draft-head"><div><h2>Draft · ' + items.length + ' questions</h2><div class="row small muted" style="margin-top:6px">' +
        (counts.new ? chipReason('new') + ' ' + counts.new : '') + ' ' + (counts.review ? chipReason('review') + ' ' + counts.review : '') + ' ' + (counts.early ? chipReason('early') + ' ' + counts.early : '') +
        '</div></div><div class="row"><button class="btn" data-act="generate">Make again</button><button class="btn primary" data-act="save" ' + (items.length ? '' : 'disabled') + '>Save paper</button></div></div>' +
        (warn ? '<div class="notice warn" style="margin-bottom:12px">Check these:<ul>' + warn + '</ul></div>' : '') +
        '<p class="muted small" style="margin-bottom:10px">Nothing counts for ' + esc(m.name) + '’s history until you save. Use Swap to replace a question with another from the same chapter.</p>' +
        '<ol class="draft-list">' + items.map((it, i) => {
          const q = S.qcache.get(it.id);
          const sub = (subjectOfChapter(it.chapter_id) || {}).name;
          const head = sub !== lastSub ? '<li class="mentor-group-title" style="margin:10px 0 0">' + esc(sub || '') + '</li>' : '';
          lastSub = sub;
          return head + '<li class="draft-q"><span class="n">' + (i + 1) + '.</span><div style="min-width:0"><div class="meta">' + esc(chapterName(it.chapter_id)) + ' ' + chipDiff(it.difficulty) + ' ' + chipReason(it.reason) + '</div>' +
            (q ? questionHTML(q, { showAnswer: true }) : '<p class="muted">This question could not be loaded.</p>') + '</div>' +
            '<div class="acts"><button class="btn sm" data-act="swap" data-i="' + i + '">Swap</button><button class="btn ghost sm" data-act="remove" data-i="' + i + '" aria-label="Remove question ' + (i + 1) + '">Remove</button></div></li>';
        }).join('') + '</ol>' +
        '<div class="form-actions"><button class="btn primary" data-act="save" ' + (items.length ? '' : 'disabled') + '>Save paper</button></div>';
      hydrateImages(box);
    }

    S.actions.tab = (b) => { st.tab = Number(b.dataset.id); st.search = ''; renderChapters(); };
    S.actions.inc = (b) => { const ch = Number(b.dataset.ch); const max = (stats.get(ch) || {}).bank || 0; const v = Math.min(max, (Number(st.counts[ch]) || 0) + 5); setCount(ch, v, false); const inp = $('#cnt-' + ch); if (inp) inp.value = v || ''; };
    S.actions.dec = (b) => { const ch = Number(b.dataset.ch); const v = Math.max(0, (Number(st.counts[ch]) || 0) - 5); setCount(ch, v, false); const inp = $('#cnt-' + ch); if (inp) inp.value = v || ''; };
    S.actions.unpick = (b) => { setCount(Number(b.dataset.ch), 0, true); };
    S.actions.generate = async (b) => {
      const req = requestList();
      if (!req.length) { toast('Pick at least one chapter.', 'bad'); return; }
      busy(b, true, 'Making…');
      try {
        const fresh = await getMeta(true);
        const res = L.buildPaper(fresh, req, chapterInfoMap(), hist, { mix: st.mix, reviewShare: st.review, order: st.order, seed: Date.now() ^ Math.floor(Math.random() * 1e9), now: Date.now(), settings: s });
        st.draft = { items: res.items, warnings: res.warnings, rejected: {}, req };
        renderSummary();
        await renderDraft();
        $('#draft').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } finally { busy(b, false); }
    };
    S.actions.swap = async (b) => {
      const i = Number(b.dataset.i);
      const cur = st.draft.items[i];
      const rej = st.draft.rejected[cur.chapter_id] || (st.draft.rejected[cur.chapter_id] = []);
      const rep = L.nextReplacement(S.meta || meta, cur, st.draft.items.map((x) => x.id), rej, hist, { now: Date.now(), settings: s, seed: Date.now() });
      if (!rep) { toast('No other question left in ' + chapterName(cur.chapter_id) + '.'); return; }
      rej.push(cur.id);
      st.draft.items[i] = rep;
      await renderDraft();
    };
    S.actions.remove = async (b) => { st.draft.items.splice(Number(b.dataset.i), 1); await renderDraft(); };
    S.actions.save = async (b) => {
      if (!st.draft || !st.draft.items.length) return;
      busy(b, true, 'Saving…');
      try {
        const req = st.draft.req || requestList();
        const title = (st.title || '').trim() || defaultTitle(req);
        const items = st.draft.items;
        const p = await Api.createPaper({
          mentee_id: m.id,
          code: L.paperCode(orgName()),
          title,
          duration_min: Number(st.duration) || items.length,
          settings: { request: req, mix: st.mix, review: st.review, order: st.order, reasons: items.reduce((o, it) => (o[it.id] = it.reason, o), {}) },
          question_ids: items.map((it) => it.id),
        });
        delete S.builder[m.id];
        toast('Paper saved');
        location.hash = '#/p/' + p.id;
      } catch (e) { fail(e); busy(b, false); }
    };

    renderChapters();
    renderSummary();
    renderDraft();
  }

  /* ================= Paper view and print ================= */

  function cssString(s) { return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\n\r]/g, ' ') + '"'; }

  function sheetHeader(p, m, title) {
    const st = S.settings || {};
    const logo = st.logo_path ? '<img data-path="' + esc(st.logo_path) + '" alt="' + esc(orgName()) + ' logo">' : '<div class="org-mono">' + esc(orgName().slice(0, 4)) + '</div>';
    return '<header class="sheet-head"><div class="org">' + logo + '<div><div class="org-name">' + esc(orgName()) + '</div><div class="org-tag">' + esc(st.tagline || '') + '</div></div></div>' +
      '<div class="paper-meta"><div>Paper code <b>' + esc(p.code) + '</b></div><div>Date ' + esc(fmtDate(p.created_at)) + '</div></div></header>' +
      '<h1 class="paper-title">' + esc(title) + '</h1>';
  }

  function paperSheet(p, m, qById, tab) {
    const s = settings();
    const n = p.question_ids.length;
    let lastSub = null;
    if (tab === 'key') {
      return '<article class="sheet">' + sheetHeader(p, m, p.title + ': Answer key') +
        '<div class="paper-facts"><span>Name: <b>' + esc(m ? m.name : '') + '</b></span><span>Questions: <b>' + n + '</b></span><span>Marking: <b>+' + s.marks_correct + ' / ' + s.marks_wrong + '</b></span></div>' +
        '<div class="key-grid">' + p.question_ids.map((id, i) => { const q = qById.get(id); return '<div><span>' + (i + 1) + '.</span><b>' + (q ? '(' + q.answer + ')' : '–') + '</b></div>'; }).join('') + '</div>' +
        '<div class="sheet-foot"><span>' + esc(m ? m.name : '') + ' · ' + esc(p.code) + '</span><span>Answer key</span></div></article>';
    }
    if (tab === 'solutions') {
      return '<article class="sheet">' + sheetHeader(p, m, p.title + ': Solutions') +
        '<div class="paper-facts"><span>Name: <b>' + esc(m ? m.name : '') + '</b></span><span>Questions: <b>' + n + '</b></span></div>' +
        '<div class="qcols" style="margin-top:10px">' + p.question_ids.map((id, i) => {
          const q = qById.get(id);
          if (!q) return '<div class="sol-item"><b>' + (i + 1) + '.</b><div class="muted">This question was removed from the bank.</div></div>';
          return '<div class="sol-item"><b>' + (i + 1) + '.</b><div><div class="ans">Answer (' + q.answer + ')</div><div class="rich">' + (q.solution ? rich(q.solution) : '<span class="muted">No solution written.</span>') + '</div></div></div>';
        }).join('') + '</div>' +
        '<div class="sheet-foot"><span>' + esc(m ? m.name : '') + ' · ' + esc(p.code) + '</span><span>Solutions</span></div></article>';
    }
    const instr = String(s.instructions || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return '<article class="sheet">' + sheetHeader(p, m, p.title) +
      '<div class="paper-facts"><span>Name: <b>' + esc(m ? m.name : '') + '</b></span><span>Time: <b>' + esc(p.duration_min || n) + ' min</b></span><span>Questions: <b>' + n + '</b></span><span>Maximum marks: <b>' + (n * s.marks_correct) + '</b></span></div>' +
      (instr.length ? '<div class="instructions"><b>Instructions</b><ol>' + instr.map((l) => '<li>' + esc(l) + '</li>').join('') + '</ol></div>' : '') +
      '<div class="qcols">' + p.question_ids.map((id, i) => {
        const q = qById.get(id);
        let head = '';
        const sub = q ? (subjectOfChapter(q.chapter_id) || {}).name : null;
        if (sub && sub !== lastSub) { head = '<h2 class="subj">' + esc(sub) + '</h2>'; lastSub = sub; }
        return '<div class="pq">' + head + '<span class="qn">' + (i + 1) + '.</span><div>' + (q ? questionHTML(q) : '<p class="muted">This question was removed from the bank.</p>') + '</div></div>';
      }).join('') + '<div class="end-mark">— END —</div></div>' +
      '<div class="sheet-foot"><span>Prepared for ' + esc(m ? m.name : '') + '</span><span class="mono">' + esc(p.code) + '</span></div></article>';
  }

  async function viewPaper(id, token) {
    main().innerHTML = loadingHTML();
    const p = await Api.getPaper(id);
    if (stale(token)) return;
    if (!p) { main().innerHTML = '<div class="empty"><h2>Paper not found</h2><a class="btn" href="#/">Back to mentees</a></div>'; return; }
    const [m, qs] = await Promise.all([Api.getMentee(p.mentee_id), Api.questionsByIds(p.question_ids)]);
    if (stale(token)) return;
    qs.forEach((q) => S.qcache.set(q.id, q));
    const qById = new Map(qs.map((q) => [q.id, q]));
    setTitle(p.title + ' · ' + (m ? m.name : ''));
    const s = settings();

    function render() {
      const tab = S.paperTab;
      main().innerHTML =
        '<div class="no-print"><div class="page-head"><div><a class="crumb" href="#/m/' + p.mentee_id + '">← ' + esc(m ? m.name : 'Mentee') + '</a><h1>' + esc(p.title) + '</h1>' +
        '<p class="sub mono">' + esc(p.code) + ' · ' + esc(fmtDate(p.created_at)) + ' · ' + p.question_ids.length + ' questions' +
        (p.marked_at ? ' · scored <b>' + p.score + '</b>/' + (p.question_ids.length * s.marks_correct) : '') + '</p></div>' +
        '<div class="row"><a class="btn" href="#/p/' + p.id + '/mark">' + (p.marked_at ? 'Edit marks' : 'Mark answers') + '</a><button class="btn primary" data-act="print">Print or save as PDF</button></div></div>' +
        '<div class="paper-tools"><div class="seg" role="radiogroup" aria-label="Show">' +
        [['paper', 'Question paper'], ['key', 'Answer key'], ['solutions', 'Solutions']].map(([k, l]) => '<label><input type="radio" name="ptab" value="' + k + '"' + (tab === k ? ' checked' : '') + '><span>' + l + '</span></label>').join('') +
        '</div><span class="spacer"></span><button class="btn ghost sm" data-act="ask-del-paper">Delete paper</button></div>' +
        '<div class="notice bad" id="delPaper" hidden style="margin-bottom:14px">Delete this paper? Its questions will no longer count as seen by ' + esc(m ? m.name : 'this mentee') + ', and any marks are lost.' +
        '<div class="form-actions" style="margin-top:10px"><button class="btn danger solid" data-act="del-paper">Yes, delete</button><button class="btn" data-act="keep-paper">Keep</button></div></div></div>' +
        '<div class="sheet-wrap">' + paperSheet(p, m, qById, tab) + '</div>';
      $$('input[name=ptab]').forEach((r) => r.addEventListener('change', () => { S.paperTab = r.value; render(); }));
      let style = document.getElementById('pageStyle');
      if (!style) { style = document.createElement('style'); style.id = 'pageStyle'; document.head.appendChild(style); }
      const label = (m ? m.name + ' · ' : '') + p.code + (tab === 'key' ? ' · Answer key' : tab === 'solutions' ? ' · Solutions' : '');
      style.textContent = '@page { @bottom-left { content: ' + cssString(label) + '; font: 7.5pt sans-serif; color: #555; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 7.5pt sans-serif; color: #555; } }';
      hydrateImages(main());
    }

    S.actions.print = async (b) => {
      if (window.__DEMO) { toast('This preview can’t open the print dialog. On the real website this button prints the paper or saves it as a PDF.'); return; }
      busy(b, true, 'Preparing…');
      try { await waitForImages(main()); } finally { busy(b, false); }
      window.print();
    };
    S.actions['ask-del-paper'] = () => { $('#delPaper').hidden = false; };
    S.actions['keep-paper'] = () => { $('#delPaper').hidden = true; };
    S.actions['del-paper'] = async (b) => {
      busy(b, true, 'Deleting…');
      try { await Api.deletePaper(p.id); toast('Paper deleted'); location.hash = '#/m/' + p.mentee_id; }
      catch (e) { fail(e); busy(b, false); }
    };
    render();
  }

  /* ================= Marking ================= */

  async function viewMark(id, token) {
    main().innerHTML = loadingHTML();
    const p = await Api.getPaper(id);
    if (stale(token)) return;
    if (!p) { main().innerHTML = '<div class="empty"><h2>Paper not found</h2><a class="btn" href="#/">Back to mentees</a></div>'; return; }
    const [m, qs] = await Promise.all([Api.getMentee(p.mentee_id), Api.questionsByIds(p.question_ids)]);
    if (stale(token)) return;
    const qById = new Map(qs.map((q) => [q.id, q]));
    const questions = p.question_ids.map((qid) => qById.get(qid)).filter(Boolean);
    const s = settings();
    setTitle('Mark ' + p.title);
    const choices = {};
    if (p.responses) Object.keys(p.responses).forEach((qid) => { choices[qid] = Number(p.responses[qid].c) || 0; });
    let showKey = false;

    function render() {
      let lastSub = null;
      main().innerHTML =
        '<div class="page-head"><div><a class="crumb" href="#/p/' + p.id + '">← ' + esc(p.title) + '</a><h1>Mark answers</h1>' +
        '<p class="sub">Tap the bubble ' + esc(m ? m.name : 'the mentee') + ' filled for each question. Leave unanswered questions blank. Wrong answers come back for revision after ' + s.wrong_gap_days + ' days.</p></div>' +
        '<div class="row"><label class="check"><input type="checkbox" id="showKey"' + (showKey ? ' checked' : '') + '> Show correct answers</label></div></div>' +
        '<div class="panel"><div class="omr">' + p.question_ids.map((qid, i) => {
          const q = qById.get(qid);
          let head = '';
          const sub = q ? (subjectOfChapter(q.chapter_id) || {}).name : 'Removed';
          if (sub !== lastSub) { head = '<div class="omr-sub">' + esc(sub) + '</div>'; lastSub = sub; }
          if (!q) return head + '<div class="omr-row"><span class="qn">' + (i + 1) + '</span><span class="muted small">Question removed from bank</span></div>';
          const c = choices[qid] || 0;
          const res = c ? (c === Number(q.answer) ? 'c' : 'w') : '';
          return head + '<div class="omr-row ' + (showKey ? res : '') + '" data-q="' + qid + '"><span class="qn">' + (i + 1) + '</span>' +
            [1, 2, 3, 4].map((k) => '<button type="button" class="bub' + (showKey && Number(q.answer) === k ? ' key' : '') + '" data-act="pick" data-q="' + qid + '" data-c="' + k + '" aria-pressed="' + (c === k) + '" aria-label="Question ' + (i + 1) + ' option ' + k + '">' + k + '</button>').join('') +
            '<span class="res">' + (showKey ? (res === 'c' ? '✓' : res === 'w' ? '✗' : '') : '') + '</span>' +
            (c ? '<button type="button" class="omr-clear" data-act="clear" data-q="' + qid + '">clear</button>' : '') + '</div>';
        }).join('') + '</div></div>' +
        '<div class="scorebar" id="scorebar"></div>';
      $('#showKey').addEventListener('change', (e) => { showKey = e.target.checked; render(); });
      renderScore();
    }
    function renderScore() {
      const r = L.scoreResponses(questions, choices, s);
      $('#scorebar').innerHTML =
        '<span class="big num">' + r.score + ' <span class="muted small">/ ' + r.max + '</span></span>' +
        '<span class="c num">' + r.correct + ' correct</span><span class="w num">' + r.wrong + ' wrong</span><span class="muted num">' + r.skipped + ' not answered</span>' +
        '<span class="spacer"></span>' + (p.marked_at ? '<button class="btn ghost sm" data-act="unmark">Remove marks</button>' : '') +
        '<button class="btn primary" data-act="save-marks">Save marks</button>';
    }
    S.actions.pick = (b) => {
      const qid = b.dataset.q, k = Number(b.dataset.c);
      choices[qid] = choices[qid] === k ? 0 : k;
      const row = b.closest('.omr-row');
      const y = window.scrollY;
      render();
      window.scrollTo(0, y);
      const again = $('.omr-row[data-q="' + qid + '"] .bub[data-c="' + k + '"]');
      if (again && row) again.focus({ preventScroll: true });
    };
    S.actions.clear = (b) => { choices[b.dataset.q] = 0; const y = window.scrollY; render(); window.scrollTo(0, y); };
    S.actions['save-marks'] = async (b) => {
      busy(b, true, 'Saving…');
      try {
        const r = L.scoreResponses(questions, choices, s);
        await Api.updatePaper(p.id, { responses: r.responses, score: r.score, marked_at: new Date().toISOString() });
        toast('Marks saved: ' + r.score + ' / ' + r.max);
        location.hash = '#/m/' + p.mentee_id;
      } catch (e) { fail(e); busy(b, false); }
    };
    S.actions.unmark = async (b) => {
      busy(b, true, 'Removing…');
      try { await Api.updatePaper(p.id, { responses: null, score: null, marked_at: null }); toast('Marks removed'); location.hash = '#/m/' + p.mentee_id; }
      catch (e) { fail(e); busy(b, false); }
    };
    render();
  }

  /* ================= Question bank ================= */

  function chapterOptions(subjectId, selected, includeHidden) {
    return S.chapters.filter((c) => (!subjectId || c.subject_id === Number(subjectId)) && (includeHidden || !c.hidden))
      .map((c) => '<option value="' + c.id + '"' + (String(selected) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + (subjectId ? '' : ' (' + esc(subjectName(c.subject_id)) + ')') + '</option>').join('');
  }
  function subjectOptions(selected) {
    return S.subjects.map((s) => '<option value="' + s.id + '"' + (String(selected) === String(s.id) ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  }
  function mapOptions(map, selected) {
    return Object.entries(map).map(([k, v]) => '<option value="' + k + '"' + (selected === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  }
  const canEdit = (q) => isAdmin() || (q.created_by && q.created_by === S.me.id);

  async function viewBank(token) {
    setTitle('Question bank');
    const f = S.bank;
    const pageSize = 25;
    main().innerHTML =
      '<div class="page-head"><div><h1>Question bank</h1><p class="sub">Shared by everyone at ' + esc(orgName()) + '. Archived questions stay on old papers but are left out of new ones.</p></div>' +
      '<div class="row"><a class="btn" href="#/import">Add from PDF</a><a class="btn primary" href="#/q/new">Add question</a></div></div>' +
      '<div id="sampleNote"></div>' +
      '<div class="panel" style="margin-bottom:14px"><div class="filters">' +
      '<label class="field">Subject<select id="fSubject"><option value="">All subjects</option>' + subjectOptions(f.subject) + '</select></label>' +
      '<label class="field wide">Chapter<select id="fChapter"><option value="">All chapters</option>' + chapterOptions(f.subject, f.chapter, true) + '</select></label>' +
      '<label class="field">Difficulty<select id="fDiff"><option value="">Any</option>' + mapOptions(DIFFS, f.difficulty) + '</select></label>' +
      '<label class="field">Type<select id="fType"><option value="">Any</option>' + mapOptions(QTYPES, f.qtype) + '</select></label>' +
      '<label class="field">Source<select id="fSource"><option value="">Any</option>' + mapOptions(SOURCES, f.source) + '</select></label>' +
      '<label class="field wide">Search question text<input type="search" id="fSearch" value="' + esc(f.search) + '" placeholder="e.g. pacemaker"></label>' +
      '</div><div class="row"><label class="check"><input type="checkbox" id="fMine"' + (f.mine ? ' checked' : '') + '> Added by me</label>' +
      '<label class="check"><input type="checkbox" id="fSamples"' + (f.samples ? ' checked' : '') + '> Samples only</label>' +
      '<label class="check"><input type="checkbox" id="fArchived"' + (f.archived ? ' checked' : '') + '> Show archived</label></div></div>' +
      '<div id="bankList">' + loadingHTML() + '</div>';

    const reload = () => { f.page = 0; loadList(); };
    $('#fSubject').addEventListener('change', (e) => { f.subject = e.target.value; f.chapter = ''; $('#fChapter').innerHTML = '<option value="">All chapters</option>' + chapterOptions(f.subject, '', true); reload(); });
    $('#fChapter').addEventListener('change', (e) => { f.chapter = e.target.value; reload(); });
    $('#fDiff').addEventListener('change', (e) => { f.difficulty = e.target.value; reload(); });
    $('#fType').addEventListener('change', (e) => { f.qtype = e.target.value; reload(); });
    $('#fSource').addEventListener('change', (e) => { f.source = e.target.value; reload(); });
    $('#fSearch').addEventListener('input', debounce((e) => { f.search = e.target.value.trim(); reload(); }, 350));
    $('#fMine').addEventListener('change', (e) => { f.mine = e.target.checked; reload(); });
    $('#fSamples').addEventListener('change', (e) => { f.samples = e.target.checked; reload(); });
    $('#fArchived').addEventListener('change', (e) => { f.archived = e.target.checked; reload(); });

    async function sampleNote() {
      const meta = await getMeta();
      if (stale(token)) return;
      const samples = meta.filter((q) => q.is_sample).length;
      const real = meta.filter((q) => !q.is_sample).length;
      $('#sampleNote').innerHTML = samples ? '<div class="notice" style="margin-bottom:14px"><b>' + samples + ' sample questions</b> are in the bank so you can try the app. ' +
        (isAdmin() ? (real ? 'Remove them once your own questions are in.' : 'They can be removed once your own questions are in.') + ' <button class="btn sm danger" data-act="ask-samples" style="margin-left:6px">Remove samples</button>' +
          '<div id="sampleConfirm" hidden style="margin-top:10px">Remove all ' + samples + ' sample questions? Papers that used them will show “question removed”. <button class="btn sm danger solid" data-act="del-samples">Yes, remove</button> <button class="btn sm" data-act="keep-samples">Keep</button></div>' : 'The admin can remove them later.') + '</div>' : '';
    }

    async function loadList() {
      const box = $('#bankList');
      box.innerHTML = loadingHTML();
      let chapterIds = null;
      if (f.chapter) chapterIds = [Number(f.chapter)];
      else if (f.subject) chapterIds = S.chapters.filter((c) => c.subject_id === Number(f.subject)).map((c) => c.id);
      const res = await Api.listQuestions({ chapterIds, difficulty: f.difficulty, qtype: f.qtype, source: f.source, mineUid: f.mine ? S.me.id : null, samplesOnly: f.samples, search: f.search, archived: f.archived, page: f.page, pageSize });
      if (stale(token)) return;
      res.rows.forEach((q) => S.qcache.set(q.id, q));
      const pages = Math.max(1, Math.ceil(res.count / pageSize));
      if (!res.rows.length) {
        box.innerHTML = '<div class="panel empty"><h2>No questions match</h2><p>' + (f.search || f.chapter || f.subject || f.difficulty ? 'Try fewer filters.' : 'Add questions one by one, or paste many at once from a PDF.') + '</p><a class="btn primary" href="#/q/new">Add question</a></div>';
        return;
      }
      box.innerHTML = '<p class="muted small" style="margin-bottom:10px">' + res.count + ' question' + (res.count === 1 ? '' : 's') + '</p>' +
        res.rows.map((q) => '<article class="qcard"><div class="meta"><b>' + esc(chapterName(q.chapter_id)) + '</b> · ' + esc((subjectOfChapter(q.chapter_id) || {}).name || '') + ' ' + chipDiff(q.difficulty) +
          '<span class="chip">' + esc(QTYPES[q.qtype] || q.qtype) + '</span>' + (q.is_sample ? '<span class="chip sample">Sample</span>' : '') + (q.archived ? '<span class="chip">Archived</span>' : '') + (q.topic ? '<span class="muted">· ' + esc(q.topic) + '</span>' : '') + '</div>' +
          questionHTML(q, { showAnswer: true }) +
          (q.solution ? '<details><summary>Solution</summary><div class="rich" style="margin-top:6px">' + rich(q.solution) + '</div></details>' : '') +
          '<div class="foot"><span>' + esc(SOURCES[q.source_type] || q.source_type) + (q.source_note ? ': ' + esc(q.source_note) : '') + ' · added by ' + esc(q.created_by ? personName(q.created_by) : 'setup') + ' · ' + esc(fmtDate(q.created_at)) + '</span>' +
          '<span class="row">' + (canEdit(q) ? '<a class="btn sm" href="#/q/' + q.id + '">Edit</a><button class="btn ghost sm" data-act="archive" data-id="' + q.id + '" data-v="' + (!q.archived) + '">' + (q.archived ? 'Restore' : 'Archive') + '</button>' : '') +
          (isAdmin() ? '<button class="btn ghost sm" data-act="ask-del-q" data-id="' + q.id + '">Delete</button>' : '') + '</span></div>' +
          '<div class="notice bad" id="dq-' + q.id + '" hidden style="margin-top:10px">Delete this question for good? Papers that used it will show “question removed”. Archive keeps it on old papers instead. ' +
          '<button class="btn sm danger solid" data-act="del-q" data-id="' + q.id + '">Delete</button> <button class="btn sm" data-act="keep-q" data-id="' + q.id + '">Keep</button></div></article>').join('') +
        (pages > 1 ? '<div class="pager"><button class="btn" data-act="prev"' + (f.page ? '' : ' disabled') + '>Previous</button><span class="muted small">Page ' + (f.page + 1) + ' of ' + pages + '</span><button class="btn" data-act="next"' + (f.page + 1 < pages ? '' : ' disabled') + '>Next</button></div>' : '');
      hydrateImages(box);
    }

    S.actions.prev = () => { f.page = Math.max(0, f.page - 1); loadList(); window.scrollTo(0, 0); };
    S.actions.next = () => { f.page += 1; loadList(); window.scrollTo(0, 0); };
    S.actions.archive = async (b) => {
      const v = b.dataset.v === 'true';
      await Api.setArchived(b.dataset.id, v);
      invalidateMeta();
      toast(v ? 'Archived: left out of new papers' : 'Restored');
      loadList();
    };
    S.actions['ask-del-q'] = (b) => { $('#dq-' + b.dataset.id).hidden = false; };
    S.actions['keep-q'] = (b) => { $('#dq-' + b.dataset.id).hidden = true; };
    S.actions['del-q'] = async (b) => { busy(b, true); await Api.deleteQuestion(b.dataset.id); invalidateMeta(); toast('Question deleted'); loadList(); sampleNote(); };
    S.actions['ask-samples'] = () => { $('#sampleConfirm').hidden = false; };
    S.actions['keep-samples'] = () => { $('#sampleConfirm').hidden = true; };
    S.actions['del-samples'] = async (b) => { busy(b, true, 'Removing…'); await Api.deleteSamples(); invalidateMeta(); toast('Sample questions removed'); sampleNote(); loadList(); };

    sampleNote().catch(fail);
    await loadList();
  }

  /* ================= Question editor ================= */

  async function viewEditor(id, token) {
    main().innerHTML = loadingHTML();
    let q;
    if (id) {
      q = await Api.getQuestion(id);
      if (stale(token)) return;
      if (!q) { main().innerHTML = '<div class="empty"><h2>Question not found</h2><a class="btn" href="#/bank">Back to bank</a></div>'; return; }
      q = JSON.parse(JSON.stringify(q));
    } else {
      const last = S.lastEditor || {};
      q = { chapter_id: last.chapter_id || null, topic: last.topic || '', qtype: 'single', difficulty: last.difficulty || 'medium', body: '', options: [], answer: null, solution: '', images: [], source_type: last.source_type || 'own', source_note: last.source_note || '' };
    }
    while ((q.options || (q.options = [])).length < 4) q.options.push({ text: '', image: null });
    q.images = q.images || [];
    const editable = !id || canEdit(q);
    let subjectId = q.chapter_id ? (S.chapterById.get(q.chapter_id) || {}).subject_id : (S.lastEditor && S.lastEditor.subject_id) || (S.subjects[0] || {}).id;
    setTitle(id ? 'Edit question' : 'Add question');

    main().innerHTML =
      '<div class="page-head"><div><a class="crumb" href="#/bank">← Question bank</a><h1>' + (id ? 'Edit question' : 'Add question') + '</h1></div></div>' +
      (!editable ? '<div class="notice warn" style="margin-bottom:14px">Only ' + esc(personName(q.created_by)) + ' or the admin can change this question.</div>' : '') +
      '<div class="editor"><form class="panel" id="qForm" novalidate><fieldset ' + (editable ? '' : 'disabled') + ' style="border:0;padding:0;margin:0;min-width:0;display:grid;gap:16px">' +
      '<div class="form-grid">' +
      '<label class="field">Subject<select id="eSubject">' + subjectOptions(subjectId) + '</select></label>' +
      '<label class="field">Chapter<select id="eChapter"><option value="">Choose…</option>' + chapterOptions(subjectId, q.chapter_id, true) + '</select></label>' +
      '<label class="field">Topic<span class="hint">Optional</span><input id="eTopic" type="text" maxlength="120" value="' + esc(q.topic || '') + '"></label>' +
      '<label class="field">Question type<select id="eType">' + mapOptions(QTYPES, q.qtype) + '</select></label>' +
      '<label class="field">Difficulty<select id="eDiff">' + mapOptions(DIFFS, q.difficulty) + '</select></label>' +
      '</div>' +
      '<label class="field">Question<textarea id="eBody" class="q-input" rows="5" placeholder="Type or paste the question. You can also paste a screenshot of a diagram here.">' + esc(q.body) + '</textarea></label>' +
      '<div class="help">Maths: <code>$v = u + at$</code> · fractions <code>$\\dfrac{1}{2}mv^2$</code> · chemistry <code>\\ce{H2SO4}</code> or <code>\\ce{N2 + 3H2 -> 2NH3}</code> · bold <code>**Assertion (A):**</code> · tables: lines like <code>| A. Cerebellum | I. Balance |</code></div>' +
      '<div><div class="row"><b class="small">Diagrams for the question</b><label class="btn sm"><input type="file" id="eImgs" accept="image/*" multiple hidden>Add image</label></div><div class="img-tiles" id="imgTiles"></div></div>' +
      '<div><div class="small" style="font-weight:600;margin-bottom:8px">Options <span class="muted" style="font-weight:400">· tap the number of the correct one</span></div><div id="optsBox"></div></div>' +
      '<label class="field">Solution<span class="hint">Shown in the solutions booklet</span><textarea id="eSol" class="q-input" rows="3">' + esc(q.solution || '') + '</textarea></label>' +
      '<div class="form-grid"><label class="field">Source<select id="eSource">' + mapOptions(SOURCES, q.source_type) + '</select></label>' +
      '<label class="field">Source details<span class="hint">e.g. NEET 2023, HC Verma Ch 5</span><input id="eSourceNote" type="text" maxlength="160" value="' + esc(q.source_note || '') + '"></label></div>' +
      '</fieldset>' +
      (editable ? '<div class="form-actions"><button class="btn primary" type="submit" id="eSave">Save</button>' + (id ? '' : '<button class="btn" type="button" data-act="save-new">Save and add another</button>') + '<a class="btn ghost" href="#/bank">Cancel</a></div>' : '') +
      '</form><aside class="panel preview"><div class="panel-head"><h2>Preview</h2><span class="muted small">As it prints</span></div><div id="ePreview" class="sheet" style="box-shadow:none;padding:14px;max-width:none"></div></aside></div>';

    const preview = () => {
      const box = $('#ePreview');
      box.innerHTML = q.body.trim() || q.options.some((o) => o.text || o.image)
        ? '<div class="pq"><span class="qn">1.</span><div>' + questionHTML(q, { showAnswer: true }) + '</div></div>' + (q.solution ? '<div class="sol-item" style="border:0"><b>Sol.</b><div class="rich">' + rich(q.solution) + '</div></div>' : '')
        : '<p class="muted">Start typing the question to see it here.</p>';
      hydrateImages(box);
    };
    const previewSoon = debounce(preview, 150);

    function renderImages() {
      $('#imgTiles').innerHTML = q.images.map((p, i) => '<div class="img-tile">' + imgTag(p) + (editable ? '<button type="button" data-act="rm-img" data-i="' + i + '" aria-label="Remove image">×</button>' : '') + '</div>').join('') || '<span class="muted small">None</span>';
      hydrateImages($('#imgTiles'));
    }
    function renderOptions() {
      $('#optsBox').innerHTML = q.options.map((o, i) =>
        '<div class="opt-edit"><label><input type="radio" name="eAns" value="' + (i + 1) + '"' + (Number(q.answer) === i + 1 ? ' checked' : '') + '><span class="radio" title="Mark as correct">' + (i + 1) + '</span></label>' +
        '<div style="min-width:0"><textarea class="q-input" data-opt="' + i + '" rows="1" placeholder="Option ' + (i + 1) + '">' + esc(o.text || '') + '</textarea>' +
        (o.image ? '<div class="img-tiles opt-img"><div class="img-tile">' + imgTag(o.image) + (editable ? '<button type="button" data-act="rm-opt-img" data-i="' + i + '" aria-label="Remove image">×</button>' : '') + '</div></div>' : '') + '</div>' +
        '<label class="btn ghost sm" title="Add an image to this option"><input type="file" accept="image/*" data-optimg="' + i + '" hidden>Image</label></div>').join('');
      $$('#optsBox textarea').forEach((t) => t.addEventListener('input', () => { q.options[Number(t.dataset.opt)].text = t.value; previewSoon(); }));
      $$('#optsBox input[name=eAns]').forEach((r) => r.addEventListener('change', () => { q.answer = Number(r.value); previewSoon(); }));
      $$('#optsBox input[data-optimg]').forEach((inp) => inp.addEventListener('change', async () => {
        const file = inp.files[0];
        if (!file) return;
        const lab = inp.closest('label'); if (lab && lab.lastChild) lab.lastChild.textContent = 'Uploading…';
        try { q.options[Number(inp.dataset.optimg)].image = await uploadFile(file); renderOptions(); preview(); }
        catch (e) { fail(e); renderOptions(); }
      }));
      hydrateImages($('#optsBox'));
    }

    async function addImages(files) {
      for (const file of files) {
        const note = document.createElement('span'); note.className = 'muted small'; note.textContent = 'Uploading…'; $('#imgTiles').appendChild(note);
        try { q.images.push(await uploadFile(file)); }
        catch (e) { fail(e); }
      }
      renderImages();
      preview();
    }

    $('#eSubject').addEventListener('change', (e) => { subjectId = Number(e.target.value); $('#eChapter').innerHTML = '<option value="">Choose…</option>' + chapterOptions(subjectId, '', true); q.chapter_id = null; });
    $('#eChapter').addEventListener('change', (e) => { q.chapter_id = Number(e.target.value) || null; });
    $('#eTopic').addEventListener('input', (e) => { q.topic = e.target.value; });
    $('#eType').addEventListener('change', (e) => {
      q.qtype = e.target.value;
      const empty = q.options.every((o) => !o.text && !o.image);
      if (empty && q.qtype === 'assertion') { q.options = ['Both A and R are true and R is the correct explanation of A', 'Both A and R are true but R is not the correct explanation of A', 'A is true but R is false', 'A is false but R is true'].map((t) => ({ text: t, image: null })); renderOptions(); }
      if (empty && q.qtype === 'statement') { q.options = ['Both Statement I and Statement II are correct', 'Both Statement I and Statement II are incorrect', 'Statement I is correct but Statement II is incorrect', 'Statement I is incorrect but Statement II is correct'].map((t) => ({ text: t, image: null })); renderOptions(); }
      if (!q.body.trim() && q.qtype === 'assertion') { q.body = '**Assertion (A):** \n**Reason (R):** '; $('#eBody').value = q.body; }
      if (!q.body.trim() && q.qtype === 'statement') { q.body = '**Statement I:** \n**Statement II:** '; $('#eBody').value = q.body; }
      if (!q.body.trim() && q.qtype === 'match') { q.body = 'Match List I with List II.\n| List I | List II |\n| A. | I. |\n| B. | II. |\n| C. | III. |\n| D. | IV. |\nChoose the correct answer.'; $('#eBody').value = q.body; }
      preview();
    });
    $('#eDiff').addEventListener('change', (e) => { q.difficulty = e.target.value; });
    $('#eBody').addEventListener('input', (e) => { q.body = e.target.value; previewSoon(); });
    $('#eBody').addEventListener('paste', (e) => {
      const files = Array.from((e.clipboardData && e.clipboardData.files) || []).filter((f) => /^image\//.test(f.type));
      if (files.length && editable) { e.preventDefault(); addImages(files); }
    });
    $('#eSol').addEventListener('input', (e) => { q.solution = e.target.value; previewSoon(); });
    $('#eSource').addEventListener('change', (e) => { q.source_type = e.target.value; });
    $('#eSourceNote').addEventListener('input', (e) => { q.source_note = e.target.value; });
    $('#eImgs').addEventListener('change', (e) => { addImages(Array.from(e.target.files || [])); e.target.value = ''; });
    S.actions['rm-img'] = (b) => { q.images.splice(Number(b.dataset.i), 1); renderImages(); preview(); };
    S.actions['rm-opt-img'] = (b) => { q.options[Number(b.dataset.i)].image = null; renderOptions(); preview(); };

    function validate() {
      if (!q.chapter_id) return 'Choose a chapter.';
      if (!q.body.trim() && !q.images.length) return 'Write the question.';
      const missing = q.options.findIndex((o) => !String(o.text || '').trim() && !o.image);
      if (missing > -1) return 'Option ' + (missing + 1) + ' is empty.';
      if (!q.answer) return 'Tap the number of the correct option.';
      return null;
    }
    async function save(andNew, btn) {
      const problem = validate();
      if (problem) { toast(problem, 'bad'); return; }
      busy(btn, true, 'Saving…');
      try {
        const row = Object.assign({}, q, {
          topic: (q.topic || '').trim() || null, body: q.body.trim(), solution: (q.solution || '').trim() || null, source_note: (q.source_note || '').trim() || null,
          options: q.options.map((o) => ({ text: String(o.text || '').trim(), image: o.image || null })),
        });
        const saved = await Api.saveQuestion(row);
        S.qcache.set(saved.id, saved);
        invalidateMeta();
        S.lastEditor = { subject_id: subjectId, chapter_id: q.chapter_id, topic: q.topic, difficulty: q.difficulty, source_type: q.source_type, source_note: q.source_note };
        toast('Question saved');
        if (andNew) { if (location.hash === '#/q/new') route(); else location.hash = '#/q/new'; }
        else location.hash = '#/bank';
      } catch (e) { fail(e); busy(btn, false); }
    }
    $('#qForm').addEventListener('submit', (e) => { e.preventDefault(); if (editable) save(false, $('#eSave')); });
    S.actions['save-new'] = (b) => save(true, b);

    renderImages();
    renderOptions();
    preview();
  }

  /* ================= Add from PDF or text ================= */

  let pdfjsPromise = null;
  function loadPdfJs() {
    if (!pdfjsPromise) {
      const base = new URL((window.APP_VENDOR_BASE || 'vendor/') + 'pdfjs/', document.baseURI).href;
      pdfjsPromise = import(base + 'stream-polyfill.js')
        .then(() => import(base + 'pdf.min.js'))
        .then((lib) => {
          lib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.shim.js';
          return lib;
        })
        .catch((e) => { console.error(e); pdfjsPromise = null; throw new Error('Could not load the PDF reader. Check the internet connection and try again.'); });
    }
    return pdfjsPromise;
  }

  async function readPdf(file, onProgress) {
    const lib = await loadPdfJs();
    const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
    const pages = [];
    let chars = 0;
    for (let n = 1; n <= doc.numPages; n++) {
      onProgress('Reading page ' + n + ' of ' + doc.numPages + '…');
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 1 });
      const tc = await page.getTextContent();
      const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str, x: it.transform[4], y: vp.height - it.transform[5], w: it.width, h: Math.abs(it.transform[3]) || Math.abs(it.transform[1]) || 10 }));
      chars += items.reduce((k, it) => k + it.s.trim().length, 0);
      pages.push({ width: vp.width, height: vp.height, items });
    }
    const lines = L.pdfPagesToLines(pages);
    return { doc, pages, lines, text: lines.map((l) => l.text).join('\n'), numPages: doc.numPages, chars };
  }

  // Renders each page that has questions, finds drawings inside each question's area and crops them out as PNGs.
  async function captureFigures(pdf, items, onProgress) {
    const SCALE = 3;
    const regions = L.questionRegions(items, pdf.lines, pdf.pages);
    const byPage = new Map();
    regions.forEach((rs, qi) => rs.forEach((r) => { if (!byPage.has(r.page)) byPage.set(r.page, []); byPage.get(r.page).push({ qi, r }); }));
    const figures = items.map(() => []);
    const order = [...byPage.keys()].sort((a, b) => a - b);
    for (let k = 0; k < order.length; k++) {
      const pi = order[k];
      onProgress('Looking for diagrams on page ' + (pi + 1) + ' of ' + pdf.numPages + '…');
      const page = await pdf.doc.getPage(pi + 1);
      const vp = page.getViewport({ scale: SCALE });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const gray = new Uint8Array(canvas.width * canvas.height);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) gray[j] = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) | 0;
      const textBoxes = pdf.pages[pi].items.map((it) => ({ x0: it.x * SCALE, y0: (it.y - it.h) * SCALE, x1: (it.x + it.w) * SCALE, y1: (it.y + it.h * 0.28) * SCALE }));
      for (const { qi, r } of byPage.get(pi)) {
        const boxes = L.findFigures(gray, canvas.width, canvas.height, { x0: r.x0 * SCALE, y0: r.y0 * SCALE, x1: r.x1 * SCALE, y1: r.y1 * SCALE }, textBoxes, SCALE);
        for (const b of boxes) {
          const c = document.createElement('canvas');
          c.width = b.x1 - b.x0; c.height = b.y1 - b.y0;
          c.getContext('2d').drawImage(canvas, b.x0, b.y0, c.width, c.height, 0, 0, c.width, c.height);
          const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
          if (blob) figures[qi].push({ blob, url: URL.createObjectURL(blob), w: c.width, h: c.height });
        }
      }
      page.cleanup();
      canvas.width = canvas.height = 0;
    }
    return figures;
  }

  function groupedChapterOptions(selected) {
    return S.subjects.map((s) => '<optgroup label="' + esc(s.name) + '">' +
      S.chapters.filter((c) => c.subject_id === s.id).map((c) => '<option value="' + c.id + '"' + (String(selected) === String(c.id) ? ' selected' : '') + '>' + esc(c.name) + '</option>').join('') + '</optgroup>').join('');
  }

  async function viewImport() {
    setTitle('Add questions from PDF or text');
    const st = S.imp || (S.imp = { chapter_id: '', difficulty: 'medium', qtype: 'single', source_type: 'own', source_note: '', text: '', parsed: null, fileInfo: null });
    const optImage = (it, i) => (it.figures || []).find((f) => f.assign === i + 1);
    const optionsFilled = (it) => it.options.every((o, i) => o.trim() || optImage(it, i));
    const isReady = (it) => it.include && it.answer && it.chapter_id && it.body && optionsFilled(it);
    // Live checks: these update as the mentor fixes text, assigns pictures or picks the answer.
    const warningsOf = (it) => {
      const w = [];
      if (!it.edited) (it.warnings || []).filter((x) => /options instead of 4/.test(x)).forEach((x) => w.push(x));
      if (!it.body.trim()) w.push('No question text');
      const empty = it.options.filter((o, k) => !o.trim() && !optImage(it, k)).length;
      if (empty) w.push(empty + ' option' + (empty > 1 ? 's' : '') + ' empty');
      if (!it.answer) w.push('No answer found');
      return w;
    };
    const dropFigures = () => { (st.parsed || []).forEach((it) => (it.figures || []).forEach((f) => URL.revokeObjectURL(f.url))); };
    main().innerHTML =
      '<div class="page-head"><div><h1>Add questions from a PDF</h1><p class="sub">Upload a question paper, or paste text copied from one. The app splits it into questions and cuts out their diagrams and graphs; you check each one, set its chapter, and save.</p></div></div>' +
      '<div class="panel">' +
      '<div class="row" style="align-items:center;gap:14px"><label class="btn primary"><input type="file" id="iPdf" accept="application/pdf,.pdf" hidden>Upload PDF</label>' +
      '<span class="muted small" id="pdfStatus">' + (st.fileInfo ? esc(st.fileInfo) : 'Works with PDFs made on a computer (text you can select). Diagrams, graphs and answer keys are picked up too.') + '</span></div>' +
      '<div id="pdfNote"></div>' +
      '<details style="margin-top:14px"' + (st.text ? ' open' : '') + '><summary class="small" style="cursor:pointer;font-weight:600;color:var(--accent)">Text read from the PDF, or paste your own</summary>' +
      '<textarea id="iText" class="q-input" rows="12" style="margin-top:10px" placeholder="1. The SI unit of force is\n(a) joule\n(b) newton\n(c) watt\n(d) pascal\nAnswer: b\nSolution: F = ma\n\n2. Next question…">' + esc(st.text) + '</textarea>' +
      '<div class="help" style="margin-top:10px">Each question starts with its number (<code>1.</code> or <code>Q1.</code>). Options can be <code>(a)</code> <code>a)</code> or <code>(1)</code>, one per line or on one line. Answers come from <code>Answer: b</code> lines or an <code>Answer key</code> list (<code>1-b 2-c</code> or <code>1. (2) 2. (4)</code>). If you fix something here, press Read again.</div>' +
      '<div class="form-actions"><button class="btn" data-act="parse">Read again</button></div></details>' +
      '<h3 style="margin:18px 0 10px">Settings for these questions</h3><div class="form-grid">' +
      '<label class="field">Chapter for all<span class="hint">Or set it per question below</span><select id="iChapter"><option value="">Set per question</option>' + groupedChapterOptions(st.chapter_id) + '</select></label>' +
      '<label class="field">Difficulty<select id="iDiff">' + mapOptions(DIFFS, st.difficulty) + '</select></label>' +
      '<label class="field">Type<select id="iType">' + mapOptions(QTYPES, st.qtype) + '</select></label>' +
      '<label class="field">Source<select id="iSource">' + mapOptions(SOURCES, st.source_type) + '</select></label>' +
      '<label class="field">Source details<input id="iSourceNote" type="text" maxlength="160" value="' + esc(st.source_note) + '" placeholder="e.g. NEET 2022"></label>' +
      '</div></div>' +
      '<section id="impPreview" class="section"></section>';

    const status = (msg) => { const el = $('#pdfStatus'); if (el) el.textContent = msg; };
    $('#iChapter').addEventListener('change', (e) => {
      const prev = st.chapter_id;
      st.chapter_id = Number(e.target.value) || '';
      if (st.parsed) st.parsed.forEach((it) => { if (!it.chapter_id || it.chapter_id === prev) it.chapter_id = st.chapter_id; });
      renderPreview();
    });
    $('#iDiff').addEventListener('change', (e) => { st.difficulty = e.target.value; });
    $('#iType').addEventListener('change', (e) => { st.qtype = e.target.value; });
    $('#iSource').addEventListener('change', (e) => { st.source_type = e.target.value; });
    $('#iSourceNote').addEventListener('input', (e) => { st.source_note = e.target.value; });
    $('#iText').addEventListener('input', (e) => { st.text = e.target.value; });

    function parseNow() {
      dropFigures();
      const items = L.parsePasted(st.text);
      const fourOptions = (it) => !it.warnings.some((w) => /options instead of 4/.test(w));
      st.parsed = items.map((it) => Object.assign(it, { include: fourOptions(it) && !!it.body, chapter_id: st.chapter_id || '', figures: [] }));
      return items.length;
    }
    async function attachFigures() {
      if (!st.pdf || st.text !== st.pdf.text || !st.parsed || !st.parsed.length) return 0;
      const figs = await captureFigures(st.pdf, st.parsed, status);
      let n = 0;
      st.parsed.forEach((it, i) => {
        const list = figs[i] || [];
        const assign = L.assignFigures(it.options, list.length);
        it.figures = list.map((f, k) => Object.assign(f, { assign: assign[k] }));
        n += list.length;
      });
      return n;
    }

    $('#iPdf').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      $('#pdfNote').innerHTML = '';
      status('Opening ' + file.name + '…');
      try {
        const res = await readPdf(file, status);
        if (st.pdf && st.pdf.doc) st.pdf.doc.destroy();
        st.pdf = res;
        st.text = res.text;
        $('#iText').value = st.text;
        const found = parseNow();
        let figs = 0;
        try { figs = await attachFigures(); } catch (err) { console.error(err); toast('Questions were read, but diagrams could not be picked up from this PDF.', 'bad'); }
        st.fileInfo = file.name + ': ' + res.numPages + ' page' + (res.numPages === 1 ? '' : 's') + ', ' + found + ' question' + (found === 1 ? '' : 's') + (figs ? ', ' + figs + ' diagram' + (figs === 1 ? '' : 's') : '') + ' found';
        status(st.fileInfo);
        if (res.chars < res.numPages * 40) {
          $('#pdfNote').innerHTML = '<div class="notice warn" style="margin-top:12px">This PDF has almost no text in it, so it is probably a scan or photos of pages. The app can only read PDFs made on a computer. Give scanned papers to the admin to add another way.</div>';
        } else if (!found) {
          $('#pdfNote').innerHTML = '<div class="notice warn" style="margin-top:12px">No numbered questions were found. Open “Text read from the PDF” below to see what was read.</div>';
        }
        renderPreview();
        if (found) $('#impPreview').scrollIntoView({ behavior: 'smooth' });
      } catch (err) {
        console.error(err);
        status('Could not read that file.');
        const msg = String((err && err.message) || err);
        if (/password/i.test(msg)) fail(new Error('That PDF is password-protected. Remove the password and try again.'));
        else if (/Invalid PDF|corrupt|unexpected/i.test(msg)) fail(new Error('That file does not look like a working PDF. Try saving or exporting it again.'));
        else fail(new Error('This browser could not read the PDF (' + msg + '). Try again in Chrome, or send the file to the admin.'));
      }
    });

    function renderPreview() {
      const box = $('#impPreview');
      if (!st.parsed) { box.innerHTML = ''; return; }
      const items = st.parsed;
      const ready = items.filter(isReady);
      const noChapter = items.filter((it) => it.include && !it.chapter_id).length;
      const noAnswer = items.filter((it) => it.include && !it.answer).length;
      const chOpts = groupedChapterOptions('');
      box.innerHTML =
        '<div class="draft-head"><div><h2>' + items.length + ' question' + (items.length === 1 ? '' : 's') + ' found</h2>' +
        '<p class="muted small" style="margin-top:4px">' + ready.length + ' ready to save' + (noChapter ? ' · ' + noChapter + ' need a chapter' : '') + (noAnswer ? ' · ' + noAnswer + ' need the correct option' : '') + '</p></div>' +
        '<button class="btn primary" data-act="save-imp"' + (ready.length ? '' : ' disabled') + '>Save ' + ready.length + ' question' + (ready.length === 1 ? '' : 's') + '</button></div>' +
        (items.length > 1 ? '<div class="panel" style="margin-bottom:12px"><div class="row" style="gap:8px"><b class="small">Set chapter for questions</b>' +
          '<input type="number" id="rFrom" min="1" style="width:76px" placeholder="from" aria-label="From question number"><span class="small">to</span><input type="number" id="rTo" min="1" style="width:76px" placeholder="to" aria-label="To question number">' +
          '<select id="rChapter" style="max-width:280px" aria-label="Chapter"><option value="">Choose chapter…</option>' + chOpts + '</select><button class="btn sm" data-act="apply-range">Apply</button></div></div>' : '') +
        items.map((it, i) => '<article class="qcard"><div class="meta"><b>Q' + it.num + '</b>' + (it.subject ? '<span class="chip">' + esc(it.subject) + ' section</span>' : '') +
          (warningsOf(it).length ? warningsOf(it).map((w) => '<span class="chip hard">' + esc(w) + '</span>').join('') : '<span class="chip easy">Looks right</span>') +
          '<span class="spacer"></span><label class="check"><input type="checkbox" data-inc="' + i + '"' + (it.include ? ' checked' : '') + '> Include</label></div>' +
          questionHTML({ body: it.body, options: it.options.map((t, k) => ({ text: t, image: optImage(it, k) ? optImage(it, k).url : null })), answer: it.answer, images: (it.figures || []).filter((f) => f.assign === 'q').map((f) => f.url) }, { showAnswer: true }) +
          ((it.figures || []).length ? '<div class="fig-pick"><span class="small muted">Diagrams found. Choose where each one goes:</span><div class="fig-row">' + it.figures.map((f, k) =>
            '<figure class="fig-item' + (f.assign === 'none' ? ' unused' : '') + '"><img src="' + esc(f.url) + '" alt="Diagram ' + (k + 1) + ' from Q' + it.num + '"><select data-fig="' + i + ':' + k + '" aria-label="Where diagram ' + (k + 1) + ' goes">' +
            [['q', 'In the question'], [1, 'Option 1'], [2, 'Option 2'], [3, 'Option 3'], [4, 'Option 4'], ['none', 'Don’t use']].map(([v, l]) => '<option value="' + v + '"' + (String(f.assign) === String(v) ? ' selected' : '') + '>' + l + '</option>').join('') +
            '</select></figure>').join('') + '</div></div>' : '') +
          '<div class="row small" style="margin-top:10px;gap:12px"><span class="row" style="gap:6px"><span class="muted">Correct:</span>' + [1, 2, 3, 4].map((k) => '<label class="check"><input type="radio" name="ia' + i + '" data-ans="' + i + '" value="' + k + '"' + (it.answer === k ? ' checked' : '') + '> ' + k + '</label>').join('') + '</span>' +
          '<select data-ich="' + i + '" aria-label="Chapter for Q' + it.num + '" style="max-width:300px' + (it.chapter_id ? '' : ';border-color:var(--warn)') + '"><option value="">Chapter…</option>' + (it.chapter_id ? groupedChapterOptions(it.chapter_id) : chOpts) + '</select></div>' +
          (it.solution ? '<details><summary>Solution</summary><div class="rich">' + rich(it.solution) + '</div></details>' : '') +
          '<details class="fix"' + (it.editing ? ' open' : '') + '><summary data-fixopen="' + i + '">Fix the text</summary><div class="fix-body">' +
          '<label class="field">Question<textarea class="q-input" rows="3" data-fix="' + i + ':body">' + esc(it.body) + '</textarea></label>' +
          '<div class="fix-opts">' + it.options.map((o, k) => '<label class="field">Option ' + (k + 1) + '<input type="text" data-fix="' + i + ':' + k + '" value="' + esc(o) + '"' + (optImage(it, k) ? ' placeholder="(picture)"' : '') + '></label>').join('') + '</div>' +
          '<label class="field">Solution<textarea class="q-input" rows="2" data-fix="' + i + ':solution">' + esc(it.solution || '') + '</textarea></label>' +
          '<button class="btn sm" data-act="fix-done" data-i="' + i + '">Done</button></div></details>' +
          '</article>').join('') +
        (ready.length ? '<div class="form-actions"><button class="btn primary" data-act="save-imp">Save ' + ready.length + ' question' + (ready.length === 1 ? '' : 's') + '</button></div>' : '') +
        '<p class="muted small" style="margin-top:12px">Diagrams and graphs are cut out of the PDF automatically. If one is missing or badly cut, save the question anyway, then open it from the bank and paste a screenshot of the diagram.</p>';
      $$('#impPreview input[data-inc]').forEach((c) => c.addEventListener('change', () => { st.parsed[Number(c.dataset.inc)].include = c.checked; renderPreview(); }));
      $$('#impPreview input[data-ans]').forEach((r) => r.addEventListener('change', () => { const it = st.parsed[Number(r.dataset.ans)]; it.answer = Number(r.value); it.warnings = it.warnings.filter((w) => w !== 'No answer found'); renderPreview(); }));
      $$('#impPreview select[data-ich]').forEach((sel) => sel.addEventListener('change', () => { st.parsed[Number(sel.dataset.ich)].chapter_id = Number(sel.value) || ''; renderPreview(); }));
      $$('#impPreview [data-fix]').forEach((el) => {
        const [i, key] = el.dataset.fix.split(':');
        const it = st.parsed[Number(i)];
        el.addEventListener('input', () => {
          it.edited = true;
          if (key === 'body') it.body = el.value; else if (key === 'solution') it.solution = el.value; else it.options[Number(key)] = el.value;
        });
      });
      $$('#impPreview summary[data-fixopen]').forEach((sm) => sm.addEventListener('click', () => { const it = st.parsed[Number(sm.dataset.fixopen)]; it.editing = !sm.parentNode.open; }));
      $$('#impPreview select[data-fig]').forEach((sel) => sel.addEventListener('change', () => {
        const [i, k] = sel.dataset.fig.split(':').map(Number);
        const it = st.parsed[i];
        const v = /^\d$/.test(sel.value) ? Number(sel.value) : sel.value;
        if (typeof v === 'number') it.figures.forEach((f, j) => { if (j !== k && f.assign === v) f.assign = 'q'; });
        it.figures[k].assign = v;
        const y = window.scrollY; renderPreview(); window.scrollTo(0, y);
      }));
      hydrateImages(box);
    }

    S.actions['fix-done'] = (btn) => {
      const it = st.parsed[Number(btn.dataset.i)];
      it.editing = false;
      if (it.edited && it.body.trim() && it.options.every((o, k) => o.trim() || optImage(it, k))) it.include = true;
      const y = window.scrollY; renderPreview(); window.scrollTo(0, y);
    };
    S.actions['apply-range'] = () => {
      const from = Number($('#rFrom').value), to = Number($('#rTo').value) || from, ch = Number($('#rChapter').value);
      if (!from || !ch) { toast('Enter the question numbers and choose a chapter.', 'bad'); return; }
      let n = 0;
      st.parsed.forEach((it) => { if (it.num >= Math.min(from, to) && it.num <= Math.max(from, to)) { it.chapter_id = ch; n++; } });
      toast(n + ' question' + (n === 1 ? '' : 's') + ' set to ' + chapterName(ch));
      renderPreview();
    };
    S.actions.parse = async () => {
      const n = parseNow();
      if (!n) { toast('No questions found. Check that each starts with a number.', 'bad'); return; }
      if (st.pdf) {
        if (st.text === st.pdf.text) { try { await attachFigures(); } catch (e) { console.error(e); } status(st.fileInfo || ''); }
        else toast('You changed the text, so diagrams from the PDF were left out. Add them by editing the questions after saving.');
      }
      renderPreview();
      $('#impPreview').scrollIntoView({ behavior: 'smooth' });
    };
    S.actions['save-imp'] = async (b) => {
      const ready = st.parsed.filter(isReady);
      if (!ready.length) return;
      busy(b, true, 'Saving…');
      try {
        const used = ready.flatMap((it) => (it.figures || []).filter((f) => f.assign !== 'none' && !f.path));
        for (let k = 0; k < used.length; k++) {
          b.textContent = 'Uploading diagrams ' + (k + 1) + ' of ' + used.length + '…';
          used[k].path = await uploadFile(new File([used[k].blob], 'diagram.png', { type: 'image/png' }));
        }
        b.textContent = 'Saving…';
        const n = await Api.insertQuestions(ready.map((it) => {
          const figs = (it.figures || []).filter((f) => f.assign !== 'none');
          return {
            chapter_id: it.chapter_id, qtype: st.qtype, difficulty: st.difficulty, body: it.body,
            options: it.options.map((t, k) => { const f = figs.find((x) => x.assign === k + 1); return { text: t.trim(), image: f ? f.path : null }; }),
            answer: it.answer, solution: it.solution || null,
            images: figs.filter((f) => f.assign === 'q').map((f) => f.path), source_type: st.source_type, source_note: st.source_note.trim() || null,
          };
        }));
        invalidateMeta();
        const chapters = [...new Set(ready.map((it) => it.chapter_id))];
        toast(n + ' question' + (n === 1 ? '' : 's') + ' added to the bank');
        S.bank = Object.assign(S.bank, { subject: '', chapter: chapters.length === 1 ? String(chapters[0]) : '', page: 0, search: '', mine: true, samples: false, archived: false });
        if (chapters.length === 1) S.bank.subject = String((S.chapterById.get(chapters[0]) || {}).subject_id || '');
        dropFigures();
        if (st.pdf && st.pdf.doc) st.pdf.doc.destroy();
        st.text = ''; st.parsed = null; st.fileInfo = null; st.pdf = null;
        location.hash = '#/bank';
      } catch (e) { fail(e); busy(b, false); }
    };
    renderPreview();
  }

  /* ================= Admin ================= */

  async function viewAdmin(token) {
    if (!isAdmin()) { location.hash = '#/'; return; }
    setTitle('Admin');
    main().innerHTML =
      '<div class="page-head"><div><h1>Admin</h1><p class="sub">Accounts for your mentors, how papers look, and the chapter list.</p></div></div>' +
      '<div class="tabs" role="tablist" style="margin:0 0 18px">' + [['people', 'Mentors and admins'], ['settings', 'Paper settings'], ['chapters', 'Chapters']].map(([k, l]) => '<button class="tab" data-act="atab" data-k="' + k + '" aria-selected="' + (S.adminTab === k) + '">' + l + '</button>').join('') + '</div>' +
      '<div id="adminBody">' + loadingHTML() + '</div>';
    S.actions.atab = (b) => { S.adminTab = b.dataset.k; viewAdmin(S.viewToken); };
    if (S.adminTab === 'people') return adminPeople(token);
    if (S.adminTab === 'settings') return adminSettings();
    return adminChapters();
  }

  async function adminPeople(token) {
    const box = $('#adminBody');
    const res = await Api.manageUsers({ action: 'list' });
    if (stale(token)) return;
    const users = res.users || [];
    const site = location.origin + location.pathname;
    box.innerHTML =
      '<div class="panel" style="margin-bottom:16px"><h2 style="margin-bottom:12px">Add a mentor</h2><form id="addUser" novalidate><div class="form-grid">' +
      '<label class="field">Name<input id="uName" type="text" maxlength="120" required></label>' +
      '<label class="field">Email<input id="uEmail" type="email" required></label>' +
      '<label class="field">First password<span class="hint">They can change it after signing in</span><span class="row" style="flex-wrap:nowrap"><input id="uPass" type="text" value="' + randomPassword() + '" autocomplete="off"><button class="btn sm" type="button" data-act="regen">New</button></span></label>' +
      '<label class="field">Role<select id="uRole"><option value="mentor">Mentor</option><option value="admin">Admin (can manage accounts)</option></select></label>' +
      '</div><div class="form-actions"><button class="btn primary" type="submit" id="uSave">Create account</button></div></form><div id="newUserBox"></div></div>' +
      '<div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>' +
      users.map((u) => '<tr><td><b>' + esc(u.full_name) + '</b>' + (u.id === S.me.id ? ' <span class="chip">You</span>' : '') + (!u.active ? ' <span class="chip hard">Switched off</span>' : '') + '</td>' +
        '<td>' + esc(u.email) + '</td><td>' + (u.role === 'admin' ? 'Admin' : 'Mentor') + '</td><td class="num">' + (u.last_sign_in_at ? esc(fmtDate(u.last_sign_in_at)) : '<span class="muted">Never</span>') + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (u.id === S.me.id ? '' :
          '<button class="btn sm" data-act="pw" data-id="' + u.id + '">New password</button> ' +
          '<button class="btn ghost sm" data-act="role" data-id="' + u.id + '" data-role="' + (u.role === 'admin' ? 'mentor' : 'admin') + '">' + (u.role === 'admin' ? 'Make mentor' : 'Make admin') + '</button> ' +
          '<button class="btn ghost sm" data-act="active" data-id="' + u.id + '" data-v="' + (!u.active) + '">' + (u.active ? 'Switch off' : 'Switch on') + '</button>') + '</td></tr>' +
        '<tr id="pwrow-' + u.id + '" hidden><td colspan="5"><div class="row"><span class="small">New password for ' + esc(u.full_name) + ':</span><input type="text" id="pw-' + u.id + '" value="' + randomPassword() + '" style="max-width:200px"><button class="btn primary sm" data-act="pw-save" data-id="' + u.id + '">Set password</button><button class="btn sm" data-act="pw-cancel" data-id="' + u.id + '">Cancel</button></div></td></tr>').join('') +
      '</tbody></table></div>' +
      '<p class="muted small" style="margin-top:10px">Switching an account off stops that person signing in. Their mentees and papers stay; you can move mentees to another mentor from the mentee’s page.</p>';

    S.actions.regen = () => { $('#uPass').value = randomPassword(); };
    $('#addUser').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#uSave');
      const body = { action: 'create', full_name: $('#uName').value.trim(), email: $('#uEmail').value.trim(), password: $('#uPass').value, role: $('#uRole').value };
      busy(btn, true, 'Creating…');
      try {
        await Api.manageUsers(body);
        await refreshProfiles();
        const msg = 'Hi ' + body.full_name + ', here is your login for the ' + orgName() + ' Paper Builder.\nWebsite: ' + site + '\nEmail: ' + body.email + '\nPassword: ' + body.password + '\nPlease change the password after you sign in (click your name at the top right).';
        await adminPeople(S.viewToken);
        $('#newUserBox').innerHTML = '<div class="notice good copy-box" style="margin-top:14px"><b>Account created.</b> Send these details to ' + esc(body.full_name) + ':<pre style="white-space:pre-wrap;font:inherit;margin:8px 0">' + esc(msg) + '</pre><button class="btn sm" data-act="copy-msg">Copy message</button></div>';
        S.actions['copy-msg'] = (b) => copyText(msg, b);
      } catch (err) { fail(err); busy(btn, false); }
    });
    S.actions.pw = (b) => { $('#pwrow-' + b.dataset.id).hidden = false; };
    S.actions['pw-cancel'] = (b) => { $('#pwrow-' + b.dataset.id).hidden = true; };
    S.actions['pw-save'] = async (b) => {
      const pw = $('#pw-' + b.dataset.id).value;
      busy(b, true, 'Setting…');
      try { await Api.manageUsers({ action: 'set_password', user_id: b.dataset.id, password: pw }); toast('Password set. Share it with them.'); $('#pwrow-' + b.dataset.id).hidden = true; }
      catch (e) { fail(e); } finally { busy(b, false); }
    };
    S.actions.role = async (b) => { busy(b, true); try { await Api.manageUsers({ action: 'update', user_id: b.dataset.id, role: b.dataset.role }); await refreshProfiles(); toast('Role changed'); adminPeople(S.viewToken); } catch (e) { fail(e); busy(b, false); } };
    S.actions.active = async (b) => { busy(b, true); try { await Api.manageUsers({ action: 'update', user_id: b.dataset.id, active: b.dataset.v === 'true' }); await refreshProfiles(); toast(b.dataset.v === 'true' ? 'Account switched on' : 'Account switched off'); adminPeople(S.viewToken); } catch (e) { fail(e); busy(b, false); } };
  }

  function adminSettings() {
    const st = Object.assign({}, settings(), S.settings);
    const gaps = (st.gaps_days || [14, 30, 60, 120]).slice(0, 4);
    while (gaps.length < 4) gaps.push(gaps[gaps.length - 1] || 30);
    $('#adminBody').innerHTML =
      '<form class="panel" id="setForm" novalidate><div class="form-grid">' +
      '<label class="field">Name on papers<input id="sOrg" type="text" maxlength="40" value="' + esc(st.org_name || 'AIN') + '"></label>' +
      '<label class="field">Line under the name<input id="sTag" type="text" maxlength="60" value="' + esc(st.tagline || '') + '"></label>' +
      '<div class="field">Logo<div class="row"><span id="logoPrev">' + (st.logo_path ? imgTag(st.logo_path) : '<span class="muted small">No logo; the name is used</span>') + '</span>' +
      '<label class="btn sm"><input type="file" id="sLogo" accept="image/*" hidden>Upload</label>' + (st.logo_path ? '<button class="btn ghost sm" type="button" data-act="rm-logo">Remove</button>' : '') + '</div></div>' +
      '</div>' +
      '<label class="field" style="margin-top:14px">Instructions printed on every paper<span class="hint">One instruction per line</span><textarea id="sInstr" rows="5">' + esc(st.instructions || '') + '</textarea></label>' +
      '<h3 style="margin:20px 0 10px">Marking</h3><div class="form-grid">' +
      '<label class="field">Marks for a correct answer<input id="sMc" type="number" min="1" max="10" value="' + esc(st.marks_correct) + '"></label>' +
      '<label class="field">Marks for a wrong answer<input id="sMw" type="number" min="-5" max="0" value="' + esc(st.marks_wrong) + '"></label></div>' +
      '<h3 style="margin:20px 0 4px">Spaced repetition</h3><p class="muted small" style="margin-bottom:10px">How many days a question stays out of a mentee’s papers after they see it.</p><div class="form-grid">' +
      gaps.map((g, i) => '<label class="field">' + ['After the 1st time', 'After the 2nd time', 'After the 3rd time', 'After the 4th time and later'][i] + '<input id="sGap' + i + '" type="number" min="1" max="730" value="' + esc(g) + '"></label>').join('') +
      '<label class="field">After a wrong answer<input id="sWrong" type="number" min="1" max="365" value="' + esc(st.wrong_gap_days) + '"></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit" id="sSave">Save settings</button></div></form>';
    hydrateImages($('#adminBody'));
    let logoPath = st.logo_path || null;
    $('#sLogo').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try { toast('Uploading logo…'); logoPath = await uploadFile(file); $('#logoPrev').innerHTML = imgTag(logoPath); hydrateImages($('#logoPrev')); }
      catch (err) { fail(err); }
    });
    S.actions['rm-logo'] = () => { logoPath = null; $('#logoPrev').innerHTML = '<span class="muted small">No logo; the name is used</span>'; };
    $('#setForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const num = (id, d) => { const v = Number($(id).value); return Number.isFinite(v) ? v : d; };
      const data = Object.assign({}, S.settings, {
        org_name: $('#sOrg').value.trim() || 'AIN', tagline: $('#sTag').value.trim(), logo_path: logoPath,
        instructions: $('#sInstr').value, marks_correct: num('#sMc', 4), marks_wrong: num('#sMw', -1),
        gaps_days: [0, 1, 2, 3].map((i) => Math.max(1, num('#sGap' + i, 30))), wrong_gap_days: Math.max(1, num('#sWrong', 7)),
      });
      const btn = $('#sSave');
      busy(btn, true, 'Saving…');
      try { await Api.saveSettings(data); S.settings = data; renderTopbar(); setActiveNav('admin'); toast('Settings saved'); }
      catch (err) { fail(err); } finally { busy(btn, false); }
    });
  }

  function adminChapters() {
    let sid = S.adminSubject || (S.subjects[0] || {}).id;
    function render() {
      const list = S.chapters.filter((c) => c.subject_id === sid).sort((a, b) => a.sort - b.sort);
      $('#adminBody').innerHTML =
        '<div class="panel"><div class="panel-head"><div class="row"><label class="field" style="min-width:200px">Subject<select id="cSubj">' + subjectOptions(sid) + '</select></label></div>' +
        '<p class="muted small" style="max-width:52ch">Hidden chapters stay on old questions and papers but are not offered when making new papers.</p></div>' +
        '<div class="table-wrap"><table class="data"><thead><tr><th>Order</th><th>Chapter</th><th>Class</th><th>Hidden</th><th></th></tr></thead><tbody>' +
        list.map((c, i) => '<tr><td class="num" style="white-space:nowrap"><button class="btn ghost sm" data-act="up" data-id="' + c.id + '"' + (i ? '' : ' disabled') + ' aria-label="Move up">↑</button><button class="btn ghost sm" data-act="down" data-id="' + c.id + '"' + (i < list.length - 1 ? '' : ' disabled') + ' aria-label="Move down">↓</button></td>' +
          '<td><input type="text" id="cn-' + c.id + '" value="' + esc(c.name) + '" maxlength="120"></td>' +
          '<td><input type="text" id="cc-' + c.id + '" value="' + esc(c.class_level || '') + '" maxlength="8" style="width:70px"></td>' +
          '<td><input type="checkbox" id="ch-' + c.id + '"' + (c.hidden ? ' checked' : '') + ' aria-label="Hidden"></td>' +
          '<td><button class="btn sm" data-act="save-ch" data-id="' + c.id + '">Save</button></td></tr>').join('') +
        '</tbody></table></div>' +
        '<form id="addCh" class="row" style="margin-top:14px" novalidate><input type="text" id="newCh" placeholder="New chapter name" maxlength="120" style="max-width:320px"><input type="text" id="newCls" placeholder="Class" maxlength="8" style="width:80px"><button class="btn" type="submit">Add chapter</button></form></div>';
      $('#cSubj').addEventListener('change', (e) => { sid = Number(e.target.value); S.adminSubject = sid; render(); });
      $('#addCh').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = $('#newCh').value.trim();
        if (!name) return;
        try {
          const maxSort = Math.max(0, ...S.chapters.filter((c) => c.subject_id === sid).map((c) => c.sort));
          await Api.saveChapter({ subject_id: sid, name, class_level: $('#newCls').value.trim() || null, sort: maxSort + 1, hidden: false });
          await refreshSyllabus(); toast('Chapter added'); render();
        } catch (err) { fail(/duplicate/i.test(err.message) ? new Error('That chapter already exists in this subject.') : err); }
      });
    }
    async function move(id, dir) {
      const list = S.chapters.filter((c) => c.subject_id === sid).sort((a, b) => a.sort - b.sort);
      const i = list.findIndex((c) => c.id === id);
      const j = i + dir;
      if (j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      await Promise.all(list.map((c, k) => (c.sort !== k + 1 ? Api.saveChapter({ id: c.id, sort: k + 1 }) : null)));
      await refreshSyllabus();
      render();
    }
    S.actions.up = (b) => move(Number(b.dataset.id), -1);
    S.actions.down = (b) => move(Number(b.dataset.id), 1);
    S.actions['save-ch'] = async (b) => {
      const id = Number(b.dataset.id);
      const name = $('#cn-' + id).value.trim();
      if (!name) { toast('A chapter needs a name.', 'bad'); return; }
      busy(b, true);
      try { await Api.saveChapter({ id, name, class_level: $('#cc-' + id).value.trim() || null, hidden: $('#ch-' + id).checked }); await refreshSyllabus(); toast('Chapter saved'); }
      catch (e) { fail(e); } finally { busy(b, false); }
    };
    render();
  }

  /* ================= Account ================= */

  function viewAccount() {
    setTitle('Your account');
    main().innerHTML =
      '<div class="page-head"><div><h1>Your account</h1><p class="sub">' + esc(S.me.email) + ' · ' + (isAdmin() ? 'Admin' : 'Mentor') + '</p></div><button class="btn" data-act="signout">Sign out</button></div>' +
      '<div class="stack" style="max-width:560px">' +
      '<form class="panel" id="nameForm" novalidate><h2 style="margin-bottom:12px">Name</h2><label class="field">Your name<input id="aName" type="text" maxlength="120" value="' + esc(S.me.full_name) + '"></label><div class="form-actions"><button class="btn primary" type="submit">Save name</button></div></form>' +
      '<form class="panel" id="pwForm" novalidate><h2 style="margin-bottom:12px">Change password</h2><div class="stack" style="gap:12px">' +
      '<label class="field">New password<span class="hint">At least 8 characters</span><input id="aPw1" type="password" autocomplete="new-password"></label>' +
      '<label class="field">Type it again<input id="aPw2" type="password" autocomplete="new-password"></label></div>' +
      '<div class="form-actions"><button class="btn primary" type="submit" id="aPwBtn">Change password</button></div></form></div>';
    S.actions.signout = async () => { await Api.signOut(); S.session = null; S.me = null; S.loaded = false; S.builder = {}; S.qcache.clear(); S.meta = null; location.hash = '#/'; route(); };
    $('#nameForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = $('#aName').value.trim();
      if (!n) { toast('Enter your name.', 'bad'); return; }
      try { await Api.updateMyName(n); S.me.full_name = n; await refreshProfiles(); renderTopbar(); toast('Name saved'); } catch (err) { fail(err); }
    });
    $('#pwForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const a = $('#aPw1').value, b = $('#aPw2').value;
      if (a.length < 8) { toast('The password needs at least 8 characters.', 'bad'); return; }
      if (a !== b) { toast('The two passwords do not match.', 'bad'); return; }
      const btn = $('#aPwBtn');
      busy(btn, true, 'Saving…');
      try { await Api.changePassword(a); toast('Password changed'); $('#aPw1').value = ''; $('#aPw2').value = ''; } catch (err) { fail(err); } finally { busy(btn, false); }
    });
  }

  /* ================= Start ================= */

  async function boot() {
    if (!window.Api) { main().innerHTML = '<div class="empty"><h2>Could not start</h2><p>Reload the page.</p></div>'; return; }
    try { S.session = await Api.getSession(); }
    catch (e) { S.session = null; if (!/did not load/.test(e.message)) fail(e); else { main().innerHTML = '<div class="empty"><h2>Could not connect</h2><p>' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Reload</button></div>'; return; } }
    Api.onAuth((event, session) => {
      if (event === 'SIGNED_OUT') { if (S.session) { S.session = null; S.me = null; S.loaded = false; route(); } }
      else if (session) S.session = session;
    });
    window.addEventListener('hashchange', route);
    route();
  }
  window.__app = { S, route };
  boot();
})();

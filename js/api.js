/* AIN Paper Builder: data layer on Supabase. Every function returns plain data or throws an Error with a readable message. */
(function () {
  'use strict';
  const cfg = window.APP_CONFIG;
  let sb = null;

  function client() {
    if (!sb) {
      if (!window.supabase || !window.supabase.createClient) throw new Error('The database library did not load. Check the internet connection and reload the page.');
      sb = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    }
    return sb;
  }

  function friendly(e) {
    const m = (e && (e.message || e.error_description || e.msg)) || String(e);
    if (/Invalid login credentials/i.test(m)) return new Error('Wrong email or password.');
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return new Error('Could not reach the server. Check the internet connection and try again.');
    if (/JWT expired|invalid JWT/i.test(m)) return new Error('Your sign-in expired. Please sign in again.');
    if (/row-level security|permission denied/i.test(m)) return new Error('You do not have permission to do that.');
    if (/User is banned/i.test(m)) return new Error('This account has been switched off. Ask the admin.');
    if (/Password should be/i.test(m)) return new Error('The password needs at least 8 characters.');
    if (/New password should be different/i.test(m)) return new Error('Choose a password different from the current one.');
    return new Error(m);
  }

  function unwrap(res) {
    if (res.error) throw friendly(res.error);
    return res.data;
  }

  async function fetchAll(build) {
    const size = 1000;
    let from = 0;
    let out = [];
    for (;;) {
      const res = await build().range(from, from + size - 1);
      if (res.error) throw friendly(res.error);
      out = out.concat(res.data || []);
      if (!res.data || res.data.length < size) break;
      from += size;
    }
    return out;
  }

  function chunks(arr, n) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  }

  const QUESTION_FIELDS = ['chapter_id', 'topic', 'qtype', 'difficulty', 'body', 'options', 'answer', 'solution', 'images', 'source_type', 'source_note', 'archived'];
  const pick = (obj, keys) => keys.reduce((o, k) => { if (obj[k] !== undefined) o[k] = obj[k]; return o; }, {});

  const urlCache = new Map();

  const Api = {
    /* ---- Sign-in ---- */
    async getSession() {
      const { data, error } = await client().auth.getSession();
      if (error) throw friendly(error);
      return data.session;
    },
    onAuth(cb) { client().auth.onAuthStateChange((event, session) => cb(event, session)); },
    async signIn(email, password) { unwrap(await client().auth.signInWithPassword({ email: email.trim().toLowerCase(), password })); },
    async signOut() { await client().auth.signOut(); },
    async changePassword(password) { unwrap(await client().auth.updateUser({ password })); },
    async setupNeeded() { return unwrap(await client().rpc('setup_needed')); },

    /* ---- People ---- */
    async me(uid) { return unwrap(await client().from('profiles').select('*').eq('id', uid).maybeSingle()); },
    async updateMyName(name) { unwrap(await client().rpc('update_my_name', { new_name: name })); },
    async profiles() { return unwrap(await client().from('profiles').select('id, full_name, email, role, active').order('full_name')); },
    async manageUsers(body) {
      const { data, error } = await client().functions.invoke('manage-users', { body });
      if (error) {
        let msg = error.message;
        try {
          const ctx = error.context;
          if (ctx && typeof ctx.json === 'function') { const j = await ctx.json(); if (j && j.error) msg = j.error; }
        } catch (e) { /* keep the generic message */ }
        throw friendly({ message: msg });
      }
      if (data && data.error) throw new Error(data.error);
      return data;
    },

    /* ---- Settings and syllabus ---- */
    async settings() {
      const r = unwrap(await client().from('app_settings').select('data').eq('id', 1).maybeSingle());
      return r ? r.data : {};
    },
    async saveSettings(data) { unwrap(await client().from('app_settings').update({ data }).eq('id', 1)); },
    async subjects() { return unwrap(await client().from('subjects').select('*').order('sort')); },
    async chapters() { return fetchAll(() => client().from('chapters').select('*').order('subject_id').order('sort')); },
    async saveChapter(ch) {
      const row = pick(ch, ['subject_id', 'class_level', 'name', 'sort', 'hidden']);
      if (ch.id) return unwrap(await client().from('chapters').update(row).eq('id', ch.id).select().single());
      return unwrap(await client().from('chapters').insert(row).select().single());
    },

    /* ---- Questions ---- */
    async questionMeta() {
      return fetchAll(() => client().from('questions').select('id, chapter_id, difficulty, archived, is_sample, created_by').order('created_at').order('id'));
    },
    async listQuestions(f) {
      let q = client().from('questions').select('*', { count: 'exact' });
      if (f.chapterIds && f.chapterIds.length) q = q.in('chapter_id', f.chapterIds);
      if (f.difficulty) q = q.eq('difficulty', f.difficulty);
      if (f.qtype) q = q.eq('qtype', f.qtype);
      if (f.source) q = q.eq('source_type', f.source);
      if (f.mineUid) q = q.eq('created_by', f.mineUid);
      if (f.samplesOnly) q = q.eq('is_sample', true);
      if (f.search) q = q.ilike('body', '%' + f.search.replace(/[%_\\]/g, (c) => '\\' + c) + '%');
      q = q.eq('archived', !!f.archived).order('created_at', { ascending: false }).order('id');
      const from = f.page * f.pageSize;
      const res = await q.range(from, from + f.pageSize - 1);
      if (res.error) throw friendly(res.error);
      return { rows: res.data || [], count: res.count || 0 };
    },
    async questionsByIds(ids) {
      const uniq = [...new Set(ids)];
      let out = [];
      for (const part of chunks(uniq, 150)) {
        out = out.concat(unwrap(await client().from('questions').select('*').in('id', part)));
      }
      return out;
    },
    async getQuestion(id) { return unwrap(await client().from('questions').select('*').eq('id', id).maybeSingle()); },
    async saveQuestion(q) {
      const row = pick(q, QUESTION_FIELDS);
      if (q.id) return unwrap(await client().from('questions').update(row).eq('id', q.id).select().single());
      return unwrap(await client().from('questions').insert(row).select().single());
    },
    async insertQuestions(rows) {
      let n = 0;
      for (const part of chunks(rows.map((r) => pick(r, QUESTION_FIELDS)), 200)) {
        unwrap(await client().from('questions').insert(part));
        n += part.length;
      }
      return n;
    },
    async setArchived(id, archived) { unwrap(await client().from('questions').update({ archived }).eq('id', id)); },
    async deleteQuestion(id) { unwrap(await client().from('questions').delete().eq('id', id)); },
    async deleteSamples() { unwrap(await client().from('questions').delete().eq('is_sample', true)); },

    /* ---- Mentees ---- */
    async mentees() { return unwrap(await client().from('mentees').select('*').order('name')); },
    async getMentee(id) { return unwrap(await client().from('mentees').select('*').eq('id', id).maybeSingle()); },
    async saveMentee(m) {
      const row = pick(m, ['name', 'status', 'target_year', 'archived', 'mentor_id']);
      if (m.id) return unwrap(await client().from('mentees').update(row).eq('id', m.id).select().single());
      return unwrap(await client().from('mentees').insert(row).select().single());
    },
    async deleteMentee(id) { unwrap(await client().from('mentees').delete().eq('id', id)); },

    /* ---- Papers ---- */
    async papersForMentee(menteeId) {
      return fetchAll(() => client().from('papers')
        .select('id, mentee_id, mentor_id, code, title, created_at, question_ids, responses, score, marked_at, duration_min, settings')
        .eq('mentee_id', menteeId).order('created_at', { ascending: false }).order('id'));
    },
    async recentPapers() {
      return unwrap(await client().from('papers')
        .select('id, mentee_id, code, title, created_at, score, marked_at, question_ids')
        .order('created_at', { ascending: false }).limit(500));
    },
    async getPaper(id) { return unwrap(await client().from('papers').select('*').eq('id', id).maybeSingle()); },
    async createPaper(p) {
      const row = pick(p, ['mentee_id', 'code', 'title', 'duration_min', 'settings', 'question_ids']);
      return unwrap(await client().from('papers').insert(row).select().single());
    },
    async updatePaper(id, patch) {
      const row = pick(patch, ['title', 'duration_min', 'responses', 'score', 'marked_at']);
      return unwrap(await client().from('papers').update(row).eq('id', id).select().single());
    },
    async deletePaper(id) { unwrap(await client().from('papers').delete().eq('id', id)); },

    /* ---- Images ---- */
    async uploadImage(blob, uid, ext) {
      const id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
      const path = uid + '/' + id + '.' + (ext || 'png');
      unwrap(await client().storage.from('qimages').upload(path, blob, { contentType: blob.type || 'image/png', upsert: false }));
      return path;
    },
    async signedUrls(paths) {
      const now = Date.now();
      const need = [...new Set(paths.filter(Boolean))].filter((p) => { const c = urlCache.get(p); return !c || c.exp < now; });
      for (const part of chunks(need, 100)) {
        const data = unwrap(await client().storage.from('qimages').createSignedUrls(part, 3600));
        (data || []).forEach((d) => { if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: now + 50 * 60000 }); });
      }
      const out = {};
      paths.forEach((p) => { const c = urlCache.get(p); if (c) out[p] = c.url; });
      return out;
    },
  };

  window.Api = Api;
})();

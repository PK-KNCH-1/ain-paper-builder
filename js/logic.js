/* AIN Paper Builder: pure logic (no DOM, no network). Used by the app and by tests. */
(function (root) {
  'use strict';
  const DAY = 86400000;

  /* ---------------- Text and maths rendering ---------------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Index of the brace that closes the one at `open`, or -1.
  function matchBrace(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const ch = src[i];
      if (ch === '\\') { i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function findClosingDollar(src, from) {
    for (let i = from; i < src.length; i++) {
      if (src[i] === '\\') { i++; continue; }
      if (src[i] === '$') return i;
    }
    return -1;
  }

  // Split a line into text and maths pieces. Supports $..$, $$..$$, \(..\), \[..\] and bare \ce{..}.
  function tokenize(src) {
    const out = [];
    let buf = '';
    const flush = () => { if (buf) { out.push({ text: buf }); buf = ''; } };
    let i = 0;
    while (i < src.length) {
      if (src[i] === '\\' && src[i + 1] === '$') { buf += '$'; i += 2; continue; }
      if (src.startsWith('$$', i)) {
        const j = src.indexOf('$$', i + 2);
        if (j > -1) { flush(); out.push({ math: src.slice(i + 2, j), display: true }); i = j + 2; continue; }
      }
      if (src[i] === '$') {
        const j = findClosingDollar(src, i + 1);
        if (j > -1 && j > i + 1) { flush(); out.push({ math: src.slice(i + 1, j), display: false }); i = j + 1; continue; }
      }
      if (src.startsWith('\\(', i)) {
        const j = src.indexOf('\\)', i + 2);
        if (j > -1) { flush(); out.push({ math: src.slice(i + 2, j), display: false }); i = j + 2; continue; }
      }
      if (src.startsWith('\\[', i)) {
        const j = src.indexOf('\\]', i + 2);
        if (j > -1) { flush(); out.push({ math: src.slice(i + 2, j), display: true }); i = j + 2; continue; }
      }
      if (src.startsWith('\\ce{', i)) {
        const j = matchBrace(src, i + 3);
        if (j > -1) { flush(); out.push({ math: src.slice(i, j + 1), display: false }); i = j + 1; continue; }
      }
      buf += src[i];
      i++;
    }
    flush();
    return out;
  }

  function renderMath(tex, display, katex) {
    if (katex) {
      try {
        return katex.renderToString(tex, { throwOnError: false, displayMode: !!display, strict: 'ignore', output: 'html' });
      } catch (e) { /* fall through */ }
    }
    return '<code class="tex">' + esc(tex) + '</code>';
  }

  function renderInline(src, katex) {
    return tokenize(src).map((t) => {
      if (t.text != null) {
        return esc(t.text)
          .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
          .replace(/__(.+?)__/g, '<u>$1</u>');
      }
      return renderMath(t.math, t.display, katex);
    }).join('');
  }

  // Full rich text: line breaks, pipe tables, inline maths.
  function renderRich(src, katex) {
    const lines = String(src == null ? '' : src).replace(/\r/g, '').split('\n');
    const blocks = [];
    let para = [];
    let table = [];
    const flushPara = () => {
      if (para.length) { blocks.push('<p>' + para.map((l) => renderInline(l, katex)).join('<br>') + '</p>'); para = []; }
    };
    const flushTable = () => {
      if (!table.length) return;
      const rows = table.map((l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim()))
        .filter((cells) => !cells.every((c) => /^:?-{2,}:?$/.test(c) || c === ''));
      let html = '<div class="rt-table"><table>';
      rows.forEach((cells, r) => {
        const tag = r === 0 ? 'th' : 'td';
        html += '<tr>' + cells.map((c) => '<' + tag + '>' + renderInline(c, katex) + '</' + tag + '>').join('') + '</tr>';
      });
      blocks.push(html + '</table></div>');
      table = [];
    };
    for (const line of lines) {
      if (/^\s*\|.*\|\s*$/.test(line)) { flushPara(); table.push(line); continue; }
      flushTable();
      if (line.trim() === '') { flushPara(); continue; }
      para.push(line);
    }
    flushPara();
    flushTable();
    return blocks.join('');
  }

  // Rough visible length of a piece of rich text (used to choose option layout).
  function visibleLength(src) {
    return tokenize(String(src || '')).reduce((n, t) => {
      if (t.text != null) return n + t.text.replace(/\*\*/g, '').length;
      const m = t.math.replace(/\\(text|mathrm|ce|dfrac|frac|tfrac|left|right|times|cdot)\b/g, '').replace(/[{}\\^_]/g, '');
      return n + Math.ceil(m.length * 0.8);
    }, 0);
  }

  /* ---------------- Spaced repetition ---------------- */

  const DEFAULT_SETTINGS = { gaps_days: [14, 30, 60, 120], wrong_gap_days: 7, marks_correct: 4, marks_wrong: -1 };

  function toMs(d) { return typeof d === 'number' ? d : new Date(d).getTime(); }

  // papers: [{created_at, question_ids, responses}] -> Map(questionId -> {seen, last, lastResult, wrong, correct})
  function buildHistory(papers) {
    const hist = new Map();
    const sorted = (papers || []).slice().sort((a, b) => toMs(a.created_at) - toMs(b.created_at));
    for (const p of sorted) {
      const t = toMs(p.created_at);
      for (const qid of p.question_ids || []) {
        const h = hist.get(qid) || { seen: 0, last: 0, lastResult: null, wrong: 0, correct: 0 };
        h.seen += 1;
        h.last = t;
        const r = p.responses && p.responses[qid] ? p.responses[qid].r : null;
        h.lastResult = r || null;
        if (r === 'w') h.wrong += 1;
        if (r === 'c') h.correct += 1;
        hist.set(qid, h);
      }
    }
    return hist;
  }

  function gapDaysFor(h, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    if (h.lastResult === 'w') return Number(s.wrong_gap_days) || 7;
    const gaps = (s.gaps_days && s.gaps_days.length ? s.gaps_days : DEFAULT_SETTINGS.gaps_days).map(Number);
    return gaps[Math.min(h.seen - 1, gaps.length - 1)];
  }

  // -> {state: 'new'|'due'|'resting', due?: ms}
  function repStatus(h, now, settings) {
    if (!h || !h.seen) return { state: 'new' };
    const due = h.last + gapDaysFor(h, settings) * DAY;
    return { state: toMs(now) >= due ? 'due' : 'resting', due };
  }

  /* ---------------- Paper selection ---------------- */

  const MIXES = {
    any: null,
    easier: { easy: 0.5, medium: 0.4, hard: 0.1 },
    balanced: { easy: 0.3, medium: 0.5, hard: 0.2 },
    harder: { easy: 0.1, medium: 0.4, hard: 0.5 },
  };

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Split n into whole-number targets by weights (largest remainder).
  function apportion(n, weights) {
    const keys = Object.keys(weights);
    const raw = keys.map((k) => n * weights[k]);
    const base = raw.map(Math.floor);
    let left = n - base.reduce((x, y) => x + y, 0);
    const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((x, y) => y[0] - x[0]);
    for (let k = 0; k < order.length && left > 0; k++, left--) base[order[k][1]]++;
    const out = {};
    keys.forEach((k, i) => { out[k] = base[i]; });
    return out;
  }

  function pickByMix(list, n, weights) {
    if (n <= 0) return [];
    if (!weights) return list.slice(0, n);
    const targets = apportion(n, weights);
    const groups = { easy: [], medium: [], hard: [] };
    list.forEach((c) => { (groups[c.q.difficulty] || groups.medium).push(c); });
    const chosen = [];
    const used = new Set();
    for (const d of ['easy', 'medium', 'hard']) {
      for (const c of groups[d].slice(0, targets[d] || 0)) { chosen.push(c); used.add(c.q.id); }
    }
    for (const c of list) {
      if (chosen.length >= n) break;
      if (!used.has(c.q.id)) { chosen.push(c); used.add(c.q.id); }
    }
    return chosen;
  }

  function dueSort(a, b) {
    const aw = a.h && a.h.lastResult === 'w' ? 0 : 1;
    const bw = b.h && b.h.lastResult === 'w' ? 0 : 1;
    if (aw !== bw) return aw - bw;
    return a.st.due - b.st.due;
  }

  function classify(pool, hist, now, settings, exclude) {
    const cands = pool.filter((q) => !q.archived && !exclude.has(q.id))
      .map((q) => ({ q, h: hist.get(q.id), st: repStatus(hist.get(q.id), now, settings) }));
    return {
      fresh: cands.filter((c) => c.st.state === 'new'),
      due: cands.filter((c) => c.st.state === 'due').sort(dueSort),
      resting: cands.filter((c) => c.st.state === 'resting').sort((a, b) => a.st.due - b.st.due),
    };
  }

  function pickForChapter(opts) {
    const { pool, count, hist, now, settings, mix, reviewShare, rng, exclude } = opts;
    const { fresh, due, resting } = classify(pool, hist, now, settings, exclude);
    const picked = [];
    const take = (c, reason) => { picked.push({ id: c.q.id, chapter_id: c.q.chapter_id, difficulty: c.q.difficulty, reason }); exclude.add(c.q.id); };
    const reviewTarget = Math.min(due.length, Math.round(count * (reviewShare || 0)));
    due.slice(0, reviewTarget).forEach((c) => take(c, 'review'));
    pickByMix(shuffle(fresh, rng), count - picked.length, MIXES[mix] || null).forEach((c) => take(c, 'new'));
    due.slice(reviewTarget, reviewTarget + (count - picked.length)).forEach((c) => take(c, 'review'));
    resting.slice(0, count - picked.length).forEach((c) => take(c, 'early'));
    return { picked, short: count - picked.length };
  }

  /*
   * buildPaper
   *  questions: [{id, chapter_id, difficulty, archived}]
   *  request: [{chapter_id, count}] in the order the mentor chose
   *  chapterInfo: Map(chapter_id -> {subject_sort, sort})
   *  options: {mix, reviewShare, order: 'chapter'|'shuffle', seed, now, settings}
   */
  function buildPaper(questions, request, chapterInfo, hist, options) {
    const o = Object.assign({ mix: 'any', reviewShare: 0.2, order: 'chapter', seed: Date.now(), now: Date.now(), settings: {} }, options || {});
    const rng = mulberry32(o.seed);
    const byChapter = new Map();
    for (const q of questions) {
      if (q.archived) continue;
      if (!byChapter.has(q.chapter_id)) byChapter.set(q.chapter_id, []);
      byChapter.get(q.chapter_id).push(q);
    }
    const exclude = new Set();
    const warnings = [];
    const groups = [];
    request.forEach((r, idx) => {
      const count = Math.max(0, Math.floor(Number(r.count) || 0));
      if (!count) return;
      const res = pickForChapter({ pool: byChapter.get(r.chapter_id) || [], count, hist, now: o.now, settings: o.settings, mix: o.mix, reviewShare: o.reviewShare, rng, exclude });
      if (res.short > 0) warnings.push({ chapter_id: r.chapter_id, wanted: count, got: count - res.short });
      const early = res.picked.filter((p) => p.reason === 'early').length;
      if (early) warnings.push({ chapter_id: r.chapter_id, early });
      groups.push({ chapter_id: r.chapter_id, idx, items: res.picked });
    });
    const info = (id) => chapterInfo.get(id) || { subject_sort: 99, sort: 0 };
    groups.sort((a, b) => (info(a.chapter_id).subject_sort - info(b.chapter_id).subject_sort) || (a.idx - b.idx));
    let items = [];
    if (o.order === 'shuffle') {
      const bySubject = new Map();
      for (const g of groups) {
        const s = info(g.chapter_id).subject_sort;
        if (!bySubject.has(s)) bySubject.set(s, []);
        bySubject.get(s).push(...g.items);
      }
      [...bySubject.keys()].sort((a, b) => a - b).forEach((s) => { items = items.concat(shuffle(bySubject.get(s), rng)); });
    } else {
      groups.forEach((g) => { items = items.concat(g.items); });
    }
    return { items, warnings };
  }

  // A replacement for one question: same chapter, not already in the paper, not rejected before.
  function nextReplacement(questions, current, paperIds, rejected, hist, options) {
    const o = Object.assign({ now: Date.now(), settings: {}, seed: Date.now() }, options || {});
    const exclude = new Set([...paperIds, ...rejected]);
    const pool = questions.filter((q) => q.chapter_id === current.chapter_id);
    const { fresh, due, resting } = classify(pool, hist, o.now, o.settings, exclude);
    const rng = mulberry32(o.seed);
    const sameDiff = (list) => list.filter((c) => c.q.difficulty === current.difficulty);
    const order = [
      [shuffle(sameDiff(fresh), rng), 'new'], [shuffle(fresh, rng), 'new'],
      [due, 'review'], [resting, 'early'],
    ];
    for (const [list, reason] of order) {
      if (list.length) {
        const c = list[0];
        return { id: c.q.id, chapter_id: c.q.chapter_id, difficulty: c.q.difficulty, reason };
      }
    }
    return null;
  }

  /* ---------------- Marking ---------------- */

  // questions: [{id, answer}], choices: {qid: 0..4}
  function scoreResponses(questions, choices, settings) {
    const s = Object.assign({}, DEFAULT_SETTINGS, settings || {});
    const responses = {};
    let correct = 0, wrong = 0, skipped = 0;
    for (const q of questions) {
      const c = Number(choices[q.id] || 0);
      let r = 's';
      if (c >= 1 && c <= 4) r = c === Number(q.answer) ? 'c' : 'w';
      if (r === 'c') correct++; else if (r === 'w') wrong++; else skipped++;
      responses[q.id] = { c, r };
    }
    const mc = Number(s.marks_correct), mw = Number(s.marks_wrong);
    return { responses, correct, wrong, skipped, score: correct * mc + wrong * mw, max: questions.length * mc };
  }

  /* ---------------- Paste importer ---------------- */

  const LETTERS = { a: 1, b: 2, c: 3, d: 4, '1': 1, '2': 2, '3': 3, '4': 4 };

  function parsePasted(text) {
    const lines = String(text || '').replace(/\r/g, '').replace(/ /g, ' ').split('\n');
    const qStart = /^\s*(?:Q(?:uestion)?\s*\.?\s*(\d{1,3})\s*[.):\-]?|(\d{1,3})\s*[.)])(?:\s+(.*))?$/i;
    // (a) (A) (1) a) a. A) are options; "A." is not, because match-the-list rows often start that way.
    const optLine = /^\s*(?:\(\s*([a-dA-D1-4])\s*\)|([a-d])\s*[).]|([A-D])\s*\))\s+(.*)$/;
    const inlineOpt = /\(\s*([a-dA-D1-4])\s*\)/g;
    const ansLine = /^\s*(?:ans(?:wer)?|key|correct(?:\s+(?:answer|option))?)\s*[:\-–.]?\s*(?:option\s*)?\(?\s*([a-dA-D1-4])\s*\)?(?:[\s.,;:].*)?$/i;
    const solLine = /^\s*(?:sol(?:ution)?|explanation|hint)\s*[:\-–.]\s*(.*)$/i;
    const keyHeader = /^\s*(?:answer\s*key|answers|answer\s*sheet)\s*[:\-]?\s*(.*)$/i;

    const qs = [];
    let cur = null;
    let mode = 'body';
    let keyMode = false;
    const keyMap = {};

    const startQ = (num, rest) => {
      cur = { num: num ? Number(num) : qs.length + 1, body: rest ? [rest] : [], options: [], answer: null, solution: [] };
      qs.push(cur);
      mode = 'body';
    };

    const readKey = (line) => {
      const re = /(\d{1,3})\s*[.):\-–]?\s*\(?\s*([a-dA-D1-4])\s*\)?(?![a-z])/g;
      let m, found = false;
      while ((m = re.exec(line))) { keyMap[Number(m[1])] = LETTERS[m[2].toLowerCase()]; found = true; }
      return found;
    };

    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { if (mode === 'solution') cur.solution.push(''); continue; }

      const kh = line.match(keyHeader);
      if (kh) { keyMode = true; if (kh[1]) readKey(kh[1]); continue; }
      if (keyMode) { if (readKey(line)) continue; keyMode = false; }

      const am = line.match(ansLine);
      if (am && cur) { cur.answer = LETTERS[am[1].toLowerCase()]; mode = 'after'; continue; }

      const sm = line.match(solLine);
      if (sm && cur) { cur.solution = sm[1] ? [sm[1]] : []; mode = 'solution'; continue; }

      // Several options on one line: (a) 2 (b) 4 (c) 6 (d) 8
      const markers = line.match(inlineOpt);
      if (cur && mode !== 'solution' && markers && markers.length >= 2 && /^\s*\(/.test(line)) {
        const parts = line.split(/\(\s*[a-dA-D1-4]\s*\)/).slice(1);
        parts.forEach((p) => cur.options.push(p.trim()));
        mode = 'options';
        continue;
      }

      const om = line.match(optLine);
      if (om && cur && mode !== 'solution' && cur.options.length < 4) {
        cur.options.push(om[4].trim());
        mode = 'options';
        continue;
      }

      const qm = line.match(qStart);
      if (qm && (!cur || cur.options.length >= 2 || mode === 'after' || mode === 'solution' || !cur.body.length)) {
        startQ(qm[1] || qm[2], (qm[3] || '').trim());
        continue;
      }

      if (!cur) { startQ(null, line.trim()); continue; }
      if (mode === 'solution') cur.solution.push(line.trim());
      else if (mode === 'options' && cur.options.length) cur.options[cur.options.length - 1] += ' ' + line.trim();
      else cur.body.push(line.trim());
    }

    return qs.map((q) => {
      const answer = q.answer || keyMap[q.num] || null;
      const warnings = [];
      const body = q.body.join('\n').trim();
      if (!body) warnings.push('No question text found');
      if (q.options.length !== 4) warnings.push('Found ' + q.options.length + ' options instead of 4');
      if (!answer) warnings.push('No answer found');
      const options = q.options.slice(0, 4);
      while (options.length < 4) options.push('');
      return { num: q.num, body, options, answer, solution: q.solution.join('\n').trim(), warnings };
    });
  }

  /* ---------------- Small helpers ---------------- */

  function paperCode(prefix, rng) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const r = rng || Math.random;
    let s = '';
    for (let i = 0; i < 5; i++) s += alphabet[Math.floor(r() * alphabet.length)];
    const p = String(prefix || 'AIN').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'QP';
    return p + '-' + s;
  }

  const api = {
    DAY, esc, tokenize, renderInline, renderRich, visibleLength,
    DEFAULT_SETTINGS, buildHistory, repStatus, gapDaysFor,
    MIXES, mulberry32, shuffle, apportion, buildPaper, nextReplacement,
    scoreResponses, parsePasted, paperCode,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);

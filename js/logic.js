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
    const optLine = /^\s*(?:\(\s*([a-dA-D1-4])\s*\)|([a-d])\s*[).]|([A-D])\s*\))(?:\s+(.*))?$/;
    const inlineOpt = /\(\s*([a-dA-D1-4])\s*\)/g;
    const ansLine = /^\s*(?:ans(?:wer)?|key|correct(?:\s+(?:answer|option))?)\s*[:\-–.]?\s*(?:option\s*)?\(?\s*([a-dA-D1-4])\s*\)?(?:[\s.,;:].*)?$/i;
    const solLine = /^\s*(?:sol(?:ution)?|explanation|hint)\s*[:\-–.]\s*(.*)$/i;
    const keyHeader = /^\s*(?:answer\s*key|answers|answer\s*sheet)\s*[:\-]?\s*(.*)$/i;
    const keyTitle = /[:\-–]\s*(?:answer\s*key|answers)\s*$/i;
    // One answer-key entry: 12. (3) | 12-c | 12 (c) | 12) 3 | Q12 c. A separator between number and option is required.
    const PAIR = '(?:Q\\.?\\s*)?(\\d{1,3})(?:\\s*[.):\\-–]\\s*\\(?|\\s*\\(|\\s+)\\s*([a-dA-D1-4])\\s*\\)?';
    const keyOnly = new RegExp('^\\s*(?:' + PAIR.replace(/(?<!\\)\((?!\?)/g, '(?:') + '\\s*[,;|]?\\s*){3,}$');
    const subjectHead = /^\s*(physics|chemistry|botany|zoology|biology)(?:\s*[:\-–]?\s*(?:section|part)\s*[a-d1-4])?\s*$/i;
    const sectionHead = /^\s*(?:section|part)\s*[-–:]?\s*[a-d1-4]\s*$/i;
    const endMark = /^[\s—–\-*.]*(?:end|the end)[\s—–\-*.]*$/i;
    let subject = null;
    const preamble = [];
    let lineNo = null;

    const qs = [];
    let cur = null;
    let mode = 'body';
    let keyMode = false;
    const keyMap = {};

    const startQ = (num, rest) => {
      cur = { num: num ? Number(num) : qs.length + 1, body: rest ? [rest] : [], options: [], answer: null, solution: [], subject, startLine: lineNo, lastLine: lineNo };
      qs.push(cur);
      mode = 'body';
    };

    const readKey = (line) => {
      const re = new RegExp('(?:^|[\\s,;|])' + PAIR + '(?=$|[\\s,;|.])', 'g');
      let m, found = false;
      while ((m = re.exec(line))) { keyMap[Number(m[1])] = LETTERS[m[2].toLowerCase()]; found = true; }
      return found;
    };

    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx].replace(/\s+$/, '');
      if (!line.trim()) { if (mode === 'solution') cur.solution.push(''); continue; }

      const kh = line.match(keyHeader);
      if (kh || keyTitle.test(line)) { keyMode = true; if (kh && kh[1]) readKey(kh[1]); continue; }
      if (keyMode) { if (readKey(line)) continue; keyMode = false; }
      if (keyOnly.test(line)) { readKey(line); continue; }

      const spaced = /^\s*(?:[A-Za-z] ){3,}[A-Za-z]\s*$/.test(line) ? line.replace(/\s+/g, '') : line;
      const sh = spaced.match(subjectHead);
      if (sh) { subject = sh[1][0].toUpperCase() + sh[1].slice(1).toLowerCase(); if (subject === 'Biology') subject = null; if (cur && mode === 'options') mode = 'after'; continue; }
      if (sectionHead.test(line) || endMark.test(line)) continue;

      const am = line.match(ansLine);
      if (am && cur) { cur.answer = LETTERS[am[1].toLowerCase()]; cur.lastLine = idx; mode = 'after'; continue; }

      const sm = line.match(solLine);
      if (sm && cur) { cur.solution = sm[1] ? [sm[1]] : []; cur.lastLine = idx; mode = 'solution'; continue; }

      // Several options on one line: (a) 2 (b) 4 (c) 6 (d) 8
      const markers = line.match(inlineOpt);
      if (cur && mode !== 'solution' && markers && markers.length >= 2 && /^\s*\(/.test(line)) {
        const parts = line.split(/\(\s*[a-dA-D1-4]\s*\)/).slice(1);
        parts.forEach((p) => cur.options.push(p.trim()));
        cur.lastLine = idx;
        mode = 'options';
        continue;
      }

      const om = line.match(optLine);
      if (om && cur && mode !== 'solution' && cur.options.length < 4) {
        cur.options.push((om[4] || '').trim());
        cur.lastLine = idx;
        mode = 'options';
        continue;
      }

      const qm = line.match(qStart);
      if (qm) {
        const num = Number(qm[1] || qm[2]);
        // Numbered lines before the real first question (instructions) are dropped when numbering restarts at 1.
        if (cur && num === 1 && !cur.options.length) {
          for (let k = qs.length - 1; k >= 0; k--) if (!qs[k].options.length) qs.splice(k, 1);
          cur = null;
        }
        if (!cur || cur.options.length >= 2 || mode === 'after' || mode === 'solution' || !cur.body.length || num === cur.num + 1) {
          lineNo = idx;
          startQ(num, (qm[3] || '').trim());
          continue;
        }
      }

      if (!cur) { preamble.push(line.trim()); continue; }
      cur.lastLine = idx;
      if (mode === 'solution') cur.solution.push(line.trim());
      else if (mode === 'options' && cur.options.length) cur.options[cur.options.length - 1] += ' ' + line.trim();
      else cur.body.push(line.trim());
    }

    // Lines wrapped by the PDF or the page width are joined back into sentences; list rows keep their own line.
    const keepBreak = /^\s*(?:\(?[A-Da-d]\)|[A-D][.)]\s|\(?[ivx]{1,4}\)|[IVX]{1,4}[.)]\s|\d{1,2}[.)]\s|\*\*|statement|assertion|reason|list|column|choose|select|codes|\|)/i;
    const joinLines = (arr) => arr.reduce((out, l) => {
      if (!out) return l;
      if (l === '' || keepBreak.test(l) || /[:?]$/.test(out) || /\n$/.test(out)) return out + '\n' + l;
      return out + ' ' + l;
    }, '');
    if (!qs.length && preamble.length && !/^\s*1[.)]\s/.test(preamble[0])) return parsePasted('1. ' + preamble.join('\n'));
    return qs.map((q) => {
      const answer = q.answer || keyMap[q.num] || null;
      const warnings = [];
      const body = joinLines(q.body).trim();
      if (!body) warnings.push('No question text found');
      if (q.options.length !== 4) warnings.push('Found ' + q.options.length + ' options instead of 4');
      if (!answer) warnings.push('No answer found');
      const options = q.options.slice(0, 4);
      while (options.length < 4) options.push('');
      return { num: q.num, body, options, answer, solution: joinLines(q.solution).trim(), subject: q.subject || null, startLine: q.startLine, lastLine: q.lastLine, warnings };
    });
  }

  /* ---------------- PDF text to lines ---------------- */
  // pages: [{width, height, items: [{s, x, y, w, h}]}] with y measured from the top of the page.

  function groupLines(items) {
    const sorted = items.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    const lines = [];
    for (const it of sorted) {
      const tol = Math.max(2, (it.h || 10) * 0.55);
      let line = null;
      for (let k = lines.length - 1; k >= 0 && k >= lines.length - 4; k--) {
        if (Math.abs(lines[k].y - it.y) <= tol) { line = lines[k]; break; }
      }
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.forEach((l) => l.items.sort((a, b) => a.x - b.x));
    return lines.sort((a, b) => a.y - b.y);
  }

  function lineText(items) {
    let s = '';
    let prevEnd = null;
    for (const it of items) {
      if (prevEnd != null && it.x - prevEnd > (it.h || 10) * 0.18 && !/\s$/.test(s) && !/^\s/.test(it.s)) s += ' ';
      s += it.s;
      prevEnd = prevEnd == null ? it.x + it.w : Math.max(prevEnd, it.x + it.w);
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function crossesGutter(line, gx, minGap) {
    let lEnd = -Infinity, rStart = Infinity;
    for (const it of line.items) {
      if (it.x < gx - 0.5 && it.x + it.w > gx + 0.5) return true;
      if (it.x + it.w <= gx + 0.5) lEnd = Math.max(lEnd, it.x + it.w);
      else rStart = Math.min(rStart, it.x);
    }
    return lEnd > -Infinity && rStart < Infinity && rStart - lEnd < minGap;
  }

  function proseWords(items) {
    const text = items.map((it) => it.s).join(' ').replace(/\(\s*[a-dA-D1-4]\s*\)/g, ' ');
    return (text.match(/[A-Za-z]{2,}/g) || []).length;
  }

  // x position of the gap between two columns, or null for a single-column page.
  // Two columns need a vertical band near the middle that most lines do not cross, with text on both sides of it.
  function findGutter(lines, width) {
    if (lines.length < 6) return null;
    const minGap = width * 0.015;
    let best = null;
    for (let f = 0.36; f <= 0.64001; f += 0.01) {
      const gx = width * f;
      let cross = 0, left = 0, right = 0, both = 0, proseL = 0, proseR = 0, rightOnly = 0;
      for (const l of lines) {
        if (crossesGutter(l, gx, minGap)) { cross++; continue; }
        const li = l.items.filter((it) => it.x + it.w <= gx + 0.5);
        const ri = l.items.filter((it) => it.x + it.w > gx + 0.5);
        if (li.length) left++;
        if (ri.length) right++;
        if (li.length && ri.length) both++;
        if (ri.length && !li.length) rightOnly++;
        if (proseWords(li) >= 5) proseL++;
        if (proseWords(ri) >= 5) proseR++;
      }
      const n = lines.length;
      // Evidence of real columns: running sentences on both sides, or a right side that carries on by itself.
      // Option grids and side-by-side figures in a single-column page show neither.
      const prose = proseL >= 1 && proseR >= 1 && proseL + proseR >= 3;
      const independent = rightOnly >= 2 && rightOnly >= 0.25 * right && proseL + proseR >= 1;
      if (cross / n < 0.34 && left / n > 0.25 && right / n > 0.25 && both / n >= 0.1 && (prose || independent) && (!best || cross < best.cross)) best = { gx, cross };
    }
    return best ? best.gx : null;
  }

  function lineGeom(items, page, colX0, colX1, text) {
    let top = Infinity, bottom = -Infinity, x0 = Infinity, x1 = -Infinity;
    for (const it of items) {
      const h = it.h || 10;
      top = Math.min(top, it.y - h); bottom = Math.max(bottom, it.y + h * 0.28);
      x0 = Math.min(x0, it.x); x1 = Math.max(x1, it.x + it.w);
    }
    return { text: text != null ? text : lineText(items), y: items.length ? items[0].y : 0, top, bottom, x0, x1, colX0, colX1, items };
  }

  function pageLines(page) {
    const all = groupLines(page.items || []);
    const W = page.width;
    // An answer key reads best row by row, so everything from its heading down is kept as full-width lines.
    const keyAt = all.findIndex((l) => /^\s*(?:answer\s*key|answers|answer\s*sheet)\s*:?\s*$|[:\-–]\s*answer\s*key\s*$/i.test(lineText(l.items)));
    const lines = keyAt >= 0 ? all.slice(0, keyAt) : all;
    const tail = keyAt >= 0 ? all.slice(keyAt).map((l) => lineGeom(l.items, page, 0, W)) : [];
    const gx = findGutter(lines, W);
    if (gx == null) return lines.map((l) => lineGeom(l.items, page, 0, W)).concat(tail);
    const minGap = W * 0.015;
    const out = [];
    let left = [], right = [];
    const flush = () => { out.push(...left, ...right); left = []; right = []; };
    for (const l of lines) {
      if (crossesGutter(l, gx, minGap)) { flush(); out.push(lineGeom(l.items, page, 0, W)); continue; }
      const li = l.items.filter((it) => it.x + it.w <= gx + 0.5);
      const ri = l.items.filter((it) => it.x + it.w > gx + 0.5);
      if (li.length) left.push(lineGeom(li, page, 0, gx));
      if (ri.length) right.push(lineGeom(ri, page, gx, W));
    }
    flush();
    return out.concat(tail);
  }

  // Lines of text in reading order, each with its page and position. pdfPagesToText joins them with newlines,
  // so line n of the text is entry n of this list.
  function pdfPagesToLines(pages) {
    const perPage = pages.map((p, pi) => ({ p, lines: pageLines(p).filter((l) => l.text).map((l) => Object.assign(l, { page: pi })) }));
    // Running headers and footers: the same text near the top or bottom edge on most pages.
    const norm = (t) => t.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
    const edge = (p, l) => l.y < p.height * 0.08 || l.y > p.height * 0.92;
    const counts = new Map();
    perPage.forEach(({ p, lines }) => {
      new Set(lines.filter((l) => edge(p, l)).map((l) => norm(l.text))).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1));
    });
    const repeated = (k) => pages.length >= 2 && (counts.get(k) || 0) >= Math.max(2, Math.ceil(pages.length * 0.5));
    const pageNo = /^(page\s*)?#+(\s*(of|\/)\s*#+)?$/;
    const out = [];
    perPage.forEach(({ p, lines }) => lines.forEach((l) => {
      if (!(edge(p, l) && (repeated(norm(l.text)) || pageNo.test(norm(l.text))))) out.push(l);
    }));
    return out;
  }

  function pdfPagesToText(pages) {
    return pdfPagesToLines(pages).map((l) => l.text).join('\n');
  }

  /* ---------------- Figures in PDFs ---------------- */

  // Areas of the page that belong to each parsed question, in PDF points from the top-left of the page.
  function questionRegions(questions, lines, pages) {
    return questions.map((q, qi) => {
      if (q.startLine == null) return [];
      const s = q.startLine, e = Math.max(q.lastLine == null ? s : q.lastLine, s);
      const groups = new Map();
      for (let i = s; i <= e && i < lines.length; i++) {
        const l = lines[i];
        const key = l.page + ':' + Math.round(l.colX0);
        if (!groups.has(key)) groups.set(key, { page: l.page, x0: l.colX0, x1: l.colX1, y0: l.top, y1: l.bottom });
        const g = groups.get(key);
        g.y0 = Math.min(g.y0, l.top); g.y1 = Math.max(g.y1, l.bottom);
      }
      return [...groups.values()].map((g) => {
        const page = pages[g.page];
        let limit = page.height * 0.95;
        for (let i = 0; i < lines.length; i++) {
          if (i >= s && i <= e) continue;
          const l = lines[i];
          if (l.page !== g.page || Math.round(l.colX0) !== Math.round(g.x0)) continue;
          if (l.top >= g.y1 - 1 && l.top < limit) limit = l.top;
        }
        return { page: g.page, x0: g.x0, x1: g.x1, y0: Math.max(0, g.y0 - 2), y1: Math.max(g.y1, limit - 1) };
      });
    });
  }

  /*
   * Finds drawings (graphs, diagrams, structures, pictures) inside one region of a rendered page.
   *  gray: Uint8Array of the page, one byte per pixel (0 = black), size W x H
   *  region: {x0, y0, x1, y1} in pixels; textBoxes: [{x0, y0, x1, y1}] in pixels; scale: pixels per PDF point
   * Returns boxes in pixels, in reading order. Text is masked out first, so what is left is drawn ink.
   */
  function findFigures(gray, W, H, region, textBoxes, scale) {
    const pt = scale;
    const cell = Math.max(2, Math.round(1.5 * pt));
    const rx0 = Math.max(0, Math.floor(region.x0)), ry0 = Math.max(0, Math.floor(region.y0));
    const rx1 = Math.min(W, Math.ceil(region.x1)), ry1 = Math.min(H, Math.ceil(region.y1));
    const gw = Math.ceil((rx1 - rx0) / cell), gh = Math.ceil((ry1 - ry0) / cell);
    if (gw <= 0 || gh <= 0) return [];
    const ink = new Uint8Array(gw * gh);
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const px0 = rx0 + gx * cell, py0 = ry0 + gy * cell;
        const px1 = Math.min(rx1, px0 + cell), py1 = Math.min(ry1, py0 + cell);
        let dark = 0;
        for (let y = py0; y < py1 && dark < 2; y++) {
          const row = y * W;
          for (let x = px0; x < px1; x++) if (gray[row + x] < 150 && ++dark >= 2) break;
        }
        if (dark >= 2) ink[gy * gw + gx] = 1;
      }
    }
    const pad = 1.2 * pt;
    for (const b of textBoxes) {
      const cx0 = Math.max(0, Math.floor((b.x0 - pad - rx0) / cell)), cx1 = Math.min(gw - 1, Math.floor((b.x1 + pad - rx0) / cell));
      const cy0 = Math.max(0, Math.floor((b.y0 - pad - ry0) / cell)), cy1 = Math.min(gh - 1, Math.floor((b.y1 + pad - ry0) / cell));
      for (let y = cy0; y <= cy1; y++) for (let x = cx0; x <= cx1; x++) ink[y * gw + x] = 0;
    }
    // Connected pieces of ink
    const seen = new Uint8Array(gw * gh);
    const comps = [];
    const stack = [];
    for (let i = 0; i < ink.length; i++) {
      if (!ink[i] || seen[i]) continue;
      let minx = Infinity, miny = Infinity, maxx = -1, maxy = -1, n = 0;
      stack.push(i); seen[i] = 1;
      while (stack.length) {
        const k = stack.pop();
        const x = k % gw, y = (k - x) / gw;
        n++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const nk = ny * gw + nx;
          if (ink[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
      if (n >= 3) comps.push({ x0: rx0 + minx * cell, y0: ry0 + miny * cell, x1: rx0 + (maxx + 1) * cell, y1: ry0 + (maxy + 1) * cell });
    }
    // Join pieces that sit close together (a curve and its axes, a diagram and its parts)
    const gap = 8 * pt;
    let boxes = comps;
    for (let changed = true; changed;) {
      changed = false;
      const next = [];
      for (const b of boxes) {
        const m = next.find((o) => b.x0 - gap <= o.x1 && o.x0 - gap <= b.x1 && b.y0 - gap <= o.y1 && o.y0 - gap <= b.y1);
        if (m) { m.x0 = Math.min(m.x0, b.x0); m.y0 = Math.min(m.y0, b.y0); m.x1 = Math.max(m.x1, b.x1); m.y1 = Math.max(m.y1, b.y1); changed = true; }
        else next.push(Object.assign({}, b));
      }
      boxes = next;
    }
    // Keep real drawings; drop rules, fraction bars, root signs and specks
    boxes = boxes.filter((b) => (b.x1 - b.x0) >= 16 * pt && (b.y1 - b.y0) >= 16 * pt && (b.x1 - b.x0) * (b.y1 - b.y0) >= 700 * pt * pt);
    // A box that is mostly text is a table or a framed passage, which the question text already has
    const textShare = (b) => {
      let a = 0;
      for (const t of textBoxes) {
        const w = Math.min(b.x1, t.x1) - Math.max(b.x0, t.x0), h = Math.min(b.y1, t.y1) - Math.max(b.y0, t.y0);
        if (w > 0 && h > 0) a += w * h;
      }
      return a / ((b.x1 - b.x0) * (b.y1 - b.y0));
    };
    boxes = boxes.filter((b) => textShare(b) < 0.3);
    // Take in labels that touch the drawing, add a margin, stay inside the region
    for (const b of boxes) {
      for (const t of textBoxes) {
        if (t.x1 >= b.x0 - 3 * pt && t.x0 <= b.x1 + 3 * pt && t.y1 >= b.y0 - 3 * pt && t.y0 <= b.y1 + 3 * pt &&
          (t.x1 - t.x0) < (b.x1 - b.x0) * 1.2) {
          b.x0 = Math.min(b.x0, t.x0); b.y0 = Math.min(b.y0, t.y0); b.x1 = Math.max(b.x1, t.x1); b.y1 = Math.max(b.y1, t.y1);
        }
      }
      b.x0 = Math.max(rx0, Math.floor(b.x0 - 4 * pt)); b.y0 = Math.max(ry0, Math.floor(b.y0 - 4 * pt));
      b.x1 = Math.min(rx1, Math.ceil(b.x1 + 4 * pt)); b.y1 = Math.min(ry1, Math.ceil(b.y1 + 4 * pt));
    }
    return sortReading(boxes);
  }

  function sortReading(boxes) {
    const rows = [];
    boxes.slice().sort((a, b) => a.y0 - b.y0).forEach((b) => {
      const row = rows.find((r) => Math.min(r.y1, b.y1) - Math.max(r.y0, b.y0) > 0.5 * Math.min(r.y1 - r.y0, b.y1 - b.y0));
      if (row) { row.items.push(b); row.y0 = Math.min(row.y0, b.y0); row.y1 = Math.max(row.y1, b.y1); }
      else rows.push({ y0: b.y0, y1: b.y1, items: [b] });
    });
    return rows.sort((a, b) => a.y0 - b.y0).flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));
  }

  // Where each figure goes: 'q' for the question, 1-4 for an option. Four figures with empty options become the options.
  function assignFigures(options, count) {
    const empty = options.filter((o) => !String(o || '').trim()).length;
    if (empty >= 3 && count >= 4) return Array.from({ length: count }, (_, i) => (i >= count - 4 ? i - (count - 4) + 1 : 'q'));
    return Array.from({ length: count }, () => 'q');
  }

  /* ---------------- AI conversion of scanned pages ---------------- */

  // Reads an answer key typed or pasted by hand: "1-3, 2-4", "1. (b) 2. (c)", "Q1 a Q2 d", one per line or all on one line.
  function parseAnswerKey(text) {
    const map = {};
    const re = /(?:^|[\s,;|])(?:Q\.?\s*)?(\d{1,3})(?:\s*[.):\-–=]\s*\(?|\s*\(|\s+)\s*([a-dA-D1-4])\s*\)?(?=$|[\s,;|.])/g;
    let m;
    const src = String(text || '').replace(/\r/g, '');
    while ((m = re.exec(src))) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 999) map[n] = LETTERS[m[2].toLowerCase()];
    }
    return map;
  }

  const LIST_START = /^\s*(?:\(?[A-Ea-e]\)|[A-E][.)]\s|\(?[ivx]{1,4}\)|\d{1,2}[.)]\s|\||statement|assertion|reason|choose|select|codes)/i;

  // Joins the pages the AI read into whole questions. Questions cut at the bottom of a page or column are joined
  // with their continuation on the next page. pages: [{ unit, label, questions: [server question], answer_key }] in reading order.
  function mergeAiPages(pages, opts) {
    const o = opts || {};
    const items = [];
    const key = {};
    let subject = o.subject || null;
    let prev = null;
    const hasContent = (op) => !!(op && (String(op.text || '').trim() || op.box));
    (pages || []).forEach((pg) => {
      (pg.answer_key || []).forEach((a) => { key[a.number] = a.answer; });
      (pg.questions || []).forEach((q) => {
        if (q.subject) subject = q.subject;
        const options = (q.options || []).map((op) => ({ text: String(op.text || ''), box: op.box || null, unit: pg.unit }));
        const figs = (q.figures || []).map((b) => ({ unit: pg.unit, box: b }));
        const qbox = q.question_box ? [{ unit: pg.unit, box: q.question_box }] : [];
        const continues = prev && (!q.starts_here || !q.number || (q.number === prev.num && (prev.open || !options.some(hasContent) || !prev.options.some(hasContent))));
        if (continues) {
          const t = String(q.text || '').trim();
          if (t) {
            if (prev.options.some(hasContent) && !options.some(hasContent)) {
              // Text after the options have started belongs to the last option.
              const last = prev.options[prev.options.length - 1];
              last.text = (last.text + ' ' + t).trim();
            } else {
              prev.body = prev.body ? prev.body + (LIST_START.test(t) || /[:?]$/.test(prev.body) ? '\n' : ' ') + t : t;
            }
          }
          const kept = prev.options.filter(hasContent);
          prev.options = kept.concat(options.filter(hasContent));
          prev.figs = prev.figs.concat(figs);
          prev.qboxes = prev.qboxes.concat(qbox);
          if (prev.pages.indexOf(pg.label) < 0) prev.pages.push(pg.label);
          prev.open = q.ends_here === false;
          if (!prev.chapter_id && q.chapter_id) prev.chapter_id = q.chapter_id;
          if (!prev.printed_answer && q.printed_answer) prev.printed_answer = q.printed_answer;
          return;
        }
        prev = {
          num: q.number || null, subject: q.subject || subject, chapter_id: q.chapter_id || null, difficulty: q.difficulty || 'medium', qtype: q.qtype || 'single',
          body: String(q.text || '').trim(), options, figs, qboxes: qbox, printed_answer: q.printed_answer || 0,
          pages: [pg.label], open: q.ends_here === false, orphan: !q.starts_here || !q.number,
        };
        items.push(prev);
      });
    });
    // Unnumbered pieces with nothing before them get the next free number so they can still be checked.
    let last = 0;
    items.forEach((it) => { if (!it.num) it.num = last + 1; last = it.num; });
    return { items, key };
  }

  // Tidies a diagram cut from a scan. data is RGBA (changed in place). With clean, coloured marks (watermarks, pen,
  // highlighter) and the paper tint become white and the print is darkened. Then slivers of neighbouring text that
  // touch the edge of the cut are dropped and empty margins trimmed. Returns the rectangle to keep.
  function tidyFigure(data, w, h, opts) {
    const o = opts || {};
    const ink = new Uint8Array(w * h);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      let v = (r * 0.3 + g * 0.59 + b * 0.11) | 0;
      if (o.clean) {
        if (sat > 60 || (sat > 30 && v > 70)) v = 255;
        else if (v > 196) v = 255;
        else v = Math.max(0, Math.round((v - 30) * 255 / 166));
        data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255;
      }
      if (v < 150 && !(sat > 60 && !o.clean)) ink[p] = 1;
    }
    const rowInk = (y, x0, x1) => { let n = 0; for (let x = x0; x < x1; x++) n += ink[y * w + x]; return n; };
    const colInk = (x, y0, y1) => { let n = 0; for (let y = y0; y < y1; y++) n += ink[y * w + x]; return n; };
    let x0 = 0, y0 = 0, x1 = w, y1 = h;
    const GAP = Math.max(3, Math.round(Math.min(w, h) * 0.012));
    // A run of empty lines within the outer 22% after ink touching the edge: cut there.
    const cutFrom = (len, inkAt, fromEnd) => {
      const at = (k) => inkAt(fromEnd ? len - 1 - k : k);
      if (!(at(0) || at(1) || at(2))) return 0;
      let blank = 0;
      for (let k = 3; k < Math.floor(len * 0.22); k++) {
        if (at(k) === 0) { blank++; if (blank >= GAP) return k + 1 - Math.floor(GAP / 2); } else blank = 0;
      }
      return 0;
    };
    for (let pass = 0; pass < 2; pass++) {
      y0 += cutFrom(y1 - y0, (k) => rowInk(y0 + k, x0, x1), false);
      y1 -= cutFrom(y1 - y0, (k) => rowInk(y0 + k, x0, x1), true);
      x0 += cutFrom(x1 - x0, (k) => colInk(x0 + k, y0, y1), false);
      x1 -= cutFrom(x1 - x0, (k) => colInk(x0 + k, y0, y1), true);
    }
    // Trim empty margins, keeping a little white around the drawing.
    let tx0 = x1, ty0 = y1, tx1 = x0 - 1, ty1 = y0 - 1;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (ink[y * w + x]) { if (x < tx0) tx0 = x; if (x > tx1) tx1 = x; if (y < ty0) ty0 = y; if (y > ty1) ty1 = y; }
    if (tx1 < tx0) return { x: 0, y: 0, w, h };
    const m = Math.max(6, Math.round(Math.min(w, h) * 0.03));
    const rx0 = Math.max(0, tx0 - m), ry0 = Math.max(0, ty0 - m), rx1 = Math.min(w, tx1 + 1 + m), ry1 = Math.min(h, ty1 + 1 + m);
    if ((rx1 - rx0) * (ry1 - ry0) < w * h * 0.02) return { x: 0, y: 0, w, h };
    return { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
  }

  // Milliseconds until Google's free daily allowance resets (midnight in California).
  function msToPacificMidnight(now) {
    const d = new Date(now == null ? Date.now() : now);
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).forEach((p) => { parts[p.type] = Number(p.value); });
    const h = parts.hour === 24 ? 0 : parts.hour;
    return ((23 - h) * 3600 + (59 - parts.minute) * 60 + (60 - parts.second)) * 1000;
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
    DAY, esc, tokenize, renderInline, renderRich, visibleLength, pdfPagesToText, pdfPagesToLines, pageLines,
    questionRegions, findFigures, assignFigures, sortReading,
    DEFAULT_SETTINGS, buildHistory, repStatus, gapDaysFor,
    MIXES, mulberry32, shuffle, apportion, buildPaper, nextReplacement,
    scoreResponses, parsePasted, paperCode, parseAnswerKey, mergeAiPages, msToPacificMidnight, tidyFigure,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Logic = api;
})(typeof window !== 'undefined' ? window : globalThis);

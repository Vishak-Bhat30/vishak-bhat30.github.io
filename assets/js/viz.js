/* Explainer animations for papers and projects.
   Each explainer is a Story: a list of captioned steps that play in order, loop,
   pause off-screen, and can be jumped to via the numbered step buttons. */
(function () {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const STOP = Symbol('stop');
  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tip = () => (window.Site && window.Site.tooltip) || { show() {}, hide() {} };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const easeInOut = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  /* ---------- tiny SVG helpers ---------- */
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'class') e.setAttribute('class', attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    if (parent) parent.appendChild(e);
    return e;
  }
  const G = (p, a) => el('g', a, p);
  const R = (p, x, y, w, h, cls, a) => el('rect', Object.assign({ x, y, width: w, height: h, class: cls }, a), p);
  const C = (p, cx, cy, r, cls, a) => el('circle', Object.assign({ cx, cy, r, class: cls }, a), p);
  const Ln = (p, x1, y1, x2, y2, cls, a) => el('line', Object.assign({ x1, y1, x2, y2, class: cls }, a), p);
  const P = (p, d, cls, a) => el('path', Object.assign({ d, class: cls }, a), p);
  const T = (p, x, y, text, cls, a) => el('text', Object.assign({ x, y, class: cls, text }, a), p);
  const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); };
  function fadeIn(node, instant) {
    node.style.opacity = 0;
    if (!instant) node.getBoundingClientRect();
    node.style.opacity = 1;
  }
  function wrap(str, max) {
    const words = str.split(' ');
    const lines = [];
    let cur = '';
    words.forEach(w => {
      if ((cur + ' ' + w).trim().length > max) { if (cur) lines.push(cur); cur = w; }
      else cur = (cur + ' ' + w).trim();
    });
    if (cur) lines.push(cur);
    return lines;
  }
  function multiline(p, x, y, lines, lh, cls, a) {
    const t = T(p, x, y, '', cls, a);
    lines.forEach((ln, i) => el('tspan', { x, dy: i === 0 ? 0 : lh, text: ln }, t));
    return t;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hoverTip(node, html) {
    node.addEventListener('mousemove', e => tip().show(typeof html === 'function' ? html() : html, e.clientX, e.clientY));
    node.addEventListener('mouseleave', () => tip().hide());
  }

  const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9-5.5z"/></svg>';
  const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>';
  const ICON_REPLAY = '<svg viewBox="0 0 16 16"><path d="M8 2.5a5.5 5.5 0 1 1-5.2 3.7l1.4.5A4 4 0 1 0 8 4v2L4.8 3.2 8 .5z"/></svg>';

  /* ---------- Story engine ---------- */
  class Story {
    constructor(panel, opts) {
      this.panel = panel;
      this.steps = opts.steps;
      this.resetFn = opts.reset;
      this.cycleFn = opts.cycle || null;
      this.hold = opts.hold || 3600;
      this.token = 0;
      this.instant = false;
      this.userPaused = false;
      this.offscreen = true;
      this.tabHidden = false;
      this.started = false;
      this.finished = false;
      this.buildCaption();
    }
    get paused() { return this.userPaused || this.offscreen || this.tabHidden; }

    buildCaption() {
      const cap = this.panel.querySelector('.viz-caption');
      clear(cap);
      const nav = document.createElement('div');
      nav.className = 'viz-steps';
      this.btns = this.steps.map((s, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(i + 1);
        b.setAttribute('aria-label', `Step ${i + 1}: ${s.title}`);
        b.addEventListener('click', () => this.jump(i));
        nav.appendChild(b);
        return b;
      });
      this.textEl = document.createElement('div');
      this.textEl.className = 'viz-text';
      this.playBtn = document.createElement('button');
      this.playBtn.type = 'button';
      this.playBtn.className = 'viz-play';
      this.playBtn.addEventListener('click', () => this.togglePlay());
      cap.append(nav, this.textEl, this.playBtn);
      this.setStep(0);
      this.paintPlay();
      try { this.resetFn(); } catch (e) { console.error(e); }
    }
    paintPlay() {
      const playing = this.started && !this.userPaused && !this.finished;
      this.playBtn.innerHTML = playing ? ICON_PAUSE : (this.finished ? ICON_REPLAY : ICON_PLAY);
      this.playBtn.setAttribute('aria-label', playing ? 'Pause animation' : (this.finished ? 'Replay animation' : 'Play animation'));
    }
    setStep(i) {
      this.btns.forEach((b, k) => {
        b.classList.toggle('on', k === i);
        b.classList.toggle('done', k < i);
        b.setAttribute('aria-current', k === i ? 'step' : 'false');
      });
      const s = this.steps[i];
      this.textEl.innerHTML = `<b>${s.title}.</b> ${s.text}`;
    }
    async wait(ms) {
      const t = this.token;
      if (this.instant) { if (t !== this.token) throw STOP; return; }
      let left = ms;
      while (left > 0) {
        const dt = Math.min(left, 50);
        await sleep(dt);
        if (t !== this.token) throw STOP;
        if (!this.paused) left -= dt;
      }
    }
    tween(ms, fn, ease = easeInOut) {
      if (this.instant) { fn(1); return Promise.resolve(); }
      const t = this.token;
      return new Promise((res, rej) => {
        let elapsed = 0;
        let last = performance.now();
        const tick = now => {
          if (t !== this.token) return rej(STOP);
          const dt = now - last;
          last = now;
          if (!this.paused) elapsed += Math.min(dt, 64);
          const p = Math.min(1, elapsed / ms);
          fn(ease(p));
          if (p < 1) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
    }
    async play(from) {
      const t = ++this.token;
      this.instant = false;
      try {
        this.resetFn();
        if (from > 0) {
          this.instant = true;
          for (let k = 0; k < from; k++) { this.setStep(k); await this.steps[k].run(); }
          this.instant = false;
        }
        let i = from;
        for (;;) {
          for (let k = i; k < this.steps.length; k++) { this.setStep(k); await this.steps[k].run(); }
          await this.wait(this.hold);
          if (this.cycleFn) this.cycleFn();
          this.resetFn();
          i = 0;
        }
      } catch (e) {
        if (t === this.token) this.instant = false;
        if (e !== STOP) console.error(e);
      }
    }
    async showUpTo(i) {
      const t = ++this.token;
      this.resetFn();
      this.instant = true;
      try {
        for (let k = 0; k <= i; k++) { this.setStep(k); await this.steps[k].run(); }
      } catch (e) { if (e !== STOP) console.error(e); }
      if (t === this.token) this.instant = false;
      this.setStep(i);
      this.started = true;
      this.finished = true;
      this.paintPlay();
    }
    start() {
      if (REDUCED) { this.showUpTo(this.steps.length - 1); return; }
      this.started = true; this.finished = false; this.userPaused = false;
      this.play(0);
      this.paintPlay();
    }
    jump(i) {
      if (REDUCED) { this.showUpTo(i); return; }
      this.started = true; this.finished = false; this.userPaused = false;
      this.play(i);
      this.paintPlay();
    }
    togglePlay() {
      if (!this.started || this.finished) {
        this.started = true; this.finished = false; this.userPaused = false;
        this.play(0);
      } else {
        this.userPaused = !this.userPaused;
      }
      this.paintPlay();
    }
  }

  /* =========================================================
     interwhen: maze + fork-and-verify lanes
     ========================================================= */
  function interwhen(panel) {
    const root = panel.querySelector('svg');
    const M = { x: 22, y: 50, c: 34 };
    const WALLS = ['v00', 'h01', 'h02', 'v02', 'v10', 'h12', 'h13', 'v13', 'v22', 'v23', 'h20', 'v30', 'h32', 'h33', 'v41', 'h03'];
    const cx = c => M.x + M.c * c + M.c / 2;
    const cy = r => M.y + M.c * r + M.c / 2;
    const DIR = { '↓': [1, 0], '↑': [-1, 0], '→': [0, 1], '←': [0, -1] };
    const BX0 = 246, BW = 15, GAP = 3, AY = 46, AH = 22, CHIP_Y = 174;
    let L, S;

    function reset() {
      clear(root);
      L = { blocks: [], trail: [], calls: 0, viol: 0, cursor: BX0, pos: [0, 0], log: [] };

      // maze
      T(root, 20, 30, 'TASK', 'sv-label');
      T(root, 58, 30, 'go from S to ★', 'sv-cap');
      const mz = G(root);
      for (let i = 1; i < 5; i++) {
        Ln(mz, M.x + M.c * i, M.y, M.x + M.c * i, M.y + M.c * 5, 'sv-grid');
        Ln(mz, M.x, M.y + M.c * i, M.x + M.c * 5, M.y + M.c * i, 'sv-grid');
      }
      R(mz, M.x, M.y, M.c * 5, M.c * 5, 'sv-maze-border', { rx: 4 });
      L.walls = {};
      WALLS.forEach(w => {
        const k = w[0], r = +w[1], c = +w[2];
        let x1, y1, x2, y2;
        if (k === 'v') { x1 = x2 = M.x + M.c * (c + 1); y1 = M.y + M.c * r; y2 = y1 + M.c; }
        else { y1 = y2 = M.y + M.c * (r + 1); x1 = M.x + M.c * c; x2 = x1 + M.c; }
        L.walls[w] = Ln(mz, x1, y1, x2, y2, 'sv-wall');
      });
      T(mz, cx(0), cy(0) + 4.5, 'S', 'sv-start', { 'text-anchor': 'middle' });
      L.goal = T(mz, cx(4), cy(4) + 6, '★', 'sv-goal', { 'text-anchor': 'middle' });
      L.pathG = G(mz);
      L.marks = G(mz);
      L.agent = C(mz, cx(0), cy(0), 7, 'sv-agent');

      // summary
      T(root, 20, 248, 'SUMMARY', 'sv-label');
      const rows = [['verifier calls', '0'], ['violations caught', '0'], ['main stream waited', '0 ms'], ['answer', 'pending']];
      L.sum = rows.map(([k, v], i) => {
        const y = 268 + i * 17;
        T(root, 20, y, k, 'sv-sum-k');
        return T(root, 194, y, v, 'sv-sum-v' + (i === 2 ? ' good' : ''), { 'text-anchor': 'end' });
      });

      // lane A
      T(root, 236, 30, 'REASONING MODEL', 'sv-label');
      T(root, 378, 30, 'one trajectory, streaming', 'sv-cap');
      R(root, 236, 40, 352, 34, 'sv-lane', { rx: 8 });
      L.forkG = G(root);
      L.blockG = G(root);

      // lane B
      T(root, 236, 160, 'FORKED EXTRACTOR → VERIFIER', 'sv-label');
      T(root, 482, 160, 'runs in parallel', 'sv-cap');
      R(root, 236, 168, 352, 36, 'sv-lane', { rx: 8 });
      L.chipG = G(root);

      // log
      T(root, 236, 232, 'VERIFIER LOG', 'sv-label');
      R(root, 236, 240, 352, 82, 'sv-console', { rx: 8 });
      L.logG = G(root);
      L.flyG = G(root);
    }

    function addLog(left, right, cls) {
      const g = G(L.logG);
      T(g, 248, 0, left, 'sv-log');
      const r = T(g, 578, 0, right || '', 'sv-log-r ' + (cls || ''), { 'text-anchor': 'end' });
      L.log.push(g);
      if (L.log.length > 4) L.log.shift().remove();
      L.log.forEach((n, i) => n.setAttribute('transform', `translate(0,${259 + i * 17})`));
      fadeIn(g, S.instant);
      return { set(text, c) { r.textContent = text; r.setAttribute('class', 'sv-log-r ' + c); } };
    }

    async function moveAgent(to, ms) {
      const [r0, c0] = [L.agentR, L.agentC];
      const [r1, c1] = to;
      await S.tween(ms || 240, p => {
        L.agent.setAttribute('cx', cx(c0) + (cx(c1) - cx(c0)) * p);
        L.agent.setAttribute('cy', cy(r0) + (cy(r1) - cy(r0)) * p);
      });
      L.agentR = r1; L.agentC = c1;
    }

    async function emit(kind, arrow, spec) {
      const x = L.cursor;
      const w = kind === 'fb' ? 54 : BW;
      const g = G(L.blockG, { class: 'v-fade' });
      const rect = R(g, x, AY, w, AH, 'sv-blk sv-blk-' + kind, { rx: 4 });
      if (kind === 'think') {
        Ln(g, x + 3.5, AY + 8, x + w - 3.5, AY + 8, 'sv-blk-line');
        Ln(g, x + 3.5, AY + 13, x + w - 5.5, AY + 13, 'sv-blk-line');
      }
      if (arrow) T(g, x + w / 2, AY + 15.5, arrow, 'sv-blk-txt', { 'text-anchor': 'middle' });
      if (kind === 'fb') T(g, x + w / 2, AY + 15, 'Wait…', 'sv-blk-fbtxt', { 'text-anchor': 'middle' });
      fadeIn(g, S.instant);
      L.cursor += w + GAP;
      const b = { g, rect, x, w, kind };
      L.blocks.push(b);
      if (arrow) {
        const [r, c] = L.pos;
        const [dr, dc] = DIR[arrow];
        const nr = r + dr, nc = c + dc;
        const seg = Ln(L.pathG, cx(c), cy(r), cx(c), cy(r), 'sv-path' + (spec ? ' spec' : ''));
        L.agentR = r; L.agentC = c;
        await S.tween(260, p => {
          seg.setAttribute('x2', cx(c) + (cx(nc) - cx(c)) * p);
          seg.setAttribute('y2', cy(r) + (cy(nr) - cy(r)) * p);
          L.agent.setAttribute('cx', cx(c) + (cx(nc) - cx(c)) * p);
          L.agent.setAttribute('cy', cy(r) + (cy(nr) - cy(r)) * p);
        });
        L.agentR = nr; L.agentC = nc;
        L.pos = [nr, nc];
        b.seg = seg;
        L.trail.push({ seg, spec: !!spec });
      }
      await S.wait(arrow ? 200 : 330);
      return b;
    }

    async function fork(n, state, ok, result) {
      const x = L.cursor - GAP / 2;
      L.calls++;
      L.sum[0].textContent = String(L.calls);
      const path = P(L.forkG, `M${x},74 C${x},118 ${x},132 ${x},${CHIP_Y}`, 'sv-fork v-fade');
      fadeIn(path, S.instant);
      const chip = G(L.chipG, { class: 'v-fade' });
      const cr = R(chip, x - 15, CHIP_Y, 30, 26, 'sv-chip', { rx: 7 });
      const ct = T(chip, x, CHIP_Y + 17.5, '···', 'sv-chip-txt', { 'text-anchor': 'middle' });
      fadeIn(chip, S.instant);
      cr.classList.add('pending');
      const line = addLog(`fork #${n}  ${state}`, 'checking…', 'pending');
      await S.wait(1150);
      cr.classList.remove('pending');
      cr.classList.add(ok ? 'ok' : 'bad');
      ct.textContent = ok ? '✓' : '✗';
      ct.classList.add(ok ? 'ok' : 'bad');
      line.set(ok ? '✓ ' + (result || 'valid') : '✗ ' + result, ok ? 'ok' : 'bad');
      return { x, chip };
    }

    async function rewind() {
      const spec = L.blocks.splice(L.specFrom);
      spec.forEach(b => b.rect.classList.add('sv-blk-discard'));
      const specSegs = L.trail.filter(t => t.spec);
      specSegs.forEach(t => t.seg.classList.add('discard'));
      const cut = Ln(L.blockG, L.forkPoint - GAP / 2, AY - 4, L.forkPoint - GAP / 2, AY + AH + 4, 'sv-cut');
      fadeIn(cut, S.instant);
      await S.wait(650);
      spec.forEach(b => { b.g.style.opacity = 0; });
      specSegs.forEach(t => { t.seg.style.opacity = 0; });
      await moveAgent([2, 3], 220);
      await moveAgent([2, 2], 220);
      L.pos = [2, 2];
      await S.wait(350);
      spec.forEach(b => b.g.remove());
      cut.remove();
      L.cursor = L.forkPoint;

      // feedback travels from the verifier chip up to the fork point
      const fx = L.f3.x;
      const fly = G(L.flyG);
      R(fly, fx - 27, CHIP_Y + 2, 54, 22, 'sv-blk sv-blk-fb', { rx: 4 });
      T(fly, fx, CHIP_Y + 17, 'Wait…', 'sv-blk-fbtxt', { 'text-anchor': 'middle' });
      const tx = (L.cursor + 27) - fx;
      const ty = AY - (CHIP_Y + 2);
      await S.tween(750, p => fly.setAttribute('transform', `translate(${tx * p},${ty * p})`));
      fly.remove();
      await emit('fb');
      addLog('steer   inject "Wait, move 5 hits a wall…"', '', 'warn');
      await S.wait(500);
    }

    async function finish() {
      await emit('think');
      await emit('move', '↓');
      await emit('move', '→');
      const f4 = fork(4, 'moves=[↓↓→→ ↓→]', true);
      await emit('move', '→');
      await emit('move', '↓');
      await f4;
      await fork(5, 'reached ★', true, 'answer released');
      L.goal.classList.add('reached');
      L.agent.classList.add('done');
      L.sum[3].textContent = '✓ released';
      L.sum[3].classList.add('good');
    }

    const steps = [
      {
        title: 'Reason',
        text: 'A reasoning model solves a maze in a <b>single trajectory</b>. Each block is one reasoning step.',
        run: async () => { await emit('think'); await emit('move', '↓'); await emit('think'); await emit('move', '↓'); }
      },
      {
        title: 'Fork &amp; extract',
        text: 'Every few steps a <b>forked</b> copy of the model extracts verifiable state from the trace: the moves so far.',
        run: async () => {
          const f = fork(1, 'moves=[↓↓]', true);
          await emit('think'); await emit('move', '→'); await emit('move', '→');
          await f;
        }
      },
      {
        title: 'Verify in parallel',
        text: 'Code verifiers check that state <b>asynchronously</b>, so generation never waits for a ✓.',
        run: async () => {
          const f = fork(2, 'moves=[↓↓→→]', true);
          await emit('think');
          L.badBlock = await emit('move', '→');
          await f;
        }
      },
      {
        title: 'Catch a violation',
        text: 'Move 5 walks through a wall. The verifier returns <b>✗</b> while speculative steps are still streaming.',
        run: async () => {
          L.forkPoint = L.cursor;
          L.specFrom = L.blocks.length;
          const f = fork(3, 'moves=[↓↓→→→]', false, 'move 5 hits a wall');
          await emit('think'); await emit('move', '↓', true); await emit('think');
          L.f3 = await f;
          L.viol++;
          L.sum[1].textContent = String(L.viol);
          L.sum[1].classList.add('bad');
          L.badBlock.rect.classList.add('sv-blk-bad');
          L.badBlock.seg.classList.add('bad');
          L.walls.v22.classList.add('bad');
          const xm = T(L.marks, M.x + M.c * 3, cy(2) + 4.5, '✗', 'sv-xmark', { 'text-anchor': 'middle' });
          fadeIn(xm, S.instant);
          await S.wait(700);
        }
      },
      {
        title: 'Rewind &amp; steer',
        text: 'Tokens after the fork point are <b>discarded</b> and the verifier’s feedback is injected into the trace: “Wait, that move hits a wall.”',
        run: rewind
      },
      {
        title: 'Sound answer',
        text: 'The model reaches ★. An answer is released <b>only if every verifier passes</b>; otherwise the system abstains.',
        run: finish
      }
    ];

    S = new Story(panel, { steps, reset, hold: 4200 });
    return S;
  }

  /* ---------- interwhen charts ---------- */
  function dumbbellChart(host) {
    const data = [
      { m: 'Qwen3-30B-A3B', sub: 'thinking', base: 32.17, iw: 87.70, tok: '96.9% of CoT tokens' },
      { m: 'GPT-5.4 mini', sub: '', base: 47.4, iw: 82.5 },
      { m: 'Claude Haiku 4.5', sub: '', base: 20.2, iw: 65.8 }
    ];
    host.innerHTML = `
      <p class="chart-title">τ²-bench Telecom (solo): task reward</p>
      <p class="chart-sub">Same model, no finetuning. interwhen adds verifiers synthesized from the domain policy.</p>
      <div class="chart-legend"><span><i class="lg-dot lg-base"></i>Chain-of-thought baseline</span><span><i class="lg-dot lg-iw"></i>interwhen (policy + trace + prompt verifiers)</span></div>`;
    const W = 560, top = 18, rowH = 50, H = top + data.length * rowH + 26;
    const x0 = 150, x1 = 520;
    const sx = v => x0 + (v / 100) * (x1 - x0);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Dumbbell chart of task reward with and without interwhen for three models' }, host);
    [0, 25, 50, 75, 100].forEach(v => {
      Ln(svg, sx(v), top - 6, sx(v), H - 22, 'sv-gridline');
      T(svg, sx(v), H - 6, v + '%', 'sv-axis', { 'text-anchor': 'middle' });
    });
    data.forEach((d, i) => {
      const y = top + i * rowH + rowH / 2 - 4;
      T(svg, 0, y - 2, d.m, 'sv-row-label');
      T(svg, 0, y + 14, `+${(d.iw - d.base).toFixed(1)} pp`, 'sv-row-delta');
      Ln(svg, sx(d.base), y, sx(d.iw), y, 'sv-dumb-line');
      C(svg, sx(d.base), y, 6, 'sv-dot-base');
      C(svg, sx(d.iw), y, 7, 'sv-dot-iw');
      T(svg, sx(d.base) - 11, y + 4, d.base.toFixed(1), 'sv-val', { 'text-anchor': 'end' });
      T(svg, sx(d.iw) + 11, y + 4, d.iw.toFixed(1), 'sv-val strong');
      const hb = C(svg, sx(d.base), y, 15, 'sv-hit');
      const hi = C(svg, sx(d.iw), y, 15, 'sv-hit');
      hoverTip(hb, `<b>${d.m}</b><br>Chain-of-thought: ${d.base.toFixed(1)}%`);
      hoverTip(hi, `<b>${d.m}</b><br>interwhen: ${d.iw.toFixed(1)}% <span class="tt-k">(+${(d.iw - d.base).toFixed(1)} pp)</span>${d.tok ? '<br><span class="tt-k">' + d.tok + '</span>' : ''}`);
    });
    const foot = document.createElement('div');
    foot.innerHTML = `<p class="chart-foot">Source: Table 1 of the paper. Similar gains on Agent-SafetyBench (safety 48.8% → 72.3%) and VitaBench.</p>
      <details><summary>Show as table</summary><table><thead><tr><th>Model</th><th class="num">CoT</th><th class="num">interwhen</th></tr></thead><tbody>
      ${data.map(d => `<tr><td>${d.m}</td><td class="num">${d.base.toFixed(1)}%</td><td class="num">${d.iw.toFixed(1)}%</td></tr>`).join('')}
      </tbody></table></details>`;
    host.appendChild(foot);
  }

  function costChart(host) {
    const METHODS = ['Chain-of-thought', 'Generate & Test', 'Best-of-4', 'Tree of Thoughts', 'interwhen', 'interwhen-GT-4'];
    const OURS = new Set([4, 5]);
    const DATA = {
      'ZebraLogic-XL': [[79.2, 100], [82.3, 91.9], [70.8, 406], [1.2, 880.3], [90.6, 103.2], [99.48, 116.6]],
      'ZebraLogic': [[95.5, 100], [95.9, 102.7], [93.9, 413], [17.2, 861.1], [97.9, 108.9], [99.9, 112.0]],
      'Maze': [[88.5, 100], [88.9, 119.7], [88.6, 399], [90.3, 746.2], [97.73, 133.1], [97.93, 133.36]],
      'SpatialMap': [[74.7, 100], [73.9, 111.8], [74.9, 399], [75.6, 672.5], [84.73, 152.9], [85.33, 154.46]],
      'Game of 24': [[95.0, 100], [96.1, 116.3], [97.4, 400], [95.0, 936.5], [97.2, 61.6], [99.49, 68.96]],
      'VERINA-Code': [[56.1, 100], [53.4, 111.4], [56.6, 400], [51.9, 1681.5], [71.6, 133.9], [76.54, 226.24]],
      'VERINA-Spec': [[25.4, 100], [25.9, 112.8], [27.0, 400], [29.6, 1825.4], [37.0, 126.9], [42.33, 279.18]]
    };
    host.innerHTML = `
      <p class="chart-title">Accuracy vs. token cost (Qwen3-30B-A3B)</p>
      <p class="chart-sub">Sampling more (Best-of-N) or searching (ToT) costs 4–18× the tokens and barely helps. Verification does.</p>
      <div class="chart-filter" role="group" aria-label="Benchmark"></div>
      <div class="chart-legend"><span><i class="lg-sq lg-ours"></i>interwhen (ours)</span><span><i class="lg-sq lg-basebar"></i>baselines</span></div>
      <div class="chart-svg"></div>
      <p class="chart-foot">Source: Table 2 of the paper. Generate &amp; Test and Best-of-4 use an LLM critic; tokens include verifier and critic tokens, relative to chain-of-thought.</p>
      <details><summary>Show as table</summary><table><thead><tr><th>Method</th><th class="num">Accuracy</th><th class="num">Tokens (× CoT)</th></tr></thead><tbody></tbody></table></details>`;
    const filter = host.querySelector('.chart-filter');
    const svgHost = host.querySelector('.chart-svg');
    const tbody = host.querySelector('tbody');
    const bar = (p, x, y, w, h, cls) => {
      const r = Math.min(4, w / 2, h / 2);
      return P(p, `M${x},${y} h${Math.max(0, w - r)} a${r},${r} 0 0 1 ${r},${r} v${h - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-Math.max(0, w - r)} z`, cls);
    };
    function render(name) {
      const rows = DATA[name];
      clear(svgHost);
      const W = 560, top = 26, rowH = 27, H = top + rows.length * rowH + 22;
      const a0 = 142, a1 = 308, t0 = 362, t1 = 516;
      const maxTok = Math.max(...rows.map(r => r[1])) / 100;
      const tMax = [2, 5, 10, 20].find(v => v >= maxTok) || Math.ceil(maxTok);
      const sa = v => a0 + (v / 100) * (a1 - a0);
      const st = v => t0 + (v / tMax) * (t1 - t0);
      const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Accuracy and token cost on ${name}` }, svgHost);
      T(svg, a0, 12, 'Accuracy (%)  ↑ better', 'sv-panel-title');
      T(svg, t0, 12, 'Tokens (× CoT)  ↓ better', 'sv-panel-title');
      [0, 50, 100].forEach(v => {
        Ln(svg, sa(v), top - 4, sa(v), H - 18, 'sv-gridline');
        T(svg, sa(v), H - 4, String(v), 'sv-axis', { 'text-anchor': 'middle' });
      });
      [0, tMax / 2, tMax].forEach(v => {
        Ln(svg, st(v), top - 4, st(v), H - 18, 'sv-gridline');
        T(svg, st(v), H - 4, v + '×', 'sv-axis', { 'text-anchor': 'middle' });
      });
      Ln(svg, st(1), top - 4, st(1), H - 18, 'sv-refline');
      rows.forEach((r, i) => {
        const y = top + i * rowH;
        const ours = OURS.has(i);
        T(svg, a0 - 10, y + 12, METHODS[i], 'sv-row-label small' + (ours ? ' strong' : ''), { 'text-anchor': 'end' });
        bar(svg, a0, y + 2, Math.max(1.5, sa(r[0]) - a0), 15, ours ? 'sv-bar-ours' : 'sv-bar-base');
        T(svg, sa(r[0]) + 5, y + 13.5, r[0].toFixed(1), 'sv-val' + (ours ? ' strong' : ''));
        const tw = Math.max(1.5, st(r[1] / 100) - t0);
        bar(svg, t0, y + 2, tw, 15, ours ? 'sv-bar-ours' : 'sv-bar-base');
        T(svg, t0 + tw + 5, y + 13.5, (r[1] / 100).toFixed(r[1] >= 1000 ? 1 : 2).replace(/0$/, '') + '×', 'sv-val' + (ours ? ' strong' : ''));
        const hit = R(svg, 0, y, W, rowH, 'sv-hit');
        hoverTip(hit, `<b>${METHODS[i]}</b> · ${name}<br>Accuracy ${r[0].toFixed(1)}%<br><span class="tt-k">Tokens ${(r[1] / 100).toFixed(2)}× CoT</span>`);
      });
      tbody.innerHTML = rows.map((r, i) => `<tr><td>${METHODS[i]}</td><td class="num">${r[0].toFixed(1)}%</td><td class="num">${(r[1] / 100).toFixed(2)}×</td></tr>`).join('');
    }
    Object.keys(DATA).forEach((name, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = name;
      b.setAttribute('aria-pressed', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => {
        filter.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        render(name);
      });
      filter.appendChild(b);
    });
    render('ZebraLogic-XL');
  }

  /* =========================================================
     Genesis: PAG → LLM-oriented, explainable causal graph
     ========================================================= */
  function genesis(panel) {
    const root = panel.querySelector('svg');
    const N = {
      asia: [72, 52, 'Visit to Asia'], smoke: [300, 52, 'Smoking'],
      tub: [72, 142, 'Tuberculosis'], lung: [222, 142, 'Lung cancer'], bronc: [354, 142, 'Bronchitis'],
      either: [150, 226, 'TB or cancer'], xray: [72, 302, 'X-ray'], dysp: [292, 302, 'Dyspnea']
    };
    const E = [
      { a: 'smoke', b: 'lung', pag: ['o', 'o'], g: 0, why: 'Smoking is an established cause of lung cancer, not the other way round.' },
      { a: 'smoke', b: 'bronc', pag: ['o', 'o'], g: 1, why: 'Tobacco smoke inflames the airways and causes bronchitis.' },
      { a: 'asia', b: 'tub', pag: ['o', 'o'], g: 2, why: 'Visiting Asia raises exposure to TB; an illness cannot cause past travel.' },
      { a: 'tub', b: 'either', pag: ['o', '>'], g: 3, why: '“TB or cancer” is defined by its two causes, so both point into it.' },
      { a: 'lung', b: 'either', pag: ['o', '>'], g: 3, why: '“TB or cancer” is defined by its two causes, so both point into it.' },
      { a: 'either', b: 'xray', pag: ['o', '>'], g: 4, why: 'A lung condition shows up on an X-ray; the X-ray does not cause disease.' },
      { a: 'either', b: 'dysp', pag: ['o', '>'], g: 5, why: 'Lung disease and bronchitis both cause shortness of breath.' },
      { a: 'bronc', b: 'dysp', pag: ['o', '>'], g: 5, why: 'Lung disease and bronchitis both cause shortness of breath.' }
    ];
    const hw = k => (N[k][2].length * 6.5 + 22) / 2;
    const HH = 13;
    let S, L;

    function endpoint(from, to) {
      const [x0, y0] = N[from], [x1, y1] = N[to];
      const dx = x1 - x0, dy = y1 - y0;
      const t = Math.min(hw(to) / Math.abs(dx || 1e-6), HH / Math.abs(dy || 1e-6));
      const len = Math.hypot(dx, dy);
      return { x: x1 - dx * t - (dx / len) * 2, y: y1 - dy * t - (dy / len) * 2, ux: dx / len, uy: dy / len };
    }
    function drawEdge(e, marks, state) {
      clear(e.gEl);
      const pa = endpoint(e.b, e.a); // point at a, pointing into a
      const pb = endpoint(e.a, e.b); // point at b
      const trim = m => (m === 'o' ? 9 : m === '>' ? 8 : 0);
      const ax = pa.x - pa.ux * trim(marks[0]), ay = pa.y - pa.uy * trim(marks[0]);
      const bx = pb.x - pb.ux * trim(marks[1]), by = pb.y - pb.uy * trim(marks[1]);
      Ln(e.gEl, ax, ay, bx, by, 'sv-edge ' + state);
      [[marks[0], pa], [marks[1], pb]].forEach(([m, p]) => {
        if (m === 'o') C(e.gEl, p.x - p.ux * 4.6, p.y - p.uy * 4.6, 4.2, 'sv-circ ' + state);
        if (m === '>') {
          const nx = -p.uy, ny = p.ux;
          const bx2 = p.x - p.ux * 9.5, by2 = p.y - p.uy * 9.5;
          P(e.gEl, `M${p.x},${p.y} L${bx2 + nx * 4.6},${by2 + ny * 4.6} L${bx2 - nx * 4.6},${by2 - ny * 4.6} Z`, 'sv-arrow ' + state);
        }
      });
    }

    function reset() {
      clear(root);
      L = { resolved: 0 };
      T(root, 20, 22, 'ASIA BENCHMARK', 'sv-label');
      L.edgeG = G(root);
      L.hitG = G(root);
      L.nodeG = G(root);
      E.forEach(e => { e.gEl = G(L.edgeG, { class: 'v-fade' }); e.gEl.style.opacity = 0; e.done = false; });
      Object.keys(N).forEach(k => {
        const [x, y, label] = N[k];
        const g = G(L.nodeG, { class: 'v-fade' });
        R(g, x - hw(k), y - HH, hw(k) * 2, HH * 2, 'sv-node', { rx: 13 });
        T(g, x, y + 4.2, label, 'sv-node-txt', { 'text-anchor': 'middle' });
        g.style.opacity = 0;
        N[k].el = g;
      });
      // panel
      const px = 414;
      R(root, px, 14, 174, 300, 'sv-panel', { rx: 10 });
      T(root, px + 12, 34, 'LLM-GUIDED SEARCH', 'sv-label nohalo');
      L.pEdge = G(root);
      L.pWhy = G(root);
      Ln(root, px + 12, 222, px + 162, 222, 'sv-gridline');
      T(root, px + 12, 244, 'edges explained', 'sv-sum-k');
      L.pCount = T(root, px + 162, 244, '0 / 8', 'sv-sum-v', { 'text-anchor': 'end' });
      R(root, px + 12, 254, 150, 6, 'sv-meter-track', { rx: 3 });
      L.pBar = R(root, px + 12, 254, 0, 6, 'sv-meter-fill', { rx: 3 });
      L.pHint = multiline(root, px + 12, 284, ['Waiting for the data-driven', 'graph…'], 14, 'sv-cap nohalo');
      // hit targets
      E.forEach(e => {
        const [x0, y0] = N[e.a], [x1, y1] = N[e.b];
        const hit = Ln(L.hitG, x0, y0, x1, y1, 'sv-hit-line');
        hoverTip(hit, () => e.done
          ? `<b>${N[e.a][2]} → ${N[e.b][2]}</b><br>${e.why}`
          : `<b>${N[e.a][2]} – ${N[e.b][2]}</b><br><span class="tt-k">Not yet oriented by the LLM</span>`);
      });
    }

    function setPanel(edgeText, why) {
      clear(L.pEdge);
      clear(L.pWhy);
      const lines = wrap(edgeText, 21);
      multiline(L.pEdge, 426, 60, lines, 17, 'sv-panel-edge');
      const t = multiline(L.pWhy, 426, 60 + lines.length * 17 + 10, wrap(why, 25), 16, 'sv-panel-why');
      fadeIn(t, S.instant);
    }

    const steps = [
      {
        title: 'Observe',
        text: 'Eight variables from the classic <b>Asia</b> benchmark. The goal is to recover their causal graph.',
        run: async () => {
          for (const k of Object.keys(N)) { fadeIn(N[k].el, S.instant); await S.wait(110); }
          await S.wait(500);
        }
      },
      {
        title: 'Skeleton from data',
        text: 'Conditional-independence tests on the data find which variables are <b>directly linked</b>.',
        run: async () => {
          for (const e of E) { drawEdge(e, ['-', '-'], 'faint'); fadeIn(e.gEl, S.instant); await S.wait(140); }
          L.pHint.remove();
          L.pHint = multiline(root, 426, 284, ['Links found. Directions', 'still unknown.'], 14, 'sv-cap nohalo');
          await S.wait(600);
        }
      },
      {
        title: 'Partial ancestral graph',
        text: 'Data alone orients a few edge marks (colliders). The rest stay <b>ambiguous (○)</b>.',
        run: async () => {
          for (const e of E) { drawEdge(e, e.pag, 'amb'); await S.wait(110); }
          L.pHint.remove();
          L.pHint = multiline(root, 426, 284, ['○ = data cannot decide', 'this end of the edge'], 14, 'sv-cap nohalo');
          await S.wait(1100);
        }
      },
      {
        title: 'LLM-guided search',
        text: 'Each ambiguous mark is resolved by an LLM that writes down <b>why</b>, so every decision can be checked.',
        run: async () => {
          L.pHint.remove();
          L.pHint = G(root);
          for (let g = 0; g <= 5; g++) {
            const grp = E.filter(e => e.g === g);
            grp.forEach(e => drawEdge(e, e.pag, 'active'));
            const label = grp.length > 1
              ? `${grp.map(e => N[e.a][2]).join(', ')} → ${N[grp[0].b][2]}`
              : `${N[grp[0].a][2]} → ${N[grp[0].b][2]}`;
            setPanel(label, grp[0].why);
            await S.wait(1500);
            grp.forEach(e => { e.done = true; drawEdge(e, ['-', '>'], 'solid'); });
            L.resolved += grp.length;
            L.pCount.textContent = `${L.resolved} / 8`;
            const w0 = +L.pBar.getAttribute('width');
            const w1 = 150 * L.resolved / 8;
            await S.tween(300, p => L.pBar.setAttribute('width', w0 + (w1 - w0) * p));
            await S.wait(250);
          }
        }
      },
      {
        title: 'Explainable graph',
        text: 'The full causal graph, with a <b>reason attached to every edge</b>. Hover over an edge to read it.',
        run: async () => {
          setPanel('All edges oriented', 'Hover over any edge in the graph to read the rationale behind its direction.');
          await S.wait(800);
        }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 5200 });
    return S;
  }

  /* =========================================================
     Muon GNN: hits → graph → message passing → pT
     ========================================================= */
  function muon(panel) {
    const root = panel.querySelector('svg');
    const IP = [42, 172];
    const ST = [176, 254, 332, 410];
    const TRACKS = [
      { k: 0.00072, pt: 9, label: 'low pT' },
      { k: 0.00017, pt: 47, label: 'high pT' }
    ];
    const rnd = mulberry32(11);
    const noise = ST.map(() => [0, 1, 2].map(() => 50 + rnd() * 240));
    let S, L;
    const yAt = (k, x) => IP[1] - k * (x - IP[0]) ** 2;

    function reset() {
      clear(root);
      L = { nodes: [], edges: [], ghost: null };
      T(root, 20, 24, 'CMS ENDCAP MUON STATIONS', 'sv-label');
      ST.forEach((x, i) => {
        R(root, x - 6, 40, 12, 262, 'sv-station', { rx: 3 });
        T(root, x, 318, 'ME' + (i + 1), 'sv-axis', { 'text-anchor': 'middle' });
        noise[i].forEach(y => C(root, x, y, 2.4, 'sv-noise'));
      });
      L.burst = G(root);
      C(L.burst, IP[0], IP[1], 5, 'sv-ip');
      T(root, IP[0], IP[1] + 24, 'collision', 'sv-cap', { 'text-anchor': 'middle' });
      L.ghostG = G(root);
      L.trackG = G(root);
      L.edgeG = G(root);
      L.msgG = G(root);
      L.nodeG = G(root);
      L.readG = G(root);
      // readout area
      T(root, 456, 24, 'READOUT', 'sv-label');
      L.pool = C(root, 520, 140, 11, 'sv-pool');
      L.pool.style.opacity = 0;
      L.ptText = T(root, 520, 194, '', 'sv-pt', { 'text-anchor': 'middle' });
      R(root, 458, 214, 124, 7, 'sv-meter-track', { rx: 3.5 });
      L.meter = R(root, 458, 214, 0, 7, 'sv-meter-fill', { rx: 3.5 });
      T(root, 458, 236, '0', 'sv-axis');
      T(root, 582, 236, '60 GeV', 'sv-axis', { 'text-anchor': 'end' });
      L.ptHint = T(root, 520, 262, '', 'sv-cap', { 'text-anchor': 'middle' });
      L.trackIdx = 0;
    }

    async function drawTrack(tr, ghostPrev) {
      if (ghostPrev) {
        clear(L.ghostG);
        const prev = TRACKS[0];
        P(L.ghostG, trackPath(prev), 'sv-track ghost');
      }
      clear(L.trackG);
      const path = P(L.trackG, trackPath(tr), 'sv-track');
      const len = path.getTotalLength ? path.getTotalLength() : 420;
      path.style.strokeDasharray = len;
      path.style.strokeDashoffset = len;
      await S.tween(900, p => { path.style.strokeDashoffset = len * (1 - p); });
      L.track = path;
    }
    function trackPath(tr) {
      let d = `M${IP[0]},${IP[1]}`;
      for (let x = IP[0] + 8; x <= 440; x += 8) d += ` L${x},${yAt(tr.k, x).toFixed(1)}`;
      return d;
    }

    async function makeNodes(tr) {
      clear(L.nodeG); clear(L.edgeG); clear(L.msgG);
      L.nodes = ST.map((x, i) => {
        const y = yAt(tr.k, x);
        const g = G(L.nodeG, { class: 'v-fade' });
        const c = C(g, x, y, 7.5, 'sv-gnode');
        const feats = G(g);
        [0, 1, 2].forEach(j => {
          const h = 4 + ((i * 7 + j * 5) % 9);
          R(feats, x + 11 + j * 4.5, y - h / 2, 3, h, 'sv-feat', { rx: 1 });
        });
        fadeIn(g, S.instant);
        return { x, y, c, g, level: 0 };
      });
      await S.wait(300);
    }

    async function makeEdges() {
      const pairs = [];
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([i, j]);
      L.edges = pairs.map(([i, j]) => {
        const a = L.nodes[i], b = L.nodes[j];
        const ln = Ln(L.edgeG, a.x, a.y, b.x, b.y, 'sv-gedge' + (j === i + 1 ? '' : ' far'));
        fadeIn(ln, S.instant);
        return { a, b };
      });
      await S.wait(500);
    }

    async function passMessages(rounds) {
      for (let r = 0; r < rounds; r++) {
        clear(L.msgG);
        const dots = [];
        L.edges.forEach(e => {
          dots.push([C(L.msgG, e.a.x, e.a.y, 3.2, 'sv-msg'), e.a, e.b]);
          dots.push([C(L.msgG, e.b.x, e.b.y, 3.2, 'sv-msg'), e.b, e.a]);
        });
        await S.tween(750, p => {
          dots.forEach(([d, from, to]) => {
            d.setAttribute('cx', from.x + (to.x - from.x) * p);
            d.setAttribute('cy', from.y + (to.y - from.y) * p);
          });
        });
        clear(L.msgG);
        L.nodes.forEach(n => { n.level++; n.c.setAttribute('class', 'sv-gnode lv' + Math.min(2, n.level)); });
        await S.wait(220);
      }
    }

    function setPT(v) {
      clear(L.ptText);
      el('tspan', { text: 'p' }, L.ptText);
      el('tspan', { text: 'T', dy: 4, class: 'sv-sub' }, L.ptText);
      el('tspan', { text: ` ≈ ${v} GeV`, dy: -4 }, L.ptText);
    }
    async function readout(tr) {
      clear(L.readG);
      L.nodes.forEach(n => {
        const l = Ln(L.readG, n.x, n.y, 520, 140, 'sv-readline');
        fadeIn(l, S.instant);
      });
      L.pool.style.opacity = 1;
      await S.wait(350);
      const w0 = +L.meter.getAttribute('width');
      const w1 = 124 * Math.min(1, tr.pt / 60);
      await S.tween(900, p => {
        L.meter.setAttribute('width', w0 + (w1 - w0) * p);
        setPT(Math.round((w0 + (w1 - w0) * p) / 124 * 60));
      });
      setPT(tr.pt);
      L.ptHint.textContent = tr.pt < 20 ? 'curvier → lower pT' : 'straighter → higher pT';
    }

    const steps = [
      {
        title: 'A muon flies out',
        text: 'A muon from a collision <b>bends in the magnetic field</b> as it crosses four endcap muon stations, among background hits.',
        run: async () => { await drawTrack(TRACKS[0]); await S.wait(300); }
      },
      {
        title: 'Hits become nodes',
        text: 'Each station hit becomes a <b>node</b> with features such as position and bend angle (bars).',
        run: async () => { await makeNodes(TRACKS[0]); L.track.classList.add('faint'); await S.wait(500); }
      },
      {
        title: 'Build a graph',
        text: '<b>Edges</b> connect hits across stations so information can flow between them.',
        run: async () => { await makeEdges(); }
      },
      {
        title: 'Message passing',
        text: 'A custom <b>message-passing layer</b> lets each node aggregate its neighbours’ features, round after round.',
        run: async () => { await passMessages(2); }
      },
      {
        title: 'Readout',
        text: 'Node embeddings are pooled and regressed to the muon’s <b>transverse momentum</b> (p<sub>T</sub>).',
        run: async () => { await readout(TRACKS[0]); await S.wait(900); }
      },
      {
        title: 'Curvature ↔ momentum',
        text: 'A <b>straighter</b> track means higher p<sub>T</sub>. The GNN learns this mapping from the hit pattern alone.',
        run: async () => {
          clear(L.readG); clear(L.edgeG); clear(L.nodeG);
          L.pool.style.opacity = 0;
          L.ptHint.textContent = '';
          await drawTrack(TRACKS[1], true);
          await makeNodes(TRACKS[1]);
          L.track.classList.add('faint');
          await makeEdges();
          await passMessages(1);
          await readout(TRACKS[1]);
        }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 4200 });
    return S;
  }

  /* =========================================================
     Projects
     ========================================================= */

  /* Vesuvius: canvas ink reveal */
  function vesuvius(panel) {
    const canvas = panel.querySelector('canvas');
    const W = 360, H = 200;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr; canvas.height = H * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const off = draw => {
      const c = document.createElement('canvas');
      c.width = W * dpr; c.height = H * dpr;
      const x = c.getContext('2d');
      x.scale(dpr, dpr);
      draw(x);
      return c;
    };
    const rnd = mulberry32(42);
    const FONT = '"Times New Roman", "DejaVu Serif", Georgia, serif';
    const LINES = [['ΕΠΙΚΟΥΡΟΣ ΚΑΙ', 34, 86], ['ΤΩΝ ΦΙΛΩΝ', 34, 134]];
    const inkText = (x, color, blur, jitterSeed) => {
      const r = mulberry32(jitterSeed);
      x.fillStyle = color;
      x.textAlign = 'center';
      x.textBaseline = 'alphabetic';
      if ('filter' in x) x.filter = blur > 0 ? `blur(${blur}px)` : 'none';
      LINES.forEach(([str, size, y]) => {
        x.font = `600 ${size}px ${FONT}`;
        const total = x.measureText(str).width;
        let cx = W / 2 - total / 2;
        for (const ch of str) {
          const w = x.measureText(ch).width;
          x.save();
          x.translate(cx + w / 2, y + (r() - 0.5) * 3);
          x.rotate((r() - 0.5) * 0.08);
          x.fillText(ch, 0, 0);
          x.restore();
          cx += w;
        }
      });
      if ('filter' in x) x.filter = 'none';
    };
    const base = off(x => {
      x.fillStyle = '#2b2927';
      x.fillRect(0, 0, W, H);
      for (let i = 0; i < 520; i++) {
        const y = rnd() * H, x0 = rnd() * W, len = 20 + rnd() * 140;
        x.strokeStyle = `rgba(${200 + rnd() * 40},${190 + rnd() * 30},${170 + rnd() * 30},${0.02 + rnd() * 0.06})`;
        x.lineWidth = 0.5 + rnd() * 1.6;
        x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + len, y + (rnd() - 0.5) * 3); x.stroke();
      }
      for (let i = 0; i < 160; i++) {
        const x0 = rnd() * W, y0 = rnd() * H, len = 10 + rnd() * 60;
        x.strokeStyle = `rgba(220,210,190,${0.015 + rnd() * 0.04})`;
        x.lineWidth = 0.5 + rnd() * 1.2;
        x.beginPath(); x.moveTo(x0, y0); x.lineTo(x0 + (rnd() - 0.5) * 3, y0 + len); x.stroke();
      }
      for (let i = 0; i < 2600; i++) {
        const g = 120 + rnd() * 120;
        x.fillStyle = `rgba(${g},${g},${g},${rnd() * 0.08})`;
        x.fillRect(rnd() * W, rnd() * H, 1, 1);
      }
      inkText(x, 'rgba(255,255,255,0.035)', 0.8, 5);
      const grd = x.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, 230);
      grd.addColorStop(0, 'rgba(0,0,0,0)');
      grd.addColorStop(1, 'rgba(0,0,0,0.45)');
      x.fillStyle = grd;
      x.fillRect(0, 0, W, H);
    });
    const inkSoft = off(x => {
      inkText(x, 'rgba(255,170,70,0.85)', 3.4, 5);
      const r = mulberry32(9);
      for (let i = 0; i < 26; i++) {
        x.fillStyle = `rgba(255,170,70,${0.12 + r() * 0.25})`;
        if ('filter' in x) x.filter = 'blur(3px)';
        x.beginPath(); x.arc(r() * W, r() * H, 2 + r() * 5, 0, Math.PI * 2); x.fill();
      }
      if ('filter' in x) x.filter = 'none';
    });
    const inkSharp = off(x => inkText(x, 'rgba(255,190,90,1)', 0.5, 5));
    const COLS = 6, ROWS = 3, cw = W / COLS, ch = H / ROWS;
    let st, S;

    function chip(text, x, y) {
      ctx.font = `500 10px "JetBrains Mono", ui-monospace, monospace`;
      const w = ctx.measureText(text).width + 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      roundRect(x, y, w, 18, 5); ctx.fill();
      ctx.fillStyle = '#f2f1ec';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, x + 7, y + 9.5);
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    }
    function draw() {
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(base, 0, 0, W, H);
      if (st.dim) { ctx.fillStyle = `rgba(10,8,6,${st.dim})`; ctx.fillRect(0, 0, W, H); }
      st.cells.forEach(i => {
        const cx = (i % COLS) * cw, cy = Math.floor(i / COLS) * ch;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
        ctx.globalAlpha = 1 - st.sharp; ctx.drawImage(inkSoft, 0, 0, W, H);
        ctx.globalAlpha = st.sharp; ctx.drawImage(inkSharp, 0, 0, W, H);
        ctx.restore();
      });
      if (st.win != null) {
        const cx = (st.win % COLS) * cw, cy = Math.floor(st.win / COLS) * ch;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);
        ctx.fillStyle = 'rgba(255,255,255,0.08)';
        ctx.fillRect(cx + 1, cy + 1, cw - 2, ch - 2);
      }
      if (st.chip) chip(st.chip, 8, 8);
      if (st.chip2) chip(st.chip2, 8, H - 26);
    }
    function reset() {
      st = { cells: new Set(), win: null, sharp: 0, dim: 0, chip: 'INPUT · X-ray CT slice', chip2: null };
      draw();
    }
    const steps = [
      { title: 'CT slice', text: 'A 3D X-ray scan of a carbonized papyrus. The carbon ink is <b>invisible</b> to the eye.', run: async () => { draw(); await S.wait(1600); } },
      {
        title: 'Sliding U-Net', text: 'U-Nets predict <b>ink probability</b> patch by patch.',
        run: async () => {
          st.chip = 'U-Net · sliding window';
          for (let i = 0; i < COLS * ROWS; i++) { st.win = i; st.cells.add(i); draw(); await S.wait(170); }
          st.win = null; draw(); await S.wait(500);
        }
      },
      {
        title: 'Ensemble + TTA', text: 'Five backbones plus test-time augmentation <b>sharpen</b> the prediction and suppress false positives.',
        run: async () => {
          st.chip = 'ensemble ×5 backbones + TTA';
          await S.tween(1300, p => { st.sharp = p; st.dim = 0.35 * p; draw(); });
          await S.wait(400);
        }
      },
      {
        title: 'Letters emerge', text: 'Hidden Greek letters become readable. Leaderboard <b>F<sub>0.5</sub> = 0.74</b>, a Kaggle bronze medal.',
        run: async () => { st.chip = 'ink prediction'; st.chip2 = 'F0.5 = 0.74 · bronze'; draw(); await S.wait(1200); }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 3000 });
    document.addEventListener('themechange', () => draw());
    return S;
  }

  /* Q vs A agents */
  function qa(panel) {
    const root = panel.querySelector('svg');
    const ROUNDS = [
      { q: ['A is B’s father and C is A’s sister.', 'How is C related to B?'], a: 'C is B’s aunt.', ok: true },
      { q: ['Six friends sit around a round table.', 'Who sits directly opposite Meera?'], a: 'Ravi', ok: false },
      { q: ['All glips are tovs; no tov is a fen.', 'Can a glip be a fen?'], a: 'No, never.', ok: true }
    ];
    let S, L;
    function reset() {
      clear(root);
      L = { q: 0, a: 0 };
      L.round = T(root, 14, 20, 'ROUND 1', 'sv-label');
      L.score = T(root, 180, 20, 'Q 0 : 0 A', 'sv-score', { 'text-anchor': 'middle' });
      L.trophy = T(root, 346, 20, '★ 1st place', 'sv-trophy', { 'text-anchor': 'end' });
      L.trophy.style.opacity = 0;
      C(root, 32, 62, 16, 'sv-av-q'); T(root, 32, 67, 'Q', 'sv-av-txt', { 'text-anchor': 'middle' });
      T(root, 32, 92, 'Q-agent', 'sv-cap', { 'text-anchor': 'middle' });
      C(root, 328, 62, 16, 'sv-av-a'); T(root, 328, 67, 'A', 'sv-av-txt', { 'text-anchor': 'middle' });
      T(root, 328, 92, 'A-agent', 'sv-cap', { 'text-anchor': 'middle' });
      L.bubbles = G(root);
      // training loop
      T(root, 14, 136, 'TRAINING', 'sv-label');
      const pills = [['SFT', 70], ['GRPO', 180], ['Self-play', 290]];
      L.pills = pills.map(([t, x]) => {
        const g = G(root);
        R(g, x - 38, 146, 76, 22, 'sv-pill', { rx: 11 });
        T(g, x, 161, t, 'sv-pill-txt', { 'text-anchor': 'middle' });
        return g;
      });
      P(root, 'M110,157 L140,157', 'sv-flow');
      P(root, 'M220,157 L250,157', 'sv-flow');
      P(root, 'M136,153 l4,4 l-4,4 M246,153 l4,4 l-4,4', 'sv-flow');
      L.loop = P(root, 'M290,170 C290,192 70,192 70,170', 'sv-loop');
      P(root, 'M66,174 l4,-4 l4,4', 'sv-loop-head');
    }
    function bubble(lines, side) {
      const g = G(L.bubbles, { class: 'v-fade' });
      const w = Math.max(...lines.map(s => s.length)) * 5.25 + 20;
      const h = lines.length * 13 + 12;
      const x = side === 'q' ? 56 : 304 - w;
      const y = side === 'q' ? 40 : 86;
      R(g, x, y, w, h, side === 'q' ? 'sv-bub-q' : 'sv-bub-a', { rx: 9 });
      multiline(g, x + 10, y + 16, lines, 13, 'sv-bub-txt');
      fadeIn(g, S.instant);
      return { g, x, y, w, h };
    }
    function light(i) { L.pills.forEach((p, k) => p.classList.toggle('on', k === i)); }
    async function round(i, fast) {
      clear(L.bubbles);
      L.round.textContent = 'ROUND ' + (i + 1);
      const r = ROUNDS[i];
      bubble(r.q, 'q');
      await S.wait(fast ? 600 : 1300);
      const b = bubble([r.a], 'a');
      await S.wait(fast ? 400 : 700);
      const v = G(L.bubbles, { class: 'v-fade' });
      C(v, b.x - 14, b.y + b.h / 2, 9, r.ok ? 'sv-ok-dot' : 'sv-bad-dot');
      T(v, b.x - 14, b.y + b.h / 2 + 4, r.ok ? '✓' : '✗', 'sv-verdict', { 'text-anchor': 'middle' });
      fadeIn(v, S.instant);
      if (r.ok) L.a++; else L.q++;
      L.score.textContent = `Q ${L.q} : ${L.a} A`;
      await S.wait(fast ? 500 : 900);
    }
    const steps = [
      { title: 'Q-agent asks', text: 'The <b>Q-agent</b> writes a hard but valid puzzle for its opponent.', run: async () => { light(0); clear(L.bubbles); bubble(ROUNDS[0].q, 'q'); await S.wait(1500); } },
      {
        title: 'A-agent answers', text: 'The <b>A-agent</b> answers and a judge checks it. Both agents start from <b>SFT</b> on curated synthetic puzzles.',
        run: async () => {
          const b = bubble([ROUNDS[0].a], 'a');
          await S.wait(700);
          const v = G(L.bubbles, { class: 'v-fade' });
          C(v, b.x - 14, b.y + b.h / 2, 9, 'sv-ok-dot');
          T(v, b.x - 14, b.y + b.h / 2 + 4, '✓', 'sv-verdict', { 'text-anchor': 'middle' });
          fadeIn(v, S.instant);
          L.a++; L.score.textContent = `Q ${L.q} : ${L.a} A`;
          await S.wait(1200);
        }
      },
      { title: 'GRPO', text: 'Wins and losses become <b>rewards for GRPO</b>. Here the Q-agent stumps its opponent and scores.', run: async () => { light(1); await round(1); } },
      {
        title: 'Self-play', text: '<b>Self-play</b> pits the agents against each other round after round. The result was <b>1st place</b>.',
        run: async () => {
          light(2);
          L.loop.classList.add('on');
          await round(2, true);
          L.trophy.style.opacity = 1;
          await S.wait(1000);
        }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 3200 });
    return S;
  }

  /* PII tagging (HTML) */
  function pii(panel) {
    const stage = panel.querySelector('.pii-stage');
    const SEG = [
      ['Hi team, please ship the onboarding kit to ', null],
      ['Ananya Rao', 'NAME'], [' (', null], ['ananya.rao@example.com', 'EMAIL'], [', ', null],
      ['+1 555-0142', 'PHONE'], ['). Her portfolio is ', null], ['github.com/ananya-r', 'URL'],
      [' and her student ID is ', null], ['22CS1047', 'ID'], ['. Thanks, ', null], ['Rahul', 'NAME'], ['.', null]
    ];
    let S, toks;
    function reset() {
      stage.innerHTML = '';
      toks = [];
      const p = document.createElement('p');
      p.style.margin = '0';
      SEG.forEach(([text, type]) => {
        if (type) {
          const s = document.createElement('span');
          s.className = 'tok';
          s.dataset.t = type;
          s.textContent = text;
          const lab = document.createElement('span');
          lab.className = 'lab';
          lab.textContent = type;
          s.appendChild(lab);
          p.appendChild(s);
          toks.push(s);
        } else {
          text.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { p.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement('span');
            s.className = 'tok';
            s.textContent = part;
            p.appendChild(s);
            toks.push(s);
          });
        }
      });
      stage.appendChild(p);
      const meta = document.createElement('div');
      meta.className = 'pii-meta';
      meta.textContent = 'BERT · token classification';
      stage.appendChild(meta);
    }
    const steps = [
      { title: 'Raw text', text: 'Personal details hide among ordinary words.', run: async () => { await S.wait(1400); } },
      {
        title: 'Token scan', text: 'A finetuned <b>BERT</b> reads every token in context and flags PII spans.',
        run: async () => {
          for (const t of toks) {
            t.classList.add('scan');
            await S.wait(t.dataset.t ? 220 : 90);
            t.classList.remove('scan');
            if (t.dataset.t) t.classList.add('det');
          }
          await S.wait(400);
        }
      },
      {
        title: 'Classify spans', text: 'Each span gets a type: NAME, EMAIL, PHONE, URL, or ID. <b>F1 = 0.92</b>.',
        run: async () => {
          for (const t of toks.filter(t => t.dataset.t)) { t.classList.remove('det'); t.classList.add('pii'); await S.wait(380); }
          await S.wait(800);
        }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 3000 });
    return S;
  }

  /* ViT electron vs photon */
  function vit(panel) {
    const root = panel.querySelector('svg');
    const X0 = 14, Y0 = 26, CELL = 12;
    const EX = [
      { name: 'electron', cx: 3.4, cy: 3.9, sx: 1.55, sy: 1.0, p: [0.91, 0.09] },
      { name: 'photon', cx: 4.3, cy: 3.2, sx: 0.85, sy: 0.85, p: [0.12, 0.88] }
    ];
    let ex = 0, S, L;
    function energy(e, r, c) {
      const v = Math.exp(-(((c + 0.5 - e.cx) ** 2) / (2 * e.sx ** 2) + ((r + 0.5 - e.cy) ** 2) / (2 * e.sy ** 2)));
      const n = (Math.sin(r * 12.9898 + c * 78.233 + ex * 3.1) * 43758.5453) % 1;
      return Math.min(1, v + Math.abs(n) * 0.06);
    }
    const tokX = i => 36 + i * 18.6;
    const TOK_Y = 150, TOK_S = 14 / 24;
    function reset() {
      clear(root);
      const e = EX[ex];
      L = { patches: [] };
      T(root, 14, 16, 'CALORIMETER', 'sv-label');
      T(root, 140, 16, 'ENCODER', 'sv-label');
      T(root, 262, 16, 'OUTPUT', 'sv-label');
      // encoder box
      L.enc = G(root);
      R(L.enc, 140, 30, 108, 62, 'sv-enc', { rx: 9 });
      T(L.enc, 194, 57, 'Transformer', 'sv-enc-txt', { 'text-anchor': 'middle' });
      T(L.enc, 194, 73, 'self-attention × L', 'sv-cap nohalo', { 'text-anchor': 'middle' });
      L.enc.style.opacity = 0.35;
      // output bars
      L.out = G(root);
      [['e⁻', 0], ['γ', 1]].forEach(([lab, i]) => {
        const y = 40 + i * 26;
        T(L.out, 262, y + 9, lab, 'sv-out-lab');
        R(L.out, 280, y, 50, 11, 'sv-meter-track', { rx: 3 });
      });
      L.bars = [0, 1].map(i => R(L.out, 280, 40 + i * 26, 0, 11, i === 0 ? 'sv-bar-e' : 'sv-bar-g', { rx: 3 }));
      L.vals = [0, 1].map(i => T(L.out, 334, 40 + i * 26 + 9.5, '', 'sv-val small'));
      P(root, 'M112,74 L136,61', 'sv-flow');
      P(root, 'M250,61 L258,61', 'sv-flow');
      P(root, 'M190,102 l4,-4 l4,4 M254,57 l4,4 l-4,4 M131,60 l5,1 l-2.5,4.5', 'sv-flow');
      L.verdict = T(root, 304, 112, '', 'sv-verdict-txt', { 'text-anchor': 'middle' });
      // attention + tokens
      L.attG = G(root);
      L.cls = G(root, { class: 'v-fade' });
      R(L.cls, 14, TOK_Y, 14, 14, 'sv-cls', { rx: 3 });
      T(L.cls, 21, TOK_Y + 26, 'CLS', 'sv-tiny', { 'text-anchor': 'middle' });
      L.cls.style.opacity = 0;
      L.flow = P(root, 'M194,140 L194,98', 'sv-flow v-fade');
      L.flow.style.opacity = 0;
      R(root, X0 - 2, Y0 - 2, 100, 100, 'sv-ghostbox', { rx: 4 });
      // patches
      for (let pr = 0; pr < 4; pr++) for (let pc = 0; pc < 4; pc++) {
        const g = G(root);
        let sum = 0;
        for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) {
          const v = energy(e, pr * 2 + r, pc * 2 + c);
          sum += v;
          R(g, c * CELL, r * CELL, CELL - 0.6, CELL - 0.6, 'sv-cell', { style: `fill-opacity:${(0.06 + v * 0.94).toFixed(3)}` });
        }
        const home = [X0 + pc * 24, Y0 + pr * 24];
        g.setAttribute('transform', `translate(${home[0]},${home[1]})`);
        L.patches.push({ g, home, pr, pc, e: sum / 4, cur: [home[0], home[1], 1] });
      }
    }
    async function moveAll(target, ms) {
      const from = L.patches.map(p => p.cur.slice());
      await S.tween(ms, t => {
        L.patches.forEach((p, i) => {
          const to = target(p, i);
          const x = from[i][0] + (to[0] - from[i][0]) * t;
          const y = from[i][1] + (to[1] - from[i][1]) * t;
          const s = from[i][2] + (to[2] - from[i][2]) * t;
          p.g.setAttribute('transform', `translate(${x},${y}) scale(${s})`);
          p.cur = [x, y, s];
        });
      });
    }
    const steps = [
      { title: 'Calorimeter image', text: 'Energy deposits from a particle shower. <b>Darker = more energy.</b>', run: async () => { await S.wait(1300); } },
      { title: 'Patchify', text: 'The image is cut into <b>2×2 patches</b>.', run: async () => { await moveAll(p => [p.home[0] + (p.pc - 1.5) * 5, p.home[1] + (p.pr - 1.5) * 4, 1], 700); await S.wait(500); } },
      {
        title: 'Tokens', text: 'Patches are flattened into a sequence of <b>tokens</b>, and a [CLS] token is prepended.',
        run: async () => {
          fadeIn(L.cls, S.instant);
          await moveAll((p, i) => [tokX(i), TOK_Y, TOK_S], 1100);
          await S.wait(300);
        }
      },
      {
        title: 'Self-attention', text: '[CLS] <b>attends</b> to every patch, most strongly to the informative shower core.',
        run: async () => {
          L.enc.style.opacity = 1;
          L.patches.forEach((p, i) => {
            const x = tokX(i) + 7;
            const h = 14 + i * 1.6;
            const a = P(L.attG, `M21,${TOK_Y} C21,${TOK_Y - h} ${x},${TOK_Y - h} ${x},${TOK_Y}`, 'sv-att v-fade', { style: `stroke-opacity:${(0.08 + p.e * 0.9).toFixed(2)}` });
            fadeIn(a, S.instant);
          });
          fadeIn(L.flow, S.instant);
          await S.wait(1400);
        }
      },
      {
        title: 'Classify', text: 'The [CLS] embedding is classified as <b>electron vs. photon</b> (ROC-AUC 0.94 on the task).',
        run: async () => {
          const e = EX[ex];
          await S.tween(800, t => {
            L.bars.forEach((b, i) => b.setAttribute('width', 50 * e.p[i] * t));
            L.vals.forEach((v, i) => { v.textContent = (e.p[i] * t).toFixed(2); });
          });
          L.verdict.textContent = `→ ${e.name}`;
          await S.wait(1200);
        }
      }
    ];
    S = new Story(panel, { steps, reset, hold: 2600, cycle: () => { ex = (ex + 1) % EX.length; } });
    return S;
  }

  /* =========================================================
     Wire-up
     ========================================================= */
  const FACTORIES = { interwhen, genesis, muon, vesuvius, qa, pii, vit };
  const stories = new Map();

  document.querySelectorAll('.viz-frame[data-viz]').forEach(frame => {
    const make = FACTORIES[frame.dataset.viz];
    if (!make) return;
    const panel = frame.querySelector('.viz-panel');
    let story;
    try { story = make(panel); } catch (e) { console.error(e); return; }
    stories.set(frame, story);

    // tabs (interwhen)
    const tabs = frame.querySelectorAll('[role="tab"]');
    if (tabs.length) {
      const charts = { dumbbell: dumbbellChart, scatter: costChart };
      frame.querySelectorAll('[data-chart]').forEach(c => { try { charts[c.dataset.chart](c); } catch (e) { console.error(e); } });
      tabs.forEach(tab => tab.addEventListener('click', () => {
        tabs.forEach(t => t.setAttribute('aria-selected', String(t === tab)));
        frame.querySelectorAll('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
        story.tabHidden = tab.dataset.tab !== 'how';
        tip().hide();
      }));
    }
  });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const s = stories.get(entry.target);
        if (!s) return;
        s.offscreen = !entry.isIntersecting;
        if (entry.isIntersecting && !s.started) s.start();
      });
    }, { threshold: 0.3 });
    stories.forEach((s, frame) => io.observe(frame));
  } else {
    stories.forEach(s => { s.offscreen = false; s.start(); });
  }
})();

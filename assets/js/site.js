/* Site chrome: theme, nav, news, BibTeX, GitHub stars, experience Gantt, shared tooltip. */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  /* ---------- shared tooltip (also used by viz.js) ---------- */
  const tipEl = $('#tooltip');
  const tooltip = {
    show(html, x, y) {
      if (!tipEl) return;
      tipEl.innerHTML = html;
      tipEl.hidden = false;
      const pad = 12;
      const r = tipEl.getBoundingClientRect();
      let left = x + pad;
      let top = y + pad;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - pad;
      if (top + r.height > window.innerHeight - 8) top = y - r.height - pad;
      tipEl.style.left = Math.max(8, left) + 'px';
      tipEl.style.top = Math.max(8, top) + 'px';
    },
    hide() { if (tipEl) tipEl.hidden = true; }
  };
  window.Site = { tooltip };
  window.addEventListener('scroll', () => tooltip.hide(), { passive: true });

  /* ---------- theme ---------- */
  const root = document.documentElement;
  const themeBtn = $('#themeToggle');
  const isDark = () => {
    const t = root.getAttribute('data-theme');
    if (t) return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  };
  themeBtn && themeBtn.addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    try { localStorage.setItem('theme', next); } catch (e) {}
    document.dispatchEvent(new CustomEvent('themechange'));
  });

  /* ---------- top bar: border on scroll + active section ---------- */
  const topbar = $('#topbar');
  const onScroll = () => topbar && topbar.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const navLinks = $$('.nav-links a[href^="#"]');
  const sections = navLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const visible = new Map();
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0));
      let best = null, bestRatio = 0;
      visible.forEach((ratio, id) => { if (ratio > bestRatio) { best = id; bestRatio = ratio; } });
      navLinks.forEach(a => a.classList.toggle('active', best && a.getAttribute('href') === '#' + best));
    }, { rootMargin: '-60px 0px -45% 0px', threshold: [0, .1, .25, .5] });
    sections.forEach(s => io.observe(s));
  }

  /* ---------- news: show older ---------- */
  const newsList = $('#newsList');
  const newsBtn = $('#newsToggle');
  if (newsList && newsBtn) {
    const n = $$('.older', newsList).length;
    newsBtn.textContent = `Show older news (${n})`;
    newsBtn.addEventListener('click', () => {
      const open = newsList.classList.toggle('expanded');
      newsBtn.setAttribute('aria-expanded', String(open));
      newsBtn.textContent = open ? 'Show less' : `Show older news (${n})`;
    });
  }

  /* ---------- BibTeX toggle + copy ---------- */
  $$('.bib-toggle').forEach(btn => {
    const box = btn.closest('.paper-body').querySelector('.bibtex');
    btn.addEventListener('click', () => {
      box.hidden = !box.hidden;
      btn.setAttribute('aria-expanded', String(!box.hidden));
    });
  });
  $$('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const text = btn.parentElement.querySelector('code').textContent;
      try {
        await navigator.clipboard.writeText(text);
        btn.textContent = 'Copied';
      } catch (e) {
        btn.textContent = 'Select & copy';
      }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
    });
  });

  /* ---------- GitHub stars (progressive enhancement) ---------- */
  $$('.gh-stars[data-repo]').forEach(el => {
    const repo = el.dataset.repo;
    const key = 'stars:' + repo;
    const paint = n => { el.textContent = '★ ' + n; el.hidden = false; };
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
      if (cached) { paint(cached); return; }
    } catch (e) {}
    fetch('https://api.github.com/repos/' + repo)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d && typeof d.stargazers_count === 'number') {
          paint(d.stargazers_count);
          try { sessionStorage.setItem(key, JSON.stringify(d.stargazers_count)); } catch (e) {}
        }
      })
      .catch(() => {});
  });

  /* ---------- Experience Gantt ---------- */
  const gantt = $('#gantt');
  if (gantt) {
    const NOW = new Date(2026, 9, 31); // site "now" (last updated)
    const START = new Date(2023, 8, 1);
    const END = new Date(2026, 11, 31);
    const span = END - START;
    const pct = d => Math.max(0, Math.min(100, ((d - START) / span) * 100));
    const D = (y, m) => new Date(y, m - 1, 1);
    const endOf = (y, m) => new Date(y, m, 0);

    const rows = [
      { org: 'Microsoft Research', role: 'Research Intern → Research Fellow', logo: 'microsoft.png', from: D(2025, 11), to: NOW, label: 'Nov 2025 – Present', kind: 'research', target: 'xp-msr', ongoing: true },
      { org: 'Sony Research India', role: 'Research Intern', logo: 'sony.svg', from: D(2025, 6), to: endOf(2025, 11), label: 'Jun – Nov 2025', kind: 'research', target: 'xp-sony' },
      { org: 'Swiggy', role: 'Data Scientist Intern', logo: 'swiggy.png', from: D(2024, 8), to: endOf(2025, 5), label: 'Aug 2024 – May 2025', kind: 'industry', target: 'xp-swiggy' },
      { org: 'GSoC · ML4SCI', role: 'GSoC Contributor (CERN CMS)', logo: 'gsoc.png', from: D(2024, 4), to: endOf(2024, 9), label: 'Apr – Sep 2024', kind: 'research', target: 'xp-gsoc' },
      { org: 'NyunAI', role: 'Research Intern', logo: 'nyunai.png', from: D(2024, 5), to: endOf(2024, 6), label: 'May – Jun 2024', kind: 'research', target: 'xp-nyun' },
      { org: 'Bosch', role: 'Computer Vision Research Intern', logo: 'bosch.png', from: D(2024, 1), to: endOf(2024, 5), label: 'Jan – May 2024', kind: 'research', target: 'xp-bosch' },
      { org: 'UiT Bio-AI Lab', role: 'Research Intern', logo: 'uit.png', from: D(2023, 10), to: endOf(2023, 12), label: 'Oct – Dec 2023', kind: 'research', target: 'xp-uit' },
      { org: 'IIT (ISM) Dhanbad', role: 'Integrated M.Tech., Mathematics & Computing', logo: 'iitism.png', from: D(2021, 8), to: endOf(2026, 5), label: '2021 – May 2026', kind: 'edu', target: 'experience', clipped: true }
    ];

    const axis = document.createElement('div');
    axis.className = 'g-axis';
    [2024, 2025, 2026].forEach(y => {
      const t = document.createElement('div');
      t.className = 'g-tick';
      t.style.left = pct(new Date(y, 0, 1)) + '%';
      t.innerHTML = `<span>${y}</span>`;
      axis.appendChild(t);
    });
    const now = document.createElement('div');
    now.className = 'g-now';
    now.style.left = pct(NOW) + '%';
    now.innerHTML = '<span>now</span>';
    axis.appendChild(now);
    gantt.appendChild(axis);

    const goTo = id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1400);
    };

    rows.forEach(r => {
      const row = document.createElement('div');
      row.className = 'g-row';
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'g-label';
      label.innerHTML = `<img src="assets/img/logos/${r.logo}" alt=""><span>${r.org}</span>`;
      label.setAttribute('aria-label', `${r.org}, ${r.role}, ${r.label}`);
      label.addEventListener('click', () => goTo(r.target));

      const track = document.createElement('div');
      track.className = 'g-track';
      const bar = document.createElement('button');
      bar.type = 'button';
      bar.className = 'g-bar' + (r.kind === 'industry' ? ' industry' : '') + (r.kind === 'edu' ? ' g-edu' : '') +
        (r.ongoing ? ' ongoing' : '') + (r.clipped ? ' clipped' : '');
      const l = pct(r.from), w = Math.max(pct(r.to) - l, 1.2);
      bar.style.left = l + '%';
      bar.style.width = w + '%';
      bar.setAttribute('aria-label', `${r.org}: ${r.role}, ${r.label}`);
      const tip = `<b>${r.org}</b><br>${r.role}<br><span class="tt-k">${r.label}</span>`;
      bar.addEventListener('mousemove', e => tooltip.show(tip, e.clientX, e.clientY));
      bar.addEventListener('mouseleave', () => tooltip.hide());
      bar.addEventListener('focus', () => { const b = bar.getBoundingClientRect(); tooltip.show(tip, b.left + b.width / 2, b.bottom); });
      bar.addEventListener('blur', () => tooltip.hide());
      bar.addEventListener('click', () => goTo(r.target));
      track.appendChild(bar);
      row.append(label, track);
      gantt.appendChild(row);
    });
    const pad = document.createElement('div');
    pad.className = 'g-axis-pad';
    gantt.appendChild(pad);
  }
})();

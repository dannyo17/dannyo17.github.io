// Header border once you scroll
const header = document.querySelector('.top');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// Project filter
const filterBtns = document.querySelectorAll('.filter button');
const items = document.querySelectorAll('#projects [data-kind]');
const empty = document.querySelector('.filter-empty');
filterBtns.forEach(btn => btn.addEventListener('click', () => {
  const f = btn.dataset.filter;
  filterBtns.forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
  let shown = 0;
  items.forEach(el => {
    const show = f === 'all' || el.dataset.kind === f;
    el.hidden = !show;
    if (show) shown++;
  });
  empty.hidden = shown > 0;
}));

// ---------------- Alarm demo ----------------
// Simulated 6 s of accelerometer magnitude at 100 Hz. Same pipeline as the
// firmware: bias correction, EMA low-pass, adaptive threshold, persistence.
(function alarmDemo() {
  const fig = document.getElementById('alarm-demo');
  if (!fig) return;
  const svg = fig.querySelector('.demo-plot');
  const countEl = fig.querySelector('.demo-count');
  const btns = fig.querySelectorAll('.demo-toggle button');

  const HZ = 100, N = 600, BIAS = 0.045, SIGMA = 0.008;
  // deterministic noise
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  const events = [
    { label: 'Knock', start: 0.8, end: 1.0, real: false },
    { label: 'Door slam', start: 1.9, end: 2.1, real: false },
    { label: 'Phone buzz', start: 2.6, end: 3.2, real: false },
    { label: 'Knock', start: 3.9, end: 4.1, real: false },
    { label: 'Picked up', start: 4.7, end: 5.6, real: true },
  ];
  const ring = (k, A) => (k < 0 || k > 20) ? 0 : A * Math.exp(-k / 3) * Math.cos(k * 1.4);

  const delta = []; // movement signal before bias is added
  for (let i = 0; i < N; i++) {
    const t = i / HZ;
    let e = gauss() * SIGMA;
    e += ring(i - 80, 0.19);
    e += ring(i - 190, 0.13);
    if (t >= 2.6 && t < 3.2) e += 0.07 * Math.sin(2 * Math.PI * (i - 260) / 4);
    e += ring(i - 390, 0.26);
    if (t >= 4.7 && t < 5.6) {
      const k = i - 470;
      const ramp = Math.min(1, k / 12) * Math.min(1, (90 - k) / 12);
      e += ramp * (0.3 + 0.04 * Math.sin(k / 5));
    }
    delta.push(e);
  }

  // Naive: assume sensor is perfectly flat, fixed threshold, fire immediately
  const naiveSig = delta.map(d => Math.abs(BIAS + d));
  const NAIVE_TH = 0.1;
  const naiveHits = [];
  // once it fires, the siren stays on until things have been quiet for 0.5 s
  let ringing = false, quiet = 0;
  naiveSig.forEach((v, i) => {
    if (ringing) {
      quiet = v > NAIVE_TH ? 0 : quiet + 1;
      if (quiet >= 50) ringing = false;
      return;
    }
    if (v > NAIVE_TH) { naiveHits.push(i); ringing = true; quiet = 0; }
  });

  // Filtered: bias removed, EMA, adaptive threshold, leaky persistence counter
  const ALPHA = 0.2, FLOOR = 0.06, PERSIST = 15;
  const FILT_TH = Math.max(FLOOR, 5 * SIGMA);
  const filtSig = [];
  const filtHits = [];
  let ema = 0, counter = 0, latched = false;
  delta.forEach((d, i) => {
    ema = ALPHA * Math.abs(d) + (1 - ALPHA) * ema;
    filtSig.push(ema);
    if (ema > FILT_TH) counter++; else counter = Math.max(0, counter - 1);
    if (!latched && counter >= PERSIST) { filtHits.push(i); latched = true; }
    if (latched && counter === 0) latched = false;
  });

  const isReal = i => events.some(e => e.real && i / HZ >= e.start - 0.05 && i / HZ <= e.end + 0.3);

  // chart geometry
  const W = 640, H = 300, L = 40, R = 10, T = 34, B = 26;
  const YMAX = 0.4;
  const x = i => L + (i / (N - 1)) * (W - L - R);
  const y = v => T + (1 - Math.min(v, YMAX) / YMAX) * (H - T - B);
  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, attrs, text) => {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };

  let animated = false;
  function render(mode, animate) {
    // keep the <desc>
    [...svg.childNodes].forEach(n => { if (n.nodeName !== 'desc') svg.removeChild(n); });

    events.forEach(ev => {
      const x0 = x(ev.start * HZ), x1 = x(ev.end * HZ);
      svg.appendChild(el('rect', { class: 'ev-span', x: x0, y: T, width: Math.max(4, x1 - x0), height: H - T - B }));
      svg.appendChild(el('text', { class: 'ev-label', x: (x0 + x1) / 2, y: T - 10, 'text-anchor': 'middle' }, ev.label));
    });
    [0, 0.1, 0.2, 0.3, 0.4].forEach(v => {
      svg.appendChild(el('line', { class: 'grid', x1: L, x2: W - R, y1: y(v), y2: y(v) }));
      svg.appendChild(el('text', { class: 'axis-label', x: L - 8, y: y(v) + 4, 'text-anchor': 'end' }, v.toFixed(1)));
    });
    for (let s = 0; s <= 6; s++) {
      svg.appendChild(el('text', { class: 'axis-label', x: x(Math.min(s * HZ, N - 1)), y: H - 6, 'text-anchor': 'middle' }, s + ' s'));
    }

    const sig = mode === 'naive' ? naiveSig : filtSig;
    const th = mode === 'naive' ? NAIVE_TH : FILT_TH;
    const hits = mode === 'naive' ? naiveHits : filtHits;

    const d = sig.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join('');
    const path = el('path', { class: 'trace', d });
    svg.appendChild(path);
    svg.appendChild(el('line', { class: 'threshold', x1: L, x2: W - R, y1: y(th), y2: y(th) }));
    svg.appendChild(el('text', { class: 'th-label', x: W - R, y: y(th) - 6, 'text-anchor': 'end' }, 'Trigger level'));

    hits.forEach(i => {
      const real = isReal(i);
      svg.appendChild(el('circle', { class: 'hit-ring', cx: x(i), cy: y(sig[i]), r: 9, stroke: real ? 'var(--green)' : 'var(--alarm)' }));
      svg.appendChild(el('circle', { class: real ? 'hit-true' : 'hit-false', cx: x(i), cy: y(sig[i]), r: 4 }));
    });

    if (animate) {
      const len = path.getTotalLength();
      path.style.setProperty('--len', len);
      path.classList.add('draw');
    }

    const falseCount = hits.filter(i => !isReal(i)).length;
    const realCount = hits.length - falseCount;
    countEl.innerHTML = mode === 'naive'
      ? `${hits.length} alarms. <span class="bad">${falseCount} false</span>, ${realCount} real.`
      : `${hits.length} alarm${hits.length === 1 ? '' : 's'}. <span class="good">${falseCount === 0 ? 'No false alarms' : falseCount + ' false'}</span>, and the pickup is still caught.`;
  }

  btns.forEach(b => b.addEventListener('click', () => {
    btns.forEach(o => o.setAttribute('aria-pressed', String(o === b)));
    render(b.dataset.mode, false);
  }));

  render('naive', false);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting) && !animated) {
        animated = true;
        const mode = fig.querySelector('.demo-toggle [aria-pressed="true"]').dataset.mode;
        render(mode, true);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(svg);
  }
})();

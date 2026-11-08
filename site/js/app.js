/* VPN Sentinel website. No dependencies, no third-party requests except the
 * optional GitHub releases lookup that keeps download links current. */
import { I18N, SUPPORTED_LANGUAGES } from './i18n.js?v=3';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const LANG_KEY = 'vpnsentinel-language';
const THEME_KEY = 'vpnsentinel-theme';

const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage unavailable */ } },
};

/* ---------- Release (links work without JS; refreshed from GitHub) ---------- */

const REPO = 'dvoineu/VPNSentinel';
const RELEASE_CACHE_KEY = 'vpnsentinel-latest-release';
const release = { version: '0.1.0', build: '1' };

function parseRelease(data) {
  const match = /^v(\d+(?:\.\d+)*)-build\.(\d+)$/.exec(data.tag_name || '');
  if (!match || !Array.isArray(data.assets)) return null;
  const [, version, build] = match;
  const asset = (name) => data.assets.find((entry) => entry.name === name)?.browser_download_url;
  const links = {
    demo: asset('VPN-Sentinel-Demo.zip'),
    experiment: asset('VPN-Sentinel-Experiment.zip'),
    install: asset('INSTALL.txt'),
    checksums: asset('SHA256SUMS'),
  };
  if (!Object.values(links).every(Boolean)) return null;
  return { version, build, links };
}

function applyRelease(info) {
  if (!info) return;
  release.version = info.version;
  release.build = info.build;
  Object.entries(info.links).forEach(([kind, url]) => {
    $$(`[data-release="${kind}"]`).forEach((a) => { a.href = url; });
  });
  $$('[data-release="label"]').forEach((el) => { el.textContent = `${release.version} (${release.build})`; });
}

async function loadLatestRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(RELEASE_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < 3600 * 1000) { applyRelease(cached.info); return; }
  } catch { /* no storage */ }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      referrerPolicy: 'no-referrer',
    });
    clearTimeout(timer);
    if (!response.ok) return;
    const info = parseRelease(await response.json());
    if (!info) return;
    try { sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({ at: Date.now(), info })); } catch { /* no storage */ }
    applyRelease(info);
  } catch { /* offline or rate limited: keep the links from the HTML */ }
}

/* ---------- Language ---------- */

let lang = 'en';
const t = (key) => I18N[lang][key] ?? I18N.en[key] ?? '';

function detectLanguage() {
  const fromUrl = new URLSearchParams(location.search).get('lang');
  if (SUPPORTED_LANGUAGES.includes(fromUrl)) return fromUrl;
  const saved = store.get(LANG_KEY);
  if (SUPPORTED_LANGUAGES.includes(saved)) return saved;
  const preferred = (navigator.languages || [navigator.language || 'en'])[0] || 'en';
  return preferred.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

const listeners = [];
function applyLanguage(next) {
  lang = SUPPORTED_LANGUAGES.includes(next) ? next : 'en';
  document.documentElement.lang = lang;
  document.title = t('metaTitle');
  $('meta[name="description"]')?.setAttribute('content', t('metaDescription'));
  $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  $$('[data-i18n-aria-label]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)));
  $$('[data-language]').forEach((a) => {
    if (a.dataset.language === lang) a.setAttribute('aria-current', 'true');
    else a.removeAttribute('aria-current');
  });
  listeners.forEach((fn) => fn());
}

$$('[data-language]').forEach((a) => a.addEventListener('click', (event) => {
  event.preventDefault();
  store.set(LANG_KEY, a.dataset.language);
  const url = new URL(location.href);
  url.searchParams.set('lang', a.dataset.language);
  history.replaceState(null, '', url);
  applyLanguage(a.dataset.language);
}));

/* ---------- Theme, header, reveal ---------- */

const root = document.documentElement;
$('#theme')?.addEventListener('click', () => {
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  store.set(THEME_KEY, root.dataset.theme);
});

const header = $('#top');
const onScroll = () => header.classList.toggle('is-scrolled', scrollY > 8);
addEventListener('scroll', onScroll, { passive: true });
onScroll();

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }), { rootMargin: '0px 0px -8% 0px' });
  $$('.reveal').forEach((el) => io.observe(el));
} else {
  $$('.reveal').forEach((el) => el.classList.add('is-in'));
}

/* ---------- Traffic scene ---------- */

const SCENES = {
  ok: { key: 'Ok', glyph: 'ok', gate: 'closed', pipe: 'ok', main: 'on-tunnel', up: 'on-tunnel', direct: '',
    route: 'r-tunnel', color: 'var(--tunnel)', lamp: 'var(--tunnel)', chip: 'chip-tunnel' },
  leak: { key: 'Leak', glyph: 'off', gate: 'hidden', pipe: 'broken', main: 'on-leak', up: '', direct: 'on-leak',
    route: 'r-direct', color: 'var(--leak)', lamp: 'var(--tunnel)', chip: 'chip-leak',
    bubble: { bg: 'var(--leak)', fg: '#fff' } },
  hold: { key: 'Hold', glyph: 'lost', gate: 'closed', pipe: 'broken', main: '', up: '', direct: '',
    route: 'r-blocked', color: 'var(--ink-3)', lamp: 'var(--paper-2)', chip: 'chip-hold', toast: true },
  pause: { key: 'Pause', glyph: 'pause', gate: 'open', pipe: 'idle', main: 'on-pause', up: '', direct: 'on-pause',
    route: 'r-direct', color: 'var(--pause)', lamp: 'var(--pause)', chip: 'chip-pause',
    bubble: { bg: 'var(--pause)', fg: '#16161B', timer: true } },
};
const ORDER = ['ok', 'leak', 'hold', 'pause'];

function setupScene() {
  const svg = $('svg.net');
  if (!svg) return;
  const NS = 'http://www.w3.org/2000/svg';
  const routes = {};
  $$('path[id^="r-"]', svg).forEach((p) => { routes[p.id] = { el: p, len: p.getTotalLength() }; });
  const layer = $('#pkts');
  const bounce = $('#bounce');
  const buttons = $$('.seg button');
  const autoBtn = $('#autoplay');
  const bubbleText = $('#bubble-text');
  let current = 'ok';
  let packets = [];
  let spawnAcc = 0;
  let lanAcc = 0;
  let bounceT = 1;
  let pauseStart = performance.now();
  let auto = !reducedMotion;
  let autoTimer = null;
  // On screen (IntersectionObserver) and tab visibility are tracked separately and
  // combined on every frame, so the scene resumes after the tab was hidden.
  let inView = true;
  const running = () => inView && !document.hidden;

  const cls = (el, base, extra) => el.setAttribute('class', extra ? `${base} ${extra}` : base);
  const pauseText = (seconds) => t('scnPauseBubble').replace('{t}',
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`);

  function fitBubble() {
    try {
      const bb = bubbleText.getBBox();
      const r = $('#bubble-bg');
      r.setAttribute('x', bb.x - 16); r.setAttribute('width', bb.width + 32);
      r.setAttribute('y', bb.y - 9); r.setAttribute('height', bb.height + 18);
      r.setAttribute('rx', (bb.height + 18) / 2);
    } catch { /* not rendered yet */ }
  }

  function makePacket(route, color, duration) {
    const el = document.createElementNS(NS, 'circle');
    el.setAttribute('r', route === 'r-lan' ? 4 : 5.5);
    el.style.fill = color;
    layer.appendChild(el);
    return { el, route, t: 0, duration };
  }
  function place(p) {
    const r = routes[p.route];
    const pt = r.el.getPointAtLength(Math.min(p.t, 1) * r.len);
    p.el.setAttribute('cx', pt.x);
    p.el.setAttribute('cy', pt.y);
  }
  function drawStatic() {
    const s = SCENES[current];
    const n = s.route === 'r-blocked' ? 3 : 7;
    for (let i = 0; i < n; i += 1) { const p = makePacket(s.route, s.color, 1); p.t = (i + 0.5) / n; place(p); packets.push(p); }
    for (let i = 0; i < 2; i += 1) { const p = makePacket('r-lan', 'var(--ink-3)', 1); p.t = (i + 0.5) / 2; place(p); packets.push(p); }
  }

  function renderText() {
    const s = SCENES[current];
    const chip = $('#verdict-chip');
    chip.className = `chip ${s.chip}`;
    chip.textContent = t(`scn${s.key}Chip`);
    $('#verdict-title').textContent = t(`scn${s.key}Title`);
    $('#verdict-body').textContent = t(`scn${s.key}Body`);
    if (s.bubble) {
      bubbleText.textContent = s.bubble.timer ? pauseText(900) : t('scnLeakBubble');
      fitBubble();
    }
    autoBtn.textContent = t(auto ? 'autoplayOn' : 'autoplayOff');
  }

  function apply(key) {
    current = key;
    const s = SCENES[key];
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scn === key)));
    $('#mb-glyph').dataset.state = s.glyph;
    $('#mb-slot').classList.toggle('is-hot', s.glyph !== 'off');
    const gate = $('#gate');
    gate.classList.toggle('is-hidden', s.gate === 'hidden');
    gate.classList.toggle('is-open', s.gate === 'open');
    $('#gate-lamp').style.fill = s.lamp;
    const pipe = $('#pipe');
    cls(pipe, 'pipe', s.pipe === 'broken' ? 'is-broken' : '');
    pipe.style.opacity = s.pipe === 'idle' ? 0.35 : 1;
    $('#pipe-label').style.opacity = s.pipe === 'ok' ? 1 : 0.45;
    $('#crack').style.opacity = s.pipe === 'broken' ? 1 : 0;
    cls($('#w-main'), 'wire', s.main);
    cls($('#w-tunnel'), 'wire', s.up);
    cls($('#w-direct'), 'wire', s.direct);
    const bubble = $('#bubble');
    bubble.classList.toggle('is-on', Boolean(s.bubble));
    if (s.bubble) {
      $('#bubble-bg').style.fill = s.bubble.bg;
      bubbleText.style.fill = s.bubble.fg;
    }
    $('#toast').classList.toggle('is-on', Boolean(s.toast));
    pauseStart = performance.now();
    renderText();
    packets.forEach((p) => p.el.remove());
    packets = [];
    if (reducedMotion) drawStatic();
  }

  let last = performance.now();
  function tick(now) {
    const dt = Math.min(now - last, 64);
    last = now;
    if (running() && !reducedMotion) {
      const s = SCENES[current];
      spawnAcc += dt;
      lanAcc += dt;
      if (spawnAcc > (s.route === 'r-blocked' ? 420 : 240)) {
        spawnAcc = 0;
        packets.push(makePacket(s.route, s.color, s.route === 'r-tunnel' ? 2100 : s.route === 'r-blocked' ? 900 : 1900));
      }
      if (lanAcc > 1100) { lanAcc = 0; packets.push(makePacket('r-lan', 'var(--ink-3)', 900)); }
      packets = packets.filter((p) => {
        p.t += dt / p.duration;
        if (p.t >= 1) {
          if (p.route === 'r-blocked') bounceT = 0;
          p.el.remove();
          return false;
        }
        place(p);
        return true;
      });
      if (bounceT < 1) {
        bounceT = Math.min(1, bounceT + dt / 420);
        bounce.setAttribute('r', 4 + 16 * bounceT);
        bounce.setAttribute('opacity', 1 - bounceT);
      }
      if (s.bubble?.timer) bubbleText.textContent = pauseText(Math.max(0, 900 - Math.floor((now - pauseStart) / 1000)));
    }
    requestAnimationFrame(tick);
  }

  function setAuto(on) {
    auto = on;
    autoBtn.setAttribute('aria-pressed', String(on));
    autoBtn.textContent = t(on ? 'autoplayOn' : 'autoplayOff');
    clearInterval(autoTimer);
    if (on) {
      autoTimer = setInterval(() => {
        if (running()) apply(ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]);
      }, 6000);
    }
  }

  buttons.forEach((b) => b.addEventListener('click', () => { setAuto(false); apply(b.dataset.scn); }));
  autoBtn.addEventListener('click', () => setAuto(!auto));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; }).observe(svg);
  }
  addEventListener('resize', () => requestAnimationFrame(fitBubble));
  listeners.push(renderText);

  apply('ok');
  setAuto(auto);
  requestAnimationFrame(tick);
}

/* ---------- A day with Sentinel ---------- */

const DAY = [
  { glyph: 'ok', clock: '09:05' },
  { glyph: 'lost', clock: '11:47' },
  { glyph: 'ok', clock: '11:48' },
  { glyph: 'pause', clock: '14:30', ring: true },
  { glyph: 'ok', clock: '14:45' },
  { glyph: 'unknown', clock: '16:10', warn: true },
  { glyph: 'ok', clock: '18:20' },
];

function glyphSvg(state) {
  return `<svg class="glyph" viewBox="0 0 24 24" data-state="${state}" aria-hidden="true"><rect class="base" x="2" y="20.5" width="20" height="1.6" rx=".8"/><rect class="post" x="4" y="7.5" width="3" height="13.5" rx="1"/><rect class="arm" x="7" y="10" width="15" height="3" rx="1.5"/><path class="arm-dash" d="M8 11.5H21.5"/><circle class="lamp" cx="5.5" cy="4" r="2"/></svg>`;
}

function setupDay() {
  const pop = $('#pop');
  if (!pop) return;
  let active = 0;
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function show(i) {
    active = i;
    const d = DAY[i];
    $('#day-glyph').dataset.state = d.glyph;
    $('#day-clock').textContent = d.clock;
    const head = el('div', 'pop-head');
    if (d.ring) {
      const ring = el('div', 'timer-ring');
      ring.appendChild(el('span', '', '15:00'));
      head.appendChild(ring);
    } else {
      head.insertAdjacentHTML('beforeend', glyphSvg(d.glyph));
    }
    const titles = el('div');
    const title = el('div', 'pop-title', t(`pop${i}Title`));
    if (d.warn) title.style.color = 'var(--leak-text)';
    titles.append(title, el('div', 'pop-sub', t(`pop${i}Sub`)));
    head.appendChild(titles);
    const rows = t(`pop${i}Rows`).split('|').map((pair) => {
      const [k, v] = pair.split('=');
      const row = el('div', 'pop-row');
      row.append(el('span', '', k), el('span', '', v));
      return row;
    });
    pop.replaceChildren(head, ...rows, el('div', 'pop-btn', t(`pop${i}Btn`)));
    $$('.step').forEach((s) => s.classList.toggle('is-active', Number(s.dataset.i) === i));
  }
  listeners.push(() => show(active));
  show(0);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) show(Number(e.target.dataset.i)); });
    }, { rootMargin: '-45% 0px -45% 0px' });
    $$('.step').forEach((s) => io.observe(s));
  }
}

setupScene();
setupDay();
applyLanguage(detectLanguage());
loadLatestRelease();

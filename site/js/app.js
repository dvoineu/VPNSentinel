import { I18N, SUPPORTED_LANGUAGES } from './i18n.js';

const STORAGE_KEY = 'vpnsentinel-language';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- Language ---------- */

function readStoredLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* storage unavailable: the ?lang link still works */
  }
}

function detectInitialLanguage() {
  const fromUrl = new URLSearchParams(window.location.search).get('lang');
  if (SUPPORTED_LANGUAGES.includes(fromUrl)) return fromUrl;
  const saved = readStoredLanguage();
  if (SUPPORTED_LANGUAGES.includes(saved)) return saved;
  return 'en';
}

let currentLanguage = 'en';

/* ---------- Latest release ----------
 * The HTML links point at a known release, so downloads work without
 * JavaScript. On load the page asks GitHub for the latest published
 * release and, if its assets are complete, replaces the links and
 * updates the version shown. Results are cached for an hour.
 */

const REPO = 'dvoineu/VPNSentinel';
const RELEASE_CACHE_KEY = 'vpnsentinel-latest-release';
const release = { version: '0.1.0', build: '1' };

function fill(value) {
  return value.replaceAll('{version}', release.version).replaceAll('{build}', release.build);
}

function parseRelease(data) {
  const match = /^v(\d+(?:\.\d+)*)-build\.(\d+)$/.exec(data.tag_name || '');
  if (!match || !Array.isArray(data.assets)) return null;
  const [, version, build] = match;
  const asset = (name) => data.assets.find((entry) => entry.name === name)?.browser_download_url;
  const links = {
    dmg: asset('VPN-Sentinel-Demo.zip') || asset(`VPN-Sentinel-${version}-${build}.dmg`),
    zip: asset('VPN-Sentinel-Experiment.zip'),
    install: asset('INSTALL.txt') || asset('metadata.json'),
    checksums: asset('SHA256SUMS'),
  };
  if (!Object.values(links).every(Boolean)) return null;
  return { version, build, links };
}

function applyRelease(info) {
  if (!info) return;
  if (info.version && info.build) {
    release.version = info.version;
    release.build = info.build;
  }
  Object.entries(info.links).forEach(([kind, url]) => {
    if (!url) return;
    document.querySelectorAll(`[data-release="${kind}"]`).forEach((a) => {
      a.href = url;
    });
  });
  document.querySelectorAll('[data-release="label"]').forEach((el) => {
    el.textContent = `${release.version} (${release.build})`;
  });
  applyLanguage(currentLanguage);
}

async function loadLatestRelease() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(RELEASE_CACHE_KEY) || 'null');
    if (cached && Date.now() - cached.at < 3600 * 1000) {
      applyRelease(cached.info);
      return;
    }
  } catch { /* no storage */ }
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!response.ok) return;
    const info = parseRelease(await response.json());
    if (!info) return;
    try {
      sessionStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify({ at: Date.now(), info }));
    } catch { /* no storage */ }
    applyRelease(info);
  } catch {
    /* offline or rate limited: keep the links from the HTML */
  }
}

/* ---------- Interactive Policy Workbench Simulator ---------- */

const STATES = ['active', 'blocked', 'unknown', 'paused'];

const demo = (() => {
  const hud = document.getElementById('demo-hud');
  const stateTitleEl = document.getElementById('demo-state-title');
  const stateBodyEl = document.getElementById('demo-state-body');
  const routeEl = document.getElementById('demo-route-value');
  const notifEl = document.getElementById('demo-notif-value');
  const timerEl = document.getElementById('demo-timer');
  const cycleBtn = document.getElementById('demo-cycle-toggle');
  const nasOutcomeEl = document.getElementById('demo-nas-outcome');
  const printerOutcomeEl = document.getElementById('demo-printer-outcome');

  let state = 'active';
  let autoCycle = true;
  let timerId = null;

  // Per-network LAN choices matching SentinelDemo.DemoSession
  let currentNet = 'A';
  const netStore = {
    A: { trust: true, denyNas: true, denyPrinter: false },
    B: { trust: false, denyNas: false, denyPrinter: false },
  };

  function evaluateDevice(deviceDenied, trustedLan, currentState) {
    // In SentinelPolicy: explicit device denial overrides LAN trust and pause
    if (deviceDenied) return false;
    if (trustedLan) return true;
    if (currentState === 'paused') return true;
    return false;
  }

  function render() {
    const dict = I18N[currentLanguage] || I18N.en;
    if (hud) hud.dataset.state = state;

    const map = {
      active: {
        title: dict.demoStateActiveTitle,
        body: dict.demoStateActiveBody,
        route: dict.demoRouteActive,
        notif: dict.demoNotifActive,
        clock: '00:05',
      },
      blocked: {
        title: dict.demoStateBlockedTitle,
        body: dict.demoStateBlockedBody,
        route: dict.demoRouteBlocked,
        notif: dict.demoNotifBlocked,
        clock: 'ALERT',
      },
      unknown: {
        title: dict.demoStateUnknownTitle,
        body: dict.demoStateUnknownBody,
        route: dict.demoRouteUnknown,
        notif: dict.demoNotifUnknown,
        clock: 'UNCONF',
      },
      paused: {
        title: dict.demoStatePausedTitle,
        body: dict.demoStatePausedBody,
        route: dict.demoRoutePaused,
        notif: dict.demoNotifPaused,
        clock: '14:42',
      },
    }[state];

    if (stateTitleEl) stateTitleEl.textContent = map.title;
    if (stateBodyEl) stateBodyEl.textContent = map.body;
    if (routeEl) routeEl.textContent = map.route;
    if (notifEl) notifEl.textContent = map.notif;
    if (timerEl) timerEl.textContent = map.clock;

    document.querySelectorAll('[data-demo-state]').forEach((btn) => {
      const active = btn.dataset.demoState === state;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });

    const net = netStore[currentNet];
    document.querySelectorAll('[data-demo-net]').forEach((btn) => {
      const active = btn.dataset.demoNet === currentNet;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('is-active', active);
    });

    const trustBtn = document.getElementById('demo-toggle-trust');
    const nasBtn = document.getElementById('demo-toggle-nas');
    const printerBtn = document.getElementById('demo-toggle-printer');
    if (trustBtn) trustBtn.setAttribute('aria-pressed', String(net.trust));
    if (nasBtn) nasBtn.setAttribute('aria-pressed', String(net.denyNas));
    if (printerBtn) printerBtn.setAttribute('aria-pressed', String(net.denyPrinter));

    const nasAllowed = evaluateDevice(net.denyNas, net.trust, state);
    const printerAllowed = evaluateDevice(net.denyPrinter, net.trust, state);

    if (nasOutcomeEl) {
      nasOutcomeEl.textContent = nasAllowed ? dict.demoOutcomeAllowed : dict.demoOutcomeDenied;
      nasOutcomeEl.dataset.outcome = nasAllowed ? 'allow' : 'deny';
    }
    if (printerOutcomeEl) {
      printerOutcomeEl.textContent = printerAllowed ? dict.demoOutcomeAllowed : dict.demoOutcomeDenied;
      printerOutcomeEl.dataset.outcome = printerAllowed ? 'allow' : 'deny';
    }

    if (cycleBtn) {
      cycleBtn.textContent = autoCycle ? dict.demoAutoPlayPause : dict.demoAutoPlayResume;
      cycleBtn.setAttribute('aria-pressed', String(!autoCycle));
    }

    document.dispatchEvent(new CustomEvent('vs-demo', { detail: state }));
    document.dispatchEvent(new CustomEvent('vh-demo', { detail: state }));
  }

  function scheduleNext() {
    window.clearTimeout(timerId);
    if (!autoCycle || reducedMotion.matches || document.hidden) return;
    timerId = window.setTimeout(() => {
      const nextIndex = (STATES.indexOf(state) + 1) % STATES.length;
      state = STATES[nextIndex];
      render();
      scheduleNext();
    }, 4400);
  }

  function bindControls() {
    document.querySelectorAll('[data-demo-state]').forEach((btn) => {
      btn.addEventListener('click', () => {
        autoCycle = false;
        state = btn.dataset.demoState;
        render();
        scheduleNext();
      });
    });

    document.querySelectorAll('[data-demo-net]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetNet = btn.dataset.demoNet;
        if (targetNet && targetNet !== currentNet) {
          currentNet = targetNet;
          // Switching network terminates active demo pause early
          if (state === 'paused') state = 'blocked';
          autoCycle = false;
          render();
          scheduleNext();
        }
      });
    });

    document.getElementById('demo-toggle-trust')?.addEventListener('click', () => {
      netStore[currentNet].trust = !netStore[currentNet].trust;
      autoCycle = false;
      render();
    });
    document.getElementById('demo-toggle-nas')?.addEventListener('click', () => {
      netStore[currentNet].denyNas = !netStore[currentNet].denyNas;
      autoCycle = false;
      render();
    });
    document.getElementById('demo-toggle-printer')?.addEventListener('click', () => {
      netStore[currentNet].denyPrinter = !netStore[currentNet].denyPrinter;
      autoCycle = false;
      render();
    });

    cycleBtn?.addEventListener('click', () => {
      autoCycle = !autoCycle;
      render();
      scheduleNext();
    });
  }

  bindControls();

  return {
    restart() {
      if (reducedMotion.matches) autoCycle = false;
      render();
      scheduleNext();
    },
    stop() {
      window.clearTimeout(timerId);
    },
  };
})();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) demo.stop();
  else demo.restart();
});

/* ---------- Verification & Diagnostics Ledger ---------- */

const LEDGER_ENTRIES = {
  en: [
    {
      badge: 'SentinelDiagnostics · schema v1 · demonstrationOnly: true',
      code: `{
  "demonstrationOnly": true,
  "trafficBlockingActive": false,
  "schemaVersion": 1,
  "records": [
    {
      "sequence": 1,
      "event": "componentVersion",
      "summary": "policy 0.1.0",
      "details": "SentinelPolicy offline rule evaluator"
    },
    {
      "sequence": 2,
      "event": "stateTransition",
      "summary": "Blocked -> Active"
    },
    {
      "sequence": 3,
      "event": "channelAbsent",
      "summary": "Selected channel became unavailable",
      "details": "Simulated VPN drop triggered episode #1"
    },
    {
      "sequence": 4,
      "event": "pauseEnded",
      "summary": "Ended because the network changed"
    }
  ]
}`,
    },
    {
      badge: 'Issue #68 · Apple Notary Accepted · VPN-Sentinel-Demo.zip',
      code: `Artifact        : VPN-Sentinel-Demo.zip (652,949 bytes)
Bundle ID       : com.vpnsentinel.demo (Universal: arm64 + x86_64, minOS 26.0)
Signing         : Developer ID Application · Hardened Runtime · Secure Timestamp
Submission ID   : 421b268c-7f31-40ca-a512-f776f28481a5
Apple Status    : Accepted (0 errors, 0 warnings)
Stapled Ticket  : Contents/CodeResources (SHA-256: 77fcbc92…4cd988d367dd)
Final ZIP SHA256: 150192ca7fa601065c6e46b00ae08fee937ccc014157360573c06b396846ebba
Gatekeeper      : spctl --assess -> accepted (source=Notarized Developer ID)`,
    },
    {
      badge: 'Issue #80 · Apple Notary Accepted · VPN-Sentinel-Experiment.zip',
      code: `Artifact        : VPN-Sentinel-Experiment.zip (Universal Host + PacketFilter)
Bundles         : com.vpnsentinel.experiment + .packet-filter (4/4 CDHash)
Submission ID   : db536713-5e69-4a0b-9dae-31194d0c7c26
Apple Status    : Accepted (0 errors, 0 warnings)
Upload ZIP Hash : fe0d7855e8b710d1cdde5856970d4d364a7cd9a3595803e084545bd3df74d2a4
Stapled Ticket  : ae2a07002344f9b841da3b916290bd7ecf3f8020aa21642348aeefc7a311db4a
Final ZIP SHA256: 681a17d9767d69a58fac391a7f6604d5f451568c882e1767cfb6d497e79180eb
Note            : Pass-through provider; does not activate filter or block traffic.`,
    },
    {
      badge: 'Packages/* · 10 Isolated Swift 6 Packages',
      code: `Packages/
├── SentinelPolicy         # Pure precedence rules (device denial > LAN > pause > tunnel)
├── SentinelNotifications  # Outage episodes, 1 alert sound & 5s recovery debounce
├── SentinelDiagnostics    # Bounded ring buffer & deterministic JSON snapshot export
├── SentinelContracts      # Versioned settings & command schemas (#54, #55)
├── SentinelDemo           # Deterministic synthetic session & clock advancement
├── SentinelPersistence    # Atomic private-directory settings storage (#61)
├── SentinelCoordinator    # Sequential command processor & fault recovery (#62, #63)
├── SentinelPackets        # Synthetic IPv4/IPv6/UDP/TCP/DNS packet evaluator (#70)
├── SentinelRuntime        # Monotonic pause scheduler & signing preflight (#70)
└── SentinelProxyProtocol  # Offline SOCKS5 & HTTP CONNECT codecs (#70)`,
    },
    {
      badge: 'scripts/check.sh · Zero-Trust Local Pre-Push Gate',
      code: `$ bash scripts/check.sh
✓ 10 Swift packages tested (--disable-automatic-resolution)
✓ SentinelIPC AF_UNIX peer code-signing identity verification passed
✓ SwiftUI localization & deterministic view state checks (EN / RU) passed
✓ 51 Python leak-harness tests & 130+ packaging/notarization tests passed
✓ Shell syntax, plist/strings lint, CommonMark internal link validator passed
✓ Unsigned Debug SentinelApp & Release Universal SentinelDemoApp compiled`,
    },
    {
      badge: 'macOS Terminal · Verify Downloaded Release Locally',
      code: `# 1. Verify cryptographic SHA-256 checksums
shasum -a 256 -c SHA256SUMS

# 2. Extract in a clean folder and verify strict universal signature
ditto -x -k VPN-Sentinel-Demo.zip ./extracted
codesign --verify --deep --strict --all-architectures "./extracted/VPN Sentinel Demo.app"

# 3. Validate stapled Apple notarization ticket & Gatekeeper assessment
xcrun stapler validate "./extracted/VPN Sentinel Demo.app"
spctl --assess --type execute --verbose=4 "./extracted/VPN Sentinel Demo.app"`,
    },
  ],
  ru: [
    {
      badge: 'SentinelDiagnostics · схема v1 · demonstrationOnly: true',
      code: `{
  "demonstrationOnly": true,
  "trafficBlockingActive": false,
  "schemaVersion": 1,
  "records": [
    {
      "sequence": 1,
      "event": "componentVersion",
      "summary": "Политика: 0.1.0",
      "details": "Офлайн-вычислитель правил SentinelPolicy"
    },
    {
      "sequence": 2,
      "event": "stateTransition",
      "summary": "Блокировка -> Канал доступен"
    },
    {
      "sequence": 3,
      "event": "channelAbsent",
      "summary": "Выбранный канал перестал быть доступен",
      "details": "Симуляция обрыва VPN открыла эпизод #1"
    },
    {
      "sequence": 4,
      "event": "pauseEnded",
      "summary": "Пауза завершена из-за смены сети"
    }
  ]
}`,
    },
    {
      badge: 'Задача #68 · Принято Apple Notary · VPN-Sentinel-Demo.zip',
      code: `Архив           : VPN-Sentinel-Demo.zip (652 949 байт)
Bundle ID       : com.vpnsentinel.demo (Universal: arm64 + x86_64, minOS 26.0)
Подпись         : Developer ID Application · Hardened Runtime · Secure Timestamp
Submission ID   : 421b268c-7f31-40ca-a512-f776f28481a5
Статус Apple    : Accepted (0 ошибок, 0 предупреждений)
Stapled Ticket  : Contents/CodeResources (SHA-256: 77fcbc92…4cd988d367dd)
SHA-256 архива  : 150192ca7fa601065c6e46b00ae08fee937ccc014157360573c06b396846ebba
Gatekeeper      : spctl --assess -> accepted (source=Notarized Developer ID)`,
    },
    {
      badge: 'Задача #80 · Принято Apple Notary · VPN-Sentinel-Experiment.zip',
      code: `Архив           : VPN-Sentinel-Experiment.zip (Universal Host + PacketFilter)
Bundle ID       : com.vpnsentinel.experiment + .packet-filter (4/4 CDHash)
Submission ID   : db536713-5e69-4a0b-9dae-31194d0c7c26
Статус Apple    : Accepted (0 ошибок, 0 предупреждений)
SHA-256 отправки: fe0d7855e8b710d1cdde5856970d4d364a7cd9a3595803e084545bd3df74d2a4
Stapled Ticket  : ae2a07002344f9b841da3b916290bd7ecf3f8020aa21642348aeefc7a311db4a
SHA-256 архива  : 681a17d9767d69a58fac391a7f6604d5f451568c882e1767cfb6d497e79180eb
Примечание      : Pass-through расширение; не включает фильтрацию трафика.`,
    },
    {
      badge: 'Packages/* · 10 изолированных пакетов Swift 6',
      code: `Packages/
├── SentinelPolicy         # Приоритеты правил (запрет устройства > LAN > пауза > туннель)
├── SentinelNotifications  # Эпизоды обрыва, 1 звук и 5 секунд стабилизации
├── SentinelDiagnostics    # Кольцевой буфер в памяти и экспорт снимка в JSON
├── SentinelContracts      # Схемы настроек и команд (#54, #55)
├── SentinelDemo           # Синтетический сеанс и управление временем модели
├── SentinelPersistence    # Атомарное файловое хранилище настроек (#61)
├── SentinelCoordinator    # Последовательный обработчик команд и сбоев (#62, #63)
├── SentinelPackets        # Синтетический анализатор пакетов IPv4/IPv6/UDP/TCP/DNS (#70)
├── SentinelRuntime        # Планировщик паузы и проверка signing metadata (#70)
└── SentinelProxyProtocol  # Офлайн-кодеки SOCKS5 и HTTP CONNECT (#70)`,
    },
    {
      badge: 'scripts/check.sh · Локальный контур проверки перед push',
      code: `$ bash scripts/check.sh
✓ 10 пакетов Swift проверены тестами (--disable-automatic-resolution)
✓ SentinelIPC: обмен AF_UNIX с проверкой подписи процесса-партнёра успешен
✓ Проверка состояний SwiftUI и встроенных локализаций (EN / RU) успешна
✓ 51 тест стенда трафика и 130+ тестов упаковки и нотаризации пройдены
✓ Проверка синтаксиса shell, plist/strings и внутренних Markdown-ссылок пройдена
✓ Компиляция Debug SentinelApp и Release Universal SentinelDemoApp завершена`,
    },
    {
      badge: 'Терминал macOS · Локальная проверка скачанного архива',
      code: `# 1. Сверьте контрольные суммы SHA-256
shasum -a 256 -c SHA256SUMS

# 2. Извлеките архив и проверьте подпись обеих архитектур (arm64 и x86_64)
ditto -x -k VPN-Sentinel-Demo.zip ./extracted
codesign --verify --deep --strict --all-architectures "./extracted/VPN Sentinel Demo.app"

# 3. Проверьте прикреплённый ticket нотаризации Apple и допуск Gatekeeper
xcrun stapler validate "./extracted/VPN Sentinel Demo.app"
spctl --assess --type execute --verbose=4 "./extracted/VPN Sentinel Demo.app"`,
    },
  ],
};

let activeLedgerIndex = 0;

function renderLedger() {
  const entries = LEDGER_ENTRIES[currentLanguage] || LEDGER_ENTRIES.en;
  const item = entries[activeLedgerIndex] || entries[0];
  const badgeEl = document.getElementById('ledger-badge');
  const codeEl = document.getElementById('ledger-code');
  if (badgeEl) badgeEl.textContent = item.badge;
  if (codeEl) codeEl.textContent = item.code;

  document.querySelectorAll('[data-seek]').forEach((btn, idx) => {
    if (idx === activeLedgerIndex) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
}

function setupChapters() {
  const buttons = [...document.querySelectorAll('[data-seek]')];
  buttons.forEach((button, index) => {
    button.addEventListener('click', () => {
      activeLedgerIndex = index;
      renderLedger();
    });
  });

  const copyBtn = document.getElementById('ledger-copy');
  copyBtn?.addEventListener('click', () => {
    const codeEl = document.getElementById('ledger-code');
    if (!codeEl || !navigator.clipboard) return;
    navigator.clipboard.writeText(codeEl.textContent || '').then(() => {
      const dict = I18N[currentLanguage] || I18N.en;
      copyBtn.textContent = dict.copiedSnippetBtn;
      window.setTimeout(() => {
        copyBtn.textContent = (I18N[currentLanguage] || I18N.en).copySnippetBtn;
      }, 1600);
    }).catch(() => {});
  });
}

/* ---------- Apply language ---------- */

function applyLanguage(lang) {
  currentLanguage = SUPPORTED_LANGUAGES.includes(lang) ? lang : 'en';
  const dict = I18N[currentLanguage];

  document.documentElement.lang = currentLanguage;
  document.title = dict.metaTitle;
  document.querySelector('meta[name="description"]')?.setAttribute('content', dict.metaDescription);

  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const value = dict[el.dataset.i18n];
    if (value === undefined) return;
    el.textContent = fill(value);
    el.hidden = value === '';
  });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => {
    const value = dict[el.dataset.i18nHtml];
    if (value !== undefined) el.innerHTML = fill(value);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
    const value = dict[el.dataset.i18nAriaLabel];
    if (value) el.setAttribute('aria-label', value);
  });

  document.querySelectorAll('[data-language]').forEach((link) => {
    if (link.dataset.language === currentLanguage) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });

  renderLedger();
  demo.restart();
}

function setupLanguageSwitch() {
  document.querySelectorAll('[data-language]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const lang = link.dataset.language;
      storeLanguage(lang);
      const url = new URL(window.location.href);
      url.searchParams.set('lang', lang);
      history.replaceState(null, '', url);
      applyLanguage(lang);
    });
  });
}

/* ---------- Active section in the header ---------- */

function setupActiveNav() {
  const links = [...document.querySelectorAll('.primary-nav a')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  if (!('IntersectionObserver' in window) || sections.length === 0) return;
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${entry.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => observer.observe(s));
}

/* ---------- Hero 3D scene (loaded after the page, skipped without WebGL) ---------- */

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function loadHeroScene() {
  const canvas = document.getElementById('hero-canvas');
  const anchor = document.getElementById('stage-anchor');
  if (!canvas || !anchor || !supportsWebGL()) return;
  import('./scene3d.js')
    .then(({ HeroScene }) => {
      new HeroScene({ canvas, host: canvas.parentElement, anchor });
      canvas.classList.add('is-ready');
    })
    .catch(() => { /* the page works without the 3D scene */ });
}

const whenIdle = window.requestIdleCallback || ((fn) => window.setTimeout(fn, 200));
if (document.readyState === 'complete') whenIdle(loadHeroScene);
else window.addEventListener('load', () => whenIdle(loadHeroScene), { once: true });

setupLanguageSwitch();
setupChapters();
setupActiveNav();
applyLanguage(detectInitialLanguage());
loadLatestRelease();

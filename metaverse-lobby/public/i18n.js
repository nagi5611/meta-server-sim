(function () {
  'use strict';

  const STORAGE_KEY = 'mnm.locale';
  const SUPPORTED = ['ja', 'zh-CN', 'zh-TW', 'en'];
  const LOCALE_LABELS = {
    ja: '日本語',
    'zh-CN': '简体中文',
    'zh-TW': '繁體中文',
    en: 'English',
  };

  /** @type {Record<string, Record<string, string>> | null} */
  let catalog = null;
  let locale = 'ja';

  /** @type {Promise<void>} */
  let readyResolve;
  const ready = new Promise((resolve) => {
    readyResolve = resolve;
  });

  function normalizeNavLang(tag) {
    const t = String(tag || '').trim();
    if (!t) return 'ja';
    const lower = t.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return 'zh-TW';
    if (lower === 'zh-cn' || lower === 'zh-hans' || lower.startsWith('zh')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('ja')) return 'ja';
    return 'ja';
  }

  function resolveLocale() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED.includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    const nav = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const tag of nav) {
      const n = normalizeNavLang(tag);
      if (SUPPORTED.includes(n)) return n;
    }
    return 'ja';
  }

  /**
   * @param {string} key
   * @param {Record<string, string | number> | undefined} vars
   */
  function t(key, vars) {
    const table = catalog?.[locale] || catalog?.ja || {};
    let s = table[key] ?? catalog?.ja?.[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  }

  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (key) el.innerHTML = t(key);
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    scope.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      const key = el.getAttribute('data-i18n-alt');
      if (key) el.setAttribute('alt', t(key));
    });
    const titleKey = document.body?.getAttribute('data-i18n-document-title');
    if (titleKey) document.title = t(titleKey);
  }

  function fillLocaleSelects() {
    document.querySelectorAll('select.locale-select').forEach((sel) => {
      if (!sel.dataset.i18nWired) {
        sel.dataset.i18nWired = '1';
        sel.innerHTML = SUPPORTED.map(
          (code) => `<option value="${code}">${LOCALE_LABELS[code] || code}</option>`,
        ).join('');
        sel.addEventListener('change', () => setLocale(sel.value));
      }
      sel.value = locale;
    });
  }

  function setLocale(next) {
    if (!SUPPORTED.includes(next)) return;
    locale = next;
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = locale === 'zh-CN' || locale === 'zh-TW' ? locale : locale.split('-')[0];
    applyDom();
    fillLocaleSelects();
    window.dispatchEvent(new CustomEvent('lobby:locale-change', { detail: { locale } }));
  }

  async function loadCatalog() {
    const res = await fetch('/locales.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('locales_load_failed');
    catalog = await res.json();
    if (!catalog?.ja) throw new Error('locales_invalid');
    locale = resolveLocale();
    document.documentElement.lang =
      locale === 'zh-CN' || locale === 'zh-TW' ? locale : locale.split('-')[0];
    applyDom();
    fillLocaleSelects();
    readyResolve();
  }

  window.LobbyI18n = {
    t,
    setLocale,
    getLocale: () => locale,
    supportedLocales: SUPPORTED,
    applyDom,
    ready,
  };

  loadCatalog().catch(() => {
    catalog = { ja: {} };
    readyResolve();
  });
})();
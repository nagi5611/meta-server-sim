(function () {
  'use strict';

  const STORAGE_KEY = 'mnm.locale';
  const SUPPORTED = ['ja', 'zh-CN', 'zh-TW', 'en'];
  const LOCALE_LABELS = {
    ja: '日本語',
    'zh-CN': '中文',
    'zh-TW': '中文（台湾）',
    en: 'English',
  };
  const LOCALE_CODES = {
    ja: 'JA',
    'zh-CN': 'ZH-CN',
    'zh-TW': 'ZH-TW',
    en: 'EN',
  };

  /** @param {string} code */
  function localeOptionLabel(code) {
    const name = LOCALE_LABELS[code] || code;
    const tag = LOCALE_CODES[code] || code.toUpperCase();
    return `${name} / ${tag}`;
  }
  const LOCALE_FLAGS = {
    ja: '🇯🇵',
    'zh-CN': '🇨🇳',
    'zh-TW': '🇹🇼',
    en: '🇺🇸',
  };

  /** @type {Set<HTMLElement>} */
  const localeDropdownRoots = new Set();
  let localeGlobalListenersWired = false;

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

  function closeAllLocaleMenus() {
    localeDropdownRoots.forEach((root) => {
      const menu = root.querySelector('.locale-select__menu');
      const trigger = root.querySelector('.locale-select__trigger');
      if (menu && !menu.hidden) {
        menu.hidden = true;
        root.classList.remove('is-open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
      }
    });
  }

  function wireLocaleGlobalListeners() {
    if (localeGlobalListenersWired) return;
    localeGlobalListenersWired = true;
    document.addEventListener('click', (ev) => {
      const t = /** @type {HTMLElement} */ (ev.target);
      if (t.closest?.('.locale-select')) return;
      closeAllLocaleMenus();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeAllLocaleMenus();
    });
  }

  /**
   * @param {HTMLElement} host
   */
  function ensureLocaleDropdown(host) {
    if (host.dataset.i18nWired === '1') return host;
    host.dataset.i18nWired = '1';
    host.classList.add('locale-select');
    if (!host.hasAttribute('data-locale-select')) host.setAttribute('data-locale-select', '');

    const labelledBy = host.getAttribute('aria-labelledby') || '';
    host.setAttribute('role', 'combobox');
    host.setAttribute('aria-haspopup', 'listbox');
    host.setAttribute('aria-expanded', 'false');
    if (labelledBy) host.setAttribute('aria-labelledby', labelledBy);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'locale-select__trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.innerHTML =
      '<span class="locale-select__flag" aria-hidden="true"></span>' +
      '<span class="locale-select__label"></span>' +
      '<span class="locale-select__chev" aria-hidden="true"></span>';

    const menu = document.createElement('ul');
    menu.className = 'locale-select__menu';
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    menu.innerHTML = SUPPORTED.map((code) => {
      const label = localeOptionLabel(code);
      const flag = LOCALE_FLAGS[code] || '';
      return (
        `<li class="locale-select__option" role="option" data-locale="${code}" ` +
        `aria-selected="false" tabindex="-1">` +
        `<span class="locale-select__opt-flag" aria-hidden="true">${flag}</span>` +
        `<span class="locale-select__opt-label">${label}</span></li>`
      );
    }).join('');

    host.replaceChildren(trigger, menu);
    localeDropdownRoots.add(host);

    trigger.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const isOpen = !menu.hidden;
      closeAllLocaleMenus();
      if (!isOpen) {
        menu.hidden = false;
        host.classList.add('is-open');
        trigger.setAttribute('aria-expanded', 'true');
        host.setAttribute('aria-expanded', 'true');
        const current = menu.querySelector('.locale-select__option[aria-selected="true"]');
        (current || menu.querySelector('.locale-select__option'))?.focus?.();
      }
    });

    menu.querySelectorAll('.locale-select__option').forEach((opt) => {
      opt.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const code = opt.getAttribute('data-locale');
        if (code) setLocale(code);
        closeAllLocaleMenus();
      });
      opt.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          const code = opt.getAttribute('data-locale');
          if (code) setLocale(code);
          closeAllLocaleMenus();
        }
      });
    });

    wireLocaleGlobalListeners();
    return host;
  }

  function upgradeLegacyLocaleSelects() {
    document.querySelectorAll('select.locale-select').forEach((sel) => {
      const div = document.createElement('div');
      div.className = 'locale-select';
      div.setAttribute('data-locale-select', '');
      const labelledBy = sel.getAttribute('aria-labelledby');
      if (labelledBy) div.setAttribute('aria-labelledby', labelledBy);
      const parent = sel.parentNode;
      if (parent) parent.replaceChild(div, sel);
      ensureLocaleDropdown(div);
    });
  }

  function syncLocaleDropdowns() {
    localeDropdownRoots.forEach((root) => {
      const flagEl = root.querySelector('.locale-select__flag');
      const labelEl = root.querySelector('.locale-select__label');
      if (flagEl) flagEl.textContent = LOCALE_FLAGS[locale] || '';
      if (labelEl) labelEl.textContent = localeOptionLabel(locale);
      root.querySelectorAll('.locale-select__option').forEach((opt) => {
        const code = opt.getAttribute('data-locale');
        const selected = code === locale;
        opt.setAttribute('aria-selected', selected ? 'true' : 'false');
        opt.classList.toggle('is-selected', selected);
      });
    });
  }

  function fillLocaleSelects() {
    upgradeLegacyLocaleSelects();
    document.querySelectorAll('[data-locale-select]').forEach((el) => {
      ensureLocaleDropdown(/** @type {HTMLElement} */ (el));
    });
    syncLocaleDropdowns();
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
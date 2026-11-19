(function () {
  'use strict';

  const LABEL_SHOW = 'パスワードを表示';
  const LABEL_HIDE = 'パスワードを非表示';

  const EYE_OPEN =
    '<svg class="pwd-ic-show" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF =
    '<svg class="pwd-ic-hide" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.24 4.24"/><path d="M6.7 6.7C4.6 8.1 3 10.2 2 12s3.5 7 10 7c1.6 0 3-.3 4.3-.9"/><path d="M9.5 5.1A10.8 10.8 0 0 1 12 5c6.5 0 10 7 10 7a16.4 16.4 0 0 1-2.3 3.2"/><path d="M14.1 9.9C13.7 9.4 12.9 9 12 9a3 3 0 0 0-2.1 5.1"/></svg>';

  /** @param {HTMLElement} wrap */
  function wire(wrap) {
    const input = wrap.querySelector('input');
    if (!input) return;
    let btn = wrap.querySelector('.pwd-toggle');
    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pwd-toggle';
      btn.innerHTML = EYE_OPEN + EYE_OFF;
      wrap.appendChild(btn);
    }
    btn.setAttribute('aria-label', LABEL_SHOW);
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.classList.toggle('is-visible', show);
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? LABEL_HIDE : LABEL_SHOW);
    });
  }

  document.querySelectorAll('.pwd-wrap').forEach(wire);
})();
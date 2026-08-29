// public/js/admin-url-sanitize.js — URL 内の Basic 認証情報を除去（fetch ブロック回避）
(function sanitizeAdminUrlCredentials() {
    const { protocol, host, pathname, search, hash, username, password } = window.location;
    if (!username && !password) return;

    const clean = `${protocol}//${host}${pathname}${search}${hash}`;
    window.location.replace(clean);
})();

// public/console/mt-admin-early.js — CSP 対応: admin.html のインライン boot を外部化
(function () {
    'use strict';
    window.__MT_BOOT__ = window.__MT_BOOT__ || {};
    if (!window.__nativeAdminFetch) {
        window.__nativeAdminFetch = window.fetch.bind(window);
    }
})();
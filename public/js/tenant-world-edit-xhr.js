// public/js/tenant-world-edit-xhr.js — モデルアップロード XHR の URL 書き換えと CSRF 付与
import { rewriteTenantWorldEditApiUrl } from './tenant-world-edit-api-paths.js';
import { ADMIN_CSRF_HEADER, getAdminCsrfTokenSync } from './admin-api-fetch.js';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * setting.js の XMLHttpRequest アップロードを Tenant 管理 API 向けに補正する
 */
export function installTenantWorldEditXhrShim() {
    if (window.__tenantWorldEditXhrShimInstalled) return;
    window.__tenantWorldEditXhrShimInstalled = true;

    const origOpen = XMLHttpRequest.prototype.open;
    const origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
        this.__tenantWorldEditMethod = String(method || 'GET').toUpperCase();
        const rawUrl = typeof url === 'string' ? url : String(url);
        this.__tenantWorldEditUrl = rewriteTenantWorldEditApiUrl(rawUrl);
        return origOpen.call(this, method, this.__tenantWorldEditUrl, ...rest);
    };

    XMLHttpRequest.prototype.setRequestHeader = function setRequestHeader(name, value) {
        this.__tenantWorldEditHeadersSet = true;
        return origSetRequestHeader.call(this, name, value);
    };

    XMLHttpRequest.prototype.send = function send(body) {
        const url = typeof this.__tenantWorldEditUrl === 'string' ? this.__tenantWorldEditUrl : '';
        const method = this.__tenantWorldEditMethod || 'GET';
        if (
            url.startsWith('/admin') &&
            MUTATING.has(method) &&
            !this.__tenantWorldEditCsrfApplied
        ) {
            const token = getAdminCsrfTokenSync();
            if (token) {
                origSetRequestHeader.call(this, ADMIN_CSRF_HEADER, token);
                this.__tenantWorldEditCsrfApplied = true;
            }
        }
        return origSend.call(this, body);
    };
}

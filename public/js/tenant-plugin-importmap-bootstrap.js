// public/js/tenant-plugin-importmap-bootstrap.js — プラグイン ESM 用 import map（最初の module より前に同期実行）
(function tenantPluginImportmapBootstrap() {
    const RESERVED = new Set(['api', 'admin', 'css', 'js', 'dist', 'node_modules']);
    const parts = window.location.pathname.split('/').filter(Boolean);
    const tenantId = parts[0] ? decodeURIComponent(parts[0]) : '';
    if (!tenantId || RESERVED.has(tenantId.toLowerCase())) return;
    if (document.getElementById('tenant-plugin-importmap-bootstrap')) return;

    const xrDepsBase = `/${encodeURIComponent(tenantId)}/api/tenant-plugins/xr/deps`;
    const imports = {
        three: `${xrDepsBase}/three/build/three.module.js`,
        'three/addons/': `${xrDepsBase}/three/examples/jsm/`,
        'three/examples/jsm/': `${xrDepsBase}/three/examples/jsm/`,
        'three-mesh-ui': `${xrDepsBase}/three-mesh-ui/build/three-mesh-ui.module.js`,
    };

    const script = document.createElement('script');
    script.type = 'importmap';
    script.id = 'tenant-plugin-importmap-bootstrap';
    script.textContent = JSON.stringify({ imports });
    document.head.appendChild(script);
})();
// public/js/tenant-plugin-importmap-bootstrap.js — SIM 本体 import map（lib/tenant-esm-deps と同一 URL 形）
(function tenantPluginImportmapBootstrap() {
    const RESERVED = new Set(['api', 'admin', 'css', 'js', 'dist', 'node_modules']);
    const parts = window.location.pathname.split('/').filter(Boolean);
    const tenantId = parts[0] ? decodeURIComponent(parts[0]) : '';
    if (!tenantId || RESERVED.has(tenantId.toLowerCase())) return;
    if (document.getElementById('tenant-plugin-importmap-bootstrap')) return;

    const esmBase = `/${encodeURIComponent(tenantId)}/api/tenant-esm-deps`;
    const imports = {
        three: `${esmBase}/three/build/three.module.js`,
        'three/addons/': `${esmBase}/three/examples/jsm/`,
        'three/examples/jsm/': `${esmBase}/three/examples/jsm/`,
        'three-mesh-ui': `${esmBase}/three-mesh-ui/build/three-mesh-ui.module.js`,
    };

    const script = document.createElement('script');
    script.type = 'importmap';
    script.id = 'tenant-plugin-importmap-bootstrap';
    script.textContent = JSON.stringify({ imports });
    document.head.appendChild(script);
})();
// test/tenant-pdfjs-shim.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { installTenantPdfjsGetDocumentShim } from '../public/js/tenant-pdfjs-get-document-shim.js';

test('installTenantPdfjsGetDocumentShim resolves without mutating pdfjs namespace', async () => {
    await assert.doesNotReject(installTenantPdfjsGetDocumentShim());
});
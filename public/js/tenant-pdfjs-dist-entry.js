// public/js/tenant-pdfjs-dist-entry.js — pdfjs-dist の Vite エントリ（getDocument のみテナント向けに上書き）
export * from 'pdfjs-dist-original';
export { tenantGetDocument as getDocument } from './tenant-pdfjs-get-document-impl.js';
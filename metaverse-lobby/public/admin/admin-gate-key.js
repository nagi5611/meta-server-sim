(function () {
  'use strict';

  const PREFIX = 'lobby-admin-key-v1:';
  const REGISTER_PREFIX = 'lobby-admin-key-register-v1:';

  function pemToDer(pem) {
    const b64 = String(pem || '')
      .replace(/-----BEGIN[\s\S]+?-----/g, '')
      .replace(/-----END[\s\S]+?-----/g, '')
      .replace(/\s+/g, '');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function derToPem(label, der) {
    let b64 = btoa(String.fromCharCode(...der));
    const lines = b64.match(/.{1,64}/g) || [];
    return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
  }

  /**
   * PKCS#8 Ed25519 秘密鍵 PEM → CryptoKey
   * @param {string} pem
   */
  async function importEd25519PrivateKeyPem(pem) {
    const der = pemToDer(pem);
    return crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
  }

  /**
   * @param {CryptoKey} privateKey
   * @param {string} challengeId
   * @param {string} nonce
   * @param {string} [messagePrefix]
   */
  async function signChallenge(privateKey, challengeId, nonce, messagePrefix) {
    const pfx = messagePrefix || PREFIX;
    const msg = new TextEncoder().encode(`${pfx}${challengeId}:${nonce}`);
    const sig = await crypto.subtle.sign('Ed25519', privateKey, msg);
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
  }

  async function signAdminKeyChallenge(privateKey, challengeId, nonce) {
    return signChallenge(privateKey, challengeId, nonce, PREFIX);
  }

  async function signAdminKeyRegisterReauth(privateKey, challengeId, nonce) {
    return signChallenge(privateKey, challengeId, nonce, REGISTER_PREFIX);
  }

  /**
   * @param {File} file
   */
  async function readAdminKeyFile(file) {
    const text = await file.text();
    return importEd25519PrivateKeyPem(text);
  }

  /**
   * ブラウザ上で Ed25519 鍵ペアを生成
   */
  async function generateEd25519KeyPair() {
    return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  }

  /**
   * @param {CryptoKey} publicKey
   */
  async function exportEd25519PublicKeyB64(publicKey) {
    const raw = await crypto.subtle.exportKey('raw', publicKey);
    return btoa(String.fromCharCode(...new Uint8Array(raw)));
  }

  /**
   * @param {CryptoKey} privateKey
   */
  async function exportEd25519PrivateKeyPem(privateKey) {
    const der = await crypto.subtle.exportKey('pkcs8', privateKey);
    return derToPem('PRIVATE KEY', new Uint8Array(der));
  }

  function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/x-pem-file' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  window.LobbyAdminGateKey = {
    importEd25519PrivateKeyPem,
    signAdminKeyChallenge,
    signAdminKeyRegisterReauth,
    readAdminKeyFile,
    generateEd25519KeyPair,
    exportEd25519PublicKeyB64,
    exportEd25519PrivateKeyPem,
    downloadTextFile,
  };
})();
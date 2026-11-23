import crypto from 'node:crypto';

/**
 * @returns {{ publicKeyB64: string, privateKeyPem: string, fingerprint: string }}
 */
export function generateTestEd25519Keypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const derPub = publicKey.export({ type: 'spki', format: 'der' });
    const rawPub = derPub.subarray(-32);
    const publicKeyB64 = rawPub.toString('base64');
    const fingerprint = crypto.createHash('sha256').update(rawPub).digest('hex');
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    return { publicKeyB64, privateKeyPem, fingerprint };
}

/**
 * @param {string} privateKeyPem
 * @param {string} message
 */
export function signEd25519Message(privateKeyPem, message) {
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(message, 'utf8'), key);
    return sig.toString('base64');
}
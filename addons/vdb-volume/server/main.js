// addons/vdb-volume/server/main.js — NanoVDB / OpenVDB ボリューム配信用テナントプラグイン
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

/**
 * @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx
 */
export default {
    async register(ctx) {
        ctx.mountHttp((router) => {
            router.get('/samples', (_req, res) => {
                let files = [];
                try {
                    files = fs
                        .readdirSync(SAMPLES_DIR)
                        .filter((n) => /\.(nvdb|vdb)$/i.test(n))
                        .sort();
                } catch {
                    files = [];
                }
                res.json({
                    ok: true,
                    pluginId: ctx.pluginId,
                    samples: files,
                });
            });

            router.get('/health', (_req, res) => {
                res.json({ ok: true, pluginId: ctx.pluginId });
            });
        });

        ctx.logger.info('registered (client loads volumes from worlds.json vdbs[])');
    },
};
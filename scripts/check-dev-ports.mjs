// scripts/check-dev-ports.mjs — npm run dev 前のポートプリフライト

import 'dotenv/config';
import process from 'node:process';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readAllDevPorts } from './read-dev-vite-ports.mjs';
import { findPortConflicts, freePortConflicts } from './dev-port-utils.mjs';

function shouldSkipCheck() {
    const raw = String(process.env.SKIP_PORT_CHECK || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function shouldForceKill() {
    const raw = String(process.env.FORCE_KILL_PORTS || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isNonInteractiveMode() {
    if (String(process.env.CI || '').trim() === 'true' || String(process.env.CI || '').trim() === '1') {
        return true;
    }
    if (String(process.env.NON_INTERACTIVE || '').trim() === '1') {
        return true;
    }
    return !input.isTTY;
}

/**
 * @param {{ port: number, occupants: { pid: number, processName: string | null }[] }[]} conflicts
 */
function printPortConflictReport(conflicts) {
    console.error('[dev] 次のポートは既に使用中です:');
    for (const { port, occupants } of conflicts) {
        for (const { pid, processName } of occupants) {
            const label = processName ? `${processName} (PID ${pid})` : `PID ${pid}`;
            console.error(`  - ポート ${port}: ${label}`);
        }
    }
}

/**
 * @param {string} message
 * @returns {Promise<boolean>}
 */
async function promptYesNo(message) {
    const rl = readline.createInterface({ input, output });
    try {
        const answer = (await rl.question(message)).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
    } finally {
        rl.close();
    }
}

async function main() {
    if (shouldSkipCheck()) {
        console.log('[dev] SKIP_PORT_CHECK: ポートチェックをスキップします');
        return;
    }

    const ports = readAllDevPorts();
    console.log(`[dev] プリフライト: ポート ${ports.join(', ')} を確認します`);

    const conflicts = findPortConflicts(ports);
    if (conflicts.length === 0) {
        console.log('[dev] すべてのポートは利用可能です');
        return;
    }

    printPortConflictReport(conflicts);

    if (isNonInteractiveMode()) {
        if (shouldForceKill()) {
            console.log('[dev] FORCE_KILL_PORTS: 占有プロセスを終了します');
            freePortConflicts(conflicts);
            return;
        }
        console.error(
            '[dev] 非インタラクティブ環境では起動を中止します。' +
                ' 占有を解除するには FORCE_KILL_PORTS=1、チェック省略は SKIP_PORT_CHECK=1'
        );
        process.exit(1);
    }

    const ok = await promptYesNo(
        '占有プロセスを終了して開発サーバーを起動しますか？ [y/N]: '
    );
    if (!ok) {
        console.error('[dev] 中止しました。ポートを空けてから再度 npm run dev を実行してください。');
        process.exit(1);
    }

    freePortConflicts(conflicts);
    console.log('[dev] ポートを解放しました。開発サーバーを起動します。');
}

main().catch((e) => {
    console.error('[dev] port preflight failed:', e instanceof Error ? e.message : e);
    process.exit(1);
});

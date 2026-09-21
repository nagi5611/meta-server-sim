// scripts/free-dev-ports.mjs — dev 用ポートの占有プロセスを強制解放（確認なし）
import 'dotenv/config';
import { readAllDevPorts } from './read-dev-vite-ports.mjs';
import { findPortConflicts, freePortConflicts } from './dev-port-utils.mjs';

const conflicts = findPortConflicts(readAllDevPorts());
if (conflicts.length === 0) {
    console.log('[dev] 解放対象のポート占有はありません');
} else {
    freePortConflicts(conflicts);
}

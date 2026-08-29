// public/js/admin-api-fetch-init.js
import { initAdminCsrf, installAdminFetchPatch } from './admin-api-fetch.js';

installAdminFetchPatch();

/**
 * CSRF 初期化まで完了させる（管理 API 呼び出し前に必須）
 */
export async function bootstrapAdminApi() {
    await initAdminCsrf();
}

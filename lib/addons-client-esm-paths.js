// lib/addons-client-esm-paths.js — addons-client 直配信モジュールが参照する SIM 本体静的パス

/**
 * metaverse-simple i18n（server.js が /js/* で配信。子モジュール locale も同ディレクトリに配信必須）
 * @see server.js simpleSharedJs
 */
export const METAVERSE_I18N_MODULE = '/js/metaverse-i18n.js';

/** metaverse-simple 静的ミラー（server.js /metaverse-simple-static） */
export const IBL_SETUP_MODULE = '/metaverse-simple-static/js/ibl-setup.js';

// addons/matsuyama-flights/client/flight-board-i18n.js — 発着板用 i18n（addon 単体配信向け）
/** @type {Record<string, Record<string, string>>} */
const MESSAGES = {
    'flightBoard.opsStatus': { ja: '運行状況', en: 'Operations', zh: '运行状况' },
    'flightBoard.filterDomestic': { ja: '国内線', en: 'Domestic', zh: '国内线' },
    'flightBoard.filterInternational': { ja: '国際線', en: 'International', zh: '国际线' },
    'flightBoard.layoutAlert': { ja: 'LAYOUT ALERT', en: 'LAYOUT ALERT', zh: 'LAYOUT ALERT' },
    'flightBoard.loading': { ja: 'データ取得中…', en: 'Loading flight data…', zh: '正在获取数据…' },
    'flightBoard.fetchFailed': { ja: '取得失敗', en: 'Fetch failed', zh: '获取失败' },
    'flightBoard.depSection': { ja: '出発 DEP', en: 'DEPARTURES', zh: '出发 DEP' },
    'flightBoard.arrSection': { ja: '到着 ARR', en: 'ARRIVALS', zh: '到达 ARR' },
    'flightBoard.colTime': { ja: '時刻', en: 'Time', zh: '时刻' },
    'flightBoard.colFlight': { ja: '便名', en: 'Flight', zh: '航班' },
    'flightBoard.colAirline': { ja: '会社', en: 'Airline', zh: '航空公司' },
    'flightBoard.colDestination': { ja: '行き先', en: 'Destination', zh: '目的地' },
    'flightBoard.colOrigin': { ja: '出発', en: 'Origin', zh: '出发地' },
    'flightBoard.colStatus': { ja: '状況', en: 'Status', zh: '状态' },
    'flightBoard.changed': { ja: 'changed', en: 'changed', zh: 'changed' },
    'flightBoard.noData': { ja: '--- NO DATA ---', en: '--- NO DATA ---', zh: '--- NO DATA ---' },
    'flightBoard.srcAirport': { ja: 'SRC 松山空港', en: 'SRC Matsuyama Airport', zh: 'SRC 松山机场' },
    'flightBoard.srcBackup': {
        ja: 'SRC ODPT/JETSTAR (backup)',
        en: 'SRC ODPT/JETSTAR (backup)',
        zh: 'SRC ODPT/JETSTAR (backup)',
    },
    'flightBoard.editorAll': { ja: '発着（全便）', en: 'Flights (all)', zh: '航班（全部）' },
    'flightBoard.editorDomestic': { ja: '発着（国内線）', en: 'Flights (domestic)', zh: '航班（国内线）' },
    'flightBoard.editorInternational': {
        ja: '発着（国際線）',
        en: 'Flights (international)',
        zh: '航班（国际线）',
    },
    'flightBoard.previewDefault': {
        ja: '松山空港 運行状況（保存後に表示）',
        en: 'Matsuyama Airport — operations (shown after save)',
        zh: '松山机场 运行状况（保存后显示）',
    },
    'flightBoard.previewWithTag': {
        ja: '松山空港 {tag}（保存後に表示）',
        en: 'Matsuyama Airport {tag} (shown after save)',
        zh: '松山机场 {tag}（保存后显示）',
    },
    'flightBoard.previewOps': {
        ja: '松山空港 運行状況',
        en: 'Matsuyama Airport — operations',
        zh: '松山机场 运行状况',
    },
    'flightBoard.previewTagOnly': {
        ja: '松山空港 {tag}',
        en: 'Matsuyama Airport {tag}',
        zh: '松山机场 {tag}',
    },
};

/**
 * @returns {'ja'|'en'|'zh'|'zh-tw'|'ko'}
 */
export function getMetaverseLocale() {
    try {
        const loc = localStorage.getItem('metaverse-locale');
        if (loc === 'en' || loc === 'zh' || loc === 'zh-tw' || loc === 'ko') return loc;
    } catch {
        /* ignore */
    }
    return 'ja';
}

/**
 * @param {string} key
 * @param {Record<string, string|number>|undefined} [vars]
 * @returns {string}
 */
export function t(key, vars) {
    const loc = getMetaverseLocale();
    const entry = MESSAGES[key];
    if (!entry) return key;
    let text = entry[loc] || entry.ja || key;
    if (vars && typeof vars === 'object') {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, String(v));
        }
    }
    return text;
}
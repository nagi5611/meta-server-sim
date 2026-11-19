import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLobbyInstant, formatLobbyLocalTime, formatLobbyDate } from '../metaverse-lobby/public/lobby-time.js';

test('parseLobbyInstant: Zulu ISO', () => {
    const d = parseLobbyInstant('2026-11-19T15:50:31.790Z');
    assert.equal(d.toISOString(), '2026-11-19T15:50:31.790Z');
});

test('parseLobbyInstant: naive ISO is UTC', () => {
    const d = parseLobbyInstant('2026-11-19T16:00:13');
    assert.equal(d.toISOString(), '2026-11-19T16:00:13.000Z');
});

test('parseLobbyInstant: unix ms string', () => {
    const d = parseLobbyInstant('1732036231790');
    assert.equal(d.getTime(), 1732036231790);
});

test('formatLobbyDate: Y/M/D with slashes in local TZ', () => {
    const d = parseLobbyInstant('2026-11-20T00:30:00Z');
    const expected = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    })
        .formatToParts(d)
        .reduce((acc, p) => {
            if (p.type === 'year' || p.type === 'month' || p.type === 'day') acc[p.type] = p.value;
            return acc;
        }, /** @type {Record<string, string>} */ ({}));
    assert.equal(
        formatLobbyDate('2026-11-20T00:30:00Z'),
        `${expected.year}/${expected.month}/${expected.day}`,
    );
});

test('formatLobbyLocalTime: applies timezone conversion', () => {
    const d = parseLobbyInstant('2026-11-18T05:52:17.138Z');
    const jst = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tokyo',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).format(d);
    assert.equal(jst, '14:52:17');
    assert.equal(
        formatLobbyLocalTime(d, { timeZone: 'Asia/Tokyo' }),
        jst,
    );
});
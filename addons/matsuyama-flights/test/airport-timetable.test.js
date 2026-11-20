// addons/matsuyama-flights/test/airport-timetable.test.js
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAirportTimetable } from '../lib/airport-timetable-client.js';
import { validateAirportTimetableLayout } from '../lib/layout-signature.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
    path.join(__dirname, '..', 'test-fixtures', 'timetable-reference.html'),
    'utf8'
);

describe('matsuyama-flights airport timetable parser', () => {
    it('validates reference fixture layout', () => {
        const layout = validateAirportTimetableLayout(fixtureHtml);
        assert.equal(layout.valid, true, layout.reasons?.join('; '));
    });

    it('parses departures and arrivals from fixture', () => {
        const parsed = parseAirportTimetable(fixtureHtml);
        assert.ok(parsed.departures.length > 0);
        assert.ok(parsed.arrivals.length > 0);
        assert.ok(parsed.departures[0].flight || parsed.departures[0].time);
    });
});
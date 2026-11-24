import assert from 'node:assert/strict';
import {
    formatOrderDateTimeAR,
    getArgentinaDateKey,
    getDateRangePresetAR,
    detectDatePresetAR,
    shiftDateKey,
} from '../helpers/orderDateHelpers';

// 1. Cambio de día según horario argentino (2026-11-25 01:30 UTC = 2026-11-24 22:30 ART)
const lateNightAr = new Date('2026-11-25T01:30:00.000Z');
assert.equal(getArgentinaDateKey(lateNightAr), '2026-11-24');

const formattedLate = formatOrderDateTimeAR('2026-11-25T01:30:00.000Z');
assert.deepEqual(formattedLate, { date: '24/11/2026', time: '22:30' });

// Medianoche exacta en ART (03:00 UTC = 00:00 ART)
const midnightAr = formatOrderDateTimeAR('2026-11-25T03:00:00.000Z');
assert.deepEqual(midnightAr, { date: '25/11/2026', time: '00:00' });

// Null / inválido no inventa fecha
assert.equal(formatOrderDateTimeAR(null), null);
assert.equal(formatOrderDateTimeAR(undefined), null);
assert.equal(formatOrderDateTimeAR('not-a-date'), null);

// 2. Presets de fecha en horario argentino
assert.deepEqual(getDateRangePresetAR('today', lateNightAr), {
    desde: '2026-11-24',
    hasta: '2026-11-24',
});
assert.deepEqual(getDateRangePresetAR('yesterday', lateNightAr), {
    desde: '2026-11-23',
    hasta: '2026-11-23',
});
assert.deepEqual(getDateRangePresetAR('last7', lateNightAr), {
    desde: '2026-11-18',
    hasta: '2026-11-24',
});
assert.deepEqual(getDateRangePresetAR('this_month', lateNightAr), {
    desde: '2026-11-01',
    hasta: '2026-11-24',
});
assert.deepEqual(getDateRangePresetAR('prev_month', lateNightAr), {
    desde: '2026-10-01',
    hasta: '2026-10-31',
});

// Cambio de año en Enero -> Mes anterior = Diciembre del año previo
const janAr = new Date('2026-01-15T15:00:00.000Z');
assert.deepEqual(getDateRangePresetAR('prev_month', janAr), {
    desde: '2025-12-01',
    hasta: '2025-12-31',
});
assert.equal(shiftDateKey('2026-03-01', -1), '2026-02-28');

// 3. Detección de preset desde query params
assert.equal(detectDatePresetAR('', '', lateNightAr), 'all');
assert.equal(detectDatePresetAR('2026-11-24', '2026-11-24', lateNightAr), 'today');
assert.equal(detectDatePresetAR('2026-11-23', '2026-11-23', lateNightAr), 'yesterday');
assert.equal(detectDatePresetAR('2026-11-18', '2026-11-24', lateNightAr), 'last7');
assert.equal(detectDatePresetAR('2026-11-01', '2026-11-24', lateNightAr), 'this_month');
assert.equal(detectDatePresetAR('2026-10-01', '2026-10-31', lateNightAr), 'prev_month');
assert.equal(detectDatePresetAR('2026-11-10', '2026-11-20', lateNightAr), 'custom');

console.log('=== UX-05.2 ORDER DATE HELPERS SUITE: 3/3 PASS ===');

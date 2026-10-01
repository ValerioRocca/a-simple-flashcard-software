import { describe, test, assert } from './harness.js';
import {
  dayIndex, dayStart, nextDayStart, dateOfDayIndex, formatMinutes, formatDays, formatDuration,
} from '../js/core/time.js';

describe('Study days', () => {
  test('a study day runs from 04:00 to 04:00', () => {
    const monday = dayIndex(new Date(2026, 9, 5, 12, 0));
    assert.equal(dayIndex(new Date(2026, 9, 5, 4, 0)), monday);
    assert.equal(dayIndex(new Date(2026, 9, 5, 23, 59)), monday);
    assert.equal(dayIndex(new Date(2026, 9, 6, 3, 59)), monday);
    assert.equal(dayIndex(new Date(2026, 9, 6, 4, 0)), monday + 1);
    assert.equal(dayIndex(new Date(2026, 9, 5, 3, 59)), monday - 1);
  });

  test('consecutive days differ by one across months, years and clock changes', () => {
    assert.equal(dayIndex(new Date(2026, 10, 1, 12)) - dayIndex(new Date(2026, 9, 31, 12)), 1);
    assert.equal(dayIndex(new Date(2027, 0, 1, 12)) - dayIndex(new Date(2026, 11, 31, 12)), 1);
    // Daylight saving changes in Europe: 29 March and 25 October 2026.
    assert.equal(dayIndex(new Date(2026, 2, 30, 12)) - dayIndex(new Date(2026, 2, 28, 12)), 2);
    assert.equal(dayIndex(new Date(2026, 9, 26, 12)) - dayIndex(new Date(2026, 9, 24, 12)), 2);
  });

  test('dayStart and nextDayStart bracket the moment', () => {
    const lateNight = new Date(2026, 9, 6, 1, 30);
    assert.deepEqual(dayStart(lateNight), new Date(2026, 9, 5, 4, 0));
    assert.deepEqual(nextDayStart(lateNight), new Date(2026, 9, 6, 4, 0));
    const morning = new Date(2026, 9, 6, 9, 0);
    assert.deepEqual(dayStart(morning), new Date(2026, 9, 6, 4, 0));
    assert.deepEqual(nextDayStart(morning), new Date(2026, 9, 7, 4, 0));
  });

  test('dateOfDayIndex gives back the calendar date', () => {
    const date = dateOfDayIndex(dayIndex(new Date(2026, 9, 5, 12, 0)));
    assert.deepEqual([date.getFullYear(), date.getMonth(), date.getDate()], [2026, 9, 5]);
  });
});

describe('Interval labels', () => {
  test('minutes, hours, days, months, years', () => {
    assert.equal(formatMinutes(0.5), '<1m');
    assert.equal(formatMinutes(1), '1m');
    assert.equal(formatMinutes(10), '10m');
    assert.equal(formatMinutes(90), '1.5h');
    assert.equal(formatMinutes(120), '2h');
    assert.equal(formatMinutes(1440), '1d');
    assert.equal(formatDays(4), '4d');
    assert.equal(formatDays(30), '30d');
    assert.equal(formatDays(61), '2mo');
    assert.equal(formatDays(45), '1.5mo');
    assert.equal(formatDays(730), '2y');
  });

  test('durations', () => {
    assert.equal(formatDuration(45_000), '45 s');
    assert.equal(formatDuration(12 * 60_000), '12 min');
    assert.equal(formatDuration(65 * 60_000), '1 h 05 min');
  });
});

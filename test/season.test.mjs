import test from 'node:test';
import assert from 'node:assert/strict';
import { SEASONAL, seasonNote } from '../worker/ideas-claude.mjs';

test('every month has a mood and seasonal produce', () => {
  const months = Array.from({ length: 12 }, (_, i) => new Date(2026, i, 1).toLocaleDateString('en-GB', { month: 'long' }));
  for (const m of months) {
    assert.ok(SEASONAL[m]?.mood && SEASONAL[m]?.produce, m);
    assert.match(seasonNote(m), new RegExp(`${m} in the UK.*\\nIn season in the UK now: `));
  }
});

test('an unknown month still gives a time of year', () => {
  assert.equal(seasonNote(''), 'Time of year: unknown, UK');
});

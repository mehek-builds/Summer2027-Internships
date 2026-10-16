import test from 'node:test';
import assert from 'node:assert/strict';
import { eligiblePostingLocation as eligible } from './posting-location.mjs';
test('foreign evidence overrides US metadata and colliding state abbreviations', () => {
  for (const location of ['United Kingdom, Edinburgh, SC, Freer', 'Hesse, DE', 'Remote Sweden', 'Remote Colombia', 'Curitiba, Brazil', 'Singapore, Singapore', 'Office - London, UK'])
    assert.equal(eligible({ location, job_country: location === 'Hesse, DE' ? 'non_us' : 'us' }), false, location);
});
test('individual US and Canadian evidence survives without treating bare remote as worldwide access', () => {
  for (const location of ['New York, NY', 'Ann Arbor, MI', 'Office - Chicago', 'Remote'])
    assert.equal(eligible({ location, job_country: 'us' }), true, location);
  for (const location of ['Toronto, ON', 'Vancouver, BC', 'Remote Canada', 'Ottawa, Ontario', 'United States'])
    assert.equal(eligible({ location, job_country: 'non_us' }), true, location);
  for (const location of ['Remote', 'Curitiba', 'Waterloo', 'Hesse, DE', 'Edinburgh, SC', '', null])
    assert.equal(eligible({ location, job_country: 'unknown' }), false, String(location));
});

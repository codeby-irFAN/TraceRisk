import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocationResolver } from '../server/locations.js';

test('location choices are bound to the query, expire, and preserve the chosen coordinates', async () => {
  let time = 0;
  const resolver = createLocationResolver({
    now: () => time,
    ttlMs: 1000,
    search: async () => [
      {
        name: 'Rampur',
        admin1: 'Uttar Pradesh',
        country: 'India',
        latitude: 28.8,
        longitude: 79,
      },
      {
        name: 'Rampur',
        admin1: 'Himachal Pradesh',
        country: 'India',
        latitude: 31.4,
        longitude: 77.6,
      },
    ],
  });
  const choices = await resolver.resolve('Rampur');
  assert.equal(choices.length, 2);
  assert.notEqual(choices[0].id, choices[1].id);
  const selected = resolver.get(choices[1].id, ' RAMPUR ');
  assert.equal(selected.admin1, 'Himachal Pradesh');
  assert.equal(selected.latitude, 31.4);
  assert.equal(resolver.get(choices[1].id, 'Delhi'), null);
  assert.equal(resolver.get('invented', 'Rampur'), null);
  time = 1001;
  assert.equal(resolver.get(choices[1].id, 'Rampur'), null);
});

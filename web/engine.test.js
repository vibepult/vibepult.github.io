import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyKey, deadLyrics, deadOptions, faderText, findBand, initialState, matchBands, nextIndex, nextLabel, query, recallBand,
} from './engine.js';

const band = (slug, a, s, extra = {}) => ({
  slug, name: slug.toUpperCase(), faders: { aggression: a, serenity: s },
  knobs: { era: 1990 }, switches: { active: true }, selectors: { country: 'NO' }, lyrics: [], ...extra,
});
const data = {
  faders: [
    { id: 'aggression', status: 'live', ticks: [{ value: 0, name: 'Calm' }, { value: 100, name: 'Loud' }] },
    { id: 'serenity', status: 'live', ticks: [] },
  ],
  knobs: [{ id: 'era', min: 1970, max: 2029 }],
  switches: [{ id: 'active' }],
  selectors: [{ id: 'country', options: ['NO', 'US'] }],
  lyrics: { id: 'lyrics', label: 'Lyrics', options: [{ id: 'occult', label: 'Occult' }, { id: 'nature', label: 'Nature' }, { id: 'war', label: 'War' }] },
  bands: [
    band('a', 0, 100, { lyrics: ['nature'] }), band('b', 50, 50), band('c', 100, 0, { lyrics: ['occult'] }),
    band('d', 90, 10, { switches: { active: false }, selectors: { country: 'US' }, lyrics: ['occult', 'nature'] }),
  ],
};
const slugs = q => q.ranked.map(b => b.slug);

test('initial state: faders at 50, every filter bypassed, no lyric axis pressed', () => {
  const s = initialState(data);
  assert.deepEqual(s.faders.aggression, { value: 50, bypass: false });
  assert.equal(s.knobs.era.bypass, true);
  assert.equal(s.switches.active.bypass, true);
  assert.equal(s.selectors.country.bypass, true);
  assert.deepEqual(s.lyrics, []);
});

test('lyrics: pressed axes are a union, none pressed means any, dead axes follow the other filters', () => {
  const s = initialState(data);
  assert.equal(slugs(query(data, s)).length, 4);
  s.lyrics = ['occult'];
  assert.deepEqual(slugs(query(data, s)).sort(), ['c', 'd']);
  s.lyrics = ['occult', 'nature'];
  assert.deepEqual(slugs(query(data, s)).sort(), ['a', 'c', 'd']);
  assert.deepEqual(deadLyrics(data, s), ['war']); // no band carries it
  s.switches.active = { on: true, bypass: false }; // d is inactive
  assert.deepEqual(slugs(query(data, s)).sort(), ['a', 'c']);
  s.selectors.country = { value: 'US', bypass: false }; // only d is US, and d is inactive
  assert.deepEqual(deadLyrics(data, s), ['occult', 'nature', 'war']);
  assert.equal(query(data, s).empty, true);
});

test('filter then distance over active dimensions', () => {
  const s = initialState(data);
  s.faders.aggression.value = 100;
  s.faders.serenity.value = 0;
  assert.equal(slugs(query(data, s))[0], 'c');
  s.switches.active.bypass = false; // active only; d is inactive
  assert.ok(!slugs(query(data, s)).includes('d'));
  s.switches.active.on = false;
  assert.deepEqual(slugs(query(data, s)), ['d']);
});

test('a bypassed dimension is dropped, not zeroed', () => {
  const s = initialState(data);
  s.faders.aggression.value = 100;
  s.faders.serenity = { value: 100, bypass: true };
  assert.equal(slugs(query(data, s))[0], 'c');
});

test('knob distance in real units scaled to the knob range', () => {
  const d2 = { ...data, bands: [band('old', 50, 50, { knobs: { era: 1975 } }), band('new', 50, 50, { knobs: { era: 2020 } })] };
  const s = initialState(d2);
  s.knobs.era = { value: 2015, bypass: false };
  assert.equal(slugs(query(d2, s))[0], 'new');
});

test('empty result names the filter to relax; dead options are greyed', () => {
  const s = initialState(data);
  s.selectors.country = { value: 'US', bypass: false };
  s.switches.active = { on: true, bypass: false };
  const q = query(data, s);
  assert.equal(q.empty, true);
  assert.deepEqual(q.relax.sort(), ['active', 'country']);
  assert.deepEqual(deadOptions(data, s, 'country'), ['US']);
});

test('all faders and knobs bypassed: filters still apply, noControls set', () => {
  const s = initialState(data);
  s.faders.aggression.bypass = s.faders.serenity.bypass = true;
  s.switches.active = { on: false, bypass: false };
  const q = query(data, s);
  assert.equal(q.noControls, true);
  assert.deepEqual(slugs(q), ['d']);
});

test('next: 0, 1 and 2 alternatives, peek cycle', () => {
  const one = [data.bands[0]];
  const two = data.bands.slice(0, 2);
  const many = data.bands;
  assert.equal(nextLabel(one, 0), null);
  assert.equal(nextLabel(two, 0), 'Next: B');
  assert.equal(nextIndex(two, 1), 0);
  assert.equal(nextLabel(many, 0), 'Next: B');
  let i = 0;
  const seen = [];
  for (let k = 0; k < 4; k++) { i = nextIndex(many, i); seen.push(i); }
  assert.deepEqual(seen, [1, 2, 0, 1]); // nearest, second, third, back to nearest; never a fourth
  assert.equal(nextLabel(many, 2), 'Next: A');
});

test('slider keys: arrows 1, page 10, shift doubles, home and end, clamped', () => {
  assert.equal(applyKey(50, 'ArrowUp', false), 51);
  assert.equal(applyKey(50, 'ArrowLeft', false), 49);
  assert.equal(applyKey(50, 'PageUp', false), 60);
  assert.equal(applyKey(50, 'PageDown', true), 30);
  assert.equal(applyKey(50, 'ArrowDown', true), 48);
  assert.equal(applyKey(50, 'Home', false), 0);
  assert.equal(applyKey(50, 'End', false), 100);
  assert.equal(applyKey(99, 'PageUp', false), 100);
  assert.equal(applyKey(50, 'a', false), null);
  assert.equal(applyKey(1990, 'ArrowUp', false, 1970, 2029, 1), 1991);
});

test('valuetext is the percentile sentence only', () => {
  assert.equal(faderText(data.faders[0], 82), 'more aggressive than 82 percent of the pool');
  assert.equal(faderText(data.faders[1], 10), 'more serene than 10 percent of the pool');
});

test('share link: base64url round trip, bypass and Any survive, malformed links rejected', async () => {
  const { encodeState, decodeState } = await import('./engine.js');
  const s = initialState(data);
  s.faders.aggression.value = 82;
  s.faders.serenity.bypass = true;
  s.knobs.era = { value: 1999, bypass: false };
  s.switches.active = { on: false, bypass: false };
  s.selectors.country = { value: 'US', bypass: false };
  s.lyrics = ['nature', 'war'];
  s.recent = ['aggression'];
  const link = encodeState(data, s);
  assert.match(link, /^[A-Za-z0-9_-]+$/);
  // 6 header + 6 mask + 7 fader + 8 knob + 1 switch + 1 selector + 3 lyric bits + 2 recency count + 1 index = 35 bits -> 6 chars
  assert.equal(link.length, 6);
  const back = decodeState({ ...data, knobs: [{ ...data.knobs[0], step: 1 }] }, link);
  assert.deepEqual(back.faders, { aggression: { value: 82, bypass: false }, serenity: { value: 50, bypass: true } });
  assert.deepEqual(back.knobs.era, { value: 1999, bypass: false });
  assert.deepEqual(back.switches.active, { on: false, bypass: false });
  assert.deepEqual(back.selectors.country, { value: 'US', bypass: false });
  assert.deepEqual(back.lyrics, ['nature', 'war']);
  assert.deepEqual(back.recent, ['aggression']);
  const fresh = encodeState(data, initialState(data)); // first-load desk: 6 + 6 + 14 + 2 = 28 bits -> 5 chars
  assert.equal(fresh.length, 5);
  assert.deepEqual(decodeState(data, fresh), initialState(data));
  const other = { ...data, faders: [...data.faders, { id: 'x', status: 'live', ticks: [] }] }; // a different layout
  for (const bad of [null, '', 'zz', '=', link.slice(0, -1), link + 'A', 'A' + link.slice(1), encodeState(other, initialState(other))]) {
    assert.equal(decodeState(data, bad), null, String(bad));
  }
  const over = structuredClone(s); over.faders.aggression.value = 101; // value out of range after rounding
  assert.equal(decodeState(data, encodeState(data, over)), null);
  const ghost = structuredClone(s); ghost.recent = ['serenity']; // a bypassed fader is never recent on the wire
  assert.deepEqual(decodeState(data, encodeState(data, ghost)).recent, []);
});

test('recency: the last fader touched pulls hardest, the list holds three, bypass forgets', async () => {
  const { touch, untouch, recencyPull, RECENCY_PULL, distance } = await import('./engine.js');
  const s = initialState(data);
  assert.equal(recencyPull(s, 'aggression'), 1);
  touch(s, 'serenity'); touch(s, 'aggression');
  assert.deepEqual(s.recent, ['aggression', 'serenity']);
  assert.equal(recencyPull(s, 'aggression'), RECENCY_PULL[0]);
  assert.equal(recencyPull(s, 'serenity'), RECENCY_PULL[1]);
  touch(s, 'serenity'); // touching again moves to the front, no duplicate
  assert.deepEqual(s.recent, ['serenity', 'aggression']);
  for (const id of ['a', 'b', 'c']) touch(s, id);
  assert.deepEqual(s.recent, ['c', 'b', 'a']);
  untouch(s, 'b');
  assert.deepEqual(s.recent, ['c', 'a']);
  // Pulled the same distance on both faders, the touched one decides which band is nearer.
  const t = initialState(data);
  t.faders.aggression.value = 70; t.faders.serenity.value = 70;
  const near = b => distance(data, t, b);
  const a = data.bands[0], c = data.bands[2]; // a: aggression 0 serenity 100; c: 100 / 0
  assert.equal(near(a), near(c));
  touch(t, 'serenity');
  assert.ok(near(a) < near(c), 'serenity touched: the serene band wins');
  touch(t, 'aggression');
  assert.ok(near(c) < near(a), 'aggression touched: the aggressive band wins');
});

test('50 means do not care: a fader pushed to an end outweighs one left in the middle', async () => {
  const { faderWeight, NEUTRAL_PULL } = await import('./engine.js');
  assert.equal(faderWeight(50), NEUTRAL_PULL);
  assert.equal(faderWeight(0), faderWeight(100));
  assert.ok(faderWeight(100) > 10 * faderWeight(50));
  const d = { ...data, bands: [band('calm-mid', 0, 50), band('loud-off', 100, 0)] };
  const s = initialState(d);
  s.faders.aggression.value = 0;   // pushed: wants calm
  s.faders.serenity.value = 55;    // barely moved: hardly counts
  assert.equal(query(d, s).ranked[0].slug, 'calm-mid');
});

test('snap: faders take the band position, bypass is kept, the band stays the answer', async () => {
  const { snapTo } = await import('./engine.js');
  const s = initialState(data);
  s.faders.serenity.bypass = true;
  const target = data.bands[3]; // d: aggression 90, serenity 10
  const snapped = snapTo(s, target);
  assert.deepEqual(snapped.faders, { aggression: { value: 90, bypass: false }, serenity: { value: 10, bypass: true } });
  assert.equal(s.faders.aggression.value, 50); // the input state is untouched
  assert.equal(query(data, snapped).ranked[0].slug, 'd');
});

test('formatFans rolls over to M where k would read 1000', async () => {
  const { formatFans } = await import('./engine.js');
  assert.equal(formatFans(999), '999');
  assert.equal(formatFans(1000), '1k');
  assert.equal(formatFans(999499), '999k');
  assert.equal(formatFans(999500), '1M');
  assert.equal(formatFans(1e6), '1M');
  assert.equal(formatFans(12345678), '12.3M');
});

test('applyKey clamps at the low end and honours knob min and unit', () => {
  assert.equal(applyKey(5, 'PageDown', false), 0);
  assert.equal(applyKey(1971, 'PageDown', false, 1970, 2029, 1), 1970);
  assert.equal(applyKey(50, 'ArrowRight', false), 51);
});

test('a fader publish marked bypassed starts bypassed and bands without it are not penalised', async () => {
  const { snapTo } = await import('./engine.js');
  const d = { ...data, faders: [...data.faders, { id: 'speed', status: 'bypassed', ticks: [] }] };
  const s = initialState(d);
  assert.equal(s.faders.speed.bypass, true);
  assert.equal(slugs(query(d, s)).length, 4);
  assert.equal(snapTo(s, data.bands[3]).faders.speed.value, 50);
});

test('ties rank by slug when every control is bypassed', () => {
  const s = initialState(data);
  s.faders.aggression.bypass = s.faders.serenity.bypass = true;
  assert.deepEqual(slugs(query(data, s)), ['a', 'b', 'c', 'd']);
});

test('prolificness readout inverts albums per year', async () => {
  const { knobText } = await import('./engine.js');
  const k = { id: 'prolific', unit: 'albums/yr' };
  assert.equal(knobText(k, 0.6), '1 album each 1.7 years');
  assert.equal(knobText(k, 0), 'no albums');
});

test('underground: a fan ceiling that only narrows the pool; 0 is off, 100 leaves the smallest band', async () => {
  const { fansCeiling, filterBands, undergroundText, encodeState, decodeState } = await import('./engine.js');
  const d = { ...data, bands: data.bands.map((b, i) => ({ ...b, fans: [5000, 200, 1e6, 50][i] })) };
  const s = initialState(d);
  assert.equal(s.underground.value, 0);
  assert.equal(filterBands(d, s).length, 4);
  assert.equal(undergroundText(d, 0), 'every band, big or small');
  s.underground.value = 50; // cut the biggest half: ceiling at the second smallest
  assert.equal(fansCeiling(d, 50), 200);
  assert.deepEqual(filterBands(d, s).map(b => b.slug), ['b', 'd']);
  assert.equal(undergroundText(d, 50), 'bands under 200 fans');
  s.underground.value = 100;
  assert.deepEqual(filterBands(d, s).map(b => b.slug), ['d']);
  s.switches.active = { on: true, bypass: false }; // d is inactive: empty, and the message names both filters
  const q = query(d, s);
  assert.ok(q.empty && q.relax.includes('underground') && q.relax.includes('active'));
  s.underground.value = 37;
  assert.deepEqual(decodeState(d, encodeState(d, s)).underground, { value: 37 });
  assert.deepEqual(decodeState(d, encodeState(d, initialState(d))).underground, { value: 0 });
});

test('findBand: exact beats prefix beats substring, case-insensitive, null on a miss', () => {
  const d = { bands: [{ name: 'Abba' }, { name: 'Ab' }, { name: 'Dark Ab' }] };
  assert.equal(findBand(d, ' ab ').name, 'Ab');
  assert.equal(findBand(d, 'ABB').name, 'Abba');
  assert.equal(findBand(d, 'k a').name, 'Dark Ab');
  assert.equal(findBand(d, 'zzz'), null);
  assert.equal(findBand(d, '  '), null);
  assert.deepEqual(matchBands(d, 'ab').map(m => [m.band.name, m.at]), [['Ab', 0], ['Abba', 0], ['Dark Ab', 5]]);
  assert.equal(matchBands(d, 'ab', 2).length, 2);
});

test('recallBand: controls move to the band, filters that hide it relax, the band is the answer', () => {
  const s = initialState(data);
  s.selectors.country = { value: 'NO', bypass: false }; // hides d
  s.switches.active = { on: false, bypass: false }; // d passes
  s.lyrics = ['war']; // d lacks it
  s.knobs.era = { value: 1970, bypass: false };
  const d = data.bands[3];
  const r = recallBand(data, s, d);
  assert.equal(r.faders.aggression.value, 90);
  assert.equal(r.knobs.era.value, 1990);
  assert.deepEqual(r.selectors.country, { value: null, bypass: true });
  assert.deepEqual(r.switches.active, { on: false, bypass: false });
  assert.deepEqual(r.lyrics, []);
  assert.equal(slugs(query(data, r))[0], 'd');
  assert.deepEqual(s.lyrics, ['war']); // the caller's state is untouched
  for (const f of Object.values(s.faders)) f.bypass = true;
  s.knobs.era.bypass = true;
  const r2 = recallBand(data, s, data.bands[0]);
  assert.equal(r2.faders.aggression.bypass, false);
  assert.equal(slugs(query(data, r2))[0], 'a');
});

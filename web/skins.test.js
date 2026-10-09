import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skin, SLOTS, SKINNED } from './skins.js';

const palette = { accent: '#8fcf5a', label: '#d8cfb0' };
const decode = u => decodeURIComponent(u.replace(/^data:image\/svg\+xml,/, ''));

test('every pack in themes.yaml is skinned; an unknown pack is null', () => {
  assert.equal(skin('nope', 'iron-maiden', palette), null);
  assert.deepEqual(SKINNED.sort(), ['black', 'death', 'doom', 'folk', 'industrial', 'power', 'prog', 'steel', 'thrash']);
});

for (const pack of SKINNED) {
  test(`${pack}: four SVG data URIs, deterministic per slug, different per band`, () => {
    const a = skin(pack, 'korpiklaani', palette), b = skin(pack, 'korpiklaani', palette), c = skin(pack, 'finntroll', palette);
    assert.deepEqual(Object.keys(a).filter(k => k !== 'lights'), SLOTS);
    assert.ok(Array.isArray(a.lights), 'a light list, possibly empty');
    for (const l of a.lights) assert.ok(['candle', 'neon', 'firefly', 'pulse', 'ember', 'flash'].includes(l.kind) && l.r > 0 && l.t > 0, 'a well-formed light');
    for (const slot of SLOTS) {
      const s = decode(a[slot]);
      assert.ok(a[slot].startsWith('data:image/svg+xml,'), slot);
      assert.ok(s.startsWith("<svg xmlns='http://www.w3.org/2000/svg'") && s.endsWith('</svg>'), slot);
      assert.ok(!/[<>#"]/.test(a[slot].slice(19)), `${slot}: raw characters a CSS url() would choke on`);
      assert.equal((s.match(/<(?!\/)/g) || []).length, (s.match(/<\//g) || []).length + (s.match(/\/>/g) || []).length, `${slot}: tags balance`);
      assert.equal(a[slot], b[slot], `${slot}: same band, same desk`);
    }
    assert.notEqual(a.scene, c.scene, 'another band, another scene');
    assert.ok(decode(a.scene).includes(palette.accent), 'the scene borrows the pack accent');
  });
}

test('a manifest entry replaces one slot with a bitmap path and leaves the rest procedural', () => {
  const a = skin('folk', 'korpiklaani', palette, { folk: { scene: 'skins/folk/scene.webp' } });
  assert.equal(a.scene, 'skins/folk/scene.webp');
  assert.ok(a.panel.startsWith('data:image/svg+xml,'));
});

test('lit scenes report lights where the scene shows around the desk', () => {
  for (const pack of ['doom', 'industrial', 'folk', 'steel']) {
    const { lights } = skin(pack, 'x', palette);
    assert.ok(lights.length > 0, pack);
    assert.ok(lights.every(l => l.x < 200 || l.x > 1400 || l.y < 300 || l.y > 790), `${pack}: no light under the desk`);
  }
});

test('crossover: the trim pack supplies ornament, emblem and cap faces, the primary keeps its scene', () => {
  const prog = skin('prog', 'gojira', palette), death = skin('death', 'gojira', palette);
  const x = skin('prog', 'gojira', palette, {}, 'death');
  assert.equal(x.scene, prog.scene);
  assert.equal(x.panel, prog.panel);
  assert.equal(x.ornament, death.ornament);
  assert.equal(x.emblem, death.emblem);
  assert.equal(x['cap-face'], death['cap-face']);
  assert.deepEqual(skin('prog', 'gojira', palette, {}, null), prog);
  assert.deepEqual(skin('prog', 'gojira', palette, {}, 'nope'), prog);
});

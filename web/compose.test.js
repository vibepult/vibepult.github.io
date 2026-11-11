// node --test web/compose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, bpmOf, restBoard, encodeState, decodeState, openingState, FADERS, IDS, PRODUCTION, PRODUCTION_SHARE, MAX_CLAUSES,
  DAY, builtin, tweakIds, restTweaks, stopPosition, nearestStop, stopBoard, stopTweaks, dayBoard, withFaders, clockPosition, THEMES, BPM, dayStyle, askState, ramp, RAMP, beatOf } from './compose.js';

const board = (v = {}) => ({ ...restBoard(), ...v });
const sentence = r => r.prompts[0].text;
const T = builtin('techno'), H = builtin('house'), D = builtin('dubstep'), A = builtin('afro'); // the built-in days as specs
const SPECS = Object.keys(THEMES).map(builtin);

const W = 'deep house'; // any genre word: the sentence carries it, the board never picks it
test('at rest: the genre word, no fader phrases, production at its share', () => {
  const r = compose(board(), W);
  assert.equal(r.prompts.length, 2);
  assert.equal(sentence(r), `${r.style} track`);
  assert.equal(r.prompts[1].text, PRODUCTION);
  const total = r.prompts.reduce((s, p) => s + p.weight, 0);
  assert.ok(Math.abs(r.prompts[1].weight / total - PRODUCTION_SHARE) < 0.01);
  assert.equal(compose(board(), W, { production: 0.4 }).prompts[1].weight, 0.67);
  assert.equal(compose(board(), W, { production: 0 }).prompts.length, 1);
  assert.equal(compose(board(), W, {}, A).prompts[1].text, THEMES.afro.production); // the theme's own phrase
  for (const t of Object.values(THEMES)) assert.ok(t.production.startsWith('studio recording'), t.label);
  // at rest the genre's own priors decide: no density, brightness or temperature is sent
  assert.deepEqual(r.config, { bpm: 120, guidance: 4.0, musicGenerationMode: 'QUALITY' });
});

test('a pushed board: lead words open, the style word follows, clauses in slot order', () => {
  const r = compose(board({ tempo: 15, energy: 25, dusty: 90, groove: 20, melodic: 65 }), 'lo-fi hip hop');
  assert.equal(r.style, 'lo-fi hip hop');
  assert.ok(sentence(r).startsWith(`${FADERS.tempo.low} ${r.style} track with `), sentence(r));
  const i = s => sentence(r).indexOf(s);
  assert.ok(i('a swung, lazy, sparse beat') < i(FADERS.melodic.high) && i(FADERS.melodic.high) < i(FADERS.dusty.high), sentence(r)); // drums, keys, texture
});

test('drums: Groove, Energy and Organic merge into one clause', () => {
  const d = v => sentence(compose(board(v), W)).replace(`${W} track with `, '');
  assert.equal(d({ groove: 95, energy: 90 }), 'a straight, tight, busy, layered beat with rolling hi-hats');
  assert.equal(d({ energy: 90, groove: 60 }), 'a busy, layered, straight, tight beat with rolling hi-hats'); // strongest first
  assert.equal(d({ organic: 10 }), 'a drum machine beat and synths');
  assert.equal(d({ organic: 90, energy: 20 }), 'a sparse groove on live hand percussion, congas and shakers');
  assert.equal(d({ groove: 20, organic: 90 }), 'a swung, lazy groove on live hand percussion, congas and shakers');
  assert.equal(d({ deep: 90 }), FADERS.deep.high); // no drum push, no theme: no drum clause
});

test('palette: the theme names the beat and the keys when no fader does', () => {
  assert.equal(sentence(compose(board(), W, {}, H)), `${W} track with a TR-909 beat and shaker, Rhodes Piano chords`);
  assert.equal(sentence(compose(board({ groove: 90 }), W, {}, A)), `${W} track with a straight, tight groove on Conga Drums, Djembe and shakers, Kalimba and Marimba melodies`);
  const r = sentence(compose(board({ organic: 90, dreamy: 90 }), W, {}, T));
  assert.ok(!r.includes('TR-909') && !r.includes(THEMES.techno.palette.keys) && r.includes(FADERS.dreamy.high), r); // faders win over the palette
  for (const t of Object.values(THEMES)) assert.ok(t.palette.beat && t.palette.keys, t.label);
});

test('deadband drops a nudge, MAX_CLAUSES caps the sentence, the strongest pushes win', () => {
  assert.equal(sentence(compose(board({ deep: 54 }), W)), sentence(compose(board(), W)));
  const all = sentence(compose(board(Object.fromEntries(IDS.map(id => [id, id === 'hard' ? 60 : 100]))), W));
  // one drum clause plus MAX_CLAUSES - 1 others, strongest first: hard (weakest) and steady (last at full) fall off
  const kept = IDS.filter(id => !['lead', 'drums'].includes(FADERS[id].slot) && all.includes(FADERS[id].high));
  assert.equal(kept.length, MAX_CLAUSES - 1, all);
  assert.ok(!all.includes(FADERS.hard.high) && !all.includes(FADERS.steady.high), all);
  assert.equal(all.split(' beat').length, 2, all);
});

test('voice: no phrase when low, wordless vocals and VOCALIZATION when high', () => {
  assert.ok(!sentence(compose(board({ voice: 0 }), W)).includes('vocal'));
  const r = compose(board({ voice: 100 }), W);
  assert.ok(sentence(r).includes(FADERS.voice.high));
  assert.equal(r.config.musicGenerationMode, 'VOCALIZATION');
  assert.equal(compose(board({ voice: 100 }), W, { mode: 'DIVERSITY' }).config.musicGenerationMode, 'DIVERSITY');
});

test('config: tempo steps, energy to density, dark to brightness, p overrides', () => {
  // the word's centre ±15: a genre never leaves its own tempo range; an unknown word sits at 110
  assert.deepEqual([bpmOf(0, W), bpmOf(50, W), bpmOf(100, W)], [105, 120, 135]);
  assert.deepEqual([bpmOf(0), bpmOf(50), bpmOf(100)], [95, 110, 125]);
  assert.equal(bpmOf(50, 'psytrance') - bpmOf(50, 'ambient dub'), 55);
  for (const t of Object.values(THEMES)) for (const w of Object.values(t.words)) assert.ok(BPM[w], `no bpm for ${w}`);
  const r = compose(board({ energy: 80, dark: 20 }), W, { bpm: 128, guidance: 3, seed: 7 });
  assert.equal(r.config.density, 0.7); // Energy 80 asks 0.8, the cap says 0.7
  assert.equal(r.config.brightness, 0.8);
  assert.equal(r.config.temperature, undefined);
  assert.ok(!('density' in compose(board({ energy: 54 }), W).config)); // inside the deadband: the prior decides
  assert.deepEqual([0, 25, 50, 75, 100].map(v => compose(board({ steady: v }), W).config.temperature), [1.4, 1.25, undefined, 0.9, 0.7]);
  assert.equal(r.config.bpm, 128);
  assert.equal(r.config.guidance, 3);
  assert.equal(r.config.seed, 7);
});

test('ramp: the old prompts fade as the new ones rise, shared texts merge, zeros drop', () => {
  const from = [{ text: 'A', weight: 1 }, { text: 'P', weight: 0.25 }], to = [{ text: 'B', weight: 1 }, { text: 'P', weight: 0.25 }];
  assert.deepEqual(ramp(from, to, 0.25), [{ text: 'A', weight: 0.75 }, { text: 'P', weight: 0.25 }, { text: 'B', weight: 0.25 }]);
  assert.deepEqual(ramp(from, to, 1), [{ text: 'P', weight: 0.25 }, { text: 'B', weight: 1 }]);
  assert.equal(RAMP.at(-1), 1); // the ramp ends on the new list exactly
  assert.equal(beatOf('deep house'), 'four');
  assert.equal(beatOf('dubstep'), 'half');
  for (const t of Object.values(THEMES)) for (const w of Object.values(t.words)) assert.ok(beatOf(w), w);
});

test('cut follows the genre word and the clauses: a lead word blends, a new clause or a word flip ramps', () => {
  const pt = { energy: 50, groove: 80, deep: 70, dreamy: 65 }, a = compose(board(pt), W);
  assert.equal(a.cut, compose(board({ ...pt, dark: 80 }), W).cut);
  assert.equal(a.cut, compose(board({ ...pt, dreamy: 75 }), W).cut); // same clause, stronger push
  assert.notEqual(a.cut, compose(board({ ...pt, energy: 85 }), W).cut);
  assert.notEqual(a.cut, compose(board(pt), 'acid techno').cut);
});

test('the share link packs the page into a few base64url characters and round trips', () => {
  const opening = openingState();
  assert.equal(encodeState(opening).length, 6);
  assert.deepEqual(decodeState(encodeState(opening)), opening);
  const page = { theme: 'dubstep', haiku: true, position: 73, board: board({ tempo: 15, hard: 90 }), tweaks: { ...restTweaks(D), 'focus.sub': 80, 'party.chill': 10 } };
  const text = encodeState(page);
  assert.equal(text.length, 14, text); // 31 header and mask bits, 7 a fader, 14 a tweak
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeState(text), page); // the theme bits pick dubstep's own tweak ids
  assert.deepEqual(decodeState(encodeState({ ...page, position: null, haiku: false })), { ...page, position: null, haiku: false });
});

test('a junk share link is the opening page', () => {
  const opening = openingState();
  for (const junk of [null, '', 'x', '%', 'AAAA', encodeState(opening) + 'A', encodeState(opening).slice(0, -1)]) assert.deepEqual(decodeState(junk), opening, String(junk));
  // a day past 100, a theme index past the list: both rejected, not clamped
  const bits = (v, n) => [...Array(n)].map((_, i) => (v >> (n - 1 - i)) & 1);
  const pack = b => { while (b.length % 6) b.push(0); let out = ''; for (let j = 0; j < b.length; j += 6) out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b.slice(j, j + 6).reduce((a, x) => 2 * a + x, 0)]; return out; };
  const n = tweakIds(T).length;
  assert.deepEqual(decodeState(pack([...bits(n, 7), ...bits(0, 3), 0, 0, ...bits(101, 7), ...bits(0, IDS.length), ...bits(0, 7)])), opening);
  assert.deepEqual(decodeState(pack([...bits(n, 7), ...bits(7, 3), 0, 1, ...bits(0, IDS.length), ...bits(0, 7)])), opening);
});

test('every stop and tweak pushes known faders, five tweaks a stop, hours in order', () => {
  for (const s of DAY) {
    assert.equal(Object.keys(s.tweaks).length, 5, s.id);
    for (const push of [s.push, ...Object.values(s.tweaks).map(t => t.push)]) for (const f of Object.keys(push)) assert.ok(IDS.includes(f), `${s.id} pushes unknown fader ${f}`);
  }
  assert.ok(DAY.every((s, i) => i === 0 || s.at > DAY[i - 1].at));
  for (const spec of SPECS) {
    const ids = tweakIds(spec);
    assert.equal(ids.length, new Set(ids).size);
    assert.equal(ids.length, 40, spec.id);
  }
  for (const [id, t] of Object.entries(THEMES)) for (const [stop, tw] of Object.entries(t.tweaks ?? {})) {
    assert.ok(DAY.some(s => s.id === stop), `${id} tweaks unknown stop ${stop}`);
    assert.equal(Object.keys(tw).length, 5, `${id} ${stop}`);
    for (const x of Object.values(tw)) for (const f of Object.keys(x.push)) assert.ok(IDS.includes(f), `${id} ${stop} pushes unknown fader ${f}`);
  }
});

test('builtin: the shared day under a theme, the theme\'s own tweaks in place of the day\'s, junk is techno', () => {
  assert.equal(builtin('house'), H); // one object per theme
  assert.equal(builtin('nope').id, 'techno');
  assert.deepEqual(Object.keys(H), ['id', 'label', 'skin', 'stops', 'theme']);
  assert.equal(H.theme, THEMES.house);
  assert.deepEqual(H.stops.map(s => s.id), DAY.map(s => s.id));
  assert.equal(H.stops[7].tweaks, DAY[7].tweaks);
  assert.equal(D.stops[7].tweaks, THEMES.dubstep.tweaks.party);
  for (const spec of SPECS) assert.deepEqual(Object.keys(spec.theme.words).sort(), spec.stops.map(s => s.id).sort(), spec.id);
});

test("a theme's own tweaks replace the day's at that stop, under their own ids, and push the board", () => {
  assert.deepEqual(stopTweaks(H, 7).map(([id]) => id), Object.keys(DAY[7].tweaks).map(t => `party.${t}`));
  const ids = stopTweaks(D, 7).map(([id]) => id);
  assert.deepEqual(ids, Object.keys(THEMES.dubstep.tweaks.party).map(t => `party.${t}`));
  assert.ok(ids.every(id => tweakIds(D).includes(id)), ids.join());
  assert.deepEqual(stopBoard(D, 7, restTweaks(D)), stopBoard(D, 7));
  const up = stopBoard(D, 7, { 'party.chill': 100 }), base = stopBoard(D, 7);
  for (const [f, d] of Object.entries(THEMES.dubstep.tweaks.party.chill.push)) assert.equal(up[f], Math.max(0, Math.min(100, base[f] + d)), f);
  assert.deepEqual(stopBoard(H, 7, { 'party.chill': 100 }), stopBoard(H, 7)); // another theme has no such tweak
  const asked = askState({ spec: D, position: 100, tweaks: { 'party.chill': 90 }, heard: stopBoard(D, 7, { 'party.chill': 90 }) });
  assert.deepEqual(asked.tweaks, [{ label: 'Chill', means: 'the growl, a bit laid back', value: 90 }]);
  assert.equal(asked.solo, true); // Haiku is told the sentence is the sound
  assert.equal('solo' in askState({ spec: A, position: 100, heard: stopBoard(A, 7) }), false); // afro has no solo body
  // The theme rewords the Hard fader, in the sentence and in what Haiku reads; a spec-less call keeps the shared phrase (every theme rewords Hard since #46).
  const hard = THEMES.dubstep.phrases.hard.high;
  assert.ok(sentence(compose(board({ hard: 100 }), 'brostep', {}, D)).includes(hard));
  assert.ok(sentence(compose(board({ hard: 100 }), 'brostep')).includes(FADERS.hard.high));
  assert.equal(asked.faders.find(f => f.name === 'Hard').high, hard);
  // Hard is dubstep's solo: pushed past SOLO it owns the sentence, both ends; nearer rest the full sentence returns.
  const r = compose(board({ hard: 90, tempo: 100, dreamy: 100 }), 'brostep', {}, D);
  assert.equal(sentence(r), `brostep track with ${hard}`);
  assert.equal(r.cut, `brostep|brostep track with ${hard}`);
  const low = THEMES.dubstep.phrases.hard.low;
  assert.equal(sentence(compose(board({ hard: 10 }), 'chillstep', {}, D)), `${low.as} track with ${low.words}`);
  assert.ok(sentence(compose(board({ hard: 70, tempo: 100 }), 'brostep', {}, D)).startsWith('fast, driving brostep track with '));
  const [by, mel] = THEMES.dubstep.phrases.hard.by; // Deep or Melodic swap the solo body; the genre word in the sentence may change, the style does not
  assert.equal(sentence(compose(board({ hard: 90, deep: 10 }), 'brostep', {}, D)), `brostep track with ${by.low}`);
  const pedal = compose(board({ hard: 90, deep: 90 }), 'brostep', {}, D);
  assert.equal(sentence(pedal), `${by.high.as} track with ${by.high.words}`);
  assert.equal(sentence(compose(board({ hard: 90, melodic: 90, deep: 60 }), 'brostep', {}, D)), `${mel.high.as} track with ${mel.high.words}`);
  assert.equal(sentence(compose(board({ hard: 90, melodic: 80, deep: 10 }), 'brostep', {}, D)), `brostep track with ${by.low}`); // the stronger push wins
  assert.equal(pedal.solo, true);
  assert.equal(compose(board({ hard: 70 }), 'brostep', {}, D).solo, false);
  assert.equal(pedal.style, 'brostep');
  assert.equal(pedal.config.bpm, 140); // the genre centre, no Party push
  // The solo drops density, brightness and temperature so the genre's own priors decide, as the heard clips did; p= still pins.
  assert.deepEqual(compose(board({ hard: 90, energy: 90, dark: 80, steady: 70 }), 'brostep', {}, D).config, { bpm: 140, guidance: 4, musicGenerationMode: 'QUALITY' });
  assert.equal(compose(board({ hard: 90, energy: 90 }), 'brostep', { density: 0.3 }, D).config.density, 0.3);
  assert.ok(sentence(compose(board({ hard: 90, tempo: 100 }), 'brostep', {}, A)).startsWith('fast, driving brostep track with '));
});

test('themes: a word for every stop, the word lands in the sentence, a flip at the midpoint, junk is techno', () => {
  assert.equal(Object.keys(THEMES).length, 6);
  for (const spec of SPECS) {
    spec.stops.forEach((s, i) => assert.ok(sentence(compose(stopBoard(spec, i), dayStyle(spec, stopPosition(spec, i)))).includes(`${spec.theme.words[s.id]} track`), `${spec.id} ${s.id}`));
  }
  const mid = (stopPosition(H, 0) + stopPosition(H, 1)) / 2;
  assert.equal(dayStyle(H, mid - 1), THEMES.house.words.morning);
  assert.equal(dayStyle(H, mid + 1), THEMES.house.words.focus);
});

test('dayBoard: a stop position is that stop, between two stops is the straight line, ends clamp', () => {
  DAY.forEach((_, i) => assert.deepEqual(dayBoard(T, stopPosition(T, i)), stopBoard(T, i)));
  const a = stopBoard(T, 2), b = stopBoard(T, 3), mid = dayBoard(T, (stopPosition(T, 2) + stopPosition(T, 3)) / 2);
  for (const id of IDS) assert.ok(Math.abs(mid[id] - (a[id] + b[id]) / 2) <= 1, id);
  assert.deepEqual(dayBoard(T, -10), stopBoard(T, 0));
  assert.deepEqual(dayBoard(T, 150), stopBoard(T, DAY.length - 1));
  assert.equal(nearestStop(T, 0), 0);
  assert.equal(nearestStop(T, 100), DAY.length - 1);
});

test('tweaks: 50 does nothing, 100 adds the push, 0 subtracts it, and only on their own stop', () => {
  assert.deepEqual(stopBoard(T, 7, restTweaks(T)), stopBoard(T, 7));
  const party = DAY[7], base = stopBoard(T, 7);
  const up = stopBoard(T, 7, { 'party.afters': 100 }), down = stopBoard(T, 7, { 'party.afters': 0 });
  for (const [f, d] of Object.entries(party.tweaks.afters.push)) {
    assert.equal(up[f], Math.max(0, Math.min(100, base[f] + d)), f);
    assert.equal(down[f], Math.max(0, Math.min(100, base[f] - d)), f);
  }
  assert.deepEqual(stopBoard(T, 0, { 'party.afters': 100 }), stopBoard(T, 0));
  assert.notDeepEqual(dayBoard(T, 95, { 'party.afters': 100 }), dayBoard(T, 95)); // fades in as the slider nears party
});

test('advanced faders are offsets on the day and clamp', () => {
  const day = stopBoard(T, 4);
  assert.deepEqual(withFaders(day, restBoard()), day);
  assert.equal(withFaders(day, { tempo: 60 }).tempo, day.tempo + 10);
  assert.equal(withFaders(day, { energy: 100 }).energy, Math.min(100, day.energy + 50));
  assert.equal(withFaders(day, { energy: 0 }).energy, Math.max(0, day.energy - 50));
});

test('clock: each stop at its hour, straight between, morning before it, party after it until 4:00', () => {
  const at = (h, m = 0) => clockPosition(T, new Date(2026, 9, 14, h, m));
  DAY.forEach((s, i) => assert.equal(at(Math.floor(s.at), (s.at % 1) * 60), Math.round(stopPosition(T, i)), s.id));
  assert.equal(at(8), Math.round(stopPosition(T, 1) / 2));
  assert.equal(at(5), 0);
  assert.equal(at(23, 30), 100);
  assert.equal(at(2), 100);
  for (let h = 4; h < 24; h++) assert.ok(at(h) <= at(h, 59), `${h}`);
});

test('askState: words not ids, only what is away from rest, the rule sentence as a draft', () => {
  const position = stopPosition(H, 2) + 2, heard = dayBoard(H, position, { 'lunch.siesta': 80 });
  const a = askState({ spec: H, position, tweaks: { 'lunch.siesta': 80, 'party.acid': 0 }, heard });
  assert.equal(a.theme, 'House');
  assert.equal(a.genre, THEMES.house.words.lunch);
  assert.deepEqual(a.day, { from: 'Lunch', to: 'More focus', toward: 0.14 });
  assert.deepEqual(a.tweaks, [{ label: 'Siesta', means: DAY[2].tweaks.siesta.hint, value: 80 }]); // party's tweak is not this hour's
  assert.ok(a.faders.length && a.faders.every(f => Math.abs(f.value - 50) >= 5 && f.high), JSON.stringify(a.faders));
  assert.equal(a.rules, compose(heard, a.genre).prompts[0].text);
  assert.equal(a.config.bpm, compose(heard, a.genre).config.bpm);
  assert.ok(!('previous' in a));
  const prev = [{ text: 'x', weight: 1 }];
  assert.deepEqual(askState({ spec: H, position, heard, previous: prev }).previous, prev);
});

// A typed day: three stops at a lake, the model's own words with their bpm and beat, under the house skin.
const LAKE = {
  id: 'lake1', label: 'Sunday at the lake', skin: 'house',
  stops: [
    { id: 'breakfast', label: 'Late breakfast', hint: 'coffee on the deck', at: 10, push: { tempo: -30, organic: 30, dark: -20 }, tweaks: {
      coffee: { label: 'Second coffee', hint: 'waking up', push: { tempo: 15, energy: 15 } }, birds: { label: 'Birds', hint: 'quiet, airy', push: { energy: -25, dreamy: 20 } },
      records: { label: 'Old records', hint: 'crackle', push: { dusty: 30 } }, jazz: { label: 'Jazzy', hint: 'swing', push: { groove: -25, melodic: 20 } }, hush: { label: 'Hush', hint: 'someone sleeps', push: { energy: -30, hard: -20 } } } },
    { id: 'swim', label: 'Swim', at: 14, push: { dark: -30, energy: 10, melodic: 20 }, tweaks: {
      splash: { label: 'Splash', hint: 'kids in the water', push: { energy: 25, groove: 15 } }, float: { label: 'Float', hint: 'on your back', push: { dreamy: 30, energy: -20 } },
      sun: { label: 'Sun', hint: 'blue sky', push: { dark: -25 } }, drums: { label: 'Drums', hint: 'hand percussion', push: { organic: 30 } }, dive: { label: 'Dive', hint: 'the deep end', push: { deep: 30 } } } },
    { id: 'bonfire', label: 'Bonfire', at: 22.5, push: { tempo: -15, dusty: 25, organic: 30, dark: 15 }, tweaks: {
      embers: { label: 'Embers', hint: 'late and low', push: { energy: -30, tempo: -15 } }, guitar: { label: 'Guitar', hint: 'someone plays', push: { organic: 30, melodic: 25 } },
      stars: { label: 'Stars', hint: 'wide and still', push: { dreamy: 30, steady: 20 } }, bottle: { label: 'Second bottle', hint: 'louder', push: { energy: 25, groove: 15 } }, dawn: { label: 'Dawn', hint: 'the sun comes up', push: { dark: -30, dreamy: 20 } } } },
  ],
  theme: { label: 'Lakeside', words: { breakfast: 'Balearic chillout', swim: 'organic house', bonfire: 'campfire downtempo' }, production: 'studio recording, warm organic production, live feel',
    palette: { beat: 'soft shaker groove', keys: 'Warm Acoustic Guitar and Rhodes Piano' }, bpm: { 'campfire downtempo': 90 }, beat: { 'campfire downtempo': 'down' } },
};

test('a typed day is a spec like the built-in ones: positions, clock, boards, words, share string', () => {
  assert.deepEqual([0, 1, 2].map(i => stopPosition(LAKE, i)), [0, 50, 100]);
  assert.equal(tweakIds(LAKE).length, 15);
  assert.deepEqual(stopBoard(LAKE, 0).tempo, 20);
  assert.deepEqual(dayBoard(LAKE, 25).tempo, Math.round((stopBoard(LAKE, 0).tempo + stopBoard(LAKE, 1).tempo) / 2));
  const at = (h, m = 0) => clockPosition(LAKE, new Date(2026, 9, 14, h, m));
  assert.deepEqual([at(9), at(10), at(12), at(14), at(22, 30), at(1)], [0, 0, 25, 50, 100, 100]);
  assert.equal(dayStyle(LAKE, 100), 'campfire downtempo');
  const r = compose(dayBoard(LAKE, 100), dayStyle(LAKE, 100), {}, LAKE);
  assert.equal(r.config.bpm, 85); // the spec's own centre 90, Tempo at 35 takes 5 off; the shared table does not know the word
  assert.equal(beatOf('campfire downtempo', LAKE.theme.beat), 'down');
  assert.equal(beatOf('campfire downtempo'), 'four');
  assert.ok(sentence(r).includes('campfire downtempo track with') && r.prompts[1].text === LAKE.theme.production, sentence(r));
  assert.ok(sentence(compose(stopBoard(LAKE, 0), 'Balearic chillout', {}, LAKE)).includes(LAKE.theme.palette.keys)); // no keys push at breakfast: the palette fills the slot
  const a = askState({ spec: LAKE, position: 10, tweaks: { 'breakfast.jazz': 90 }, heard: dayBoard(LAKE, 10, { 'breakfast.jazz': 90 }) });
  assert.deepEqual([a.theme, a.day.from, a.day.to, a.day.means, a.tweaks[0].label], ['Lakeside', 'Late breakfast', 'Swim', 'coffee on the deck', 'Jazzy']);
  // the share string is read against the day: its own tweak ids, the theme bits ignored
  const page = { ...openingState(LAKE), position: 60, tweaks: { ...restTweaks(LAKE), 'swim.dive': 90 } };
  const text = encodeState(page, LAKE);
  assert.deepEqual(decodeState(text, LAKE), page);
  assert.deepEqual(decodeState(text), openingState()); // under the built-in layout the same string is junk: 15 tweaks against 40
  assert.deepEqual(decodeState(encodeState(openingState()), LAKE), openingState(LAKE));
});

test('#46: brightness floors at 0.4, density caps at 0.7, the Party tempo is the genre centre', () => {
  // the control tokens are spectral-centroid and onset priors, not moods; Google's samples run density 0.2 to 0.5 and brightness 0.4 to 0.7
  assert.deepEqual([0, 25, 50, 75, 100].map(v => compose(board({ dark: v }), W).config.brightness), [1, 0.75, undefined, 0.4, 0.4]);
  assert.deepEqual([0, 25, 50, 75, 100].map(v => compose(board({ energy: v }), W).config.density), [0, 0.25, undefined, 0.7, 0.7]);
  assert.equal(compose(board({ energy: 100 }), W, { density: 0.9 }).config.density, 0.9); // a p= pin still goes through
  assert.ok(sentence(compose(board({ dark: 100 }), W)).startsWith(`${FADERS.dark.high} `)); // Dark keeps its words
  assert.equal(stopBoard(T, 7).tempo, 50); // no Party push on Tempo: the word's own centre carries it
  for (const spec of SPECS) assert.equal(compose(stopBoard(spec, 7), spec.theme.words.party, {}, spec).config.bpm, bpmOf(50, spec.theme.words.party), spec.id);
});

test('#46: each theme owns its Party body, by the solo rule dubstep set', () => {
  for (const t of ['house', 'bass', 'balearic']) {
    const spec = builtin(t), word = THEMES[t].words.party, r = compose(stopBoard(spec, 7), word, {}, spec);
    assert.equal(sentence(r), `${word} track with ${THEMES[t].phrases.hard.high}`, t);
    assert.deepEqual(r.config, { bpm: bpmOf(50, word), guidance: 4, musicGenerationMode: 'QUALITY' }, t); // the word's priors decide
    assert.ok(sentence(compose(board({ hard: 10 }), word, {}, spec)).includes(FADERS.hard.low), t); // the low end stays the shared one
    assert.equal(compose(stopBoard(spec, 7, { 'party.afters': 100 }), word, {}, spec).solo, false, t); // Afters brings the full sentence back
  }
  const afro = compose(stopBoard(A, 7), 'afro tech', {}, A); // afro keeps the full sentence, no body: its party is the centre at 135
  assert.equal(afro.solo, false);
  assert.ok(sentence(afro).includes(FADERS.hard.high) && sentence(afro).includes(THEMES.afro.palette.beat), sentence(afro));
  assert.deepEqual([afro.config.bpm, afro.config.density, afro.config.brightness], [135, 0.7, 0.4]);
  assert.equal(beatOf(THEMES.bass.words.party), 'garage'); // breaks & bass: the word and the body agree on the beat
  assert.ok(THEMES.bass.phrases.hard.high.includes('garage hats') && THEMES.bass.phrases.hard.high.includes('kick'));
  assert.notEqual(THEMES.bass.words.party, 'dubstep'); // the one bad clip of 2026-10-15
});

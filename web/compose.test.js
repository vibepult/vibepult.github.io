// node --test web/compose.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compose, bpmOf, restBoard, encodeState, decodeState, openingState, FADERS, IDS, PRODUCTION, PRODUCTION_SHARE, MAX_CLAUSES,
  DAY, TWEAK_IDS, restTweaks, stopPosition, nearestStop, stopBoard, stopTweaks, dayBoard, withFaders, clockPosition, THEMES, BPM, dayStyle, askState, ramp, RAMP, beatOf } from './compose.js';

const board = (v = {}) => ({ ...restBoard(), ...v });
const sentence = r => r.prompts[0].text;

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
  assert.equal(compose(board(), W, {}, 'afro').prompts[1].text, THEMES.afro.production); // the theme's own phrase
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
  assert.equal(sentence(compose(board(), W, {}, 'house')), `${W} track with a TR-909 beat and shaker, Rhodes Piano chords`);
  assert.equal(sentence(compose(board({ groove: 90 }), W, {}, 'afro')), `${W} track with a straight, tight groove on Conga Drums, Djembe and shakers, Kalimba and Marimba melodies`);
  const r = sentence(compose(board({ organic: 90, dreamy: 90 }), W, {}, 'techno'));
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
  const page = { theme: 'dubstep', haiku: true, position: 73, board: board({ tempo: 15, hard: 90 }), tweaks: { ...restTweaks(), 'focus.deep': 80, 'dubstep.party.chill': 10 } };
  const text = encodeState(page);
  assert.equal(text.length, 14, text); // 31 header and mask bits, 7 a fader, 14 a tweak
  assert.match(text, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeState(text), page);
  assert.deepEqual(decodeState(encodeState({ ...page, position: null, haiku: false })), { ...page, position: null, haiku: false });
});

test('a junk share link is the opening page', () => {
  const opening = openingState();
  for (const junk of [null, '', 'x', '%', 'AAAA', encodeState(opening) + 'A', encodeState(opening).slice(0, -1)]) assert.deepEqual(decodeState(junk), opening, String(junk));
  // a day past 100, a theme index past the list: both rejected, not clamped
  const bits = (v, n) => [...Array(n)].map((_, i) => (v >> (n - 1 - i)) & 1);
  const pack = b => { while (b.length % 6) b.push(0); let out = ''; for (let j = 0; j < b.length; j += 6) out += 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b.slice(j, j + 6).reduce((a, x) => 2 * a + x, 0)]; return out; };
  assert.deepEqual(decodeState(pack([...bits(TWEAK_IDS.length, 7), ...bits(0, 3), 0, 0, ...bits(101, 7), ...bits(0, IDS.length), ...bits(0, 7)])), opening);
  assert.deepEqual(decodeState(pack([...bits(TWEAK_IDS.length, 7), ...bits(7, 3), 0, 1, ...bits(0, IDS.length), ...bits(0, 7)])), opening);
});

test('every stop and tweak pushes known faders, five tweaks a stop, hours in order', () => {
  for (const s of DAY) {
    assert.equal(Object.keys(s.tweaks).length, 5, s.id);
    for (const push of [s.push, ...Object.values(s.tweaks).map(t => t.push)]) for (const f of Object.keys(push)) assert.ok(IDS.includes(f), `${s.id} pushes unknown fader ${f}`);
  }
  assert.ok(DAY.every((s, i) => i === 0 || s.at > DAY[i - 1].at));
  assert.equal(TWEAK_IDS.length, new Set(TWEAK_IDS).size);
  for (const [id, t] of Object.entries(THEMES)) for (const [stop, tw] of Object.entries(t.tweaks ?? {})) {
    assert.ok(DAY.some(s => s.id === stop), `${id} tweaks unknown stop ${stop}`);
    assert.equal(Object.keys(tw).length, 5, `${id} ${stop}`);
    for (const x of Object.values(tw)) for (const f of Object.keys(x.push)) assert.ok(IDS.includes(f), `${id} ${stop} pushes unknown fader ${f}`);
  }
});

test("a theme's own tweaks replace the day's at that stop, under their own ids, and push the board", () => {
  assert.deepEqual(stopTweaks(7, 'house').map(([id]) => id), Object.keys(DAY[7].tweaks).map(t => `party.${t}`));
  const ids = stopTweaks(7, 'dubstep').map(([id]) => id);
  assert.ok(ids.every(id => id.startsWith('dubstep.party.') && TWEAK_IDS.includes(id)), ids.join());
  assert.deepEqual(stopBoard(7, restTweaks(), 'dubstep'), stopBoard(7));
  const up = stopBoard(7, { 'dubstep.party.chill': 100 }, 'dubstep'), base = stopBoard(7);
  for (const [f, d] of Object.entries(THEMES.dubstep.tweaks.party.chill.push)) assert.equal(up[f], Math.max(0, Math.min(100, base[f] + d)), f);
  assert.deepEqual(stopBoard(7, { 'dubstep.party.chill': 100 }, 'house'), stopBoard(7)); // another theme does not hear it
  const asked = askState({ theme: 'dubstep', position: 100, tweaks: { 'dubstep.party.chill': 90 }, heard: stopBoard(7, { 'dubstep.party.chill': 90 }, 'dubstep') });
  assert.deepEqual(asked.tweaks, [{ label: 'Chill', means: 'the growl, a bit laid back', value: 90 }]);
  assert.equal(asked.solo, true); // Haiku is told the sentence is the sound
  assert.equal('solo' in askState({ theme: 'afro', position: 100, heard: stopBoard(7) }), false); // afro has no solo body
  // The theme rewords the Hard fader, in the sentence and in what Haiku reads; a theme-less call keeps the shared phrase (every theme rewords Hard since #46).
  const hard = THEMES.dubstep.phrases.hard.high;
  assert.ok(sentence(compose(board({ hard: 100 }), 'brostep', {}, 'dubstep')).includes(hard));
  assert.ok(sentence(compose(board({ hard: 100 }), 'brostep')).includes(FADERS.hard.high));
  assert.equal(asked.faders.find(f => f.name === 'Hard').high, hard);
  // Hard is dubstep's solo: pushed past SOLO it owns the sentence, both ends; nearer rest the full sentence returns.
  const r = compose(board({ hard: 90, tempo: 100, dreamy: 100 }), 'brostep', {}, 'dubstep');
  assert.equal(sentence(r), `brostep track with ${hard}`);
  assert.equal(r.cut, `brostep|brostep track with ${hard}`);
  const low = THEMES.dubstep.phrases.hard.low;
  assert.equal(sentence(compose(board({ hard: 10 }), 'chillstep', {}, 'dubstep')), `${low.as} track with ${low.words}`);
  assert.ok(sentence(compose(board({ hard: 70, tempo: 100 }), 'brostep', {}, 'dubstep')).startsWith('fast, driving brostep track with '));
  const [by, mel] = THEMES.dubstep.phrases.hard.by; // Deep or Melodic swap the solo body; the genre word in the sentence may change, the style does not
  assert.equal(sentence(compose(board({ hard: 90, deep: 10 }), 'brostep', {}, 'dubstep')), `brostep track with ${by.low}`);
  const pedal = compose(board({ hard: 90, deep: 90 }), 'brostep', {}, 'dubstep');
  assert.equal(sentence(pedal), `${by.high.as} track with ${by.high.words}`);
  assert.equal(sentence(compose(board({ hard: 90, melodic: 90, deep: 60 }), 'brostep', {}, 'dubstep')), `${mel.high.as} track with ${mel.high.words}`);
  assert.equal(sentence(compose(board({ hard: 90, melodic: 80, deep: 10 }), 'brostep', {}, 'dubstep')), `brostep track with ${by.low}`); // the stronger push wins
  assert.equal(pedal.solo, true);
  assert.equal(compose(board({ hard: 70 }), 'brostep', {}, 'dubstep').solo, false);
  assert.equal(pedal.style, 'brostep');
  assert.equal(pedal.config.bpm, 140); // the genre centre, no Party push
  // The solo drops density, brightness and temperature so the genre's own priors decide, as the heard clips did; p= still pins.
  assert.deepEqual(compose(board({ hard: 90, energy: 90, dark: 80, steady: 70 }), 'brostep', {}, 'dubstep').config, { bpm: 140, guidance: 4, musicGenerationMode: 'QUALITY' });
  assert.equal(compose(board({ hard: 90, energy: 90 }), 'brostep', { density: 0.3 }, 'dubstep').config.density, 0.3);
  assert.ok(sentence(compose(board({ hard: 90, tempo: 100 }), 'brostep', {}, 'afro')).startsWith('fast, driving brostep track with '));
});

test('themes: a word for every stop, the word lands in the sentence, a flip at the midpoint, junk is techno', () => {
  assert.equal(Object.keys(THEMES).length, 6);
  for (const [id, t] of Object.entries(THEMES)) {
    assert.deepEqual(Object.keys(t.words).sort(), DAY.map(s => s.id).sort(), id);
    DAY.forEach((s, i) => assert.ok(sentence(compose(stopBoard(i), dayStyle(id, stopPosition(i)))).includes(`${t.words[s.id]} track`), `${id} ${s.id}`));
  }
  const mid = (stopPosition(0) + stopPosition(1)) / 2;
  assert.equal(dayStyle('house', mid - 1), THEMES.house.words.morning);
  assert.equal(dayStyle('house', mid + 1), THEMES.house.words.focus);
});

test('dayBoard: a stop position is that stop, between two stops is the straight line, ends clamp', () => {
  DAY.forEach((_, i) => assert.deepEqual(dayBoard(stopPosition(i)), stopBoard(i)));
  const a = stopBoard(2), b = stopBoard(3), mid = dayBoard((stopPosition(2) + stopPosition(3)) / 2);
  for (const id of IDS) assert.ok(Math.abs(mid[id] - (a[id] + b[id]) / 2) <= 1, id);
  assert.deepEqual(dayBoard(-10), stopBoard(0));
  assert.deepEqual(dayBoard(150), stopBoard(DAY.length - 1));
  assert.equal(nearestStop(0), 0);
  assert.equal(nearestStop(100), DAY.length - 1);
});

test('tweaks: 50 does nothing, 100 adds the push, 0 subtracts it, and only on their own stop', () => {
  assert.deepEqual(stopBoard(7, restTweaks()), stopBoard(7));
  const party = DAY[7], base = stopBoard(7);
  const up = stopBoard(7, { 'party.afters': 100 }), down = stopBoard(7, { 'party.afters': 0 });
  for (const [f, d] of Object.entries(party.tweaks.afters.push)) {
    assert.equal(up[f], Math.max(0, Math.min(100, base[f] + d)), f);
    assert.equal(down[f], Math.max(0, Math.min(100, base[f] - d)), f);
  }
  assert.deepEqual(stopBoard(0, { 'party.afters': 100 }), stopBoard(0));
  assert.notDeepEqual(dayBoard(95, { 'party.afters': 100 }), dayBoard(95)); // fades in as the slider nears party
});

test('advanced faders are offsets on the day and clamp', () => {
  const day = stopBoard(4);
  assert.deepEqual(withFaders(day, restBoard()), day);
  assert.equal(withFaders(day, { tempo: 60 }).tempo, day.tempo + 10);
  assert.equal(withFaders(day, { energy: 100 }).energy, Math.min(100, day.energy + 50));
  assert.equal(withFaders(day, { energy: 0 }).energy, Math.max(0, day.energy - 50));
});

test('clock: each stop at its hour, straight between, morning before it, party after it until 4:00', () => {
  const at = (h, m = 0) => clockPosition(new Date(2026, 9, 14, h, m));
  DAY.forEach((s, i) => assert.equal(at(Math.floor(s.at), (s.at % 1) * 60), Math.round(stopPosition(i)), s.id));
  assert.equal(at(8), Math.round(stopPosition(1) / 2));
  assert.equal(at(5), 0);
  assert.equal(at(23, 30), 100);
  assert.equal(at(2), 100);
  for (let h = 4; h < 24; h++) assert.ok(at(h) <= at(h, 59), `${h}`);
});

test('askState: words not ids, only what is away from rest, the rule sentence as a draft', () => {
  const position = stopPosition(2) + 2, heard = dayBoard(position, { 'lunch.siesta': 80 });
  const a = askState({ theme: 'house', position, tweaks: { 'lunch.siesta': 80, 'party.acid': 0 }, heard });
  assert.equal(a.theme, 'House');
  assert.equal(a.genre, THEMES.house.words.lunch);
  assert.deepEqual(a.day, { from: 'Lunch', to: 'More focus', toward: 0.14 });
  assert.deepEqual(a.tweaks, [{ label: 'Siesta', means: DAY[2].tweaks.siesta.hint, value: 80 }]); // party's tweak is not this hour's
  assert.ok(a.faders.length && a.faders.every(f => Math.abs(f.value - 50) >= 5 && f.high), JSON.stringify(a.faders));
  assert.equal(a.rules, compose(heard, a.genre).prompts[0].text);
  assert.equal(a.config.bpm, compose(heard, a.genre).config.bpm);
  assert.ok(!('previous' in a));
  const prev = [{ text: 'x', weight: 1 }];
  assert.deepEqual(askState({ theme: 'house', position, heard, previous: prev }).previous, prev);
});

test('#46: brightness floors at 0.4, density caps at 0.7, the Party tempo is the genre centre', () => {
  // the control tokens are spectral-centroid and onset priors, not moods; Google's samples run density 0.2 to 0.5 and brightness 0.4 to 0.7
  assert.deepEqual([0, 25, 50, 75, 100].map(v => compose(board({ dark: v }), W).config.brightness), [1, 0.75, undefined, 0.4, 0.4]);
  assert.deepEqual([0, 25, 50, 75, 100].map(v => compose(board({ energy: v }), W).config.density), [0, 0.25, undefined, 0.7, 0.7]);
  assert.equal(compose(board({ energy: 100 }), W, { density: 0.9 }).config.density, 0.9); // a p= pin still goes through
  assert.ok(sentence(compose(board({ dark: 100 }), W)).startsWith(`${FADERS.dark.high} `)); // Dark keeps its words
  assert.equal(stopBoard(7).tempo, 50); // no Party push on Tempo: the word's own centre carries it
  for (const [t, th] of Object.entries(THEMES)) assert.equal(compose(stopBoard(7, {}, t), th.words.party, {}, t).config.bpm, bpmOf(50, th.words.party), t);
});

test('#46: each theme owns its Party body, by the solo rule dubstep set', () => {
  for (const t of ['house', 'bass', 'balearic']) {
    const word = THEMES[t].words.party, r = compose(stopBoard(7, {}, t), word, {}, t);
    assert.equal(sentence(r), `${word} track with ${THEMES[t].phrases.hard.high}`, t);
    assert.deepEqual(r.config, { bpm: bpmOf(50, word), guidance: 4, musicGenerationMode: 'QUALITY' }, t); // the word's priors decide
    assert.ok(sentence(compose(board({ hard: 10 }), word, {}, t)).includes(FADERS.hard.low), t); // the low end stays the shared one
    assert.equal(compose(stopBoard(7, { 'party.afters': 100 }, t), word, {}, t).solo, false, t); // Afters brings the full sentence back
  }
  const afro = compose(stopBoard(7, {}, 'afro'), 'afro tech', {}, 'afro'); // afro keeps the full sentence, no body: its party is the centre at 135
  assert.equal(afro.solo, false);
  assert.ok(sentence(afro).includes(FADERS.hard.high) && sentence(afro).includes(THEMES.afro.palette.beat), sentence(afro));
  assert.deepEqual([afro.config.bpm, afro.config.density, afro.config.brightness], [135, 0.7, 0.4]);
  assert.equal(beatOf(THEMES.bass.words.party), 'garage'); // breaks & bass: the word and the body agree on the beat
  assert.ok(THEMES.bass.phrases.hard.high.includes('garage hats') && THEMES.bass.phrases.hard.high.includes('kick'));
  assert.notEqual(THEMES.bass.words.party, 'dubstep'); // the one bad clip of 2026-10-15
});

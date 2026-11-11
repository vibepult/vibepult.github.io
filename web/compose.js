// v2: the day on one slider. Twelve faders are the dimensions, a board is a point, a position on the day is a
// board, the theme names the genre word for each stop, and one sentence tells Lyria what the board says.
// DOM-free, tested by compose.test.js. The tables are the tuning surface; every phrase and push is a guess until heard.
// v1 lessons kept: one role-based sentence, a production phrase at a fixed share,
// fader words inside the sentence, a hard cut when the genre word or the tempo step changes.

// Each fader: a listener-facing label, a low and a high phrase, and the slot the phrase takes in the sentence.
// `lead` words open the sentence as adjectives; the other slots are clauses after "track with". Every phrase names
// an instrument or a part, never a mood alone. The three `drums` faders merge into
// one clause: Groove and Energy give the adjectives (`adj`), Organic says what plays it.
export const FADERS = {
  tempo: { label: 'Tempo', slot: 'lead', low: 'slow, laid-back', high: 'fast, driving' },
  energy: { label: 'Energy', slot: 'drums', low: 'a sparse beat with few hits', high: 'busy layered percussion with rolling hi-hats', adj: { low: 'sparse', high: 'busy, layered' } },
  dark: { label: 'Dark', slot: 'lead', low: 'bright, sunny', high: 'dark, moody' },
  organic: { label: 'Organic', slot: 'drums', low: 'a drum machine beat and synths', high: 'live hand percussion, congas and shakers, acoustic instruments' },
  dusty: { label: 'Dusty', slot: 'texture', low: 'clean, polished sounds', high: 'lo-fi texture with vinyl crackle and tape warmth' },
  dreamy: { label: 'Dreamy', slot: 'keys', low: 'dry, close keys and punchy stabs', high: 'reverb-washed Synth Pads drifting over the beat' },
  melodic: { label: 'Melodic', slot: 'keys', low: 'hypnotic looping arpeggios', high: 'a memorable lead melody over warm chord changes' },
  deep: { label: 'Deep', slot: 'bass', low: 'a light, airy bassline', high: 'a deep sub bass locked to the kick' },
  hard: { label: 'Hard', slot: 'texture', low: 'soft filtered synths and warm pads', high: 'acid 303 lines and distorted, industrial synths' },
  groove: { label: 'Groove', slot: 'drums', low: 'a swung, lazy beat', high: 'a straight, tight beat locked to the grid', adj: { low: 'swung, lazy', high: 'straight, tight' } }, // the genre word says if it is four-on-the-floor
  voice: { label: 'Voice', slot: 'keys', low: '', high: 'airy wordless vocal chops' }, // low is instrumental: no phrase, QUALITY mode
  steady: { label: 'Steady', slot: 'mood', low: 'evolving filter sweeps and breakdowns', high: 'a locked, hypnotic groove that never breaks' },
};
export const IDS = Object.keys(FADERS);
const SLOTS = ['drums', 'bass', 'keys', 'texture', 'mood']; // clause order after the style word

// The production phrase holds PRODUCTION_SHARE of the total weight whatever else is sent (v1, phase 0). 0.2 since
// 2026-10-15: heard against 0.4 and 0. Each theme has its own phrase in THEMES; this is the fallback.
export const PRODUCTION = 'studio recording, steady groove, full arrangement, polished electronic production';
export const PRODUCTION_SHARE = 0.2;
export const DEADBAND = 0.1; // |v - 50| / 50 below this is "don't care", the v0 engine rule
export const SOLO = 0.5; // a theme's solo fader past 75 (or below 25) owns the sentence
export const MAX_CLAUSES = 5; // strongest pushes speak; every extra clause dilutes the sentence (v1, finding 10). 5 keeps it under 45 words
// bpm is a learned prior per style: a genre word at a tempo it never has costs quality. Each word
// gets its natural centre; Tempo and the day pushes move at most ±15 inside it, in 5 bpm steps. A spec's own `bpm`
// map (a typed day's words) comes before the shared table.
export const bpmOf = (v, style = '', bpm = null) => Math.round(((bpm?.[style] ?? BPM[style] ?? 110) + 0.3 * (v - 50)) / 5) * 5;
const DEFAULTS = { guidance: 4.0 }; // the API default. Heard 2026-10-15 against 4.5 and 5.5: the 5.5 of v1 (metal) renders the most obvious version of the prompt; p= overrides

export const restBoard = () => Object.fromEntries(IDS.map(id => [id, 50]));
const round = x => Math.round(x * 100) / 100;
const clamp = v => Math.max(0, Math.min(100, Math.round(v)));
const unit = position => Math.max(0, Math.min(100, position)) / 100; // a day position as 0..1, unrounded

// The built-in day: stops in slider order, evenly spaced from 0 to 100. Each stop is a push over the rest board, the
// hour the clock reaches it, and five tweaks. A tweak slider at 100 adds its push to its own stop, at 0 subtracts it,
// at 50 does nothing; tweaks stack. Pushes are guesses until heard. The surf office's own (bbq, shopping,
// taverna, grilling) were written by Gemini Flash once on 2026-10-12 and kept as plain values. Since #48 a day is
// data: every day function below takes a spec (`builtin(theme)` wraps this day with a theme; a typed day comes from
// the relay, written by a model and gated by the bench).
export const DAY = [
  { id: 'morning', label: 'Lofi morning', at: 7, push: { tempo: -35, energy: -30, dusty: 35, dreamy: 10, melodic: 10, groove: -30, hard: -40 }, tweaks: {
    coffee: { label: 'Second coffee', hint: 'waking up for real', push: { tempo: 20, energy: 20, melodic: 10 } },
    rain: { label: 'Grey sky', hint: 'rain on the window', push: { dark: 30, dreamy: 20, dusty: 15 } },
    sunny: { label: 'Sunny', hint: 'blue sky, coffee on the terrace', push: { dark: -35, organic: 20, melodic: 20 } },
    jazzy: { label: 'Jazzy', hint: 'warm keys and swing', push: { organic: 30, melodic: 25, groove: -20 } },
    quiet: { label: 'Quiet', hint: 'the house still sleeps', push: { energy: -30, hard: -20, deep: -15 } },
  } },
  { id: 'focus', label: 'Focus work', at: 9, push: { steady: 40, melodic: -25, dreamy: 20, voice: -30, hard: -20, energy: -10, groove: 20 }, tweaks: {
    deep: { label: 'Deep work', hint: 'headphones on, door closed', push: { steady: 30, melodic: -20, voice: -30 } },
    warm: { label: 'Warm', hint: 'less sterile', push: { organic: 25, dusty: 20, dark: -15 } },
    pulse: { label: 'Pulse', hint: 'a beat to type to', push: { groove: 30, energy: 15, tempo: 10 } },
    space: { label: 'Space', hint: 'more air, fewer notes', push: { dreamy: 30, energy: -20, deep: 15 } },
    calls: { label: 'Between calls', hint: 'background, never in the way', push: { energy: -25, hard: -25, voice: -30, melodic: -10 } },
  } },
  // energy -10: the lunch words' own density prior is busier than a lunch wants (heard 2026-10-15, density 0.5 pinned brought the lounge back)
  { id: 'lunch', label: 'Lunch', at: 12.5, push: { organic: 30, dark: -25, melodic: 20, hard: -25, groove: 15, energy: -10 }, tweaks: {
    taverna: { label: 'Lunch from the taverna', hint: 'sunny, relaxed Mediterranean acoustic grooves by the sea', push: { organic: 30, dark: -25, energy: -15, tempo: -15, melodic: 20, groove: -20, hard: -25 } },
    shopping: { label: 'Michal went shopping', hint: 'sleek, upbeat, brightly melodic strutting music', push: { dark: -30, melodic: 30, dusty: -25, groove: 20, energy: 15, tempo: 10, hard: -20, voice: 15 } },
    siesta: { label: 'Siesta', hint: 'slow down after eating', push: { tempo: -25, energy: -25, dreamy: 20 } },
    disco: { label: 'Disco', hint: 'lunch turns into a party', push: { groove: 30, energy: 20, melodic: 15, voice: 15 } },
    terrace: { label: 'Terrace', hint: 'blue sky, sea breeze', push: { dark: -25, dreamy: 20, organic: 15 } },
  } },
  { id: 'flow', label: 'More focus', at: 14, push: { steady: 35, groove: 30, deep: 25, dreamy: 20, melodic: -15, energy: 5 }, tweaks: {
    hypnotic: { label: 'Hypnotic', hint: 'loops that carry you', push: { steady: 30, melodic: -25, groove: 20 } },
    drive: { label: 'Drive', hint: 'push through the slump', push: { energy: 25, tempo: 15, hard: 15 } },
    drift: { label: 'Drift', hint: 'soft focus', push: { dreamy: 30, dark: -10, energy: -15 } },
    night: { label: 'Night mode', hint: 'darker, tighter', push: { dark: 30, deep: 20, hard: 15 } },
    words: { label: 'Voices', hint: 'more for some, a distraction for others', push: { voice: 40 } },
  } },
  { id: 'surf', label: 'Surf hype', at: 16.5, push: { energy: 30, tempo: 15, melodic: 30, dark: -25, groove: 30, dreamy: 15 }, tweaks: {
    swell: { label: 'Swell is up', hint: 'boards on the car', push: { energy: 30, tempo: 20 } },
    sunny: { label: 'Sunny', hint: 'blue sky, offshore wind', push: { dark: -35, melodic: 20, organic: 15 } },
    tribal: { label: 'Tribal', hint: 'drums, drums, drums', push: { organic: 35, groove: 20, energy: 15 } },
    breaks: { label: 'Breaks', hint: 'broken beats', push: { groove: -40, hard: 20 } },
    anthem: { label: 'Anthem', hint: 'hands up', push: { melodic: 30, voice: 25, dreamy: 15 } },
  } },
  { id: 'sunset', label: 'Sunset', at: 19, push: { tempo: -20, dreamy: 30, organic: 30, melodic: 20, dusty: 15, hard: -25 }, tweaks: {
    salt: { label: 'Salt and tired', hint: 'warm, slow, done', push: { tempo: -25, energy: -25, dreamy: 20 } },
    golden: { label: 'Golden hour', hint: 'the last light', push: { dark: -25, melodic: 25, organic: 15 } },
    deeper: { label: 'Deeper', hint: 'the sun is gone', push: { deep: 30, dark: 25 } },
    dusty: { label: 'Old records', hint: 'crackle and warmth', push: { dusty: 35, organic: 15 } },
    hum: { label: 'Someone humming', hint: 'voices in the mix', push: { voice: 35, melodic: 15 } },
  } },
  { id: 'dinner', label: 'Dinner', at: 20.5, push: { groove: 25, melodic: 25, dark: -10, organic: 20, deep: 15, hard: -20 }, tweaks: {
    bbq: { label: 'BBQ starting', hint: 'warm, sunny, organic grooves for a relaxed evening barbecue', push: { organic: 30, dark: -25, melodic: 20, hard: -25, dusty: 15, groove: 10 } },
    grilling: { label: 'Fish are grilling', hint: 'laid-back beachside cookout, acoustic percussion, lo-fi texture', push: { organic: 35, dusty: 30, dark: -25, tempo: -20, energy: -20, groove: -25, melodic: 20 } },
    bottle: { label: 'Second bottle', hint: 'the table gets louder', push: { energy: 25, groove: 20, tempo: 15 } },
    candle: { label: 'Candlelight', hint: 'a quiet table', push: { energy: -30, dreamy: 25, hard: -20 } },
    disco: { label: 'Disco', hint: 'someone pushes the table aside', push: { groove: 30, melodic: 25, voice: 20, dark: -20 } },
  } },
  // No Tempo push since #46: the word's own centre carries the party (BPM), +10 never landed on the bench (2026-11-04).
  { id: 'party', label: 'Party', at: 22.5, push: { energy: 40, hard: 35, groove: 30, dark: 25, steady: 20, melodic: -10 }, tweaks: {
    peak: { label: 'Peak time', hint: 'hands in the air', push: { energy: 25, tempo: 15, steady: 15 } },
    acid: { label: 'Acid', hint: 'squelch', push: { hard: 30, melodic: -15 } },
    tribal: { label: 'Tribal', hint: 'drums and sweat', push: { organic: 35, groove: 15, melodic: -10 } },
    warehouse: { label: 'Warehouse', hint: 'concrete and strobe', push: { dark: 30, deep: 20, hard: 20 } },
    afters: { label: 'Afters', hint: 'the sun is coming up', push: { tempo: -30, energy: -30, dreamy: 30, hard: -25 } },
  } },
];
// A spec: { id, label, skin, stops: [{ id, label, hint?, at, push, tweaks: { [t]: { label, hint, push } } }],
// theme: { label, words: { [stop]: word }, production, palette: { beat, keys }, phrases?, bpm?: { [word]: n },
// beat?: { [word]: skeleton } } }. Hours in order; after midnight is 24 plus the hour. `skin` is the built-in theme
// whose look it borrows.
export const stopPosition = (spec, i) => i * 100 / (spec.stops.length - 1);
export const nearestStop = (spec, position) => Math.round(unit(position) * (spec.stops.length - 1));

const add = (out, push, k = 1) => { for (const [f, d] of Object.entries(push)) out[f] += k * d; return out; };
const clampBoard = b => Object.fromEntries(IDS.map(id => [id, clamp(b[id])]));

// The five tweaks of a stop, as [id, tweak], ids `stop.tweak`.
export const stopTweaks = (spec, i) => Object.entries(spec.stops[i].tweaks).map(([t, tw]) => [`${spec.stops[i].id}.${t}`, tw]);
// Every tweak id of a spec, stop by stop: the order of the tweaks in the share string.
export const tweakIds = spec => spec.stops.flatMap((s, i) => stopTweaks(spec, i).map(([id]) => id));
export const restTweaks = spec => Object.fromEntries(tweakIds(spec).map(id => [id, 50]));

// A stop's board with its own tweaks on top. Tweaks belong to their stop, so they fade as the slider leaves it.
export function stopBoard(spec, i, tweaks = {}) {
  const out = add(restBoard(), spec.stops[i].push);
  for (const [id, tw] of stopTweaks(spec, i)) add(out, tw.push, ((tweaks[id] ?? 50) - 50) / 50);
  return clampBoard(out);
}

// Where a position sits: stop i, and t of the way from it to stop i + 1.
export function daySpan(spec, position) {
  const n = spec.stops.length, x = unit(position) * (n - 1), i = Math.min(Math.floor(x), n - 2);
  return { i, t: x - i };
}

// Every position 0..100 is a board: a straight line between the two nearest stops.
export function dayBoard(spec, position, tweaks = {}) {
  const { i, t } = daySpan(spec, position);
  const a = stopBoard(spec, i, tweaks), b = stopBoard(spec, i + 1, tweaks);
  return Object.fromEntries(IDS.map(id => [id, Math.round(a[id] + t * (b[id] - a[id]))]));
}

// The advanced faders as offsets on the day: 50 leaves it alone, 100 adds 50, 0 takes 50 away.
export const withFaders = (day, board = {}) => clampBoard(add({ ...day }, Object.fromEntries(IDS.map(id => [id, (board[id] ?? 50) - 50]))));

// The clock: each stop at its hour, a straight line between them, the first stop before it, the last stop after it.
// after midnight is the last stop until 4:00, then the first; tune by ear.
export function clockPosition(spec, date) {
  const stops = spec.stops;
  let h = date.getHours() + date.getMinutes() / 60;
  if (h < 4) h += 24;
  if (h <= stops[0].at) return 0;
  const i = stops.findLastIndex(s => s.at <= h);
  if (i === stops.length - 1) return 100;
  return Math.round(stopPosition(spec, i) + (h - stops[i].at) / (stops[i + 1].at - stops[i].at) * stopPosition(spec, 1));
}

// Themes: the flavour of the whole day, one genre word per stop. Only the word changes, the boards stay: the faders
// say how it moves, the theme says what it is. Mainstream words first, Lyria knows them best. `t=` in the hash.
// A morning word must live at a morning tempo (BPM below), so the two fast ones were swapped 2026-10-15.
// Era and region words (the guide: "Berlin minimal techno", "early 1990s") anchor a stop to a real scene; five stops carry one since 2026-10-15 (leak F), to be heard against the plain word.
export const THEMES = {
  // palette: the instruments Lyria knows best for the theme (the guide's keyword list). `beat` is the drum noun when
  // Organic is at rest, `keys` fills the keys slot when no keys fader is pushed. Guesses until heard.
  techno: { label: 'Techno', production: 'studio recording, clean club mix, tight low end, wide stereo', palette: { beat: 'TR-909 beat', keys: 'dub chord stabs with delay and Spacey Synths' }, words: { morning: 'ambient dub', focus: 'minimal techno', lunch: 'Berlin dub techno', flow: 'hypnotic techno', surf: 'melodic techno', sunset: 'deep dub techno', dinner: 'Detroit techno', party: 'acid techno' } }, // no Party body: a solo body lost the kick (92 to 112 found against 140), the full sentence keeps it (bench 2026-11-05)
  // #46: the Party body per theme. Hard's high end is the theme's signature at the party and solos as dubstep's does (the solo rule
  // below): the word and the body, no density, brightness or temperature, so the word's own priors decide. Every theme sent the same
  // acid body at the party until 2026-11-05. Benched, then heard: techno and afro keep the full sentence (their solo
  // bodies lost the kick; afro's party is its centre at 135), breaks & bass parties on speed garage, not brostep (every half-time or
  // breaks body read as chill or focus to the ear, 2026-11-06).
  house: { label: 'House', production: 'studio recording, warm analog production, polished club mix', palette: { beat: 'TR-909 beat and shaker', keys: 'Rhodes Piano chords' }, words: { morning: 'lo-fi hip hop', focus: '90s deep house', lunch: 'nu disco', flow: 'deep tech house', surf: 'Chicago house', sunset: 'organic house', dinner: 'disco house', party: 'tech house' },
    phrases: { hard: { high: 'a tight TR-909 beat, a rolling bassline and filtered disco stabs', solo: 'high' } } },
  bass: { label: 'Breaks & bass', production: 'studio recording, clean sub-focused mix, crisp punchy drums', palette: { beat: 'breakbeat', keys: 'Rhodes Piano chords and Dirty Synths' }, words: { morning: 'Bristol trip hop', focus: 'downtempo breakbeat', lunch: 'UK garage', flow: 'deep dubstep', surf: 'breakbeat', sunset: 'lo-fi breakbeat', dinner: 'UK garage', party: 'speed garage' }, // speed garage since #46: dubstep gave the one bad clip of 2026-10-15, five brostep bodies read as chill-step (2026-11-06)
    phrases: { hard: { high: 'shuffling, skipping garage hats over a light, punchy kick, a bouncy warped sub bassline, chopped diva vocals and rave organ stabs', solo: 'high' } } }, // a light kick: the hard one choked the ear
  balearic: { label: 'Balearic & trance', production: 'studio recording, lush, wide, sunlit production', palette: { beat: 'soft TR-909 beat and shakers', keys: 'Warm Acoustic Guitar and Smooth Pianos' }, words: { morning: 'Balearic chillout', focus: 'progressive house', lunch: 'Balearic house', flow: 'progressive trance', surf: 'uplifting trance', sunset: 'Balearic downtempo', dinner: 'Ibiza lounge house', party: 'psytrance' },
    phrases: { hard: { high: 'a driving kick, a rolling psytrance bassline and plucked, phasing synth leads', solo: 'high' } } },
  afro: { label: 'Afro & organic', production: 'studio recording, warm organic production, natural percussion, live feel', palette: { beat: 'groove on Conga Drums, Djembe and shakers', keys: 'Kalimba and Marimba melodies' }, words: { morning: 'organic downtempo', focus: 'organic house', lunch: 'afro house', flow: 'deep afro house', surf: 'tribal house', sunset: 'world downtempo', dinner: 'amapiano', party: 'afro tech' } }, // no Party body: the solo body ran 3 kHz bright and lost the kick, a log drum clause was too chill; the acid sentence at 135 is the afro party (bench and ear, 2026-11-06)
  // A theme may carry its own five tweaks per stop (`tweaks`, same shape as a stop's); the day's tweaks serve the
  // stops it leaves out. It may also reword a fader's end (`phrases: { fader: { low, high } }`) where the shared one misses.
  // Dubstep's day runs from chillstep (the Blackmill morning) to brostep (the Skrillex party), written 2026-10-15,
  // every push a guess. Measured the same day (data/probe/skrillex-*.wav): the party sentence with "dark, moody" and
  // a "clean sub bass" production phrase came out as a sub-bass bed (2.8 percent of the energy between 200 Hz and
  // 2 kHz, centroid 1 kHz); the bare growl sentence had 15 percent and 3.2 kHz. Brightness is a learned prior on
  // the spectral centroid, so the Skrillex tweak pushes Dark down, not up.
  dubstep: { label: 'Dubstep', production: 'studio recording, loud modern bass music mix, heavy sub bass, crisp punchy drums', palette: { beat: 'half-time beat', keys: 'eerie Synth Pads and a wobble bass' },
    words: { morning: 'chillstep', focus: 'deep dubstep', lunch: 'glitch hop', flow: 'deep dubstep', surf: 'melodic dubstep', sunset: 'future garage', dinner: 'UK garage', party: 'brostep' },
    // Hard is the bass synth and the theme's solo: Blackmill at the low end (the same screeching wobble under a
    // piano, at half the tempo; data/probe/bm-M4-melodic-70.wav), Skrillex's talking bass at the high end. The morning rests at Hard 10 and the party at 85, so both own their
    // sentence at rest; Afters (Hard back to 60) brings the full sentence back. Heard 2026-10-15 (data/probe/sk-P*.wav):
    // the talking bass is the closest to Skrillex; Deep swaps it for the chill half-time version (low) or the
    // electro house hybrid, pedal to the metal (high). "dubstep" as the genre word was the one bad clip.
    phrases: {
      hard: { low: { as: 'melodic dubstep', words: 'a soaring piano lead melody, lush strings and soft pads over a heavy half-time beat, a distorted screeching wobble bass with robotic growls' }, high: 'a heavy half-time beat, stuttering robotic talking bass, distorted vowel growls, screeching lasers, glitchy edits and a catchy synth lead melody', solo: true,
        by: [{ fader: 'deep', low: 'a heavy half-time dubstep beat, snare on the third beat, aggressive mid-range growl bass, wobble bass, screeching laser synths and heavy distortion',
          high: { as: 'aggressive electro house and dubstep hybrid', words: 'a half-time drop, robotic growl bass, wobble bass and screeching distorted synths' } },
        { fader: 'melodic', high: { as: 'melodic brostep', words: 'a big euphoric synth lead melody and soaring chords over a heavy half-time beat, stuttering robotic talking bass and screeching lasers' } }] },
      melodic: { low: 'sparse stabs, the bass carries the melody', high: 'an emotional piano melody over lush strings' },
      dark: { low: 'bright, metallic', high: 'dark, menacing' },
      // Deep high in the shared book is "locked to the kick": at More focus that put the kick in front and lost the wobble (heard 2026-10-15).
      deep: { low: 'a light, airy bassline', high: 'a deep screeching wobble bass riding under the beat' },
    },
    tweaks: {
      morning: {
        piano: { label: 'Piano', hint: 'the melody on the keys', push: { melodic: 30, organic: 15, dreamy: 10 } },
        strings: { label: 'Strings', hint: 'cinematic, wide', push: { dreamy: 30, melodic: 15, dark: 10 } },
        wobble: { label: 'Soft wobble', hint: 'the bass moves, gently', push: { deep: 30, hard: 15 } },
        sunrise: { label: 'Sunrise', hint: 'bright, hopeful', push: { dark: -30, melodic: 20 } },
        quiet: { label: 'Quiet', hint: 'the house still sleeps', push: { energy: -30, hard: -20, deep: -15 } },
      },
      focus: {
        headphones: { label: 'Headphones', hint: 'melodic and calm, no drops', push: { steady: 30, melodic: 15, hard: -25, voice: -30 } },
        rain: { label: 'Rain', hint: 'pads and vinyl crackle', push: { dreamy: 30, dusty: 25, dark: 10 } },
        pulse: { label: 'Pulse', hint: 'a snare to type to', push: { energy: 15, groove: 25, steady: 15 } },
        sub: { label: 'Sub', hint: 'bass you feel, not hear', push: { deep: 35, hard: -10 } },
        calls: { label: 'Between calls', hint: 'background, never in the way', push: { energy: -25, hard: -25, voice: -30, melodic: -10 } },
      },
      lunch: {
        funky: { label: 'Funky', hint: 'bass guitar and swing', push: { groove: -25, organic: 25, melodic: 15 } },
        sunny: { label: 'Sunny', hint: 'bright and bouncy', push: { dark: -30, melodic: 20, energy: 10 } },
        crunchy: { label: 'Crunchy', hint: 'bitcrushed and chopped', push: { hard: 25, dusty: 20 } },
        siesta: { label: 'Siesta', hint: 'slow down after eating', push: { tempo: -25, energy: -25, dreamy: 20 } },
        bounce: { label: 'Bounce', hint: 'lunch turns into a party', push: { energy: 25, groove: 15, voice: 15 } },
      },
      flow: {
        hypnotic: { label: 'Hypnotic', hint: 'one bass note, forever', push: { steady: 30, melodic: -25, deep: 15 } },
        drive: { label: 'Drive', hint: 'push through the slump', push: { energy: 25, hard: 20, tempo: 10 } },
        drift: { label: 'Drift', hint: 'soft focus', push: { dreamy: 30, dark: -10, energy: -15 } },
        dungeon: { label: 'Dungeon', hint: 'dark, dry, sub-heavy', push: { dark: 30, deep: 25, dreamy: -15 } },
        words: { label: 'Voices', hint: 'more for some, a distraction for others', push: { voice: 40 } },
      },
      surf: {
        drop: { label: 'The drop', hint: 'build and release', push: { energy: 30, hard: 25, steady: -20 } },
        anthem: { label: 'Anthem', hint: 'hands up, big lead', push: { melodic: 30, voice: 25, dreamy: 15 } },
        sunny: { label: 'Sunny', hint: 'blue sky, offshore wind', push: { dark: -35, melodic: 20, organic: 10 } },
        wobble: { label: 'Wobble', hint: 'the bass talks', push: { hard: 35, deep: 20, melodic: -10 } },
        trap: { label: 'Trap', hint: 'hi-hat rolls and 808s', push: { energy: 25, deep: 25, groove: 20 } },
      },
      sunset: {
        bus: { label: 'Night bus', hint: 'rain, vinyl crackle, ghost vocals', push: { dusty: 30, dreamy: 25, voice: 20, dark: 15 } },
        golden: { label: 'Golden hour', hint: 'the last light', push: { dark: -25, melodic: 25, organic: 15 } },
        deeper: { label: 'Deeper', hint: 'the sun is gone', push: { deep: 30, dark: 25 } },
        shuffle: { label: 'Shuffle', hint: 'swung, skipping hats', push: { groove: -30, energy: 15 } },
        salt: { label: 'Salt and tired', hint: 'warm, slow, done', push: { tempo: -25, energy: -25, dreamy: 20 } },
      },
      dinner: {
        twostep: { label: '2-step', hint: 'skippy, swung drums', push: { groove: -30, energy: 15 } },
        soulful: { label: 'Soulful', hint: 'chopped vocals and warm keys', push: { voice: 30, melodic: 25, dark: -15 } },
        bottle: { label: 'Second bottle', hint: 'the table gets louder', push: { energy: 25, groove: 20, tempo: 15 } },
        candle: { label: 'Candlelight', hint: 'a quiet table', push: { energy: -30, dreamy: 25, hard: -20 } },
        bassline: { label: 'Bassline', hint: 'the bass leads', push: { deep: 30, hard: 20, melodic: -10 } },
      },
      party: {
        chill: { label: 'Chill', hint: 'the growl, a bit laid back', push: { deep: -40, energy: -15, dark: -10 } },
        pedal: { label: 'Pedal to the metal', hint: 'electro house meets dubstep, flat out', push: { deep: 40, energy: 10, hard: 10 } },
        peak: { label: 'Peak time', hint: 'hands in the air', push: { energy: 25, tempo: 15, steady: 15 } },
        euphoric: { label: 'Euphoric', hint: 'big melodic drops', push: { melodic: 40, dreamy: 20, voice: 15 } },
        afters: { label: 'Afters', hint: 'the sun is coming up', push: { tempo: -30, energy: -30, dreamy: 30, hard: -25 } },
      },
    } },
};
// The built-in days as specs: the shared DAY under one theme, the theme's own tweaks in place of the day's where it
// has them. An unknown theme is techno, as a junk share link is.
const BUILTIN = Object.fromEntries(Object.keys(THEMES).map(id => [id, { id, label: THEMES[id].label, skin: id, stops: DAY.map(s => ({ ...s, tweaks: THEMES[id].tweaks?.[s.id] ?? s.tweaks })), theme: THEMES[id] }]));
export const builtin = theme => Object.hasOwn(BUILTIN, theme) ? BUILTIN[theme] : BUILTIN.techno;
// The centre of each word's typical range. General knowledge, not measured; a word not here
// gets 110. Check by ear and move the number, not the fader.
export const BPM = {
  'ambient dub': 90, 'minimal techno': 128, 'dub techno': 120, 'Berlin dub techno': 120, 'Detroit techno': 128, 'hypnotic techno': 132, 'melodic techno': 123, 'deep dub techno': 120, 'deep techno': 128, 'acid techno': 140,
  'lo-fi hip hop': 85, 'deep house': 122, '90s deep house': 122, 'Chicago house': 124, 'nu disco': 115, 'deep tech house': 124, 'piano house': 125, 'organic house': 118, 'disco house': 122, 'tech house': 127,
  'trip hop': 90, 'Bristol trip hop': 90, 'downtempo breakbeat': 100, 'UK garage': 134, 'deep dubstep': 140, 'breakbeat': 132, 'lo-fi breakbeat': 92, 'dubstep': 140,
  'Balearic chillout': 95, 'progressive house': 127, 'Balearic house': 115, 'progressive trance': 135, 'uplifting trance': 139, 'Balearic downtempo': 95, 'Ibiza lounge house': 112, 'psytrance': 144,
  'organic downtempo': 95, 'afro house': 121, 'deep afro house': 121, 'tribal house': 125, 'world downtempo': 95, 'amapiano': 113, 'afro tech': 135, // afro tech 135 since #46: at 125 the percussion thins out and the party goes with it (ear, 2026-11-06)
  // chillstep 80: the morning push (-35 Tempo, -10 bpm) lands on 70, the half-time feel of 140. brostep
  // 140 since #46 (no party push); 150 came out as hardbass. Both heard 2026-10-15.
  'Jamaican dub': 75, 'chillstep': 80, 'glitch hop': 110, 'melodic dubstep': 140, 'future garage': 130, 'brostep': 140, 'speed garage': 138,
};
// The rhythm skeleton of each word; four-on-the-floor unless listed. Two words with the same skeleton blend (leak G),
// a skeleton change is a hard cut like a tempo step.
export const BEAT = {
  'ambient dub': 'down', 'lo-fi hip hop': 'breaks', 'trip hop': 'breaks', 'Bristol trip hop': 'breaks', 'downtempo breakbeat': 'breaks', 'UK garage': 'garage',
  'deep dubstep': 'half', 'breakbeat': 'breaks', 'lo-fi breakbeat': 'breaks', 'dubstep': 'half',
  'Balearic chillout': 'down', 'Balearic downtempo': 'down', 'organic downtempo': 'down', 'world downtempo': 'down',
  'Jamaican dub': 'down', 'chillstep': 'half', 'glitch hop': 'breaks', 'melodic dubstep': 'half', 'future garage': 'garage', 'brostep': 'half', 'speed garage': 'garage',
};
export const beatOf = (style, beat = null) => beat?.[style] ?? BEAT[style] ?? 'four';
// A fader end's words: the theme's own if it rewords that fader, else the shared phrase. A solo end may be { as, words }.
export const phrase = (spec, id, side) => { const x = spec?.theme.phrases?.[id]?.[side]; return x === undefined ? FADERS[id][side] : x.words ?? x; };

// A small genre move blends instead of cutting: the
// old prompts fade as the new ones rise, one frame per RAMP step, RAMP_MS apart. Same texts merge; zero weights drop.
export const RAMP = [0.25, 0.5, 0.75, 1], RAMP_MS = 10_000;
export function ramp(from, to, k) {
  const w = new Map();
  for (const [list, f] of [[from, 1 - k], [to, k]]) for (const q of list) w.set(q.text, round((w.get(q.text) ?? 0) + q.weight * f));
  return [...w].filter(([, weight]) => weight > 0).map(([text, weight]) => ({ text, weight }));
}
// The genre word flips at the midpoint between two stops: a hard cut there, as any style change.
export const dayStyle = (spec, position) => spec.theme.words[spec.stops[nearestStop(spec, position)].id];

// The two objects the model sees: one sentence at 1.0 and the production phrase at its share. `style` is the genre
// word; `spec` brings the theme's palette, production, phrases, bpm and solo rule, none of them without a spec.
export function compose(board, style, p = {}, spec = null) {
  const theme = spec?.theme, pushes = [];
  for (const id of IDS) {
    const v = board[id] ?? 50, w = Math.abs(v - 50) / 50, side = v > 50 ? 'high' : 'low';
    const words = phrase(spec, id, side);
    if (w >= DEADBAND && words) pushes.push({ id, w, side, slot: FADERS[id].slot, words });
  }
  pushes.sort((a, b) => b.w - a.w);
  const lead = pushes.filter(t => t.slot === 'lead').map(t => t.words).join(', ');
  const palette = theme?.palette;
  // One drum clause from up to three pushes: "a straight, tight, busy TR-909 beat with rolling hi-hats".
  const drums = pushes.filter(t => t.slot === 'drums');
  const organic = drums.find(t => t.id === 'organic')?.side;
  const adjs = drums.filter(t => t.id !== 'organic').map(t => FADERS[t.id].adj[t.side]);
  const noun = organic === 'high' ? 'groove on live hand percussion, congas and shakers' : organic === 'low' ? 'drum machine beat' : palette?.beat;
  const busy = drums.some(t => t.id === 'energy' && t.side === 'high');
  const drumClause = noun || adjs.length
    ? `a ${adjs.length ? adjs.join(', ') + ' ' : ''}${noun ?? 'beat'}${busy ? ' with rolling hi-hats' : ''}${organic === 'low' ? ' and synths' : ''}` : '';
  const rest = pushes.filter(t => t.slot !== 'lead' && t.slot !== 'drums').slice(0, MAX_CLAUSES - 1);
  const clauses = [
    ...(drumClause ? [{ slot: 'drums', words: drumClause }] : []),
    ...rest,
    ...(palette && !rest.some(t => t.slot === 'keys') ? [{ slot: 'keys', words: palette.keys }] : []),
  ];
  const body = SLOTS.flatMap(s => clauses.filter(t => t.slot === s).map(t => t.words)).join(', ');
  // A fader end the theme marks `solo` is the theme's signature sound. Pushed past SOLO it takes the sentence over:
  // the genre word and that phrase, nothing else, not even the lead adjectives. Measured 2026-10-15 (data/probe,
  // the abl-, cl- and rep- clips): the growl phrase alone landed at a 2.1 to 3.5 kHz centroid, inside the full
  // party sentence always at 0.7 to 1.1 kHz, as a second prompt beside it still 0.8 kHz, and the lead adjectives
  // alone pulled it to 0.9 to 1.7 kHz. Every extra clause dilutes (v1, finding 10); for a signature sound, fatally.
  // `by` lists other faders whose far ends swap the solo body for a variant (a body, or { as, words } to reword the
  // genre too, in the sentence only); the strongest pushed one wins.
  const solo = pushes.find(t => { const x = theme?.phrases?.[t.id]?.solo; return (x === true || x === t.side) && t.w >= SOLO; });
  let sentence = `${lead ? lead + ' ' : ''}${style} track${body ? ' with ' + body : ''}`;
  if (solo) {
    const by = theme.phrases[solo.id].by ?? [], k = pushes.find(t => t.w >= SOLO && by.some(b => b.fader === t.id && b[t.side]));
    const v = k ? by.find(b => b.fader === k.id)[k.side] : theme.phrases[solo.id][solo.side], { as = style, words } = typeof v === 'string' ? { words: v } : v;
    sentence = `${as} track with ${words}`;
  }
  // The share is a p= pin for the A/B by ear; 0 drops the production prompt.
  const share = p.production ?? PRODUCTION_SHARE;
  const prompts = [
    { text: sentence, weight: 1.0 },
    ...(share > 0 ? [{ text: theme?.production ?? PRODUCTION, weight: round(share / (1 - share)) }] : []),
  ];
  const at = id => board[id] ?? 50;
  // density, brightness and temperature are learned priors per style: a field is sent only when
  // its fader left the deadband, otherwise the genre's own prior decides. Temperature sits on the API default 1.1:
  // Steady at 100 is 0.7 (locked), at 0 is 1.4 (restless).
  // A solo owns the config too: the clips that had the sound sent only bpm and guidance;
  // the same words with the party's density, brightness and temperature averaged a 1.2 kHz centroid against 2.7 kHz.
  const asked = id => !solo && Math.abs(at(id) - 50) / 50 >= DEADBAND;
  const s = at('steady');
  const config = {
    bpm: p.bpm ?? bpmOf(at('tempo'), style, theme?.bpm),
    // #46: density caps at 0.7 and brightness floors at 0.4. Google's guide calls 0.9 a chaotic orchestra and low brightness dark and
    // bass-heavy; its samples run 0.2 to 0.5 and 0.4 to 0.7. Brightness 0.25 put the Party at 1.4 kHz against a 2 to 3 kHz band (bench, 2026-11-04).
    ...(asked('energy') && { density: Math.min(0.7, round(at('energy') / 100)) }),
    ...(asked('dark') && { brightness: Math.max(0.4, round(1 - at('dark') / 100)) }),
    ...(asked('steady') && { temperature: round(s >= 50 ? 1.1 - 0.4 * (s - 50) / 50 : 1.1 + 0.3 * (50 - s) / 50) }),
    ...(p.density !== undefined && { density: p.density }), // p= pins a field for an A/B by ear
    ...(p.temperature !== undefined && { temperature: p.temperature }),
    guidance: p.guidance ?? DEFAULTS.guidance,
    musicGenerationMode: p.mode || (at('voice') > 50 ? 'VOCALIZATION' : 'QUALITY'),
  };
  if (p.seed !== undefined) config.seed = p.seed;
  // cut: what needs a context reset when it changes, plus bpm which the page handles. The style word and the clauses:
  // blended, the model keeps its old instruments for a long time (v1, finding 4). Lead adjectives blend fine.
  return { prompts, config, style, solo: !!solo, cut: `${style}|${solo ? sentence : body}` };
}

// The share link, `s=` in the hash: the whole page as base64url bits, sparse, the way v1's engine.js packs its desk.
// Header: the spec's tweak count in 7 bits, so a link from another layout reads as the opening page. Then the theme
// index in 3 bits (picks the built-in spec; 0 and ignored under a typed day, `d=`), Haiku in 1, follow-the-clock in 1
// and, when not following, the day in 7. Then one mask bit per fader and 7 bits for each pushed one; then the pushed
// tweak count in 7 bits and, per tweak, 7 bits of index into the spec's tweak ids and 7 of value. The opening page is
// 6 characters; one fader and one tweak away from rest make 9. Junk reads as the opening page.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const THEME_IDS = Object.keys(THEMES);
export const openingState = (day = null) => ({ theme: 'techno', haiku: false, position: null, board: restBoard(), tweaks: restTweaks(day ?? builtin('techno')) });
export function encodeState({ theme, haiku, position, board, tweaks }, day = null) {
  const ids = tweakIds(day ?? builtin(theme));
  const bits = [], push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  const at = (b, id) => Math.round(b[id] ?? 50);
  push(ids.length, 7); push(Math.max(0, THEME_IDS.indexOf(theme)), 3); push(haiku ? 1 : 0, 1);
  push(position === null ? 1 : 0, 1); if (position !== null) push(position, 7);
  for (const id of IDS) push(at(board, id) !== 50 ? 1 : 0, 1);
  for (const id of IDS) if (at(board, id) !== 50) push(at(board, id), 7);
  const moved = ids.map((id, i) => [i, at(tweaks, id)]).filter(([, v]) => v !== 50);
  push(moved.length, 7);
  for (const [i, v] of moved) { push(i, 7); push(v, 7); }
  while (bits.length % 6) bits.push(0);
  let out = '';
  for (let j = 0; j < bits.length; j += 6) out += B64[bits.slice(j, j + 6).reduce((a, b) => 2 * a + b, 0)];
  return out;
}
// Untrusted input (anyone can paste a link): anything malformed, out of range or with trailing junk is the opening page.
export function decodeState(text, day = null) {
  const s = openingState(day), bad = () => { throw new RangeError(); };
  if (typeof text !== 'string' || !text.length || [...text].some(c => !B64.includes(c))) return s;
  const bits = [];
  for (const c of text) for (let i = 5; i >= 0; i--) bits.push((B64.indexOf(c) >> i) & 1);
  let pos = 0;
  const read = n => { if (pos + n > bits.length) bad(); let v = 0; for (let i = 0; i < n; i++) v = 2 * v + bits[pos++]; return v; };
  const value = () => { const v = read(7); if (v > 100) bad(); return v; };
  try {
    const count = read(7);
    s.theme = THEME_IDS[read(3)] ?? bad();
    const ids = tweakIds(day ?? builtin(s.theme));
    if (count !== ids.length) bad();
    s.tweaks = Object.fromEntries(ids.map(id => [id, 50]));
    s.haiku = read(1) === 1;
    if (!read(1)) s.position = value();
    const mask = IDS.map(() => read(1) === 1);
    IDS.forEach((id, i) => { if (mask[i]) s.board[id] = value(); });
    for (let n = read(7), last = -1; n > 0; n--) { const i = read(7); if (i <= last || i >= ids.length) bad(); s.tweaks[ids[i]] = value(); last = i; }
    if (bits.length - pos >= 6 || bits.slice(pos).some(b => b)) bad(); // exactly the padding, nothing else
    return s;
  } catch (e) { if (e instanceof RangeError) return openingState(day); throw e; }
}

// What Haiku reads (the relay's prompt file says how): words, not ids, and only what is away from rest.
// `heard` is the board the model hears; `previous` is Haiku's last answer, so a small move keeps its wording.
export function askState({ spec, position, tweaks = {}, heard, p = {}, previous }) {
  const { i, t } = daySpan(spec, position), genre = dayStyle(spec, position), stops = spec.stops;
  const { prompts, config, solo } = compose(heard, genre, p, spec);
  const value = id => tweaks[id] ?? 50;
  const near = stops[nearestStop(spec, position)];
  return {
    theme: spec.theme.label,
    genre,
    day: { from: stops[i].label, to: stops[i + 1].label, toward: round(t), ...(near.hint && { means: near.hint }) },
    tweaks: stopTweaks(spec, nearestStop(spec, position)).filter(([id]) => value(id) !== 50).map(([id, tw]) => ({ label: tw.label, means: tw.hint, value: value(id) })),
    faders: IDS.filter(id => Math.abs(heard[id] - 50) >= 5)
      .map(id => ({ name: FADERS[id].label, value: heard[id], low: phrase(spec, id, 'low') || 'instrumental, no voices', high: phrase(spec, id, 'high') })),
    config: { bpm: config.bpm, density: config.density, brightness: config.brightness, mode: config.musicGenerationMode },
    rules: prompts[0].text,
    ...(solo && { solo: true }),
    ...(previous ? { previous } : {}),
  };
}

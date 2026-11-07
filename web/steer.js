// Steering: the board -> Lyria prompts and config. DOM-free, tested by steer.test.js. The tuning surface
// of v1, the way weights.yaml is v0's. Every phrase is a guess until
// the listening sheet (phase 4) says otherwise. Revised 2026-10-15 with what v2 heard and measured:
// the bpm belongs to the genre word, a config field goes out only when a fader asks for it,
// production at 0.2, guidance 4, and a cap on the ideas in the sentence, because every extra one dilutes the rest.

// The genre word per pack. The anchor is style plus this word (phase 0, finding 11).
export const GENRE = {
  steel: 'heavy metal', black: 'black metal', death: 'death metal', doom: 'doom metal', folk: 'folk metal',
  industrial: 'industrial metal', power: 'power metal', prog: 'progressive metal', thrash: 'thrash metal',
};

// The style per pack: the modifier vocabulary the pool uses. A one-word style prefixes
// the genre word ("melodic death metal"); a style that is a genre of its own (WHOLE) replaces it ("sludge metal").
export const STYLES = {
  steel: ['melodic', 'progressive', 'epic', 'speed metal', 'glam metal', 'groove metal', 'hard rock', 'nu metal'],
  black: ['melodic', 'atmospheric', 'symphonic', 'progressive', 'depressive', 'industrial', 'epic', 'ambient', 'pagan', 'folk', 'post-black metal'],
  death: ['melodic', 'technical', 'brutal', 'progressive', 'symphonic', 'industrial', 'blackened', 'slam', 'deathcore', 'grindcore'],
  doom: ['funeral', 'melodic', 'atmospheric', 'epic', 'psychedelic', 'sludge metal', 'stoner metal', 'gothic metal', 'drone metal'],
  folk: ['celtic', 'pagan', 'viking', 'middle eastern', 'medieval', 'symphonic', 'blackened', 'atmospheric', 'epic'],
  industrial: ['electronic', 'symphonic', 'neue deutsche härte', 'metalcore'],
  power: ['melodic', 'symphonic', 'progressive', 'neoclassical', 'epic', 'symphonic metal'],
  prog: ['melodic', 'technical', 'avant-garde', 'extreme', 'experimental', 'djent', 'post-metal'],
  thrash: ['technical', 'melodic', 'industrial', 'crossover thrash', 'speed metal'],
};
const WHOLE = /(metal|core|grind|rock|härte|thrash)$/;
export const anchorText = (pack, style) => (!style ? GENRE[pack] : WHOLE.test(style) ? style : `${style} ${GENRE[pack]}`);

// The natural tempo of each anchor word, the centre of its range (bpm is a learned prior per
// style, and a tempo the genre never has is off-prior and costs quality). General knowledge, not measured; check by
// ear and move the number. The whole anchor text first, then the pack's word. Fast moves ±20 inside it, 5 bpm steps.
export const BPM = {
  'heavy metal': 130, 'black metal': 160, 'death metal': 160, 'doom metal': 70, 'folk metal': 130, 'industrial metal': 120,
  'power metal': 160, 'progressive metal': 130, 'thrash metal': 170,
  // styles that replace the word
  'speed metal': 180, 'glam metal': 130, 'groove metal': 110, 'hard rock': 120, 'nu metal': 100, 'post-black metal': 150,
  'deathcore': 130, 'grindcore': 200, 'sludge metal': 75, 'stoner metal': 110, 'gothic metal': 100, 'drone metal': 60,
  'neue deutsche härte': 120, 'metalcore': 150, 'symphonic metal': 140, 'djent': 120, 'post-metal': 100, 'crossover thrash': 180,
  // modifiers that move the tempo far from the pack's word
  'funeral doom metal': 50, 'brutal death metal': 180, 'depressive black metal': 110, 'ambient black metal': 100, 'atmospheric black metal': 140,
};
export const tempoOf = (pack, style) => BPM[anchorText(pack, style)] ?? BPM[GENRE[pack]];
export const bpmOf = (v, centre = 130) => Math.round((centre + 0.4 * (v - 50)) / 5) * 5;

// Instruments: one pad each on the player. Each phrase names a role in a song, never a bare
// instrument: bare names and many short prompts average into a sound check (finding 10, heard 2026-10-12). The
// pressed pads join the anchor sentence. Drums are never a pad; the production layer owns them (finding 6).
export const INSTRUMENTS = {
  rhythm: 'palm-muted distorted rhythm guitar riffs', lead: 'a harmonized lead guitar hook', bass: 'a driving bass line locked to the kick',
  kick: 'double kick drum patterns', clean: 'a soaring clean vocal melody', growl: 'growled harsh vocals', choir: 'a chanted choir refrain',
  keys: 'keyboard pads under the riffs', orchestra: 'orchestral string and brass swells', fiddle: 'a fiddle carrying the main melody',
  whistle: 'a tin whistle counter-melody', accordion: 'accordion chords', bagpipes: 'bagpipes carrying the melody',
  synth: 'pulsing industrial synth lines', piano: 'piano chords and runs',
};
export const MAX_INSTRUMENTS = 5; // pads at most; they count toward MAX_CLAUSES
// Ideas after "song with": pads plus fader clauses. v2 measured the dilution: the same
// signature words inside a full sentence lost half their spectral centroid. 5 keeps the sentence under 45 words.
export const MAX_CLAUSES = 5;
// A pack may reword a pad where the shared phrase is another genre's sound: palm-muted riffs are thrash and death;
// black metal is tremolo picking, doom is slow fuzz (v2's `phrases`: a niche word needs its sound described).
export const ANCHORS = {
  death: { pads: ['rhythm', 'lead', 'bass'] },
  black: { pads: ['rhythm', 'lead', 'bass'], words: { rhythm: 'tremolo-picked buzzing rhythm guitar riffs', lead: 'a cold, melancholic lead guitar melody' } },
  doom: { pads: ['rhythm', 'lead', 'bass'], words: { rhythm: 'slow, fuzzed-out crushing power chord riffs', lead: 'a mournful, wailing lead guitar melody' } },
  thrash: { pads: ['rhythm', 'lead', 'bass'] },
  folk: { mode: 'VOCALIZATION', pads: ['fiddle', 'whistle', 'rhythm', 'choir', 'bass'] },
  steel: { pads: ['rhythm', 'lead', 'bass'] },
  industrial: { pads: ['rhythm', 'synth', 'bass'] },
  power: { pads: ['rhythm', 'lead', 'keys', 'bass'] },
  prog: { pads: ['rhythm', 'lead', 'keys', 'bass'] },
};

// The production layer: one phrase per pack that holds PRODUCTION_SHARE of the total weight whatever else is sent,
// because Lyria normalizes weights and the layer dilutes as prompts are added (phase 0, findings 2 and 5). It owns
// the drums (finding 6) and the song shape (phase 2). About the mix, never the genre's sound: that is the sentence's.
// 0.2 since 2026-10-15, heard on v2 against 0.4 and 0: 0.4 made every hour sound the same. The
// 0.4 of phase 0 was heard against drum tag lists, never against the one-sentence form. `p=production:0.4` pins the
// share for the A/B by ear; 0 drops the layer. The mix words are guesses until heard.
const MIX = {
  steel: 'punchy classic heavy metal production', black: 'cold, reverberant, raw but clear mix', death: 'dense, tight, modern extreme metal mix',
  doom: 'warm, cavernous analog mix with a huge guitar tone', folk: 'live band feel with the acoustic instruments clear in the mix',
  industrial: 'cold, hard-hitting, wide mechanical mix', power: 'bright, polished, wide stereo mix', prog: 'clear, detailed, dynamic modern mix',
  thrash: 'dry, punchy 1980s thrash production',
};
export const PRODUCTION = Object.fromEntries(Object.entries(MIX).map(([pack, mix]) =>
  [pack, `studio recording, ${mix}, live drummer on a natural kit, full song with verse and chorus`]));
export const PRODUCTION_SHARE = 0.2;

// Faders steer the anchor from inside the sentence (2026-10-12: tags outside it were too weak). Each fader
// adds its low or high fragment when pushed past DEADBAND from 50; the strongest GROUP_WORDS pushes per group
// speak. riff fragments lead the sentence as adjectives on the genre word, lead fragments qualify the lead lines,
// layers are clauses that each name a part of the arrangement (a mood alone pulls out of the genre, finding 9).
export const FADERS = {
  aggression: { group: 'riff', low: 'restrained', high: 'aggressive' },
  speed: { group: 'riff', low: 'slow, crawling', high: 'fast, frantic' },
  heaviness: { group: 'riff', low: 'light, thin', high: 'heavy, down-tuned, crushing' },
  rawness: { group: 'riff', low: 'polished, tight', high: 'raw, lo-fi, primitive' },
  melody: { group: 'lead', low: 'atonal, riff-driven', high: 'melodic, harmonized' },
  darkness: { group: 'lead', low: 'bright, uplifting', high: 'dark, ominous' },
  serenity: { group: 'lead', low: 'harsh, dissonant', high: 'serene, reverb-washed' },
  technicality: { group: 'lead', low: 'simple, straightforward', high: 'technical, shredding, odd meters' },
  grandeur: { group: 'layers', low: 'a stripped-down arrangement', high: 'epic orchestral layers behind the band' },
  theatricality: { group: 'layers', low: 'a plain, no-frills arrangement', high: 'a dramatic symphonic choir' },
  consistency: { group: 'layers', low: 'a shifting, unpredictable song structure', high: 'a steady, hypnotic groove' },
  humanity: { group: 'layers', low: 'tight, machine-precise playing', high: 'a loose, organic live band feel' },
};
export const DEADBAND = 0.1; // |v - 50| / 50 below this is "don't care", the engine's rule
// Fragments per group: the strongest pushes, the rest is word salad. 3 → 2 on 2026-10-15: v2 measured that lead
// adjectives alone pulled a signature sound's centroid from about 2.7 kHz to 0.9–1.7 kHz.
export const GROUP_WORDS = 2;

// Config: bpm needs a context reset, so the page sends it on release only; the others blend
// live. guidance 4.0 is the API default, heard on v2 against 4.5 and 5.5; phase 0's 5.5 was heard
// against the garage-demo genre sets. `p=guidance:5.5` pins it back for the A/B.
const DEFAULTS = { guidance: 4.0, mode: 'QUALITY' };

const faderValue = (state, id) => { const f = state.faders[id]; return !f || f.bypass ? 50 : f.value; };
const round = x => Math.round(x * 100) / 100;

// The anchor: the Subgenre selector picks the pack (steel when bypassed), p.style one of the pack's styles.
// Nothing else moves it; the faders and the nearest band never do.
export function anchorOf(state, p = {}) {
  const sel = state.selectors?.subgenre;
  const pack = (!sel?.bypass && sel?.value) || 'steel';
  const style = STYLES[pack].includes(p.style) ? p.style : '';
  const pads = p.inst ?? ANCHORS[pack].pads;
  return { pack, style, pads, text: anchorText(pack, style) };
}

// p= from the hash: `style:melodic,inst:fiddle+choir,mode:VOCALIZATION,guidance:4,seed:7`. Spaces travel as `+`. Junk is ignored.
// The numeric keys pin a config field or the production share for an A/B by ear.
export function parseP(text) {
  const p = {};
  for (const kv of (text || '').split(',')) {
    const [k, v] = kv.split(':');
    if (k === 'style' && v) p.style = v.replace(/\+/g, ' ');
    else if (k === 'inst' && v !== undefined) p.inst = v.split('+').filter(id => INSTRUMENTS[id]).slice(0, MAX_INSTRUMENTS);
    else if (k === 'mode' && ['QUALITY', 'DIVERSITY', 'VOCALIZATION'].includes(v)) p.mode = v;
    else if (['guidance', 'seed', 'bpm', 'temperature', 'density', 'brightness', 'production', 'master'].includes(k) && Number.isFinite(+v) && v !== '') p[k] = +v; // master: player.js reads it (0 bypasses the chain)
  }
  return p;
}
export const formatP = p => Object.entries(p).map(([k, v]) => `${k}:${k === 'style' ? v.replace(/ /g, '+') : k === 'inst' ? v.join('+') : v}`).join(',');

// The two objects the model sees: one anchor sentence at 1.0 with the fader steering inside it, then the pack's
// production phrase at its share.
export function steer(state, p = {}) {
  const { pack, style, pads, text } = anchorOf(state, p);
  const groups = { riff: [], lead: [], layers: [] };
  for (const [id, f] of Object.entries(FADERS)) {
    const ctl = state.faders[id];
    if (!ctl || ctl.bypass) continue; // bypass drops the fader's words
    const w = Math.abs(ctl.value - 50) / 50;
    if (w < DEADBAND) continue;
    groups[f.group].push({ w, words: ctl.value > 50 ? f.high : f.low });
  }
  const top = g => groups[g].sort((a, b) => b.w - a.w).slice(0, GROUP_WORDS);
  const say = g => top(g).map(t => t.words).join(', ');
  // After "song with": the pads first (the listener pressed them), then the strongest fader clauses, MAX_CLAUSES in
  // all. The lead lines are one clause, as strong as the strongest lead push.
  const lead = groups.lead.length ? [{ w: Math.max(...groups.lead.map(t => t.w)), words: `with ${say('lead')} lead lines`, lead: true }] : [];
  const picked = [...lead, ...top('layers')].sort((a, b) => b.w - a.w).slice(0, Math.max(0, MAX_CLAUSES - pads.length));
  const words = ANCHORS[pack].words ?? {};
  const sentence = [
    `${say('riff')} ${text} song`.trim(),
    pads.length ? `with ${pads.map(id => words[id] ?? INSTRUMENTS[id]).join(', ')}` : '',
    ...picked.filter(t => t.lead).map(t => t.words),
    ...picked.filter(t => !t.lead).map(t => t.words),
  ].filter(Boolean).join(', ').replace('song, with', 'song with');
  const share = p.production ?? PRODUCTION_SHARE;
  const prompts = [
    { text: sentence, weight: 1.0 },
    ...(share > 0 ? [{ text: PRODUCTION[pack], weight: round(share / (1 - share)) }] : []),
  ];

  // density, brightness and temperature are learned priors per style: a field goes out only when
  // its fader left the deadband, otherwise the genre's own prior decides. Temperature sits on the API default 1.1:
  // Consistent at 100 is 0.7 (locked), at 0 is 1.4 (restless). Phase 0 liked 0.7 against the garage demos; that is
  // one `p=temperature:0.7` away for the A/B.
  const at = id => faderValue(state, id);
  const asked = id => Math.abs(at(id) - 50) / 50 >= DEADBAND;
  const c = at('consistency');
  const config = {
    bpm: p.bpm ?? bpmOf(at('speed'), tempoOf(pack, style)),
    ...(asked('darkness') && { brightness: round(1 - at('darkness') / 100) }),
    ...(asked('technicality') && { density: round(at('technicality') / 100) }),
    ...(asked('consistency') && { temperature: round(c >= 50 ? 1.1 - 0.4 * (c - 50) / 50 : 1.1 + 0.3 * (50 - c) / 50) }),
    ...(p.brightness !== undefined && { brightness: p.brightness }),
    ...(p.density !== undefined && { density: p.density }),
    ...(p.temperature !== undefined && { temperature: p.temperature }),
    guidance: p.guidance ?? DEFAULTS.guidance,
    musicGenerationMode: p.mode || ANCHORS[pack].mode || DEFAULTS.mode,
  };
  if (p.seed !== undefined) config.seed = p.seed;
  // cut: what needs a new deck when it changes, the genre and the instruments (pult.js, commit)
  return { prompts, config, pack, style, anchor: text, cut: [text, ...pads].join('|') };
}

// Order-free identity of a prompt list, to match a chunk's sourceMetadata echo against the last send.
export const promptKey = prompts => prompts.map(p => `${p.text}:${round(p.weight)}`).sort().join('|');

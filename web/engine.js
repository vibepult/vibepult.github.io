// Query engine: DOM-free so node --test can import it. Filter by switches and selectors, then weighted
// Euclidean distance over active faders and knobs in percentile space (poc-24h.md, Engine).

export const ALTERNATIVES = 2; // Next shows up to two more bands (D17)

const ADJECTIVE = {
  aggression: 'more aggressive', serenity: 'more serene', darkness: 'darker', rawness: 'rawer',
  speed: 'faster', heaviness: 'heavier', grandeur: 'grander', melody: 'more melodic',
  technicality: 'more technical', consistency: 'more consistent', humanity: 'more human',
  theatricality: 'more theatrical',
};

// Initial desk (D6): faders at 50 unless publish marked them bypassed; every filter bypassed.
export function initialState(data) {
  const s = { faders: {}, knobs: {}, switches: {}, selectors: {}, lyrics: [], recent: [], underground: { value: 0 } };
  for (const f of data.faders) s.faders[f.id] = { value: 50, bypass: f.status !== 'live' };
  for (const k of data.knobs) s.knobs[k.id] = { value: (k.min + k.max) / 2, bypass: true };
  for (const w of data.switches) s.switches[w.id] = { on: true, bypass: true };
  for (const sel of data.selectors) s.selectors[sel.id] = { value: null, bypass: true };
  return s;
}

function activeFilters(data, state) {
  const out = [];
  for (const [id, w] of Object.entries(state.switches)) if (!w.bypass) out.push({ kind: 'switches', id, value: w.on });
  for (const [id, sel] of Object.entries(state.selectors)) if (!sel.bypass && sel.value !== null) out.push({ kind: 'selectors', id, value: sel.value });
  if (state.lyrics?.length) out.push({ kind: 'lyrics', id: 'lyrics', value: state.lyrics }); // pressed axes, a union
  if (state.underground?.value > 0) out.push({ kind: 'underground', id: 'underground', value: fansCeiling(data, state.underground.value) });
  return out;
}

// The master fader (Underground, 2026-10-07): a ceiling on Deezer fans. At 0 every band passes; at m the
// biggest m percent of the pool is cut, so 100 leaves the smallest band. Faders then pick the nearest among
// what is left: fame never enters the distance, it only narrows the pool like a switch does.
export const UNDERGROUND = { id: 'underground', label: 'Underground' };
export function fansCeiling(data, m) {
  data.fansSorted ||= data.bands.map(b => b.fans).sort((a, b) => a - b);
  const n = data.fansSorted.length;
  return data.fansSorted[Math.max(0, Math.floor((1 - m / 100) * (n - 1)))];
}
export function undergroundText(data, m) {
  return m > 0 ? `bands under ${formatFans(fansCeiling(data, m))} fans` : 'every band, big or small';
}

const passes = (band, filters) => filters.every(f => (
  f.kind === 'lyrics' ? band.lyrics.some(a => f.value.includes(a))
    : f.kind === 'underground' ? band.fans <= f.value
      : band[f.kind][f.id] === f.value));

export function filterBands(data, state) {
  const filters = activeFilters(data, state);
  return data.bands.filter(b => passes(b, filters));
}

// 50 means "don't care": a fader's pull grows with its distance from the middle, so the faders you push
// steer and the idle ones barely count. At 50 the weight is NEUTRAL_PULL; at 0 or 100 it is 1 + NEUTRAL_PULL.
export const NEUTRAL_PULL = 0.1;
export const faderWeight = value => NEUTRAL_PULL + Math.abs(value - 50) / 50;

// Recency: the fader you touched last pulls hardest, the two before it less, so a drag re-sorts the pool
// along the fader under your finger instead of along the nine you set earlier. Measured on the 671 pool:
// a full sweep of one fader reaches 8 bands at x1 and 12 at x3 from the opening desk, 5 and 8 with four
// faders pushed. The order is part of the desk (it is in the share link), so a shared desk answers the same.
export const RECENCY_PULL = [3, 2, 1.5];
export function touch(state, id) {
  state.recent = [id, ...(state.recent || []).filter(x => x !== id)].slice(0, RECENCY_PULL.length);
}
export function untouch(state, id) {
  state.recent = (state.recent || []).filter(x => x !== id);
}
export function recencyPull(state, id) {
  const rank = (state.recent || []).indexOf(id);
  return rank < 0 ? 1 : RECENCY_PULL[rank];
}

// Squared distance contributions are in percentile points; knobs scale their real unit to 0..100 and,
// being engaged on purpose, always pull with weight 1.
export function distance(data, state, band) {
  let sum = 0;
  for (const [id, f] of Object.entries(state.faders)) {
    if (f.bypass || band.faders[id] === undefined) continue;
    sum += faderWeight(f.value) * recencyPull(state, id) * (f.value - band.faders[id]) ** 2;
  }
  for (const k of data.knobs) {
    const st = state.knobs[k.id];
    if (st.bypass) continue;
    sum += (100 * (st.value - band.knobs[k.id]) / (k.max - k.min)) ** 2;
  }
  return Math.sqrt(sum);
}

export function activeCount(state) {
  return [...Object.values(state.faders), ...Object.values(state.knobs)].filter(c => !c.bypass).length;
}

// Ranked result. empty: no band survives the filters, relax names the filter(s) whose removal alone helps.
export function query(data, state) {
  const pool = filterBands(data, state);
  if (!pool.length) {
    const filters = activeFilters(data, state);
    const relax = filters.filter(f => data.bands.some(b => passes(b, filters.filter(g => g !== f))));
    return { ranked: [], empty: true, relax: (relax.length ? relax : filters).map(f => f.id), noControls: false };
  }
  const ranked = pool
    .map(b => ({ band: b, d: distance(data, state, b) }))
    .sort((a, b) => a.d - b.d || (a.band.slug < b.band.slug ? -1 : 1))
    .map(x => x.band);
  return { ranked, empty: false, relax: [], noControls: activeCount(state) === 0 };
}

// Selector options that would empty the pool under the other active filters are greyed before picking.
export function deadOptions(data, state, selectorId) {
  const sel = data.selectors.find(s => s.id === selectorId);
  const others = activeFilters(data, state).filter(f => !(f.kind === 'selectors' && f.id === selectorId));
  return sel.options.filter(opt => !data.bands.some(b => passes(b, others) && b.selectors[selectorId] === opt));
}

// Lyric axes no band carries under the other filters. Pressing a second axis only widens the union, so the
// pressed ones never make another dead.
export function deadLyrics(data, state) {
  const others = activeFilters(data, state).filter(f => f.kind !== 'lyrics');
  return data.lyrics.options.map(o => o.id).filter(id => !data.bands.some(b => passes(b, others) && b.lyrics.includes(id)));
}

// Next is a peek (D17): cycle nearest -> second -> third -> nearest. Returns the view index after a press.
export function candidates(ranked) {
  return ranked.slice(0, 1 + ALTERNATIVES);
}

export function nextIndex(ranked, index) {
  const n = candidates(ranked).length;
  return n < 2 ? 0 : (index + 1) % n;
}

export function nextLabel(ranked, index) {
  const c = candidates(ranked);
  return c.length < 2 ? null : `Next: ${c[nextIndex(ranked, index)].name}`;
}

// Slider keys (D13): arrows 1, PageUp/PageDown 10, Shift doubles, Home/End extremes.
export function applyKey(value, key, shift, min = 0, max = 100, unit = 1) {
  const step = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }[key];
  let next;
  if (key === 'Home') next = min;
  else if (key === 'End') next = max;
  else if (step !== undefined) next = value + step * unit * (shift ? 2 : 1);
  else return null;
  return Math.min(max, Math.max(min, next));
}

// Readout and aria-valuetext share one sentence (D15).
export function faderText(fader, value) {
  return `${ADJECTIVE[fader.id] || fader.id} than ${Math.round(value)} percent of the pool`;
}

export function knobText(knob, value) {
  if (knob.id === 'era') return `formed ${Math.round(value)}`;
  if (knob.id === 'prolific') return value > 0 ? `1 album each ${(1 / value).toFixed(1)} years` : 'no albums';
  return `${value.toFixed(2)} ${knob.unit}`;
}

export function formatFans(n) {
  if (n >= 999500) return `${+(n / 1e6).toFixed(1)}M`; // what would round to 1000k reads as 1M
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return `${Math.round(n)}`;
}

// Share link: the whole desk as base64url, bit-packed and sparse. Header: the control count in 6 bits, so a
// link from a different desk layout is rejected. Then one bit per control in bands.json order (faders, knobs,
// switches, selectors, lyrics, underground): 1 = engaged. Then a value per engaged control: fader 7 bits (0..100), knob 8 bits
// across its range, switch 1 bit, selector enough bits for its option index, underground 7 bits. Then the recency list: 2 bits
// for its length, then each fader's index. A bypassed control costs its mask bit only, so the opening desk
// with twelve faders is 19 characters where the hex it replaced was 42.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const bitsFor = n => Math.max(1, Math.ceil(Math.log2(n)));
const selectorsOf = data => data.selectors;
const controlCount = data => data.faders.length + data.knobs.length + data.switches.length + selectorsOf(data).length + 2; // + lyrics + underground

export function encodeState(data, state) {
  const bits = [];
  const push = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  push(controlCount(data), 6);
  const engaged = [
    ...data.faders.map(f => !state.faders[f.id].bypass),
    ...data.knobs.map(k => !state.knobs[k.id].bypass),
    ...data.switches.map(w => !state.switches[w.id].bypass),
    ...selectorsOf(data).map(s => !state.selectors[s.id].bypass && s.options.includes(state.selectors[s.id].value)),
    (state.lyrics || []).some(id => data.lyrics.options.some(o => o.id === id)),
    (state.underground?.value || 0) > 0,
  ];
  for (const e of engaged) push(e ? 1 : 0, 1);
  let i = 0;
  for (const f of data.faders) if (engaged[i++]) push(Math.round(state.faders[f.id].value), 7);
  for (const k of data.knobs) if (engaged[i++]) push(Math.round(255 * (state.knobs[k.id].value - k.min) / (k.max - k.min)), 8);
  for (const w of data.switches) if (engaged[i++]) push(state.switches[w.id].on ? 1 : 0, 1);
  for (const s of selectorsOf(data)) if (engaged[i++]) push(s.options.indexOf(state.selectors[s.id].value), bitsFor(s.options.length));
  if (engaged[i++]) for (const o of data.lyrics.options) push(state.lyrics.includes(o.id) ? 1 : 0, 1); // one bit per axis
  if (engaged[i++]) push(Math.round(state.underground.value), 7);
  const recent = (state.recent || []).filter(id => data.faders.some(f => f.id === id) && !state.faders[id].bypass);
  push(recent.length, 2);
  for (const id of recent) push(data.faders.findIndex(f => f.id === id), bitsFor(data.faders.length));
  while (bits.length % 6) bits.push(0);
  let out = '';
  for (let j = 0; j < bits.length; j += 6) out += B64[bits.slice(j, j + 6).reduce((a, b) => 2 * a + b, 0)];
  return out;
}

// Untrusted input (anyone can paste a link): anything malformed, out of range or with trailing junk returns null.
export function decodeState(data, text) {
  if (typeof text !== 'string' || !text.length || [...text].some(c => !B64.includes(c))) return null;
  const bits = [];
  for (const c of text) for (let i = 5; i >= 0; i--) bits.push((B64.indexOf(c) >> i) & 1);
  let pos = 0;
  const read = n => { if (pos + n > bits.length) throw new RangeError(); let v = 0; for (let i = 0; i < n; i++) v = 2 * v + bits[pos++]; return v; };
  try {
    if (read(6) !== controlCount(data)) return null;
    const engaged = Array.from({ length: controlCount(data) }, () => read(1) === 1);
    const s = initialState(data);
    let i = 0;
    for (const f of data.faders) {
      s.faders[f.id] = { value: 50, bypass: true };
      if (!engaged[i++]) continue;
      const v = read(7);
      if (v > 100) return null;
      s.faders[f.id] = { value: v, bypass: false };
    }
    for (const k of data.knobs) {
      if (!engaged[i++]) continue;
      let v = k.min + (read(8) / 255) * (k.max - k.min);
      if (k.step) v = Math.round(v / k.step) * k.step;
      s.knobs[k.id] = { value: v, bypass: false };
    }
    for (const w of data.switches) if (engaged[i++]) s.switches[w.id] = { on: read(1) === 1, bypass: false };
    for (const sel of selectorsOf(data)) {
      if (!engaged[i++]) continue;
      const idx = read(bitsFor(sel.options.length));
      if (idx >= sel.options.length) return null;
      s.selectors[sel.id] = { value: sel.options[idx], bypass: false };
    }
    if (engaged[i++]) {
      s.lyrics = data.lyrics.options.filter(() => read(1) === 1).map(o => o.id);
      if (!s.lyrics.length) return null; // engaged with nothing pressed is not a desk the encoder makes
    }
    if (engaged[i++]) {
      const v = read(7);
      if (v < 1 || v > 100) return null;
      s.underground = { value: v };
    }
    const n = read(2);
    for (let j = 0; j < n; j++) {
      const idx = read(bitsFor(data.faders.length));
      const f = data.faders[idx];
      if (!f || s.faders[f.id].bypass || s.recent.includes(f.id)) return null;
      s.recent.push(f.id);
    }
    if (bits.length - pos >= 6 || bits.slice(pos).some(b => b)) return null; // exactly the padding, nothing else
    return s;
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
}

// After a filter change picks a new band, the faders move to where that band sits, so the desk describes
// the answer. Bypassed faders move too (their caps match their LEDs) but stay bypassed.
export function snapTo(state, band) {
  const s = structuredClone(state);
  for (const [id, f] of Object.entries(s.faders)) {
    if (band.faders[id] !== undefined) f.value = Math.round(band.faders[id]);
  }
  return s;
}

// Search (2026-10-09): a name typed into the desk. Exact beats prefix beats substring, case-insensitive,
// pool order within a tier. Each match carries where the typed text sits in the name, for highlighting.
export function matchBands(data, text, limit = 8) {
  const t = text.trim().toLowerCase();
  if (!t) return [];
  const tiers = [[], [], []];
  for (const band of data.bands) {
    const at = band.name.toLowerCase().indexOf(t);
    if (at >= 0) tiers[at > 0 ? 2 : band.name.length === t.length ? 0 : 1].push({ band, at, len: t.length });
  }
  return tiers.flat().slice(0, limit);
}
export const findBand = (data, text) => matchBands(data, text, 1)[0]?.band ?? null;

// Recall: the desk describes the searched band. Faders and levers move to where it sits (bypassed ones too, they
// stay bypassed) and every filter that would hide it goes to Any; filters it passes are kept. With every fader
// and lever OFF the faders engage, or the desk would answer nothing. snapTo rounds, so the band's distance is a
// residue under half a point per fader: first in practice, and the share link stores integers anyway.
export function recallBand(data, state, band) {
  const s = snapTo(state, band);
  for (const k of data.knobs) if (band.knobs[k.id] !== undefined) s.knobs[k.id].value = band.knobs[k.id];
  for (const [id, w] of Object.entries(s.switches)) if (w.on !== band.switches[id]) w.bypass = true;
  for (const [id, sel] of Object.entries(s.selectors)) if (sel.value !== band.selectors[id]) Object.assign(sel, { value: null, bypass: true });
  if (!s.lyrics.some(a => band.lyrics.includes(a))) s.lyrics = [];
  if (s.underground.value > 0 && band.fans > fansCeiling(data, s.underground.value)) s.underground.value = 0;
  if (activeCount(s) === 0) for (const [id, f] of Object.entries(s.faders)) if (band.faders[id] !== undefined) f.bypass = false;
  return s;
}

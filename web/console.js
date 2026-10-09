// The desk. All decisions live in engine.js; this file wires DOM, pointer, keyboard and the embed.
import {
  applyKey, candidates, deadOptions, decodeState, encodeState, faderText, filterBands, findBand, formatFans,
  fansCeiling, initialState, knobText, matchBands, recallBand, UNDERGROUND, undergroundText,
  deadLyrics, nextIndex, nextLabel, query, snapTo, touch, untouch,
} from './engine.js';
import { skin, SLOTS } from './skins.js';

const $ = id => document.getElementById(id);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  n.append(...kids);
  return n;
};
const SEGMENTS = 16; // meter LEDs per strip
const CAP = 36; // fader cap height, matches --cap-h in style.css
const LEVER_CAP = 28; // lever cap width / master cap height, matches --lever-cap
const CHEVRON = { '-1': 'M15 6l-6 6 6 6', '1': 'M9 6l6 6-6 6' };
const READOUT_HIDE_MS = 600;
const EMBED_TIMEOUT_MS = 5000;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = c => regions.of(c) || c;

let data, state, openReadout, view = 0, touched = false, lastNearest = null, lastCommitted = null, liveBand = null, manifest = {};
const ui = { faders: {}, knobs: {}, selectors: {}, lyrics: {} };

// ---------------------------------------------------------------------------------------------- load

async function load() {
  try {
    if (location.protocol === 'file:') throw new LoadError('opened from file://, where the browser blocks loading bands.json', 'serve');
    const res = await fetch('bands.json', { cache: 'no-store' });
    if (res.status === 404) throw new LoadError('bands.json is missing because publish has not run', 'publish');
    if (!res.ok) throw new LoadError(`bands.json returned HTTP ${res.status}`, 'serve');
    data = await res.json();
    manifest = await fetch('skins/manifest.json').then(m => (m.ok ? m.json() : {})).catch(() => ({})); // bitmap slot overrides, optional
  } catch (e) {
    return showLoadError(e instanceof LoadError ? e : new LoadError(`bands.json could not be read (${e.message})`, 'publish'));
  }
  const shared = decodeState(data, new URLSearchParams(location.hash.slice(1)).get('s'));
  state = shared || initialState(data);
  build();
  $('console').setAttribute('aria-busy', 'false');
  $('hint').hidden = Boolean(shared); // a shared setup is already an answer, not a blank desk
  touched = Boolean(shared);
  render();
  const q = query(data, state);
  if (!q.empty && !q.noControls) { // a shared link can filter the pool empty, or bypass every control
    lastNearest = q.ranked[0].slug;
    commitBand(q.ranked[0], { announce: false });
  }
  addEventListener('hashchange', () => location.reload()); // a pasted share link in an open tab
}

class LoadError extends Error {
  constructor(message, fix) { super(message); this.fix = fix; }
}

function showLoadError(e) {
  $('console').setAttribute('aria-busy', 'false');
  for (const n of document.querySelectorAll('.row--bottom, .left-body, .selects, .search')) n.hidden = true;
  $('band-name').textContent = 'The desk is offline';
  const msg = $('message');
  msg.hidden = false;
  msg.replaceChildren(
    el('p', { text: `Cause: ${e.message}.` }),
    el('p', { text: e.fix === 'serve' ? 'Serve the page over http:' : 'Publish the pool, then reload:' }),
    el('code', { text: e.fix === 'serve' ? 'python web/serve.py' : 'python -m ingest publish && python -m ingest check' }),
    el('p', { text: 'then open http://localhost:8000' }),
  );
  $('embed-slot').hidden = true;
}

// --------------------------------------------------------------------------------------------- build

// The ON/OFF button on every fader and lever: ON while the control is engaged, OFF while bypassed.
function bypassButton(name, ctl, wrap, { filter = false, onToggle } = {}) {
  const b = el('button', { class: 'onoff', type: 'button', 'aria-label': `Use ${name}` });
  b.addEventListener('click', () => {
    ctl.bypass = !ctl.bypass;
    onToggle?.();
    syncBypass(b, ctl, wrap);
    interacted();
    if (filter) snapToAnswer();
    render();
    commitNearest();
  });
  syncBypass(b, ctl, wrap);
  return b;
}

function syncBypass(button, ctl, wrap) {
  button.setAttribute('aria-pressed', String(!ctl.bypass));
  button.textContent = ctl.bypass ? 'OFF' : 'ON';
  wrap.classList.toggle('is-off', ctl.bypass);
}

function build() {
  data.faders.forEach((f, i) => buildStrip(f, i + 1));
  data.knobs.forEach(buildKnob);
  data.selectors.forEach(buildSelector);
  data.switches.forEach(buildSwitch);
  buildLyrics(data.lyrics);
  buildMaster();
  buildSearch();
  $('next').addEventListener('click', () => { // Next walks: faders glide to the alternative, which becomes the answer
    const { ranked } = query(data, state);
    glideTo(candidates(ranked)[nextIndex(ranked, view)]);
    render();
    commitNearest();
  });
}

function buildStrip(f, n) {
  const ctl = state.faders[f.id];
  const strip = el('div', { class: 'strip', 'data-id': f.id });
  const onoff = bypassButton(f.label, ctl, strip, { onToggle: () => { if (ctl.bypass) untouch(state, f.id); } });
  const head = el('div', { class: 'strip__head' }, el('span', { class: 'strip__num', text: `CH${n}` }), onoff);
  const cap = el('div', {
    class: 'cap', role: 'slider', tabindex: '0', 'aria-labelledby': `lbl-${f.id}`,
    'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-orientation': 'vertical',
  });
  const rail = el('div', { class: 'rail' }, cap);
  // Reference ticks: the band nearest each quintile, names on hover (design-doc "Display and feedback").
  const ticks = el('div', { class: 'ticks' }, ...f.ticks.map(t => {
    const s = el('span', { class: 'tick', title: t.name, text: t.short });
    s.style.setProperty('--v', t.value);
    return s;
  }));
  const meter = el('div', { class: 'meter', 'aria-hidden': 'true' }, ...Array.from({ length: SEGMENTS }, () => el('i')));
  const readout = el('div', { class: 'readout', hidden: '' });
  const value = el('span', { class: 'lcd' });
  const scribble = el('div', { class: 'scribble' }, value, el('span', { class: 'scribble__name', id: `lbl-${f.id}`, text: f.label }));
  strip.append(scribble, el('div', { class: 'strip__fader' }, meter, el('div', { class: 'fader' }, ticks, rail)), head, readout); // name and value on top, ON/OFF below
  document.querySelector(`.strips[data-group="${f.group}"] .strips__inner`).append(strip);

  const setValue = v => { ctl.value = Math.round(Math.min(100, Math.max(0, v))); };
  const fromPointer = e => {
    const r = rail.getBoundingClientRect();
    setValue(100 * (r.bottom - CAP / 2 - e.clientY) / (r.height - CAP));
  };
  const text = () => faderText(f, ctl.value);
  ui.faders[f.id] = { strip, cap, meter, ctl, text, engage: onoff, value };
  wireSlider({ surface: rail, focus: cap, ctl, readout, text, fromPointer, setValue, min: 0, max: 100, unit: 1,
               onTouch: () => touch(state, f.id) }); // the last three faders touched pull hardest (recency)
}

// Knobs are horizontal levers (2026-10-07): a cap on a rail with a notch per detent, absolute like a fader.
function buildKnob(k) {
  const ctl = state.knobs[k.id];
  const wrap = el('div', { class: 'lever' });
  const engage = bypassButton(k.label, ctl, wrap);
  ui.knobs[k.id] = buildLever(k, ctl, wrap, engage, () => knobText(k, ctl.value),
    () => (k.step ? String(Math.round(ctl.value)) : ctl.value.toFixed(2)));
  document.querySelector('.levers').append(wrap);
}

// The master fader: Underground, a ceiling on fan count, vertical in the left panel. No bypass: 0 is off.
function buildMaster() {
  const ctl = state.underground;
  const k = { ...UNDERGROUND, min: 0, max: 100, step: 1, detents: [25, 50, 75] };
  const wrap = el('div', { class: 'lever lever--vertical' });
  ui.knobs[k.id] = buildLever(k, ctl, wrap, null, () => undergroundText(data, ctl.value),
    () => (ctl.value > 0 ? `<${formatFans(fansCeiling(data, ctl.value))}` : 'all'), true);
  $('master').append(wrap);
}

function buildLever(k, ctl, wrap, engage, text, valueText, vertical = false) {
  const cap = el('div', {
    class: 'lever__cap', role: 'slider', tabindex: '0', 'aria-label': k.label,
    'aria-orientation': vertical ? 'vertical' : 'horizontal',
    'aria-valuemin': String(k.min), 'aria-valuemax': String(k.max),
  });
  const pct = v => 100 * (v - k.min) / (k.max - k.min);
  const track = el('div', { class: 'lever__track' }, ...(k.detents || []).map(d => {
    const n = el('i', { class: 'detent' });
    n.style.setProperty('--v', pct(d));
    return n;
  }), cap);
  const value = el('span', { class: 'lcd lever__val' });
  const readout = el('div', { class: 'readout', hidden: '' });
  wrap.append(el('div', { class: 'lever__head' }, ...(engage ? [engage] : []), el('span', { class: 'lever__name', text: k.label }), value), track, readout);

  const range = k.max - k.min;
  const unit = k.step || range / 100;
  const setValue = v => { ctl.value = Math.min(k.max, Math.max(k.min, k.step ? Math.round(v / k.step) * k.step : v)); };
  const fromPointer = e => {
    const r = track.getBoundingClientRect();
    const t = vertical ? (r.bottom - LEVER_CAP / 2 - e.clientY) / (r.height - LEVER_CAP)
      : (e.clientX - r.left - LEVER_CAP / 2) / (r.width - LEVER_CAP);
    setValue(k.min + range * t);
  };
  wireSlider({ surface: track, focus: cap, ctl, readout, text, fromPointer, setValue, min: k.min, max: k.max, unit });
  track.addEventListener('wheel', e => {
    if (!e.deltaY) return; // horizontal trackpad swipe: not a turn, and the page may scroll
    e.preventDefault();
    setValue(ctl.value - Math.sign(e.deltaY) * unit);
    ctl.bypass = false;
    interacted();
    render();
    clearTimeout(track.wheelTimer);
    track.wheelTimer = setTimeout(commitNearest, 300);
  }, { passive: false });
  return { cap, value, ctl, text, valueText, wrap, engage, pct };
}

// A switch is a stepped selector with three positions: Any (bypassed), Yes, No.
function buildSwitch(w) {
  const ctl = state.switches[w.id];
  buildStepped(w.id, w.label, [{ v: '', t: 'Any' }, { v: 'yes', t: 'Yes' }, { v: 'no', t: 'No' }],
    () => (ctl.bypass ? '' : ctl.on ? 'yes' : 'no'),
    v => { ctl.bypass = v === ''; if (v) ctl.on = v === 'yes'; });
}

function buildSelector(s) {
  const ctl = state.selectors[s.id];
  const label = s.id === 'country' ? countryName : v => data.packs[v]?.label_name || v;
  buildStepped(s.id, s.label, [{ v: '', t: 'Any' }, ...s.options.map(o => ({ v: o, t: label(o) }))],
    () => (ctl.bypass ? '' : ctl.value),
    v => { ctl.value = v || null; ctl.bypass = ctl.value === null; },
    () => deadOptions(data, state, s.id));
}

// Stepped selector (the mock's take on a dropdown): prev/next buttons around a native select styled as an LCD.
// Option 0 is Any, which is the bypass. Stepping skips options that would empty the pool.
function buildStepped(id, label, options, get, set, dead = () => []) {
  const wrap = el('div', { class: 'select' });
  const select = el('select', { id: `sel-${id}`, class: 'select__value lcd' },
    ...options.map(o => el('option', { value: o.v, text: o.t })));
  const pos = el('span', { class: 'select__pos' });
  const change = () => { set(select.value); interacted(); snapToAnswer(); render(); commitNearest(); };
  select.addEventListener('change', change);
  const step = dir => {
    let i = select.selectedIndex;
    do i = (i + dir + options.length) % options.length; while (select.options[i].disabled);
    select.selectedIndex = i;
    change();
  };
  const arrow = dir => {
    const b = el('button', { class: 'select__step', type: 'button', 'aria-label': `${dir < 0 ? 'Previous' : 'Next'} ${label}` });
    b.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="${CHEVRON[dir]}"/></svg>`;
    b.addEventListener('click', () => step(dir));
    return b;
  };
  wrap.append(el('div', { class: 'select__head' }, el('label', { class: 'select__name', for: `sel-${id}`, text: label }), pos),
    el('div', { class: 'select__box' }, arrow(-1), select, arrow(1)));
  document.querySelector('.selects').append(wrap);
  ui.selectors[id] = { select, pos, wrap, get, dead };
}

// Lyrics: the button bank. One pad per lyric axis from Metal Archives themes; pressed pads are a union filter,
// none pressed means any. No bypass button: an empty bank is the bypass.
function buildLyrics(l) {
  const grid = document.querySelector('.bank__grid');
  for (const o of l.options) {
    const b = el('button', { class: 'pad', type: 'button', 'aria-pressed': 'false', text: o.label });
    b.addEventListener('click', () => {
      state.lyrics = state.lyrics.includes(o.id) ? state.lyrics.filter(x => x !== o.id) : [...state.lyrics, o.id];
      interacted();
      snapToAnswer();
      render();
      commitNearest();
    });
    ui.lyrics[o.id] = b;
    grid.append(b);
  }
}

// Search (2026-10-09): a name typed in the brand row recalls that band. Matches drop out of the field as LCD
// lines (arrows move, Enter or a tap picks, Escape closes). The field empties once the output names the band,
// so it never shows a name the next drag makes stale. Enter on a miss dims the field until the next keystroke.
function buildSearch() {
  const input = $('search');
  const list = $('search-list');
  let matches = [], active = 0;
  const close = () => { matches = []; list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  const paint = () => {
    [...list.children].forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    input.setAttribute('aria-activedescendant', `search-opt-${active}`);
  };
  const suggest = () => {
    matches = matchBands(data, input.value);
    active = 0;
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(matches.length > 0));
    list.replaceChildren(...matches.map(({ band, at, len }, i) => {
      const li = el('li', { id: `search-opt-${i}`, role: 'option' },
        band.name.slice(0, at), el('b', { text: band.name.slice(at, at + len) }), band.name.slice(at + len));
      li.addEventListener('pointerdown', e => { e.preventDefault(); recall(band); }); // before the input blurs
      li.addEventListener('pointerenter', () => { active = i; paint(); });
      return li;
    }));
    paint();
  };
  const recall = band => {
    settle(recallBand(data, state, band));
    interacted();
    render();
    commitNearest();
    input.value = '';
    close();
    input.blur();
  };
  input.addEventListener('input', () => { input.removeAttribute('aria-invalid'); suggest(); });
  input.addEventListener('focus', suggest);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!matches.length) return;
      e.preventDefault();
      active = (active + (e.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length;
      paint();
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      const band = matches[active]?.band || findBand(data, input.value);
      if (band) return recall(band);
      if (input.value.trim()) { input.setAttribute('aria-invalid', 'true'); say(`No band called ${input.value.trim()}`); }
    }
  });
}

// One handler for faders and levers (D13): pointer drag, keys, readout, commit on release.
function wireSlider({ surface, focus, ctl, readout, text, fromPointer, setValue, min, max, unit, onTouch }) {
  let hideTimer;
  // The band name joins the line only once the move has changed the answer (the panel already shows it).
  readout.refresh = () => { readout.textContent = text() + (liveBand && liveBand.slug !== lastCommitted ? `, next: ${liveBand.name}` : ''); };
  const show = () => {
    clearTimeout(hideTimer);
    if (openReadout && openReadout !== readout) openReadout.hidden = true; // only the most recent one shows
    openReadout = readout;
    readout.hidden = false;
    readout.refresh();
  };
  const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => { readout.hidden = true; }, READOUT_HIDE_MS); };
  const engage = () => { ctl.bypass = false; onTouch?.(); interacted(); };

  surface.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.isPrimary) return;
    surface.setPointerCapture(e.pointerId);
    focus.focus({ preventScroll: true });
    engage();
    fromPointer(e);
    render();
    show();
    surface.dragging = true;
  });
  surface.addEventListener('pointermove', e => {
    if (!surface.dragging) return;
    fromPointer(e);
    scheduleRender();
    show();
  });
  const end = () => {
    if (!surface.dragging) return;
    surface.dragging = false;
    hideSoon();
    commitNearest();
  };
  surface.addEventListener('pointerup', end);
  surface.addEventListener('pointercancel', end);
  surface.addEventListener('lostpointercapture', end);
  surface.addEventListener('pointerenter', show);
  surface.addEventListener('pointerleave', () => { if (!surface.dragging && document.activeElement !== focus) hideSoon(); });
  focus.addEventListener('focus', show);
  focus.addEventListener('blur', hideSoon);
  let keyHeld = false;
  focus.addEventListener('keydown', e => {
    const v = applyKey(ctl.value, e.key, e.shiftKey, min, max, unit);
    if (v === null) return;
    e.preventDefault();
    keyHeld = true;
    setValue(v);
    engage();
    render();
    show();
  });
  focus.addEventListener('keyup', e => {
    if (!keyHeld || applyKey(0, e.key, false) === null) return; // a key pressed elsewhere and released here commits nothing
    keyHeld = false;
    commitNearest(); // key release commits (D5)
  });
}

// -------------------------------------------------------------------------------------------- render

let frame = 0;
function scheduleRender() {
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); });
}

// Live, every frame (D5): slider positions, meters, band name, subgenre. Never the embed or theme.
function render() {
  for (const { strip, cap, ctl, text, engage, value } of Object.values(ui.faders)) {
    syncBypass(engage, ctl, strip);
    strip.style.setProperty('--v', ctl.value);
    cap.setAttribute('aria-valuenow', String(ctl.value));
    cap.setAttribute('aria-valuetext', text());
    value.textContent = String(ctl.value);
  }
  for (const { cap, value, ctl, text, valueText, wrap, engage, pct } of Object.values(ui.knobs)) {
    if (engage) syncBypass(engage, ctl, wrap);
    wrap.style.setProperty('--v', pct(ctl.value));
    cap.setAttribute('aria-valuenow', String(+ctl.value.toFixed(2)));
    cap.setAttribute('aria-valuetext', text());
    value.textContent = valueText();
  }
  for (const { select, pos, wrap, get, dead } of Object.values(ui.selectors)) {
    select.value = get();
    const gone = new Set(dead());
    for (const o of select.options) {
      o.disabled = o.value !== '' && gone.has(o.value) && o.value !== select.value;
      o.title = o.disabled ? 'no band left' : '';
    }
    pos.textContent = `${select.selectedIndex + 1}/${select.options.length}`;
    wrap.classList.toggle('is-any', select.value === '');
  }
  const deadAxes = new Set(deadLyrics(data, state));
  for (const [id, b] of Object.entries(ui.lyrics)) {
    const pressed = state.lyrics.includes(id);
    b.setAttribute('aria-pressed', String(pressed));
    b.disabled = !pressed && deadAxes.has(id);
    b.title = b.disabled ? 'no band left' : '';
  }
  view = 0; // any control change resets the Next peek (D17)
  const total = data.bands.length;
  const passing = filterBands(data, state).length;
  $('pool-count').textContent = `${total} bands known` + (passing < total ? ` · ${passing} pass the filters` : '');
  const q = query(data, state);
  liveBand = !q.empty && !q.noControls ? q.ranked[0] : null;
  if (openReadout && !openReadout.hidden) openReadout.refresh();
  const msg = $('message');
  msg.hidden = !q.empty;
  if (!q.empty && !q.noControls) return renderBand(q.ranked[0], q.ranked);
  // No answer: either the filters leave no band, or every fader and knob is bypassed (distance is zero for all).
  const names = q.relax.map(id => [...data.switches, ...data.selectors, data.lyrics, UNDERGROUND].find(c => c.id === id).label);
  if (q.empty) msg.textContent = `No band matches. Relax ${names.join(' or ')}.`;
  $('band-name').textContent = q.empty ? 'No band matches' : 'Set at least one control.';
  $('subgenre').textContent = '';
  $('next').hidden = true;
  lightMeters(null);
  say(q.empty ? msg.textContent : 'Set at least one control.');
}

function renderBand(band, ranked) {
  $('band-name').textContent = band.name;
  $('subgenre').textContent = `${band.genre} · ${countryName(band.selectors.country)} · ${formatFans(band.fans)} fans`;
  const label = nextLabel(ranked, view);
  $('next').hidden = !label;
  $('next').textContent = label || '';
  lightMeters(band);
}

// Two brightnesses: dim up to the fader (the ask), bright up to where the answer band sits.
function lightMeters(band) {
  for (const [id, { meter, ctl }] of Object.entries(ui.faders)) {
    const lit = band && band.faders[id] !== undefined ? Math.round(band.faders[id] / 100 * SEGMENTS) : 0;
    const ask = ctl.bypass ? 0 : Math.round(ctl.value / 100 * SEGMENTS);
    [...meter.children].forEach((seg, i) => {
      seg.classList.toggle('on', i < lit);
      seg.classList.toggle('ask', i < ask);
    });
  }
}

// -------------------------------------------------------------------------------------------- commit

// A filter change that brings up a new band moves the faders to where that band sits (caps glide 150 ms).
function snapToAnswer() {
  const q = query(data, state);
  if (q.empty || q.noControls || q.ranked[0].slug === lastNearest) return;
  glideTo(q.ranked[0]);
}

function glideTo(band) {
  settle(snapTo(state, band));
}

// Adopt a state the engine computed. The ui closures hold the control objects, so each is updated in place.
function settle(next) {
  for (const group of ['faders', 'knobs', 'switches', 'selectors']) {
    for (const [id, ctl] of Object.entries(next[group])) Object.assign(state[group][id], ctl);
  }
  state.lyrics = next.lyrics;
  state.underground.value = next.underground.value;
  const root = document.documentElement;
  root.classList.add('settling');
  setTimeout(() => root.classList.remove('settling'), 200);
}

function commitNearest() {
  history.replaceState(null, '', `#s=${encodeState(data, state)}`); // share link for this setup
  const q = query(data, state);
  if (q.empty || q.noControls) return;
  lastNearest = q.ranked[0].slug;
  commitBand(q.ranked[0]);
}

// Committed on release (D5): embed swap, theme cross-fade, announcement. Only when the band changed.
function commitBand(band, { announce = true } = {}) {
  if (!band.slug || band.slug === lastCommitted) return;
  lastCommitted = band.slug;
  const apply = () => { applyPack(band.pack, band.slug, band.pack2); swapEmbed(band); };
  if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(apply);
  else apply();
  if (announce) say(`${band.name}, ${band.genre}`);
}

// The Ko-fi button speaks the pack's dialect.
const TIPS = {
  steel:      'Buy the crew a coffee',
  black:      'Buy me a black coffee',
  death:      'Buy me a bloody mary mix',
  doom:       'Buy me a slow brew',
  folk:       'Buy me a horn of mead',
  industrial: 'Buy me a can of oil',
  power:      'Buy me a mighty beverage',
  prog:       'Buy me a 7/8 espresso',
  thrash:     'Buy me a gas station coffee',
};

function applyPack(name, slug, trim) {
  const p = data.packs[name] || data.packs.steel;
  $('donate-btn').textContent = TIPS[name] || TIPS.steel;
  const root = document.documentElement;
  const assets = skin(name, slug, p, manifest, trim); // procedural asset set (docs/designs/skins.md), null for a palette-only pack
  for (const slot of SLOTS) {
    if (assets) root.style.setProperty(`--${slot}`, `url("${assets[slot]}")`);
    else root.style.removeProperty(`--${slot}`);
  }
  renderLights(assets?.lights || []);
  for (const slot of ['panel', 'panel_inset', 'cap', 'led_on', 'led_off', 'label', 'accent']) {
    root.style.setProperty(`--${slot.replace('_', '-')}`, p[slot]);
  }
  root.style.setProperty('--font-display', p.font_display);
  root.dataset.cap = p.cap_shape;
  root.dataset.led = p.led_shape;
  root.dataset.pack = name;
}

// The animated light layer behind the desk: one blurred disc per light the scene reported, in scene coordinates
// that fitDesk maps onto the viewport the same way background-size: cover maps the scene.
function renderLights(lights) {
  let box = $('lights');
  if (!box) box = document.body.insertBefore(el('div', { id: 'lights', 'aria-hidden': 'true' }), $('console'));
  box.replaceChildren(...lights.map(l => {
    const n = el('i', { class: `light light--${l.kind}` });
    n.style.cssText = `--x:${l.x};--y:${l.y};--r:${l.r};--c:${l.color};--d:${l.d}s;--t:${l.t}s`;
    return n;
  }));
}

let embedTimer;
function swapEmbed(band) {
  const iframe = $('embed');
  const ph = $('embed-placeholder');
  const link = `https://open.spotify.com/artist/${band.spotify}`;
  $('open-spotify').href = link;
  $('open-spotify').hidden = false;
  ph.hidden = false;
  ph.replaceChildren(el('strong', { text: band.name }), el('span', { text: 'Loading Spotify' }));
  iframe.hidden = true;
  iframe.title = `Spotify player for ${band.name}`;
  clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    ph.replaceChildren(el('strong', { text: band.name }), el('a', { href: link, target: '_blank', rel: 'noopener', text: 'Open in Spotify' }));
  }, EMBED_TIMEOUT_MS);
  iframe.onload = () => { clearTimeout(embedTimer); ph.hidden = true; iframe.hidden = false; };
  iframe.src = `https://open.spotify.com/embed/artist/${band.spotify}?utm_source=generator&theme=0`;
}

// ---------------------------------------------------------------------------------------------- misc

// Screen readers re-announce a live region on every write, so write only when the text changes (render runs per frame).
const say = text => { if ($('announce').textContent !== text) $('announce').textContent = text; };

function interacted() {
  if (touched) return;
  touched = true;
  $('hint').hidden = true;
}

// Desktop scale: the 1440 x 876 reference desk fills 80 percent of the viewport, whichever side binds (DESK_SHARE).
const DESK_SHARE = 0.8;
function fitDesk() {
  $('console').style.setProperty('--zoom', Math.min(DESK_SHARE * innerWidth / 1440, DESK_SHARE * innerHeight / 876).toFixed(3));
  const ss = Math.max(innerWidth / 1600, innerHeight / 900); // the scene's cover scale, for the light layer
  const root = document.documentElement.style;
  root.setProperty('--ss', ss.toFixed(4));
  root.setProperty('--sx', `${((innerWidth - 1600 * ss) / 2).toFixed(1)}px`);
  root.setProperty('--sy', `${((innerHeight - 900 * ss) / 2).toFixed(1)}px`);
}
addEventListener('resize', fitDesk);
fitDesk();
load();

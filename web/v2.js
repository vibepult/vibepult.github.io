// v2 page: the v1 pult (desk.js) with the day on a lever. The theme selector, the day lever (follows the clock until
// dragged), five tweak levers for the nearest stop, the twelve faders as offsets on the day, the genre word as a
// readout, the model monitor, and the v1 player for audio. Each theme and stop brings its own skin (skins2.js).
// Steering lives in compose.js. Cadence as in v1: prompts and no-reset config while dragging, one
// send per 200 ms; on release, when the tempo step or the rhythm skeleton changed, a second deck starts and cross-fades
// in (player.js) instead of the context reset's hard cut.
// With "More LLM help" on, the relay asks Haiku on release and on clock moves, never while dragging;
// the rule prompt rides along as the fallback. The page never names the model.
// Every frame up carries `s`, the share string, so the relay logs the desk as it was.
import * as player from './player.js';
import { parseP, formatP, promptKey } from './steer.js';
import { compose, dayBoard, withFaders, clockPosition, nearestStop, stopPosition, dayStyle, askState, stopTweaks, phrase, THEMES, DAY, FADERS, IDS, TWEAK_IDS, DEADBAND, encodeState, decodeState, beatOf, ramp, RAMP, RAMP_MS } from './compose.js';
import { $, el, applyAssets, buildLever, buildStepped, buildStrips, interacted, lightMeters, mount, reducedMotion, render, say, ui } from './desk.js';
import { PALETTES, FONTS, skin2 } from './skins2.js';

const STEER_MS = 200, CLOCK_MS = 30_000, STATS_MS = 30_000;
const hash = () => new URLSearchParams(location.hash.slice(1));
const writeHash = (k, v) => { const h = hash(); v === null ? h.delete(k) : h.set(k, v); history.replaceState(null, '', '#' + h.toString().replace(/%2B/g, '+')); };
const share = () => encodeState({ theme, haiku, position: following ? null : position, board, tweaks });

const shared = decodeState(hash().get('s')), { board, tweaks } = shared;
const p = parseP(hash().get('p'));
let { theme, haiku } = shared;
let position = shared.position, following = position === null;
if (following) position = clockPosition(new Date());
const heard = () => withFaders(day(), board); // the board the model hears
const now = () => compose(heard(), dayStyle(theme, position), p, theme); // what the model gets
let previous = null, lastAsk = null; // previous: Haiku's last prompts
const ask = () => askState({ theme, position, tweaks, heard: heard(), p, previous });
const askKey = a => JSON.stringify({ ...a, previous: undefined }); // the same state is not asked twice
let lastConfig = null, playing = false, lastSent = null, lastBpm = null, lastCut = null, steerTimer = 0, filtered = null, shown = null, skinned = null;
let lastBeat = null, lastPrompts = null, rampTimer = 0; // the rhythm skeleton and the prompts a ramp fades from
let lastDay = '', glideTimer = 0; // the day board last drawn: when it moves, the caps glide (150 ms, style.css .settling)

// The hour a day position stands for: clockPosition inverted, linear between the stops' hours.
function hourOf(position) {
  const t = Math.max(0, Math.min(100, position)) / stopPosition(1), i = Math.min(Math.floor(t), DAY.length - 2);
  return DAY[i].at + (t - i) * (DAY[i + 1].at - DAY[i].at);
}
const clockText = h => { const m = Math.round(h * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

// A control on a shared number: the desk drags `value`, the page keeps its own objects (board, tweaks) for the hash.
const bound = (get, set) => ({ get value() { return get(); }, set value(v) { set(v); }, bypass: false });

// ---------------------------------------------------------------------------------------------- build

document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: FONTS }));
// A fader cap sits where the model hears the fader; a drag stores the difference to the day as the offset (`board`,
// 50 leaves the day alone, so an offset past ±50 clips). When the day moves, the caps glide after it. No bypass.
const day = () => dayBoard(position, tweaks, theme);
const data = { faders: IDS.map((id, i) => ({ id, label: FADERS[id].label, group: i < 6 ? 'audio' : 'character', ticks: [] })), packs: PALETTES };
const state = { faders: Object.fromEntries(IDS.map(id => [id, bound(() => heard()[id], v => { board[id] = Math.max(0, Math.min(100, 50 + v - day()[id])); })])), knobs: {}, switches: {}, selectors: {}, lyrics: [], underground: { value: 0 } };
mount(data, state, { render: renderPage, commit });
buildStrips(faderText);
buildStepped('theme', 'Theme', Object.entries(THEMES).map(([v, t]) => ({ v, t: t.label })), () => theme, v => { theme = v; });
buildVolume();
const clockButton = buildDay();
const stops = DAY.map((s, i) => {
  const b = el('button', { class: 'stop', type: 'button', text: s.label });
  b.style.setProperty('--v', stopPosition(i));
  b.addEventListener('click', () => { position = Math.round(stopPosition(i)); following = false; interacted(); render(); commit(); });
  $('stops').append(b);
  return b;
});
$('llm').setAttribute('aria-pressed', String(haiku));
$('llm').addEventListener('click', () => { haiku = !haiku; $('llm').setAttribute('aria-pressed', String(haiku)); lastAsk = null; commit(true); });
$('play').addEventListener('click', play);
$('stop').addEventListener('click', () => { if (player.isOpen()) { send({ control: 'stop' }); playing = false; } });
// A listener's verdict with the desk as it was: labelled ground truth for the judges. The lamp line goes with the next chunk.
$('bad').addEventListener('click', () => { if (!player.isOpen()) return; player.send({ s: share(), mark: 'bad' }); lamp('noted: sounds bad'); });
setInterval(() => {
  if (!following || clockPosition(new Date()) === position) return;
  position = clockPosition(new Date());
  render();
  commit();
}, CLOCK_MS);
setInterval(() => {
  const s = player.status();
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  $('stats').textContent = playing ? `played ${mmss(s.played)} · gaps ${s.gaps} · buffer ${s.buffered.toFixed(1)} s` : '';
}, 500);
// Audio health to the session log: player.send, not send(), which would redraw the monitor.
setInterval(() => { if (playing && player.isOpen()) player.send({ s: share(), stats: player.status() }); }, STATS_MS);
$('lamp').style.setProperty('--fade', `${player.FADE}s`);
render();
commit();

// The words the model hears for one fader: the heard value, the offset when off 50, the phrase outside the deadband.
function faderText(f) {
  const h = heard()[f.id], off = board[f.id] - 50;
  const words = Math.abs(h - 50) / 50 < DEADBAND ? '' : phrase(theme, f.id, h < 50 ? 'low' : 'high') || 'instrumental';
  return `${f.label} ${h}${off ? ` (offset ${off > 0 ? '+' : ''}${off})` : ''}${words ? `: ${words}` : ''}`;
}

// The master lever is the volume: the listener's, never shared.
function buildVolume() {
  const ctl = { value: 80, bypass: false };
  const k = { id: 'volume', label: 'Volume', min: 0, max: 100, step: 1, detents: [25, 50, 75] };
  const wrap = el('div', { class: 'lever lever--vertical' });
  ui.knobs.volume = buildLever(k, ctl, wrap, null, () => `volume ${ctl.value} percent`, () => String(ctl.value), true);
  $('master').append(wrap);
}

// The day lever: a drag stops the clock, CLOCK brings it back. The CLOCK button sits in the lever head but is not
// the lever's engage button, which desk.js would relabel ON/OFF every frame.
function buildDay() {
  const ctl = bound(() => position, v => { position = v; following = false; });
  const wrap = el('div', { class: 'lever' });
  const clock = el('button', { class: 'onoff clock', type: 'button', 'aria-label': 'Follow the clock', text: 'CLOCK' });
  clock.addEventListener('click', () => { following = !following; if (following) position = clockPosition(new Date()); interacted(); render(); commit(); });
  ui.knobs.day = buildLever({ id: 'day', label: 'Day', min: 0, max: 100, step: 1, detents: DAY.map((_, i) => stopPosition(i)) }, ctl, wrap, null,
    () => `Day: ${DAY[nearestStop(position)].label}, ${clockText(hourOf(position))}${following ? ', following the clock' : ''}`,
    () => `${DAY[nearestStop(position)].label} ${position}`);
  wrap.querySelector('.lever__head').prepend(clock);
  $('day').prepend(wrap);
  return clock;
}

// The five tweaks of the stop nearest the day lever, the theme's own if it has them. Each keeps its own value.
function showTweaks(i) {
  for (const id of TWEAK_IDS) delete ui.knobs[id];
  $('tweaks').replaceChildren();
  $('tweaks-label').textContent = `Tweak ${DAY[i].label}`;
  for (const [id, tw] of stopTweaks(i, theme)) {
    const wrap = el('div', { class: 'lever', title: tw.hint });
    ui.knobs[id] = buildLever({ id, label: tw.label, min: 0, max: 100, step: 1, detents: [50] }, bound(() => tweaks[id], v => { tweaks[id] = v; }), wrap, null,
      () => `${tw.label} ${tweaks[id]}: ${tw.hint}`, () => String(tweaks[id]));
    $('tweaks').append(wrap);
  }
  shown = `${theme}:${i}`;
}

// ------------------------------------------------------------------------------------------ transport

async function play() {
  if (player.isConnecting()) return lamp('still connecting, hold on'); // a second click while the relay cold-starts
  if (!player.isOpen()) {
    lamp('connecting to relay');
    try { await player.connect(player.RELAY, onFrame); }
    catch (e) { return lamp(e.code === 4401 ? 'token rejected' : e.code === 4429 ? 'relay busy, try later' : `no relay at ${player.RELAY}`); }
  }
  player.volume(ui.knobs.volume.ctl.value / 100);
  const { prompts, config, cut, style } = now();
  playing = true;
  lastBpm = config.bpm;
  lastCut = cut;
  lastBeat = beatOf(style);
  lastPrompts = prompts;
  const a = haiku ? ask() : null;
  if (a) lastAsk = askKey(a);
  send({ prompts, config, control: 'play', ...(a && { ask: a }) });
}

function send(frame, via = player.send) {
  if (frame.prompts) { lastSent = promptKey(frame.prompts); filtered = null; lamp(frame.ask ? 'asking the LLM' : 'steering'); }
  via({ s: share(), ...frame });
  if (frame.config) lastConfig = frame.config;
  monitor(frame.ask ? ['asking the LLM; the rules play if it fails'] : []);
}

// The model monitor, on the left panel: the config, one field a line, and the LLM's notes. The prompt text stays off
// the page. Before Play it shows the config the desk would send.
function monitor(extra = []) {
  const lines = [...Object.entries(lastConfig).map(([k, v]) => `${k === 'musicGenerationMode' ? 'mode' : k} ${v}`), ...extra];
  $('monitor').replaceChildren(...lines.map(text => el('li', { text })));
}

function onFrame(m) {
  if (m.status) {
    // Follow the relay both ways: with the LLM on, Lyria's connect reports "stopped" before the delayed play lands.
    if (m.status === 'playing') playing = true;
    if (m.status === 'stopped' || m.status === 'closed' || m.status === 'unauthorized' || m.status === 'busy') playing = false;
    if (m.status === 'unauthorized') return lamp('token rejected');
    if (m.status === 'busy') return lamp('relay busy, try later');
    $('lamp').classList.toggle('crossfading', m.status === 'crossfading');
    if (m.status === 'crossfading') return lamp(`crossfading to ${lastBpm} bpm`);
    return lamp(m.status === 'playing' && lastSent ? 'steering' : m.status + (m.reason ? ` (${m.reason})` : ''));
  }
  if (m.filtered) { filtered = m.filtered; return lamp(`filtered: ${m.filtered} (${m.reason})`); }
  if (m.warning) { lamp(m.warning); return monitor([`warning: ${m.warning}`]); } // the lamp is overwritten by the next chunk
  if (m.asked) { // the LLM's prompts go to Lyria right after this frame
    previous = m.asked.prompts;
    lastSent = promptKey(previous);
    lamp('steering');
    return monitor([`LLM: ${m.asked.note}`, `${m.asked.ms} ms · ${m.asked.cached} cached tokens`]);
  }
  if (m.chunk && promptKey(m.chunk.clientContent?.weightedPrompts || []) === lastSent) { lastSent = null; lamp(filtered ? `playing, filtered: ${filtered}` : 'playing'); }
}

function lamp(text) {
  $('lamp').textContent = text;
  say(text);
}

// ------------------------------------------------------------------------------------------- steering

// Every frame, after desk.js has drawn the controls: the tweaks of the nearest stop, the strip LCDs and meters,
// the day readouts, the style word, then a debounced live steer that keeps the committed tempo.
function renderPage() {
  const i = nearestStop(position), d = day(), h = heard();
  if (`${theme}:${i}` !== shown) { showTweaks(i); return render(); } // new levers: draw them too
  const key = JSON.stringify(d);
  if (key !== lastDay && lastDay) { document.documentElement.classList.add('settling'); clearTimeout(glideTimer); glideTimer = setTimeout(() => document.documentElement.classList.remove('settling'), 200); }
  lastDay = key;
  for (const id of IDS) { // the LCD shows what the model hears, a struck offset when the fader is off the day
    const off = board[id] - 50;
    ui.faders[id].value.replaceChildren(...(off ? [el('s', { text: (off > 0 ? '+' : '') + off })] : []), String(h[id]));
  }
  lightMeters({ faders: h }, d); // bright: what the model hears, up to the cap; dim: where the day alone would put it
  clockButton.setAttribute('aria-pressed', String(following));
  stops.forEach((b, j) => b.setAttribute('aria-current', String(j === i)));
  $('clock-time').textContent = clockText(hourOf(position));
  $('clock-stop').textContent = DAY[i].label;
  $('style').textContent = dayStyle(theme, position);
  $('meta').textContent = `${THEMES[theme].label} · ${DAY[i].label} · ${position}`;
  player.volume(ui.knobs.volume.ctl.value / 100);
  if (!playing) { lastConfig = now().config; return monitor(); }
  clearTimeout(steerTimer);
  clearTimeout(rampTimer); // a drag replaces the whole list; the ramp is over
  steerTimer = setTimeout(() => {
    const { prompts, config } = now(), c = { ...config, bpm: lastBpm ?? config.bpm };
    if (!haiku) { lastPrompts = prompts; return send({ prompts, config: c }); }
    // The LLM writes the words on release (about 2.5 s a call); Lyria's own controls need no words and blend live.
    send({ config: c });
  }, STEER_MS);
}

// On release: the share link, the skin, a second deck cross-faded in if the tempo step or the rhythm skeleton changed,
// a ramp if only the words did (a genre word flip or a new clause; v1 cut those), and
// the LLM if the state moved. With the LLM on, a word flip blends through `previous` instead of a ramp. `force`
// sends even when nothing changed: switching between the LLM and the rules.
function runRamp(from, to, config) {
  let i = 0;
  const step = () => {
    send({ prompts: ramp(from, to, RAMP[i]), ...(i === 0 && { config }) });
    if (++i < RAMP.length) rampTimer = setTimeout(step, RAMP_MS);
  };
  lastPrompts = to;
  step();
}

function commit(force = false) {
  const stop = nearestStop(position);
  if (`${theme}:${stop}` !== skinned) {
    skinned = `${theme}:${stop}`;
    const apply = () => applyAssets(theme, PALETTES[theme], skin2(theme, stop));
    if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(apply); else apply();
  }
  writeHash('s', share());
  if (Object.keys(p).length) writeHash('p', formatP(p));
  if (!playing) return;
  const { prompts, config, cut, style } = now(), beat = beatOf(style);
  const hard = config.bpm !== lastBpm || beat !== lastBeat, moved = cut !== lastCut;
  const a = haiku ? ask() : null, asked = a && askKey(a) !== lastAsk;
  if (!hard && !moved && !asked && !force) return;
  clearTimeout(steerTimer);
  clearTimeout(rampTimer);
  lastBpm = config.bpm;
  lastBeat = beat;
  lastCut = cut;
  if (a) lastAsk = askKey(a);
  if (moved && !hard && !a && lastPrompts) return runRamp(lastPrompts, prompts, config);
  lastPrompts = prompts;
  if (hard) return send({ prompts, config, control: 'play', ...(a && { ask: a }) }, player.cross);
  send({ prompts, config, ...(a && { ask: a }) });
}

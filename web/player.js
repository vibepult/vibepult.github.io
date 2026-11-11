// v1 player: Lyria PCM from the relay into Web Audio.
// Scheduled buffers with a lead. A late chunk re-primes the lead and counts as a gap.
// A deck is one relay socket, one Lyria session and one gain bus. A tempo or rhythm change needs a context reset,
// which Lyria plays as a hard cut; cross() hides it with a second deck.
// scheduled buffers, an AudioWorklet ring buffer if they glitch.

import { mastering } from "./mastering.js";

const RATE = 48000;
// Tuning knob: gap safety against steer latency. 1.0 s gapped once in 10 live minutes and came within 0.07 s
// in another run (2026-10-12); chunks arrived up to 1 s late. Every second here is a second of fader lag.
const LEAD = 2.0;
// Tuning knob: the equal-power cross-fade between decks. The beats are not matched, so they clash for this long;
// much shorter and it sounds like the cut it hides.
export const FADE = 5.0;
// Local pages talk to a local relay; any other page (GitHub Pages, a phone on the LAN) to the Fly app, which is
// wss so an https page may open it.
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
export const RELAY = LOCAL ? `ws://${location.hostname}:8765` : "wss://vibepult-relay.fly.dev";

// A token in the URL fragment (#token=...) is saved and stripped; the fragment never reaches a server.
const frag = new URLSearchParams(location.hash.slice(1));
if (frag.has("token")) {
  localStorage.relayToken = frag.get("token");
  frag.delete("token");
  history.replaceState(null, "", location.pathname + location.search + (frag.size ? "#" + frag.toString().replace(/%2B/g, "+") : ""));
}
// No token, or one the relay refused: the page shows nothing. The relay spends the key's quota, so a person without
// a token gets a blank page, not a desk to look at. The body starts hidden in the html, so nothing flashes while the
// modules load and nothing shows with JavaScript off. Not on localhost: the relay there is in dev mode, any token goes.
const blank = () => { document.body.hidden = true; };
if (LOCAL || localStorage.relayToken) document.body.hidden = false; else blank();
// The mastering chain (mastering.js) sits between the decks and the volume. Always, since 2026-11-06: heard better on
// three Party pairs offline and not worse live. `p=master:0` plays the plain path, one reload apart,
// for an A/B by ear. Read once at load, like the token.
const MASTERED = !(frag.get("p") || "").split(",").includes("master:0");

let ctx, master, input, url, onstatus, deck, fading; // input: the chain or the volume; deck: the one steered and heard; fading: the old one on its way out
let pending = null; // the connect in flight: a second Play waits on it instead of opening a second deck (2026-11-02)
let opening = null; // the cross in flight: a second cross() before the ack waits on it instead of opening a third deck
const stats = { gaps: 0, played: 0 };  // played: seconds of audio scheduled since PLAY
const last = { playing: false };  // prompts, config, playing: what a reconnect replays
let delay = 1000;  // reconnect backoff, 1 s doubling to 30 s

// Must run from a user gesture (PLAY): browsers block audio before one. The Fly relay cold-starts on the first Play,
// so a second click 5 to 25 s later is normal; it must not open a second socket (heard 2026-10-22: two decks for 17
// minutes, only one steered).
export function connect(relay, status) {
  if (pending) return pending;
  if (!ctx) {
    ctx = new AudioContext({ sampleRate: RATE });
    master = ctx.createGain();
    master.connect(ctx.destination);
    input = MASTERED ? mastering(ctx, master) : master; // the volume last: the knob must not drive the limiter
  }
  ctx.resume();
  url = relay; onstatus = status;
  return pending = open().then((d) => { deck = d; }).finally(() => { pending = null; });
}

// Resolves on the relay's first frame (its ack to our token), rejects with the close code (e.code) before that:
// 4401 unauthorized, 4429 busy, 1006 no relay.
function open() {
  const d = { ws: new WebSocket(url), bus: null, nextStart: 0, live: false, prime: true, onfirst: null };
  d.ws.binaryType = "arraybuffer";
  return new Promise((ok, fail) => {
    let acked = false;
    d.ws.onopen = () => d.ws.send(JSON.stringify({ token: localStorage.relayToken || "" }));
    d.ws.onmessage = (ev) => {
      if (acked && d !== deck && d !== fading) return close(d);  // orphaned by two opens in flight: nobody steers it, nobody hears it
      if (typeof ev.data !== "string") return d.live && enqueue(d, ev.data);
      const m = JSON.parse(ev.data);
      if (!acked) { acked = true; ok(d); }
      if (m.status === "reconnecting") d.prime = true;  // the gap that follows is expected, not counted
      if (d === deck) onstatus(m);  // a fading deck's status is nobody's business
    };
    // onerror needs no handler: a close always follows it
    d.ws.onclose = (ev) => {
      if (ev.code === 4401) { delete localStorage.relayToken; blank(); }
      if (!acked) return fail(Object.assign(new Error("relay closed"), { code: ev.code }));
      if (d !== deck) return;
      if (ev.code === 4401 || ev.code === 4429) return onstatus({ status: ev.code === 4401 ? "unauthorized" : "busy" });
      if (!last.playing) return onstatus({ status: "closed" });
      onstatus({ status: "reconnecting", reason: "relay closed" });
      reconnect();
    };
  });
}

// The relay went away mid-play (the Fly machine restarted, the network blinked): open a new deck after the backoff
// and replay prompts, config and play. Audio already scheduled on the old deck plays out meanwhile. Stops on
// STOP, on a token or cap refusal, or when cross() opened a deck in the meantime.
async function reconnect() {
  const was = deck;
  await new Promise((r) => setTimeout(r, delay));
  delay = Math.min(delay * 2, 30000);
  if (deck !== was || !last.playing) return;
  try { deck = await open(); }
  catch (e) {
    if (e.code === 4401 || e.code === 4429) return onstatus({ status: e.code === 4401 ? "unauthorized" : "busy" });
    return reconnect();
  }
  delay = 1000;
  send({ prompts: last.prompts, config: last.config, control: "play" });
}

export function send(frame) {
  if (frame.prompts) last.prompts = frame.prompts;
  if (frame.config) last.config = frame.config;
  if (["play", "pause", "stop"].includes(frame.control)) last.playing = frame.control === "play";
  if (frame.control === "play" && !deck.live) {
    deck.live = true; deck.prime = true;
    deck.bus = ctx.createGain();
    deck.bus.connect(input);
    if (!fading) { stats.gaps = 0; stats.played = 0; }
  }
  if (frame.control === "stop" || frame.control === "pause") { cut(deck); if (fading) close(fading); fading = null; }
  deck.ws.send(JSON.stringify({ deck: 0, ...frame }));
}

// A new deck plays `frame` (prompts, config and play) while this one plays on. When the new deck's first chunk is
// scheduled, the two cross-fade over FADE seconds and the old one closes. If no second deck opens, or a fade is
// still running, the reset goes to this deck: the hard cut, but the tempo lands. A third deck mid-fade would put
// a second gain curve on a bus that is still fading, which Web Audio refuses (heard 2026-10-15: every chunk after
// that threw, and the deck's chunks piled up on one start time). A second cross() before the relay's ack waits for
// that open, then takes the fade branch: its frame lands as a reset on the new deck, never as a third socket.
export async function cross(frame) {
  if (opening) return opening.then(() => cross(frame));
  if (fading) return send({ ...frame, control: "reset" });
  const next = await (opening = open().catch(() => null));
  opening = null;
  if (!next) return send({ ...frame, control: "reset" });
  fading = deck; deck = next;
  send(frame);
  deck.bus.gain.value = 0;
  deck.onfirst = fade;
}

function fade(at) {
  const old = fading, cur = deck, n = 64, out = new Float32Array(n), inn = new Float32Array(n);
  for (let i = 0; i < n; i++) { out[i] = Math.cos(Math.PI / 2 * i / (n - 1)); inn[i] = Math.sin(Math.PI / 2 * i / (n - 1)); }
  old.bus.gain.setValueCurveAtTime(out, at, FADE);
  cur.bus.gain.setValueCurveAtTime(inn, at, FADE);
  setTimeout(() => cur === deck && onstatus({ status: "crossfading" }), (at - ctx.currentTime) * 1000);
  setTimeout(() => {
    if (fading === old) { close(old); fading = null; }
    if (cur === deck) onstatus({ status: "playing" });
  }, (at + FADE - ctx.currentTime) * 1000);
}

export const isOpen = () => deck?.ws.readyState === WebSocket.OPEN;
export const isConnecting = () => pending !== null;
export const volume = (v) => { if (master) master.gain.value = v; };
// The page shows this and sends it to the relay every 30 s as a stats frame: a replay then shows gaps and double decks.
export const status = () => ({ ...stats, buffered: deck?.live ? Math.max(0, deck.nextStart - ctx.currentTime) : 0,
  decks: [deck, fading].filter((d) => d?.live).length });

// Silence now: audio already scheduled plays into a disconnected bus.
function cut(d) {
  d.live = false; d.nextStart = 0;
  d.bus?.disconnect();
}

function close(d) {
  cut(d);
  d.ws.close();  // the relay closes its Lyria session with the socket
}

function enqueue(d, data) {
  const i16 = new Int16Array(data), frames = i16.length / 2;
  const buf = ctx.createBuffer(2, frames, RATE);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  for (let i = 0; i < frames; i++) { L[i] = i16[2 * i] / 32768; R[i] = i16[2 * i + 1] / 32768; }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(d.bus);
  if (d.nextStart < ctx.currentTime) {
    if (!d.prime && d === deck) { stats.gaps++; console.warn(`gap at ${stats.played.toFixed(0)} s of audio`); }
    d.nextStart = ctx.currentTime + LEAD;
  }
  d.prime = false;
  const at = d.nextStart;
  src.start(at);
  d.nextStart += buf.duration;
  if (d === deck) stats.played += buf.duration;
  if (d.onfirst) { const first = d.onfirst; d.onfirst = null; first(at); }  // after the bookkeeping: a throw here must not repeat
}

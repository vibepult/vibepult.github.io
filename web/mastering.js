// Browser-side mastering. Every Lyria clip plays close to mono (L/R correlation 0.985 to 0.999,
// side over mid 0.02 to 0.09 where records sit at 0.14 to 0.59) and short of mids (8 to 11 percent of the energy in
// 200 Hz to 2 kHz against 16 to 60), and no prompt changes that. This chain sits
// after the deck buses: a mid-side widener with a high-pass on the side (the bass stays mono), a presence peak, a
// hard-knee limiter, a trim, a soft ceiling. Always on since 2026-11-06 (heard better on three Party pairs, not worse
// live); `p=master:0` (player.js) plays the plain path, one reload apart. The bench runs the same numbers offline
//, so a change here is measured before it is heard.
// The limiter alone does not hold the peaks: its envelope follows the detector with no held look-ahead, so a
// transient a few samples wide passes, and its makeup gain adds 1.7 dB. Measured 2026-11-06 on five Party clips:
// peaks at +3 to +5.5 dBFS after it, and 2 to 2.7 dB more RMS than the plain path. The trim level-matches the two
// paths within 0.7 dB, so the A/B is not a loudness test; the ceiling (a WaveShaperNode, linear to its knee, then
// tanh to full scale, 6 dB of table headroom) catches what the limiter let through.
export const MASTERING = {
  side: 6, // dB on the side signal
  sideHp: { f: 150, q: -3 }, // Hz; Q in dB, the Web Audio rule for highpass: -3 is Butterworth
  // A peaking band about two octaves wide, dB. Measured 2026-11-06 on five Party clips: 1.5 kHz at +4 left the mids at
  // 9 to 16 percent, 1 kHz at +6 lands all five inside their references' band (10 to 22 percent); +8 works the limiter.
  presence: { f: 1000, q: 0.7, gain: 6 },
  limiter: { threshold: -3, knee: 0, ratio: 20, attack: 0.003, release: 0.1 }, // dB, dB, ratio, s, s
  trim: -2, // dB after the limiter
  ceiling: { knee: -3 }, // dBFS: linear below, soft above, never past 0
};

// The ceiling's transfer function on a sample: identity to the knee, then a tanh that reaches 1 only at infinity.
export const ceiling = (x, k) => Math.abs(x) <= k ? x : Math.sign(x) * (k + (1 - k) * Math.tanh((Math.abs(x) - k) / (1 - k)));

// The graph from a stereo entry node to `out`; returns the entry.
export function mastering(ctx, out) {
  const g = (v) => { const n = ctx.createGain(); n.gain.value = v; return n; };
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  const mid = g(0.5), side = g(0.5 * 10 ** (MASTERING.side / 20)), negR = g(-1), negS = g(-1), left = g(1), right = g(1);
  const hp = ctx.createBiquadFilter(), presence = ctx.createBiquadFilter(), limiter = ctx.createDynamicsCompressor();
  const trim = g(10 ** (MASTERING.trim / 20)), half = g(0.5), shaper = ctx.createWaveShaper(); // half: the table spans -2 to 2
  const k = 10 ** (MASTERING.ceiling.knee / 20), n = 4096;
  shaper.curve = Float32Array.from({ length: n }, (_, i) => ceiling((i / (n - 1) * 2 - 1) * 2, k));
  shaper.oversample = "4x";
  hp.type = "highpass"; hp.frequency.value = MASTERING.sideHp.f; hp.Q.value = MASTERING.sideHp.q;
  presence.type = "peaking"; presence.frequency.value = MASTERING.presence.f; presence.Q.value = MASTERING.presence.q; presence.gain.value = MASTERING.presence.gain;
  for (const [name, v] of Object.entries(MASTERING.limiter)) limiter[name].value = v;
  split.connect(mid, 0); split.connect(mid, 1); // M = (L + R) / 2
  split.connect(side, 0); split.connect(negR, 1); negR.connect(side); // S = (L - R) / 2, boosted
  side.connect(hp);
  mid.connect(left); hp.connect(left); // L = M + S
  mid.connect(right); hp.connect(negS); negS.connect(right); // R = M - S
  left.connect(merge, 0, 0); right.connect(merge, 0, 1);
  merge.connect(presence); presence.connect(limiter); limiter.connect(trim); trim.connect(half); half.connect(shaper); shaper.connect(out);
  return split;
}

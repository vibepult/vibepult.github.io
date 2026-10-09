// Procedural skins (M4): seeded SVG data URIs for the asset slots in docs/designs/skins.md. Pure strings, no DOM,
// so the generator is testable in node. Textures are grey luminance tiles (overlay-blended on the pack colour in CSS);
// scenes carry their own colours and borrow the pack accent for lights. Seed = the band slug: a band's own desk.
// The desk hides the middle of the scene; motifs go where it shows: x < 160 or > 1440, y < 110 or > 790 (of 1600 x 900).

const hash = s => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const rng = seed => () => { // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (r, lo, hi) => lo + r() * (hi - lo);
const i = n => Math.round(n);
const uri = s => `data:image/svg+xml,${s.replace(/\s+/g, ' ').replace(/[<>#"%]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
const svg = (w, h, body, attrs = '') => uri(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' ${attrs}>${body}</svg>`);
const use = (id, x, y, s = 1, rot = 0) => `<use href='#${id}' transform='translate(${i(x)} ${i(y)}) scale(${s.toFixed(2)}) rotate(${i(rot)})'/>`;

// Grey noise mapped onto [lo, hi]: mean near .5 is a no-op under overlay, so the range is the grain strength.
const noise = (id, type, fx, fy, oct, seed) =>
  `<feTurbulence type='${type}' baseFrequency='${fx} ${fy}' numOctaves='${oct}' seed='${seed}' stitchTiles='stitch' result='${id}'/>`;
const grain = (w, h, { type = 'fractalNoise', fx, fy, oct = 3, lo, hi, seed, more = '' }) => svg(w, h,
  `<filter id='f' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>${noise('n', type, fx, fy, oct, seed)}
   <feColorMatrix type='saturate' values='0'/><feComponentTransfer>
   <feFuncR type='table' tableValues='${lo} ${hi}'/><feFuncG type='table' tableValues='${lo} ${hi}'/><feFuncB type='table' tableValues='${lo} ${hi}'/>
   <feFuncA type='table' tableValues='1 1'/></feComponentTransfer></filter>
   <rect width='100%' height='100%' filter='url(#f)'/>${more}`);
// Bump-lit noise: the noise is a height map lit from the top left, so stone, bark, rust and wax get real relief.
const relief = (w, h, { fx, fy, oct = 3, seed, scale = 6, lo = .2, hi = .8, shine = 0, more = '' }) => svg(w, h,
  `<filter id='f' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>${noise('n', 'fractalNoise', fx, fy, oct, seed)}
   <feDiffuseLighting in='n' surfaceScale='${scale}' lighting-color='#fff' result='d'><feDistantLight azimuth='235' elevation='40'/></feDiffuseLighting>
   ${shine ? `<feSpecularLighting in='n' surfaceScale='${scale}' specularExponent='${shine}' lighting-color='#fff' result='s'><feDistantLight azimuth='235' elevation='55'/></feSpecularLighting><feComposite in='s' in2='d' operator='arithmetic' k2='.6' k3='1'/>` : ''}
   <feComponentTransfer><feFuncR type='table' tableValues='${lo} ${hi}'/><feFuncG type='table' tableValues='${lo} ${hi}'/><feFuncB type='table' tableValues='${lo} ${hi}'/><feFuncA type='table' tableValues='1 1'/></feComponentTransfer></filter>
   <rect width='100%' height='100%' filter='url(#f)'/>${more}`);
// A coloured mist: noise luminance becomes alpha over a flat colour. For scenes.
const mist = (id, color, fx, fy, seed, gain = 1, bias = -.2) => {
  const [r, g, b] = [1, 3, 5].map(k => parseInt(color.slice(k, k + 2), 16) / 255);
  return `<filter id='${id}' x='0' y='0' width='100%' height='100%' color-interpolation-filters='sRGB'>${noise('n', 'fractalNoise', fx, fy, 3, seed)}
    <feColorMatrix values='0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${gain / 3} ${gain / 3} ${gain / 3} 0 ${bias}'/></filter>`;
};
const blur = (w, h, sd = 10) => `<filter id='blur' filterUnits='userSpaceOnUse' x='0' y='0' width='${w}' height='${h}'><feGaussianBlur stdDeviation='${sd}'/></filter>`;
const vignette = `<radialGradient id='v' cx='.5' cy='.45' r='.72'><stop offset='.45' stop-color='#000' stop-opacity='0'/><stop offset='1' stop-color='#000' stop-opacity='.75'/></radialGradient><rect width='100%' height='100%' fill='url(#v)'/>`;
const sky = (top, bottom) => `<linearGradient id='s' x2='0' y2='1'><stop offset='0' stop-color='${top}'/><stop offset='1' stop-color='${bottom}'/></linearGradient><rect width='100%' height='100%' fill='url(#s)'/>`;
const glow = (id, color, a) => `<radialGradient id='${id}'><stop offset='0' stop-color='${color}' stop-opacity='${a}'/><stop offset='1' stop-color='${color}' stop-opacity='0'/></radialGradient>`;
const dots = (r, n, box, color, rmin, rmax) => { // fireflies, snow, embers
  let s = '';
  for (let k = 0; k < n; k++) s += `<circle cx='${i(between(r, box[0], box[2]))}' cy='${i(between(r, box[1], box[3]))}' r='${between(r, rmin, rmax).toFixed(1)}' fill='${color}' opacity='${between(r, .25, .9).toFixed(2)}'/>`;
  return s;
};
// A neon tube: wide blurred halo, the tube, a white-hot core. Needs a #blur filter in the document.
const neon = (d, color, w = 3) => `<path d='${d}' fill='none' stroke='${color}' stroke-width='${w * 5}' stroke-linecap='round' stroke-linejoin='round' opacity='.5' filter='url(#blur)'/>
  <path d='${d}' fill='none' stroke='${color}' stroke-width='${w}' stroke-linecap='round' stroke-linejoin='round'/>
  <path d='${d}' fill='none' stroke='#fff' stroke-width='${(w / 3).toFixed(1)}' stroke-linecap='round' stroke-linejoin='round' opacity='.85'/>`;
// A light for the animated layer: scene coordinates, radius, colour, kind (candle | neon | firefly | pulse), timing jitter.
const PACE = { candle: [1.2, 2.4], flash: [7, 12], ember: [4, 8] };
const light = (r, L, kind, x, y, rad, color) => L.push({ kind, x: i(x), y: i(y), r: i(rad), color, d: +between(r, 0, 4).toFixed(2), t: +between(r, ...(PACE[kind] || [3, 9])).toFixed(2) });
const SCENE = `preserveAspectRatio='xMidYMid slice'`;
const W = 1600, H = 900;

// ------------------------------------------------------------------------------------------- motifs
// Drawn once in <defs> at native size, placed with use(). Skull 40 x 40, pine cone 20 x 30, both from the top left.

// Three skulls: whole, a cracked jawless cranium, and a horned one. pickId(r, 'skull', 3) chooses per placement.
const SKULL = bone => {
  const face = `<ellipse cx='13' cy='19' rx='4.8' ry='5.5' fill='#050506'/><ellipse cx='27' cy='19' rx='4.8' ry='5.5' fill='#050506'/><path d='M20 23l-3 6h6z' fill='#050506'/>`;
  const dome = `M20 1C9.5 1 2 8.5 2 19c0 6 3 10.5 7 13`;
  return `<g id='skull0'><path d='${dome}v7h22v-7c4-2.5 7-7 7-13C38 8.5 30.5 1 20 1z' fill='${bone}' stroke='#050506' stroke-width='1.2'/>${face}<path d='M12 33v6M16 33v6M20 33v6M24 33v6M28 33v6' stroke='#050506' stroke-width='1.2'/></g>
  <g id='skull1'><path d='${dome}c2 1 4 1.5 7 1 l4 -1 c3 1 5 .5 8 0 c4 -2.5 7 -7 7 -13C38 8.5 30.5 1 20 1z' fill='${bone}' stroke='#050506' stroke-width='1.2'/>${face}<path d='M15 3 l3 7 l-2 5 l4 6' fill='none' stroke='#050506' stroke-width='1'/></g>
  <g id='skull2'><path d='M6 14 C-6 10 -4 -4 4 -2 C-2 2 0 10 8 10 M34 14 C46 10 44 -4 36 -2 C42 2 40 10 32 10' fill='${bone}' stroke='#050506' stroke-width='1.2' stroke-linejoin='round'/>
    <path d='${dome}v7h22v-7c4-2.5 7-7 7-13C38 8.5 30.5 1 20 1z' fill='${bone}' stroke='#050506' stroke-width='1.2'/>${face}<path d='M14 33v6M20 33v6M26 33v6' stroke='#050506' stroke-width='1.2'/></g>`;
};
const pickId = (r, id, n) => `${id}${Math.floor(r() * n)}`;
const CONE = (body, scale) => { // cone0 closed and tight, cone1 open with the scales spread and tipped light
  let s = `<g id='cone0'><ellipse cx='10' cy='16' rx='7.5' ry='13' fill='${body}'/>`;
  for (let y = 5; y <= 27; y += 4) for (const x of (y / 4) % 2 ? [4.5, 10, 15.5] : [7, 13]) s += `<ellipse cx='${x}' cy='${y}' rx='2.8' ry='1.8' fill='${scale}' stroke='${body}' stroke-width='.6'/>`;
  s += `</g><g id='cone1'><ellipse cx='10' cy='17' rx='9' ry='12' fill='${body}'/>`;
  for (let y = 7; y <= 27; y += 5) for (const x of (y / 5) % 2 ? [3, 10, 17] : [6.5, 13.5]) s += `<path d='M${x - 3.5} ${y} q3.5 -4 7 0 q-3.5 2.5 -7 0z' fill='${scale}' stroke='${body}' stroke-width='.5'/><path d='M${x - 1.5} ${y - 1.5} h3' stroke='#9a7a4a' stroke-width='.8'/>`;
  return s + '</g>';
};
const BONE = bone => `<g id='bone' fill='${bone}' stroke='#0a0a0b' stroke-width='.8'><rect x='-8' y='-1.7' width='16' height='3.4' rx='1.7'/><circle cx='-8' cy='-2' r='2.2'/><circle cx='-8' cy='2' r='2.2'/><circle cx='8' cy='-2' r='2.2'/><circle cx='8' cy='2' r='2.2'/></g>`;
// A fern frond from (0,0) curling up and to the right, leaflets both sides; silhouette.
const fern = (r, color) => {
  const len = between(r, 60, 110), bend = between(r, -40, -70);
  let s = `<g stroke='${color}' stroke-width='1.6' fill='none' stroke-linecap='round'><path d='M0 0 Q ${i(len * .5)} ${i(bend)} ${i(len)} ${i(bend * 1.4)}'/>`;
  for (let t = .15; t < 1; t += .08) { // points along the quadratic and a leaflet pair, shrinking towards the tip
    const x = 2 * (1 - t) * t * len * .5 + t * t * len, y = 2 * (1 - t) * t * bend + t * t * bend * 1.4, l = (1 - t) * 22 + 4;
    s += `<path d='M${i(x)} ${i(y)} l${i(-l * .5)} ${i(-l)} M${i(x)} ${i(y)} l${i(l * .7)} ${i(-l * .7)}'/>`;
  }
  return s + '</g>';
};
// A pine bough hanging in from a top corner: stem, needle pairs along it, side twigs, cones on some twig ends.
const bough = (r, x0, dir, color) => {
  let s = `<g stroke='${color}' stroke-width='2' fill='none' stroke-linecap='round'>`;
  const twig = (x, y, ang, len, depth) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    s += `<path d='M${i(x)} ${i(y)} L${i(x2)} ${i(y2)}'/>`;
    for (let t = 6; t < len; t += 7) { // needles
      const px = x + Math.cos(ang) * t, py = y + Math.sin(ang) * t, n = between(r, 10, 16);
      s += `<path d='M${i(px)} ${i(py)} l${i(Math.cos(ang + 1.1) * n)} ${i(Math.sin(ang + 1.1) * n)} M${i(px)} ${i(py)} l${i(Math.cos(ang - 1.1) * n)} ${i(Math.sin(ang - 1.1) * n)}'/>`;
    }
    if (depth > 0) for (let k = 0; k < 2; k++) twig(x + Math.cos(ang) * len * between(r, .3, .8), y + Math.sin(ang) * len * between(r, .3, .8), ang + dir * between(r, .3, .9), len * between(r, .4, .6), depth - 1);
    else if (r() < .6) s += `</g>${use(pickId(r, 'cone', 2), x2 - 10, y2 - 2, between(r, 1.6, 2.2))}<g stroke='${color}' stroke-width='2' fill='none' stroke-linecap='round'>`;
  };
  twig(x0, -10, Math.PI / 2 + dir * between(r, .5, .9), between(r, 150, 230), 2);
  return s + '</g>';
};

// ------------------------------------------------------------------------------------------- scenes

function forest(r, p, L) {
  const ground = 790;
  const conifer = (x, h, fill, o) => { // trunk and four to six stacked tiers, the clearing's silhouettes
    let s = `<rect x='${i(x - h / 44)}' y='${i(ground - h * .5)}' width='${i(h / 22) || 1}' height='${i(h * .5)}' fill='${fill}' opacity='${o}'/>`;
    const tiers = 4 + Math.floor(r() * 3);
    for (let t = 0; t < tiers; t++) {
      const w = h * (.16 + .09 * t) * between(r, .9, 1.1), top = ground - h + t * h * .16, bot = Math.min(ground, top + h * .3);
      s += `<polygon points='${i(x)},${i(top)} ${i(x - w / 2)},${i(bot)} ${i(x + w / 2)},${i(bot)}' fill='${fill}' opacity='${o}'/>`;
    }
    return s;
  };
  const pine = (x, h, fill, o) => { // a Scots pine: bare trunk, a few bent limbs, a flat crown of three blobs
    const top = ground - h;
    return `<g fill='${fill}' opacity='${o}'><rect x='${i(x - h / 50)}' y='${i(top + h * .2)}' width='${i(h / 25) || 1}' height='${i(h * .8)}'/>
      <path d='M${i(x)} ${i(top + h * .32)} l${i(h * .12)} ${i(-h * .06)} M${i(x)} ${i(top + h * .4)} l${i(-h * .14)} ${i(-h * .05)}' stroke='${fill}' stroke-width='${i(h / 40) || 1}'/>
      <ellipse cx='${i(x)}' cy='${i(top + h * .2)}' rx='${i(h * .22)}' ry='${i(h * .1)}'/><ellipse cx='${i(x + h * .12)}' cy='${i(top + h * .26)}' rx='${i(h * .16)}' ry='${i(h * .08)}'/><ellipse cx='${i(x - h * .14)}' cy='${i(top + h * .3)}' rx='${i(h * .15)}' ry='${i(h * .07)}'/></g>`;
  };
  const tree = (x, h, fill, o) => (r() < .3 ? pine : conifer)(x, h, fill, o);
  let trees = '';
  for (let k = 0; k < 34; k++) trees += tree(r() * W, between(r, 150, 300), '#0f1c14', .85);
  for (let k = 0; k < 16; k++) trees += tree(r() * W, between(r, 280, 470), '#08110c', 1);
  for (let k = 0; k < 7; k++) trees += tree(k % 2 ? between(r, 0, 260) : between(r, 1340, W), between(r, 620, 950), '#030504', 1); // the clearing
  const moonX = between(r, 300, 1300), moonY = between(r, 110, 240), dusk = r() < .4, lake = r() < .4;
  forestLights(r, p, L);
  const water = lake ? `<rect y='${ground}' width='100%' height='${H - ground}' fill='#0a1418'/><rect x='${i(moonX - 30)}' y='${ground}' width='60' height='${H - ground}' fill='#dfe8d8' opacity='.12' filter='url(#fog)'/>` : '';
  let floor = ''; // ferns and fallen cones in the bottom corners, lit a little so they read
  for (let k = 0; k < 8; k++) floor += `<g transform='translate(${i(k < 4 ? between(r, 0, 200) : between(r, 1380, 1580))} ${i(between(r, 850, 900))}) scale(${k % 2 ? -1 : 1} 1)'>${fern(r, '#223a2a')}</g>`;
  for (let k = 0; k < 7; k++) floor += use(pickId(r, 'cone', 2), k < 4 ? between(r, 10, 170) : between(r, 1420, 1570), between(r, 810, 860), between(r, 1.3, 2), between(r, -40, 40));
  const boughs = [bough(r, between(r, 0, 60), 1, '#0a140e'), bough(r, between(r, 80, 180), 1, '#050a07'), bough(r, between(r, 1420, 1520), -1, '#050a07'), bough(r, between(r, 1540, W), -1, '#0a140e')].join('');
  return svg(W, H, `<defs>${CONE('#3a2816', '#6a4c2a')}</defs>${sky(dusk ? '#3a2420' : '#1a3324', '#060a08')}${dusk ? `<rect y='60' width='100%' height='300' fill='#9a4a2a' opacity='.18'/>` : ''}${glow('m', '#dfe8d8', .35)}${mist('fog', '#aebfa7', .004, .009, i(r() * 1e6), 1.2)}
    <circle cx='${i(moonX)}' cy='${i(moonY)}' r='140' fill='url(#m)'/><circle cx='${i(moonX)}' cy='${i(moonY)}' r='34' fill='#dfe8d8' opacity='.9'/>
    <rect y='420' width='100%' height='480' fill='#aebfa7' filter='url(#fog)' opacity='.28'/>
    ${trees}<rect y='${ground}' width='100%' height='${H - ground}' fill='#050806'/>${water}${lake ? '' : floor}${boughs}
    ${dots(r, 26, [0, 430, W, 820], p.accent, 1.2, 2.6)}${vignette}`, SCENE);
}
function forestLights(r, p, L) { // drifting fireflies at the sides, a slow pulse on the moon halo
  for (let k = 0; k < 14; k++) light(r, L, 'firefly', k % 2 ? between(r, 0, 170) : between(r, 1430, W), between(r, 450, 820), between(r, 5, 9), p.accent);
}

function frost(r, p, L) {
  const branch = (x, y, len, ang, depth) => { // a dead tree: binary-ish branching, thinner each level
    if (depth === 0 || len < 7) return '';
    const x2 = x + Math.cos(ang) * len, y2 = y - Math.sin(ang) * len;
    let s = `<line x1='${i(x)}' y1='${i(y)}' x2='${i(x2)}' y2='${i(y2)}' stroke-width='${(depth * 1.3).toFixed(1)}'/>`;
    const n = 2 + (r() < .25 ? 1 : 0);
    for (let k = 0; k < n; k++) s += branch(x2, y2, len * between(r, .6, .78), ang + (r() - .5) * 1.4, depth - 1);
    return s;
  };
  let ridge = `0,${H} 0,590`;
  for (let x = 0; x <= W; x += 70) ridge += ` ${x},${i(between(r, 480, 640))}`;
  ridge += ` ${W},590 ${W},${H}`;
  let trees = '';
  for (let k = 0; k < 6; k++) {
    const x = k < 2 ? between(r, 60, 330) : k < 4 ? between(r, 1270, 1540) : between(r, 400, 1200);
    const len = k < 4 ? between(r, 170, 230) : between(r, 60, 100);
    trees += `<g stroke='#020203' stroke-linecap='round' fill='none'>${branch(x, 840, len, Math.PI / 2 + (r() - .5) * .25, 6)}</g>`;
  }
  let skulls = ''; // on stakes at the sides, piled in the bottom corners
  for (let k = 0; k < 5; k++) {
    const x = k % 2 ? between(r, 30, 150) : between(r, 1450, 1570), h = between(r, 110, 200), s = between(r, .8, 1.2);
    skulls += `<line x1='${i(x)}' y1='840' x2='${i(x)}' y2='${i(840 - h)}' stroke='#17181b' stroke-width='5'/>${use(pickId(r, 'skull', 3), x - 20 * s, 840 - h - 36 * s, s, between(r, -12, 12))}`;
  }
  for (let k = 0; k < 10; k++) skulls += use(pickId(r, 'skull', 3), k < 5 ? between(r, 0, 150) : between(r, 1420, 1560), between(r, 820, 870), between(r, .6, 1), between(r, -70, 70));
  const moonX = between(r, 1000, 1350), moonY = between(r, 150, 260);
  light(r, L, 'pulse', moonX, moonY, 150, p.accent);
  let aurora = '';
  if (r() < .5) for (let k = 0; k < 3; k++) aurora += `<path d='M-100 ${i(between(r, 120, 260))} C 400 ${i(between(r, 40, 200))}, 800 ${i(between(r, 160, 320))}, 1700 ${i(between(r, 60, 220))}' fill='none' stroke='#5de39a' stroke-width='${i(between(r, 30, 70))}' opacity='.16' filter='url(#blur)'/>`;
  return svg(W, H, `<defs>${SKULL('#cfcbbe')}</defs>${sky('#171b21', '#040507')}${blur(W, H, 22)}${aurora}${glow('m', p.accent, .3)}${mist('fog', '#8d98a6', .003, .006, i(r() * 1e6), 1.3)}
    <circle cx='${i(moonX)}' cy='${i(moonY)}' r='260' fill='url(#m)'/><circle cx='${i(moonX)}' cy='${i(moonY)}' r='66' fill='#d5d9dd' opacity='.92'/>
    <polygon points='${ridge}' fill='#0a0c10'/>
    <rect y='380' width='100%' height='520' fill='#8d98a6' filter='url(#fog)' opacity='.3'/>
    <rect y='840' width='100%' height='60' fill='#06070a'/>${trees}${skulls}
    ${dots(r, 110, [0, 0, W, H], p.accent, .7, 2.2)}${vignette}`, SCENE);
}

function factory(r, p, L) {
  const vpX = 800, vpY = 500, cyan = '#38d7e6';
  let grid = `<g stroke='${p.accent}' stroke-width='1' opacity='.22'>`;
  for (let x = -1200; x <= 2800; x += 200) grid += `<line x1='${vpX}' y1='${vpY}' x2='${x}' y2='${H}'/>`;
  for (let y = vpY + 10; y < H; y = vpY + (y - vpY) * 1.32) grid += `<line x1='0' y1='${i(y)}' x2='${W}' y2='${i(y)}'/>`;
  grid += '</g>';
  let lamps = '', pipes = '';
  if (r() < .5) for (let k = 0; k < 4; k++) {
    const x = between(r, 150, 1450), spread = between(r, 110, 170);
    lamps += `<polygon points='${i(x)},40 ${i(x - spread)},${vpY} ${i(x + spread)},${vpY}' fill='url(#cone)'/><circle cx='${i(x)}' cy='40' r='5' fill='#f4efe6' opacity='.9'/>`;
  } else for (let x = between(r, 0, 120); x < W; x += between(r, 160, 240)) { // a row of grimy windows instead, some lit
    const lit = r() < .4;
    lamps += `<rect x='${i(x)}' y='230' width='110' height='150' fill='${lit ? '#3b3a2e' : '#1a1a19'}' stroke='#2c2c2a' stroke-width='4'/><path d='M${i(x + 55)} 230 V380 M${i(x)} 305 H${i(x + 110)}' stroke='#2c2c2a' stroke-width='4'/>${lit ? `<rect x='${i(x)}' y='230' width='110' height='150' fill='#e8d89a' opacity='.25' filter='url(#blur)'/>` : ''}`;
  }
  for (let k = 0; k < 3; k++) {
    const y = i(between(r, 30, 170)), h = i(between(r, 14, 26));
    pipes += `<rect y='${y}' width='100%' height='${h}' fill='url(#pipe)'/>`;
    for (let x = between(r, 0, 300); x < W; x += between(r, 260, 520)) pipes += `<rect x='${i(x)}' y='${y - 3}' width='14' height='${h + 6}' rx='2' fill='#262625' stroke='#3a3a38'/>`;
  }
  // Neon: vertical tubes down both sides, a sign in each top corner, a strip along the floor edge.
  const tubes = [[between(r, 40, 110), p.accent], [between(r, 110, 150), cyan], [between(r, 1450, 1490), cyan], [between(r, 1490, 1560), p.accent]]
    .map(([x, c]) => { const y1 = between(r, 120, 220), y2 = between(r, 620, 760); for (let y = y1; y < y2; y += 90) light(r, L, 'neon', x, y, 70, c); return neon(`M${i(x)} ${i(y1)} V${i(y2)}`, c, 3); }).join('');
  const bolt = (x, y) => neon(`M${x} ${y} l-16 36 h20 l-14 38 l40 -50 h-20 l14 -24z`, cyan, 2.5);
  const ring = (x, y) => neon(`M${x - 40} ${y} a40 40 0 1 0 80 0 a40 40 0 1 0 -80 0 M${x - 22} ${y} a22 22 0 1 0 44 0 a22 22 0 1 0 -44 0`, p.accent, 2.5);
  const signs = (r() < .5 ? [bolt(i(between(r, 60, 120)), 20), ring(i(between(r, 1460, 1540)), 62)] : [ring(i(between(r, 60, 130)), 62), bolt(i(between(r, 1460, 1530)), 20)]).join('');
  const strip = neon(`M0 ${i(between(r, 850, 880))} H${W}`, r() < .5 ? cyan : p.accent, 2);
  return svg(W, H, `${sky('#131312', '#070707')}
    <linearGradient id='cone' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.12'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>
    <linearGradient id='pipe' x2='0' y2='1'><stop offset='0' stop-color='#333332'/><stop offset='.5' stop-color='#1c1c1b'/><stop offset='1' stop-color='#0e0e0d'/></linearGradient>
    ${blur(W, H, 12)}${mist('con', '#9a9a94', .02, .02, i(r() * 1e6), .8, -.3)}
    <pattern id='scan' width='1' height='4' patternUnits='userSpaceOnUse'><rect width='1' height='1' fill='#000' opacity='.35'/></pattern>
    <rect width='100%' height='100%' fill='#9a9a94' filter='url(#con)' opacity='.12'/>
    ${pipes}${lamps}${grid}
    <rect y='${vpY - 3}' width='100%' height='6' fill='${p.accent}' filter='url(#blur)' opacity='.8'/><rect y='${vpY - 1}' width='100%' height='2' fill='${p.accent}'/>
    ${tubes}${signs}${strip}
    <rect width='100%' height='100%' fill='url(#scan)'/>${vignette}`, SCENE);
}


// A candle: cream body with wax drips down one side, flame, warm halo, soot above. Halo needs #blur and #halo.
const candle = (r, x, y, h) => {
  const pillar = r() < .4, w = pillar ? between(r, 22, 32) : between(r, 9, 15), top = y - (pillar ? h * .55 : h);
  if (pillar) h *= .55;
  return `<circle cx='${i(x + w / 2)}' cy='${i(top - 8)}' r='${i(between(r, 90, 140))}' fill='url(#halo)'/>
    <ellipse cx='${i(x + w / 2)}' cy='${i(top - 60)}' rx='14' ry='26' fill='#000' opacity='.5' filter='url(#blur)'/>
    <rect x='${i(x)}' y='${i(top)}' width='${i(w)}' height='${i(h)}' rx='2' fill='#e9dfc4'/>
    <path d='M${i(x + w)} ${i(top + 6)} c3 10 3 ${i(between(r, 16, 34))} 0 ${i(between(r, 24, 44))} c-2 6 -4 2 -4 -4 c0 -8 2 -16 4 -26z' fill='#f3ebd8'/>
    <path d='M${i(x)} ${i(top + 2)} c-2 8 -2 ${i(between(r, 10, 20))} 0 ${i(between(r, 14, 26))} c1 4 3 2 3 -2 c0 -6 -1 -12 -3 -18z' fill='#f3ebd8'/>
    ${pillar ? `<path d='M${i(x + 4)} ${i(top + 2)} c-1 8 1 14 3 18 c2 4 4 0 3 -6 c-1 -5 -2 -8 -3 -12z M${i(x + w * .6)} ${i(top)} c2 6 0 12 2 16 c2 4 4 0 3 -5 c-1 -5 -3 -8 -5 -11z' fill='#f3ebd8'/>` : ''}
    <ellipse cx='${i(x + w / 2)}' cy='${i(top - 9)}' rx='3.5' ry='9' fill='#ffcf6a'/><ellipse cx='${i(x + w / 2)}' cy='${i(top - 7)}' rx='1.5' ry='4' fill='#fff8e0'/>`;
};
const chain = (x, y1, y2, color = '#3a3238') => { // vertical links, every second one seen edge-on
  let s = `<g stroke='${color}' stroke-width='2.5' fill='none'>`;
  for (let y = y1, k = 0; y < y2; y += 13, k++) s += k % 2 ? `<ellipse cx='${i(x)}' cy='${i(y)}' rx='5' ry='8'/>` : `<rect x='${i(x - 1.5)}' y='${i(y - 7)}' width='3' height='14' rx='1.5' fill='${color}'/>`;
  return s + '</g>';
};
const cobweb = (x, y, sx, sy) => { // radial threads from a corner and sagging rings, mirrored by sx, sy
  let s = `<g transform='translate(${x} ${y}) scale(${sx} ${sy})' stroke='#8a8290' stroke-width='1' fill='none' opacity='.35'>`;
  for (let a = 0; a <= 90; a += 15) s += `<line x1='0' y1='0' x2='${i(Math.cos(a * Math.PI / 180) * 150)}' y2='${i(Math.sin(a * Math.PI / 180) * 150)}'/>`;
  for (const rad of [40, 72, 104, 136]) s += `<path d='M${rad} 0 Q${i(rad * .62)} ${i(rad * .62)} 0 ${rad}'/>`;
  return s + '</g>';
};

function dungeon(r, p, L) {
  let wall = '';
  for (let row = 0, y = 0; y < H; row++, y += 50) for (let x = row % 2 ? -50 : 0; x < W; x += 100) {
    const g = i(between(r, 28, 44));
    wall += `<rect x='${x + 2}' y='${y + 2}' width='96' height='46' rx='3' fill='rgb(${g + 6},${g},${g + 10})'/>`;
  }
  let lights = '';
  for (let k = 0; k < 8; k++) { // candle clusters on little shelves at the sides, the floor ones in the bottom corners
    const side = k % 2, x = side ? between(r, 1440, 1540) : between(r, 30, 130), y = k < 6 ? between(r, 260, 720) : 870;
    if (k < 6) lights += `<rect x='${i(x - 14)}' y='${i(y)}' width='60' height='6' fill='#1a1418'/>`;
    for (let c = 0, cx = x; c < 2 + Math.floor(r() * 2); c++, cx += between(r, 16, 26)) { const h = between(r, 30, 95); lights += candle(r, cx, y, h); light(r, L, 'candle', cx + 7, y - h * .8, 110, p.accent); }
  }
  let chains = '';
  for (let k = 0; k < 4; k++) chains += chain(k < 2 ? between(r, 40, 150) : between(r, 1450, 1560), 0, between(r, 120, 260));
  return svg(W, H, `${blur(W, H, 10)}${glow('halo', p.accent, .35)}${mist('grime', '#000000', .006, .012, i(r() * 1e6), 1.4, -.1)}
    <rect width='100%' height='100%' fill='#161218'/>${wall}
    <rect width='100%' height='100%' fill='#000' filter='url(#grime)' opacity='.55'/>
    <ellipse cx='800' cy='-420' rx='1100' ry='560' fill='none' stroke='#0a080c' stroke-width='60' opacity='.9'/>
    <rect y='880' width='100%' height='20' fill='#0a080c'/>
    ${cobweb(0, 0, 1, 1)}${cobweb(W, 0, -1, 1)}${chains}${lights}${vignette}`, SCENE);
}

function slaughterhouse(r, p, L) {
  for (let k = 0; k < 16; k++) light(r, L, 'ember', k % 2 ? between(r, 0, 170) : between(r, 1430, W), between(r, 700, 880), between(r, 3, 6), '#ff7a3a');
  let hooks = '';
  for (let k = 0; k < 6; k++) {
    const x = k < 3 ? between(r, 30, 150) : between(r, 1450, 1570), y = between(r, 90, 300);
    hooks += chain(x, 0, y, '#4a4440') + `<path d='M${i(x)} ${i(y)} c0 16 -18 16 -18 0 c0 -9 7 -12 10 -7' fill='none' stroke='#8a8a86' stroke-width='4' stroke-linecap='round'/>`;
  }
  let blood = '';
  for (let k = 0; k < 14; k++) { // splatters at the sides, pools along the floor
    const x = k < 7 ? between(r, 0, 170) : between(r, 1430, W), y = between(r, 300, 860), n = 3 + Math.floor(r() * 5);
    for (let b = 0; b < n; b++) blood += `<circle cx='${i(x + between(r, -30, 30))}' cy='${i(y + between(r, -30, 30))}' r='${between(r, 2, 11).toFixed(1)}' fill='${p.accent}' opacity='.55'/>`;
    blood += `<rect x='${i(x)}' y='${i(y)}' width='3' height='${i(between(r, 20, 80))}' fill='${p.accent}' opacity='.55'/>`;
  }
  for (let k = 0; k < 5; k++) blood += `<ellipse cx='${i(r() * W)}' cy='${i(between(r, 860, 895))}' rx='${i(between(r, 60, 160))}' ry='${i(between(r, 6, 14))}' fill='${p.accent}' opacity='.35'/>`;
  let bones = '';
  for (let k = 0; k < 9; k++) bones += use(pickId(r, 'skull', 3), k < 5 ? between(r, 0, 150) : between(r, 1420, 1560), between(r, 815, 865), between(r, .6, 1), between(r, -80, 80));
  let wire = `<path d='M0 34 Q400 20 800 34 T1600 34' fill='none' stroke='#6a6058' stroke-width='2'/>`;
  for (let x = 20; x < W; x += 46) wire += `<path d='M${x - 5} ${i(34 - 7)} l10 14 M${x + 5} ${i(34 - 7)} l-10 14' stroke='#8a8078' stroke-width='1.5'/>`;
  return svg(W, H, `<defs>${SKULL('#b9a89a')}</defs>${sky('#1c0f0f', '#070404')}${mist('rust', '#7a3b1e', .002, .02, i(r() * 1e6), 1.5, -.25)}
    <rect width='100%' height='100%' fill='#7a3b1e' filter='url(#rust)' opacity='.45'/>
    <rect y='860' width='100%' height='40' fill='#0c0606'/>${blood}${bones}${wire}${hooks}
    ${dots(r, 30, [0, 0, W, 300], '#000', 1, 2.2)}${vignette}`, SCENE);
}

function castle(r, p, L) {
  let towers = '';
  for (let x = -40; x < W; x += between(r, 90, 220)) { // towers and the wall between them, crenellated
    const w = between(r, 60, 140), h = between(r, 140, 320);
    towers += `<rect x='${i(x)}' y='${i(H - h)}' width='${i(w)}' height='${i(h)}' fill='#050814'/>`;
    for (let c = x; c < x + w - 8; c += 20) towers += `<rect x='${i(c)}' y='${i(H - h - 14)}' width='11' height='16' fill='#050814'/>`;
    towers += `<rect x='${i(x)}' y='${i(H - 90)}' width='${i(w + 220)}' height='90' fill='#050814'/>`;
    if (r() < .4) { towers += `<rect x='${i(x + w / 2 - 4)}' y='${i(H - h + 30)}' width='8' height='14' rx='4' fill='${p.accent}' opacity='.7'/>`; light(r, L, 'candle', x + w / 2, H - h + 37, 28, p.accent); } // a lit window
  }
  let banners = '';
  for (let k = 0; k < 4; k++) {
    const x = k < 2 ? between(r, 40, 150) : between(r, 1450, 1560), h = between(r, 150, 220);
    banners += `<polygon points='${i(x - 26)},0 ${i(x + 26)},0 ${i(x + 26)},${i(h)} ${i(x)},${i(h + 36)} ${i(x - 26)},${i(h)}' fill='#6e1a2c' stroke='${p.accent}' stroke-width='3'/>
      <circle cx='${i(x)}' cy='${i(h * .45)}' r='14' fill='none' stroke='${p.accent}' stroke-width='3'/><rect x='${i(x - 30)}' y='0' width='60' height='8' fill='${p.accent}'/>`;
  }
  const dragon = (x, y, s, flip) => `<path transform='translate(${i(x)} ${i(y)}) scale(${flip * s} ${s})' fill='#040610' d='M0 60 c20 -6 36 -4 50 4 c-4 -28 10 -50 40 -58 c-10 14 -10 30 0 42 c22 -4 44 2 60 14 c-20 -2 -34 2 -44 10 c14 10 30 12 50 8 l10 6 c-24 8 -46 4 -62 -8 c6 20 2 40 -14 54 c2 -20 -4 -36 -18 -46 c-18 10 -40 10 -60 0 c20 -4 32 -10 38 -18 c-22 2 -40 -2 -50 -8z'/>`;
  const moonX = between(r, 200, 1400), storm = r() < .4;
  const boltX = between(r, 100, 1500);
  if (storm) light(r, L, 'flash', boltX, 120, 700, '#fff6d0');
  return svg(W, H, `${sky(storm ? '#0d1226' : '#122050', '#060a1c')}${glow('m', '#fff3c4', .35)}${blur(W, H, 16)}
    ${storm ? `${mist('cloud', '#3a4466', .003, .006, i(r() * 1e6), 1.6, -.2)}<rect width='100%' height='520' fill='#3a4466' filter='url(#cloud)' opacity='.6'/>
      <path d='M${i(boltX)} 0 l-40 200 h50 l-70 260' fill='none' stroke='#fff6d0' stroke-width='14' opacity='.5' filter='url(#blur)'/><path d='M${i(boltX)} 0 l-40 200 h50 l-70 260' fill='none' stroke='#fff6d0' stroke-width='3'/>`
      : `<circle cx='${i(moonX)}' cy='150' r='220' fill='url(#m)'/><circle cx='${i(moonX)}' cy='150' r='54' fill='#f4ecd2'/>`}
    ${dots(r, 120, [0, 0, W, 600], '#fff3c4', .6, 1.8)}
    ${dragon(between(r, 30, 220), between(r, 20, 160), between(r, .7, 1.1), r() < .5 ? 1 : -1)}${dragon(between(r, 1350, 1500), between(r, 160, 360), between(r, .5, .8), r() < .5 ? 1 : -1)}
    ${towers}${banners}${vignette}`, SCENE);
}

function garage(r, p) {
  const inks = ['#e8e4d8', p.accent, '#ff3d3d', '#3d9bff', '#ffd23d', '#111111'];
  let bricks = '';
  for (let row = 0, y = 0; y < H; row++, y += 40) for (let x = row % 2 ? -40 : 0; x < W; x += 80) {
    const g = i(between(r, 34, 48));
    bricks += `<rect x='${x + 2}' y='${y + 2}' width='76' height='36' fill='rgb(${g + 8},${g},${g + 2})'/>`;
  }
  let stickers = '';
  for (let k = 0; k < 16; k++) { // rotated labels with bars for text, at the sides and the top band
    const x = k < 6 ? between(r, 0, 140) : k < 12 ? between(r, 1440, 1580) : between(r, 200, 1400), y = k < 12 ? between(r, 120, 820) : between(r, 0, 90);
    const fill = inks[Math.floor(r() * inks.length)], ink = fill === '#111111' || fill === '#ff3d3d' || fill === '#3d9bff' ? '#f4f1e8' : '#111';
    const w = between(r, 70, 120), h = between(r, 34, 60);
    const shape = r();
    const body = shape < .5 ? `<rect x='${i(-w / 2)}' y='${i(-h / 2)}' width='${i(w)}' height='${i(h)}' rx='5'/>`
      : shape < .8 ? `<circle r='${i(h * .8)}'/>`
      : `<polygon points='${Array.from({ length: 24 }, (_, q) => { const rad = q % 2 ? h * .95 : h * .7, a = q * Math.PI / 12; return `${i(Math.cos(a) * rad)},${i(Math.sin(a) * rad)}`; }).join(' ')}'/>`; // a burst
    const text = shape < .5 ? `<rect x='${i(-w / 2 + 10)}' y='${i(-h / 2 + 10)}' width='${i(w * .6)}' height='${i(h * .3)}'/><rect x='${i(-w / 2 + 10)}' y='${i(h / 2 - 16)}' width='${i(w * .4)}' height='6'/>`
      : `<rect x='${i(-h * .45)}' y='-6' width='${i(h * .9)}' height='12'/><rect x='${i(-h * .3)}' y='10' width='${i(h * .6)}' height='5'/>`;
    stickers += `<g transform='translate(${i(x)} ${i(y)}) rotate(${i(between(r, -28, 28))})'><g fill='${fill}' stroke='#000' stroke-width='1' opacity='.95'>${body}</g><g fill='${ink}'>${text}</g></g>`;
  }
  let paint = '';
  for (let k = 0; k < 5; k++) { // spray splats with drips
    const x = k < 3 ? between(r, 10, 150) : between(r, 1450, 1580), y = between(r, 200, 760), c = k % 2 ? p.accent : '#ff3d3d';
    paint += `<circle cx='${i(x)}' cy='${i(y)}' r='${i(between(r, 30, 60))}' fill='${c}' opacity='.55' filter='url(#blur)'/>`;
    for (let d = 0; d < 4; d++) paint += `<rect x='${i(x + between(r, -30, 30))}' y='${i(y)}' width='4' height='${i(between(r, 20, 90))}' rx='2' fill='${c}' opacity='.8'/>`;
  }
  let scrawl = '';
  for (let k = 0; k < 8; k++) {
    const x = k < 4 ? between(r, 0, 120) : between(r, 1440, 1560), y = k < 2 ? between(r, 0, 100) : between(r, 100, 850);
    scrawl += `<path d='M${i(x)} ${i(y)} c${i(between(r, 10, 40))} ${i(between(r, -30, 30))} ${i(between(r, 20, 60))} ${i(between(r, -30, 30))} ${i(between(r, 40, 90))} ${i(between(r, -20, 20))}' fill='none' stroke='#f4f1e8' stroke-width='3' stroke-linecap='round' opacity='.8'/>`;
  }
  return svg(W, H, `${blur(W, H, 8)}${mist('dirt', '#000000', .01, .01, i(r() * 1e6), 1.2, -.3)}
    <rect width='100%' height='100%' fill='#1a1618'/>${bricks}<rect width='100%' height='100%' fill='#000' filter='url(#dirt)' opacity='.5'/>
    <rect y='870' width='100%' height='30' fill='#0e0c0d'/><path d='M0 885 C 300 860 500 900 800 880 S 1300 860 1600 885' fill='none' stroke='#000' stroke-width='6'/>
    ${paint}${scrawl}${stickers}${vignette}`, SCENE);
}

function lattice(r, p, L) {
  const pts = Array.from({ length: 70 }, () => [r() * W, r() * H]);
  let mesh = `<g stroke='${p.accent}' stroke-width='1' opacity='.14'>`;
  for (const [x, y] of pts) { // each point to its three nearest
    const near = pts.map(q => [Math.hypot(q[0] - x, q[1] - y), q]).sort((a, b) => a[0] - b[0]).slice(1, 4);
    for (const [, q] of near) mesh += `<line x1='${i(x)}' y1='${i(y)}' x2='${i(q[0])}' y2='${i(q[1])}'/>`;
  }
  mesh += '</g>';
  for (const [x, y] of pts) { mesh += `<circle cx='${i(x)}' cy='${i(y)}' r='${between(r, 1.2, 3).toFixed(1)}' fill='${p.accent}' opacity='${between(r, .2, .8).toFixed(2)}'/>`; if (r() < .2 && (x < 160 || x > 1440 || y < 110 || y > 790)) light(r, L, 'pulse', x, y, 16, p.accent); }
  const cube = (x, y, s, a) => { // an isometric wireframe cube, back edges dashed
    const c = Math.cos(Math.PI / 6) * s, h = s / 2;
    return `<g transform='translate(${i(x)} ${i(y)}) rotate(${i(a)})' fill='none' stroke='${p.accent}' stroke-width='1.5' opacity='.7'>
      <polygon points='0,${i(-s)} ${i(c)},${i(-h)} ${i(c)},${i(h)} 0,${i(s)} ${i(-c)},${i(h)} ${i(-c)},${i(-h)}'/><path d='M0 0 L0 ${i(s)} M0 0 L${i(c)} ${i(-h)} M0 0 L${i(-c)} ${i(-h)}'/>
      <path d='M0 ${i(-s)} L0 0 M${i(c)} ${i(h)} L0 0 M${i(-c)} ${i(h)} L0 0' stroke-dasharray='4 5' opacity='.5'/></g>`;
  };
  let solids = '';
  for (let k = 0; k < 6; k++) solids += cube(k < 3 ? between(r, 40, 140) : between(r, 1460, 1560), between(r, 120, 760), between(r, 28, 60), between(r, -20, 20));
  let wave = `M0 860`; // a waveform whose frequency keeps changing: odd time
  for (let x = 0; x <= W; x += 8) wave += ` L${x} ${i(860 + Math.sin(x / between(r, 18, 22)) * Math.sin(x / 140) * 22)}`;
  return svg(W, H, `${sky('#0d1a21', '#050c0e')}${mesh}${solids}
    <path d='${wave}' fill='none' stroke='${p.accent}' stroke-width='1.5' opacity='.7'/><line x1='0' y1='860' x2='${W}' y2='860' stroke='${p.accent}' stroke-width='.5' opacity='.3'/>${vignette}`, SCENE);
}

function stage(r, p, L) { // steel, the default pack: a dark stage, spotlights, amp stacks at the sides, cables, haze
  let spots = '';
  for (let k = 0; k < 4; k++) {
    const x = between(r, 120, 1480), spread = between(r, 120, 200), c = k % 2 ? p.accent : '#f4efe6';
    spots += `<polygon points='${i(x)},30 ${i(x - spread)},${H} ${i(x + spread)},${H}' fill='url(#beam)'/><rect x='${i(x - 14)}' y='8' width='28' height='26' rx='3' fill='#1a1c1e' stroke='#2c2f33'/><circle cx='${i(x)}' cy='34' r='7' fill='${c}'/>`;
    light(r, L, 'pulse', x, 34, 110, c);
  }
  const stack = (x, flip) => { // a head with a knob row on two cabs with grilles and a plate
    let g = `<g transform='translate(${i(x)} 0) scale(${flip} 1)'>`;
    for (let k = 0; k < 2; k++) g += `<rect x='0' y='${560 + k * 150}' width='150' height='140' rx='4' fill='#111214' stroke='#2a2d31' stroke-width='3'/><rect x='12' y='${572 + k * 150}' width='126' height='116' fill='url(#grille)'/><rect x='56' y='${640 + k * 150}' width='38' height='10' rx='2' fill='#c9ccd0'/>`;
    g += `<rect x='0' y='500' width='150' height='56' rx='4' fill='#111214' stroke='#2a2d31' stroke-width='3'/><rect x='10' y='508' width='130' height='40' rx='2' fill='#1c1e21'/>`;
    for (let k = 0; k < 7; k++) g += `<circle cx='${22 + k * 17}' cy='528' r='5' fill='#3a3d42' stroke='#0a0b0c'/>`;
    g += `<circle cx='140' cy='528' r='2.5' fill='#ff3b2f'/></g>`;
    light(r, L, 'pulse', flip > 0 ? x + 140 : x - 140, 528, 8, '#ff3b2f');
    return g;
  };
  const wedge = x => `<polygon points='${i(x)},870 ${i(x + 120)},870 ${i(x + 110)},810 ${i(x + 30)},800' fill='#111214' stroke='#2a2d31' stroke-width='3'/><polygon points='${i(x + 40)},860 ${i(x + 100)},860 ${i(x + 96)},816 ${i(x + 46)},810' fill='url(#grille)'/>`;
  let cables = '';
  for (let k = 0; k < 4; k++) cables += `<path d='M${i(between(r, -100, 300))} ${i(between(r, 850, 895))} C ${i(between(r, 300, 700))} ${i(between(r, 820, 900))}, ${i(between(r, 900, 1300))} ${i(between(r, 820, 900))}, ${i(between(r, 1300, 1700))} ${i(between(r, 850, 895))}' fill='none' stroke='#000' stroke-width='5'/>`;
  let boards = `<rect y='840' width='100%' height='60' fill='#0e0f10'/>`;
  for (let x = between(r, 0, 40); x < W; x += between(r, 50, 90)) boards += `<rect x='${i(x)}' y='840' width='2' height='60' fill='#050506'/>`;
  return svg(W, H, `${sky('#121416', '#050506')}${mist('haze', '#9aa0a6', .004, .004, i(r() * 1e6), 1.1, -.25)}
    <linearGradient id='beam' x2='0' y2='1'><stop offset='0' stop-color='#fff' stop-opacity='.16'/><stop offset='1' stop-color='#fff' stop-opacity='0'/></linearGradient>
    <pattern id='grille' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='6' height='6' fill='#1a1c1f'/><rect width='3' height='6' fill='#0b0c0d'/></pattern>
    <rect width='100%' height='100%' fill='#9aa0a6' filter='url(#haze)' opacity='.2'/>
    ${spots}${boards}${stack(5, 1)}${stack(1595, -1)}${wedge(between(r, 160, 240))}${wedge(between(r, 1200, 1280))}${cables}${vignette}`, SCENE);
}

// ----------------------------------------------------------------------------------------- ornaments
// 9-slice border images, 120 x 120, 24 px slices: everything is drawn inside the 22 px rim the panels keep clear.
// One corner drawn and mirrored to the others, one edge piece drawn and rotated; a 2 px rule along the edges.

const corners = (piece, edge, rule, defs = '') => svg(120, 120,
  `<defs>${defs}</defs><rect x='1' y='1' width='118' height='118' fill='none' stroke='${rule}' stroke-width='2'/><g id='c'>${piece}</g><g id='e'>${edge}</g>
   <use href='#c' transform='translate(120 0) scale(-1 1)'/><use href='#c' transform='translate(0 120) scale(1 -1)'/><use href='#c' transform='translate(120 120) scale(-1 -1)'/>
   <use href='#e' transform='translate(0 120) scale(1 -1)'/><use href='#e' transform='translate(0 120) rotate(-90)'/><use href='#e' transform='translate(120 0) rotate(90)'/>`);
const iron = () => corners(
  `<path d='M3 22 L3 3 L22 3' fill='none' stroke='#15120e' stroke-width='5' stroke-linecap='round'/>
   <path d='M3 22 L3 3 L22 3' fill='none' stroke='#6b6256' stroke-width='1.2' stroke-linecap='round'/>
   <path d='M4 20 C 4 9, 11 9, 13 14 C 14 18, 7 19, 8 14 M20 4 C 9 4, 9 11, 14 13 C 18 14, 19 7, 14 8' fill='none' stroke='#1b1713' stroke-width='3' stroke-linecap='round'/>
   <g fill='#8a8277' stroke='#0d0b09' stroke-width='.6'><circle cx='6' cy='6' r='1.8'/><circle cx='19' cy='5' r='1.5'/><circle cx='5' cy='19' r='1.5'/></g>`,
  `${use('cone0', 52, 1, .7)}<g fill='#8a8277' stroke='#0d0b09' stroke-width='.6'><circle cx='38' cy='5' r='1.5'/><circle cx='82' cy='5' r='1.5'/></g>`,
  '#1b1713', CONE('#2a1c10', '#5a4126'));
const skulls = () => corners(use('skull2', -1, 3, .52), `${use('bone', 60, 10, .9, 0)}`, '#4a4c50', `${SKULL('#d8d3c4')}${BONE('#d8d3c4')}`);
const plates = () => {
  let rivets = '';
  for (const c of [36, 60, 84]) rivets += `<circle cx='${c}' cy='5' r='2'/>`;
  return corners(
    `<rect x='2' y='2' width='20' height='20' rx='1.5' fill='#3b3c3a' stroke='#6c6e6a'/>
     <polygon points='12,6 17.2,9 17.2,15 12,18 6.8,15 6.8,9' fill='#8c8f8a' stroke='#1c1d1c'/><circle cx='12' cy='12' r='2.2' fill='#1c1d1c'/>`,
    `<g fill='#8c8f8a' stroke='#1c1d1c' stroke-width='.8'>${rivets}</g>${neon('M30 15 H90', '#ff5a1f', 1.6)}`,
    '#55575a', blur(120, 120, 3));
};

const rings = () => { // doom: an iron ring in each corner, a wax drip and chain links along the edges
  let links = '';
  for (let x = 30, k = 0; x < 92; x += 11, k++) links += k % 2 ? `<ellipse cx='${x}' cy='11' rx='5' ry='3'/>` : `<rect x='${x - 1.5}' y='8' width='3' height='6' rx='1.5' fill='#2a2228'/>`;
  return corners(`<circle cx='11' cy='11' r='7' fill='none' stroke='#120f12' stroke-width='3.5'/><circle cx='11' cy='11' r='7' fill='none' stroke='#5a4e58' stroke-width='1'/>`,
    `<g fill='none' stroke='#2a2228' stroke-width='2'>${links}</g><path d='M59 1 v6 q0 4 2 4 q2 0 2 -4 v-6z' fill='#e9dfc4' opacity='.8'/>`, '#1a1418');
};
const wire = () => { // death: barbed wire along the edges, a knot of it in the corners
  let barbs = '';
  for (let x = 32; x < 92; x += 18) barbs += `<path d='M${x - 4} 7 l8 8 M${x + 4} 7 l-8 8'/>`;
  return corners(`<path d='M3 20 C3 8 8 3 20 3 M6 16 C7 9 10 6 16 6' fill='none' stroke='#8a8078' stroke-width='1.8'/><path d='M8 12 l6 6 M14 12 l-6 6 M4 8 l5 5' stroke='#8a8078' stroke-width='1.5'/>`,
    `<path d='M24 11 H96' stroke='#6a6058' stroke-width='1.6'/><g stroke='#8a8078' stroke-width='1.4'>${barbs}</g>`, '#3a2222');
};
const filigree = () => corners( // power: gold scrollwork corners, beads along the edges
  `<g fill='none' stroke='#e3cf8a' stroke-width='1.6' stroke-linecap='round'><path d='M3 21 C3 8 8 3 21 3'/><path d='M7 17 C7 10 10 7 17 7 c4 0 5 4 2 5 c-3 1 -4 -2 -1 -3'/><path d='M5 20 c0 -4 2 -5 4 -3 M20 5 c-4 0 -5 2 -3 4'/></g>`,
  `<g fill='#e3cf8a'>${[34, 46, 58, 70, 82].map(x => `<circle cx='${x}' cy='6' r='1.6'/>`).join('')}</g><path d='M28 6 H92' stroke='#e3cf8a' stroke-width='.6' opacity='.6'/>`, '#3a4470');
const tape = () => corners( // thrash: duct tape across the corners, a sticker on each edge
  `<path d='M-2 16 L16 -2 L26 8 L8 26z' fill='#8d8d89' opacity='.92'/><g stroke='#777771' stroke-width='.5'><path d='M2 20 L20 2 M5 23 L23 5 M-1 17 L17 -1'/></g>`,
  `<path d='M30 12 c8 -8 14 4 22 -2 s12 8 20 0 s10 -6 18 2' fill='none' stroke='#f4f1e8' stroke-width='2' stroke-linecap='round' opacity='.8'/>`, '#1a1b1d');
const brackets = () => corners( // prog: nested thin L brackets, ruler ticks on the edges
  `<g fill='none' stroke='#35e0e0' stroke-width='1.4'><path d='M3 21 V3 H21'/><path d='M8 16 V8 H16' opacity='.6'/></g>`,
  `<g stroke='#35e0e0' stroke-width='1' opacity='.7'>${[30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90].map((x, k) => `<path d='M${x} 2 v${k % 5 ? 4 : 7}'/>`).join('')}</g>`, '#1f3a44');

const studs = () => { // steel: a pyramid stud in each corner, a row of smaller ones along the edges
  const stud = (x, y, sz) => `<polygon points='${x},${y - sz} ${x + sz},${y} ${x},${y + sz} ${x - sz},${y}' fill='#8a8f95' stroke='#0a0b0c' stroke-width='.8'/><polygon points='${x},${y - sz} ${x + sz},${y} ${x},${y}' fill='#c9ccd0'/><polygon points='${x},${y} ${x + sz},${y} ${x},${y + sz}' fill='#4a4f55'/>`;
  return corners(stud(11, 11, 9), [36, 60, 84].map(x => stud(x, 8, 5)).join(''), '#4a4f55');
};

// ----------------------------------------------------------------------------------------- cap faces
// The fader cap drawn at 44 x 36 in the pack's cap colour, stretched to fit (preserveAspectRatio none); the lever
// cap is the same drawing turned on its side. Each face draws its own grip, so the CSS grip line is off.

const faces = (p, motif) => {
  const body = `<rect width='44' height='36' fill='${p.cap}'/><rect width='44' height='14' fill='#fff' opacity='.22'/><rect y='22' width='44' height='14' fill='#000' opacity='.28'/>${motif}<rect x='.5' y='.5' width='43' height='35' fill='none' stroke='#000' opacity='.45'/>`;
  const attrs = `preserveAspectRatio='none'`;
  return { 'cap-face': svg(44, 36, body, attrs), 'lever-face': svg(36, 44, `<g transform='translate(36 0) rotate(90)'>${body}</g>`, attrs) };
};
const FACES = {
  steel: p => faces(p, `<path d='M4 13 H40 M4 18 H40 M4 23 H40' stroke='#000' stroke-width='1.6' opacity='.55'/><path d='M4 14.5 H40 M4 19.5 H40 M4 24.5 H40' stroke='#fff' stroke-width='.8' opacity='.35'/>`),
  folk: p => faces(p, `<path d='M2 8 Q 22 11 42 7 M2 29 Q 22 26 42 30' fill='none' stroke='#5a3c1e' stroke-width='1' opacity='.5'/><rect y='0' width='44' height='4' fill='#2a2522'/><rect y='32' width='44' height='4' fill='#2a2522'/><circle cx='6' cy='2' r='1' fill='#8a8277'/><circle cx='38' cy='2' r='1' fill='#8a8277'/><circle cx='6' cy='34' r='1' fill='#8a8277'/><circle cx='38' cy='34' r='1' fill='#8a8277'/><path d='M22 29 V9 M22 17 L15 10 M22 17 L29 10' fill='none' stroke='#2a1c10' stroke-width='2.2' stroke-linecap='round'/>`),
  black: p => faces(p, `<ellipse cx='15' cy='15' rx='4.5' ry='5' fill='#050506'/><ellipse cx='29' cy='15' rx='4.5' ry='5' fill='#050506'/><path d='M22 19 l-2.5 5 h5z' fill='#050506'/><path d='M14 28 v5 M18 28 v5 M22 28 v5 M26 28 v5 M30 28 v5 M12 28 H32' stroke='#050506' stroke-width='1.2'/><path d='M4 3 l4 6 l-2 5' fill='none' stroke='#050506' stroke-width='.8'/>`),
  industrial: p => faces(p, `<pattern id='k' width='4' height='4' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='1.6' height='4' fill='#000' opacity='.35'/></pattern><rect width='44' height='36' fill='url(#k)'/><rect x='4' y='16' width='36' height='4' rx='1' fill='${p.accent}' opacity='.45'/><rect x='6' y='17' width='32' height='2' fill='${p.accent}'/><polygon points='6,4 9,5.5 9,8.5 6,10 3,8.5 3,5.5' fill='#5a5d60' stroke='#111'/><polygon points='38,26 41,27.5 41,30.5 38,32 35,30.5 35,27.5' fill='#5a5d60' stroke='#111'/>`),
  doom: p => faces(p, `<rect width='44' height='36' fill='#000' opacity='.35'/><path d='M0 0 H44 V6 C40 6 38 14 36 10 C34 6 33 20 30 14 C27 8 26 18 22 12 C19 7 17 22 14 15 C11 9 9 16 6 11 C4 8 2 14 0 9z' fill='#e9dfc4'/><path d='M8 6 c2 8 -1 14 1 20 c1 3 3 1 2 -4 c-1 -6 -1 -10 -3 -16z M30 8 c1 6 -1 10 1 14 c1 2 3 0 2 -3 c-1 -5 -1 -7 -3 -11z' fill='#f3ebd8'/>`),
  death: p => faces(p, `<circle cx='9' cy='9' r='6' fill='#4a2a18' opacity='.6'/><circle cx='36' cy='28' r='8' fill='#4a2a18' opacity='.5'/><circle cx='30' cy='6' r='3' fill='#4a2a18' opacity='.5'/><circle cx='22' cy='18' r='5' fill='#3b3c3a' stroke='#111'/><path d='M19 18 H25 M22 15 V21' stroke='#111' stroke-width='1.2'/><path d='M2 30 C 10 26 20 33 30 29 S 42 31 44 30 V36 H2z' fill='${p.accent}' opacity='.6'/>`),
  power: p => faces(p, `<rect x='3' y='3' width='38' height='30' fill='none' stroke='#7a5a1a' stroke-width='1'/><path d='M3 10 C3 4 5 3 10 3 M34 3 C39 3 41 4 41 10 M3 26 C3 32 5 33 10 33 M34 33 C39 33 41 32 41 26' fill='none' stroke='#7a5a1a' stroke-width='1.4'/><ellipse cx='22' cy='18' rx='7' ry='6' fill='#a3122a' stroke='#5a0a18'/><ellipse cx='20' cy='16' rx='2.5' ry='1.6' fill='#ff8a9a' opacity='.8'/>`),
  thrash: p => faces(p, `<path d='M-4 24 L30 -4 L40 4 L6 32z' fill='#8d8d89' opacity='.9'/><path d='M0 26 L32 0 M4 30 L36 4' stroke='#777771' stroke-width='.5'/><path d='M26 20 l12 12 M38 20 l-12 12' stroke='#111' stroke-width='2.4' stroke-linecap='round'/><rect x='4' y='26' width='12' height='7' rx='1' fill='${p.accent}' stroke='#000' stroke-width='.6'/>`),
  prog: p => faces(p, `<rect width='44' height='36' fill='#000' opacity='.45'/><path d='M4 18 H40' stroke='${p.accent}' stroke-width='1.2'/><polygon points='22,11 28,14.5 28,21.5 22,25 16,21.5 16,14.5' fill='none' stroke='${p.accent}' stroke-width='1'/><path d='M8 14 V22 M36 14 V22' stroke='${p.accent}' stroke-width='1' opacity='.6'/>`),
};

// ------------------------------------------------------------------------------------------- emblems
// A sigil watermarked into the output U, 160 x 160, drawn in the pack label colour at low opacity.

const emblem = (body, color) => svg(160, 160, `<g fill='none' stroke='${color}' stroke-width='6' stroke-linecap='round' opacity='.3' transform='translate(80 80)'>${body}</g>`);
const triskele = color => emblem([0, 120, 240].map(a => `<path d='M0 0 C 0 -36 44 -36 44 -6 C 44 16 24 22 16 10 C 12 2 22 -6 28 0' transform='rotate(${a})'/>`).join(''), color);
const skullSigil = color => svg(160, 160, `<defs>${SKULL(color)}</defs><g opacity='.3'>${use('skull2', 20, 24, 3)}</g>`);
const pick = color => emblem(`<path d='M0 -62 C 42 -62 58 -30 50 2 C 42 34 18 58 0 66 C -18 58 -42 34 -50 2 C -58 -30 -42 -62 0 -62z'/><path d='M0 -40 C 26 -40 36 -20 30 2 C 25 22 12 36 0 42 C -12 36 -25 22 -30 2 C -36 -20 -26 -40 0 -40z' opacity='.5'/>`, color);
const cog = color => {
  let pts = '';
  for (let k = 0; k < 24; k++) { const rad = k % 2 ? 62 : 50, a = k * Math.PI / 12; pts += `${i(Math.cos(a) * rad)},${i(Math.sin(a) * rad)} `; }
  return emblem(`<polygon points='${pts}'/><circle r='22'/><circle r='36' stroke-dasharray='8 10'/>`, color);
};

const candleSigil = color => emblem(`<rect x='-12' y='-20' width='24' height='60' rx='3'/><path d='M12 -14 c6 14 6 24 0 34' /><path d='M0 -56 c-10 14 -10 24 0 32 c10 -8 10 -18 0 -32z' fill='${color}' fill-opacity='.4'/><path d='M-30 40 H30' />`, color);
const hookSigil = color => emblem(`<path d='M0 -60 V-10 c0 40 -44 40 -44 0 c0 -20 16 -26 24 -16' /><path d='M-8 -62 h16' /><circle cx='-22' cy='34' r='6' fill='${color}' fill-opacity='.4'/>`, color);
const crown = color => emblem(`<path d='M-56 30 L-56 -20 L-28 6 L0 -40 L28 6 L56 -20 L56 30z'/><path d='M-56 44 H56'/><circle cx='0' cy='-44' r='5'/><circle cx='-56' cy='-24' r='4'/><circle cx='56' cy='-24' r='4'/><circle cx='0' cy='18' r='6' fill='${color}' fill-opacity='.4'/>`, color);
const boltSigil = color => emblem(`<path d='M10 -64 L-30 8 H-2 L-14 64 L34 -16 H6z' fill='${color}' fill-opacity='.25'/>`, color);
const cubeSigil = color => emblem(`<polygon points='0,-60 52,-30 52,30 0,60 -52,30 -52,-30'/><path d='M0 0 V60 M0 0 L52 -30 M0 0 L-52 -30'/><path d='M0 -60 V0 M52 30 L0 0 M-52 30 L0 0' stroke-dasharray='6 8' opacity='.6'/>`, color);

// ------------------------------------------------------------------------------------------ textures

const bark = (r, seed) => relief(256, 256, { fx: .04, fy: .012, oct: 4, scale: 8, lo: .1, hi: .7, seed });
const wax = (r, seed) => relief(64, 64, { fx: .06, fy: .25, oct: 2, scale: 4, lo: .3, hi: .8, shine: 24, seed });
const waxSoft = (r, seed) => relief(64, 64, { fx: .06, fy: .25, oct: 2, scale: 2, lo: .4, hi: .68, shine: 24, seed });
const gold = (r, seed) => relief(64, 64, { fx: .5, fy: .03, oct: 2, scale: 2, lo: .3, hi: .8, shine: 16, seed });
const bone = (r, seed) => relief(64, 64, { fx: .12, fy: .12, oct: 3, scale: 2, lo: .35, hi: .8, seed });
const oak = (r, seed) => grain(512, 512, { fx: .08, fy: .004, lo: .18, hi: .82, seed,
  more: [0, i(between(r, 150, 200)), i(between(r, 320, 380))].map(x => `<rect x='${x}' width='3' height='100%' fill='#000' opacity='.35'/>`).join('') });
const steel = (r, seed) => grain(512, 512, { fx: .003, fy: .5, oct: 2, lo: .3, hi: .74, seed,
  more: Array.from({ length: 5 }, () => `<line x1='${i(r() * 512)}' y1='${i(r() * 512)}' x2='${i(r() * 512)}' y2='${i(r() * 512)}' stroke='#fff' stroke-width='1' opacity='.18'/>`).join('') });
const marble = (r, seed) => grain(512, 512, { type: 'turbulence', fx: .012, fy: .012, lo: .2, hi: .78, seed });
const knurl = () => svg(64, 64, `<pattern id='p' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='6' height='6' fill='#848484'/><rect width='2' height='6' fill='#5e5e5e'/></pattern>
  <pattern id='q' width='6' height='6' patternUnits='userSpaceOnUse' patternTransform='rotate(-45)'><rect width='2' height='6' fill='#5e5e5e'/></pattern>
  <rect width='64' height='64' fill='url(#p)'/><rect width='64' height='64' fill='url(#q)' opacity='.6'/>`);

const stone = (r, seed) => { // blocks with mortar
  let m = '';
  for (let y = 0; y < 512; y += 64) { m += `<rect y='${y}' width='512' height='3' fill='#000' opacity='.5'/>`; for (let x = (y / 64) % 2 ? 64 : 0; x < 512; x += 128) m += `<rect x='${x}' y='${y}' width='3' height='64' fill='#000' opacity='.5'/>`; }
  return relief(512, 512, { fx: .02, fy: .02, oct: 4, scale: 5, lo: .22, hi: .74, seed, more: m });
};
const rust = (r, seed) => relief(512, 512, { fx: .015, fy: .015, oct: 4, scale: 7, lo: .12, hi: .8, seed,
  more: Array.from({ length: 12 }, () => `<circle cx='${i(r() * 512)}' cy='${i(r() * 512)}' r='${i(between(r, 4, 22))}' fill='#000' opacity='.3'/>`).join('') });
const brocade = (r, seed) => grain(512, 512, { fx: .3, fy: .3, oct: 2, lo: .42, hi: .6, seed,
  more: `<pattern id='d' width='24' height='24' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='24' height='24' fill='none' stroke='#fff' stroke-width='1' opacity='.14'/></pattern><rect width='512' height='512' fill='url(#d)'/>` });
const denim = (r, seed) => grain(512, 512, { fx: .4, fy: .4, oct: 2, lo: .4, hi: .62, seed,
  more: `<pattern id='t' width='5' height='5' patternUnits='userSpaceOnUse' patternTransform='rotate(60)'><rect width='2' height='5' fill='#fff' opacity='.12'/></pattern><rect width='512' height='512' fill='url(#t)'/>` });
const matte = (r, seed) => grain(512, 512, { fx: .5, fy: .5, oct: 1, lo: .46, hi: .54, seed,
  more: `<pattern id='h' width='28' height='48' patternUnits='userSpaceOnUse'><path d='M14 0 L28 8 V24 L14 32 L0 24 V8z M14 32 V48 M0 24 L0 40 M28 24 L28 40' fill='none' stroke='#fff' stroke-width='.8' opacity='.07'/></pattern><rect width='512' height='512' fill='url(#h)'/>` });
const leather = (r, seed) => relief(256, 256, { fx: .25, fy: .25, oct: 3, scale: 2, lo: .36, hi: .64, seed });
const studded = (r, seed) => relief(128, 128, { fx: .25, fy: .25, oct: 3, scale: 2, lo: .34, hi: .62, seed,
  more: [[32, 32], [96, 96]].map(([x, y]) => `<polygon points='${x},${y - 12} ${x + 12},${y} ${x},${y + 12} ${x - 12},${y}' fill='#8a8a8a'/><polygon points='${x},${y - 12} ${x + 12},${y} ${x},${y}' fill='#d0d0d0'/><polygon points='${x},${y} ${x + 12},${y} ${x},${y + 12}' fill='#3a3a3a'/>`).join('') });
const twill = () => svg(64, 64, `<pattern id='t' width='4' height='4' patternUnits='userSpaceOnUse' patternTransform='rotate(60)'><rect width='4' height='4' fill='#808080'/><rect width='1.6' height='4' fill='#6a6a6a'/></pattern><rect width='64' height='64' fill='url(#t)'/>`);

const diamondPlate = () => svg(64, 64, `<pattern id='d' width='32' height='32' patternUnits='userSpaceOnUse' patternTransform='rotate(45)'><rect width='32' height='32' fill='#808080'/><rect x='4' y='12' width='24' height='8' rx='4' fill='#9a9a9a'/><rect x='4' y='14' width='24' height='3' rx='1.5' fill='#6a6a6a'/></pattern><rect width='64' height='64' fill='url(#d)'/>`);
const tolex = (r, seed) => relief(128, 128, { fx: .35, fy: .35, oct: 2, scale: 2, lo: .3, hi: .62, seed,
  more: Array.from({ length: 2 }, (_, k) => `<circle cx='${k ? 96 : 32}' cy='${k ? 96 : 32}' r='6' fill='#777'/><circle cx='${k ? 96 : 32}' cy='${k ? 96 : 32}' r='3.5' fill='#9a9a9a'/>`).join('') }); // pebbled vinyl with rivets
const carbon = () => svg(64, 64, `<pattern id='c' width='16' height='16' patternUnits='userSpaceOnUse'><rect width='16' height='16' fill='#787878'/><rect width='8' height='8' fill='#8c8c8c'/><rect x='8' y='8' width='8' height='8' fill='#8c8c8c'/><path d='M0 4 H8 M8 12 H16' stroke='#6a6a6a' stroke-width='1'/><path d='M4 8 V16 M12 0 V8' stroke='#6a6a6a' stroke-width='1'/></pattern><rect width='64' height='64' fill='url(#c)'/>`);
const parchment = (r, seed) => grain(256, 256, { fx: .02, fy: .02, oct: 4, lo: .4, hi: .68, seed,
  more: Array.from({ length: 6 }, () => `<circle cx='${i(r() * 256)}' cy='${i(r() * 256)}' r='${i(between(r, 6, 30))}' fill='#000' opacity='.08'/>`).join('') }); // foxed paper
const lcd = () => svg(16, 16, `<rect width='16' height='16' fill='#7a7a7a'/><path d='M0 3.5 H16 M0 7.5 H16 M0 11.5 H16 M0 15.5 H16' stroke='#5c5c5c' stroke-width='1'/>`);

// --------------------------------------------------------------------------------------------- packs

const SKINS = {
  steel: (r, p, L) => ({ scene: stage(r, p, L), panel: leather(r, i(r() * 1e6)), cap: grain(64, 64, { fx: .5, fy: .003, oct: 2, lo: .3, hi: .74, seed: i(r() * 1e6) }), ornament: studs(), emblem: pick(p.label), chassis: studded(r, i(r() * 1e6)), pad: leather(r, i(r() * 1e6)), plate: lcd() }),
  folk: (r, p, L) => ({ scene: forest(r, p, L), panel: oak(r, i(r() * 1e6)), cap: grain(64, 64, { fx: .5, fy: .03, oct: 2, lo: .25, hi: .8, seed: i(r() * 1e6) }), ornament: iron(), emblem: triskele(p.label), chassis: bark(r, i(r() * 1e6)), pad: parchment(r, i(r() * 1e6)), plate: parchment(r, i(r() * 1e6)) }),
  black: (r, p, L) => ({ scene: frost(r, p, L), panel: marble(r, i(r() * 1e6)), cap: bone(r, i(r() * 1e6)), ornament: skulls(), emblem: skullSigil(p.label), chassis: grain(256, 256, { fx: .05, fy: .05, oct: 4, lo: .3, hi: .62, seed: i(r() * 1e6) }), pad: grain(64, 64, { fx: .1, fy: .1, lo: .3, hi: .75, seed: i(r() * 1e6) }), plate: grain(64, 64, { fx: .1, fy: .1, lo: .3, hi: .75, seed: i(r() * 1e6) }) }),
  industrial: (r, p, L) => ({ scene: factory(r, p, L), panel: steel(r, i(r() * 1e6)), cap: knurl(), ornament: plates(), emblem: cog(p.label), chassis: diamondPlate(), pad: lcd(), plate: lcd() }),
  doom: (r, p, L) => ({ scene: dungeon(r, p, L), panel: stone(r, i(r() * 1e6)), cap: wax(r, i(r() * 1e6)), ornament: rings(), emblem: candleSigil(p.label), chassis: stone(r, i(r() * 1e6)), pad: waxSoft(r, i(r() * 1e6)), plate: waxSoft(r, i(r() * 1e6)) }),
  death: (r, p, L) => ({ scene: slaughterhouse(r, p, L), panel: rust(r, i(r() * 1e6)), cap: grain(64, 64, { type: 'turbulence', fx: .15, fy: .15, lo: .25, hi: .8, seed: i(r() * 1e6) }), ornament: wire(), emblem: hookSigil(p.label), chassis: rust(r, i(r() * 1e6)), pad: rust(r, i(r() * 1e6)), plate: rust(r, i(r() * 1e6)) }),
  power: (r, p, L) => ({ scene: castle(r, p, L), panel: brocade(r, i(r() * 1e6)), cap: gold(r, i(r() * 1e6)), ornament: filigree(), emblem: crown(p.label), chassis: grain(256, 256, { fx: .3, fy: .3, oct: 2, lo: .4, hi: .62, seed: i(r() * 1e6) }), pad: brocade(r, i(r() * 1e6)), plate: parchment(r, i(r() * 1e6)) }),
  thrash: (r, p) => ({ scene: garage(r, p), panel: denim(r, i(r() * 1e6)), cap: twill(), ornament: tape(), emblem: boltSigil(p.label), chassis: tolex(r, i(r() * 1e6)), pad: parchment(r, i(r() * 1e6)), plate: twill() }),
  prog: (r, p, L) => ({ scene: lattice(r, p, L), panel: matte(r, i(r() * 1e6)), cap: grain(64, 64, { fx: .5, fy: .5, oct: 1, lo: .47, hi: .53, seed: i(r() * 1e6) }), ornament: brackets(), emblem: cubeSigil(p.label), chassis: carbon(), pad: matte(r, i(r() * 1e6)), plate: lcd() }),
};
export const SKINNED = Object.keys(SKINS);
export const SLOTS = ['scene', 'panel', 'cap', 'ornament', 'emblem', 'chassis', 'pad', 'plate', 'cap-face', 'lever-face'];

// The asset set for a pack, or null for an unknown one. Seeded by the band slug so a band always gets the same desk.
// `overrides` is web/skins/manifest.json: { pack: { slot: 'skins/pack/file.webp' } } replaces that slot with the bitmap.
export function skin(pack, slug, palette, overrides = {}, trim = null) {
  const make = SKINS[pack];
  if (!make) return null;
  const lights = [];
  const own = { ...make(rng(hash(slug)), palette, lights), ...FACES[pack](palette) };
  if (SKINS[trim]) { // crossover: the second pack the genre names trims the primary's stage (ornament, emblem, cap faces)
    const t = SKINS[trim](rng(hash(slug)), palette, []);
    Object.assign(own, { ornament: t.ornament, emblem: t.emblem }, FACES[trim](palette));
  }
  return { ...own, ...overrides[pack], lights };
}

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorld, seededRng, key, distOrigin, neighborKeys } from './hex.js';
import { createWeather, createLandingMaterial, createWaterMaterial, FinishShader } from './shaders.js';
import { drawIcon, EMOJI_TO_ICON } from './icons.js';

// Performance notes
// - Every tile is baked into ONE merged mesh (vertex colours) sharing ONE toon material,
//   so the island costs roughly one draw call per tile. Only a few moving parts
//   (flags, windmill blades, fire, boats, lake water, sprites) stay separate.
// - Seasons and tree sway run in that shared shader via uniforms (no per-mesh CPU work).
// - Frontier hexes and particles are instanced; '?' markers are one Points draw.
// - Picking is analytic (ray/plane + hex rounding), no scene raycasts.
// - Shadow maps only re-render while something changes; resolution adapts to frame rate.

const TOP = 0.3;
const SEASON_IDS = { grass: 1, leaf: 2, pine: 3, rock: 4 };

// ---------- toon materials (Link's Awakening-ish: soft bands, rim light, plastic glint) ----------
const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 196, 236, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

const RIM_GLSL = /* glsl */ `
  {
    vec3 vd = normalize(vViewPosition);
    float rim = pow(1.0 - saturate(dot(normal, vd)), 3.0);
    outgoingLight += vec3(1.0, 0.96, 0.86) * rim * 0.28 * diffuseColor.rgb;
    #if NUM_DIR_LIGHTS > 0
      vec3 hv = normalize(directionalLights[0].direction + vd);
      outgoingLight += directionalLights[0].color * pow(max(dot(normal, hv), 0.0), 40.0) * 0.1;
    #endif
  }
  #include <opaque_fragment>
`;

const U = {
  uTime: { value: 0 },
  uTints: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4(0, 0, 0, 0)) },
  uLeaf2: { value: new THREE.Color(0xf0b02c) },
};

function worldShader(sh) {
  Object.assign(sh.uniforms, U);
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aSeason;
      attribute vec2 aSway;
      uniform float uTime;
      uniform vec4 uTints[5];
      uniform vec3 uLeaf2;`)
    .replace('#include <color_vertex>', `#include <color_vertex>
      #ifdef USE_COLOR
      {
        int si = int(aSeason + 0.5);
        if (si > 0) {
          vec4 tn = uTints[si];
          vec3 tc = si == 2 ? mix(tn.rgb, uLeaf2, fract(aSway.y * 7.31)) : tn.rgb;
          vColor.rgb = mix(vColor.rgb, tc, tn.a);
        }
      }
      #endif`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', RIM_GLSL);
}

const WORLD_MAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
WORLD_MAT.onBeforeCompile = worldShader;

// shadow depth pass must sway exactly like the colour pass, otherwise trees self-shadow in stripes
const SWAY_GLSL = `transformed.x += sin(uTime * 1.4 + aSway.y) * aSway.x * 0.07;
      transformed.z += cos(uTime * 1.1 + aSway.y * 1.3) * aSway.x * 0.04;`;
const WORLD_DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
WORLD_DEPTH.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = U.uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`);
};

const matCache = new Map();
function rimOnly(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', RIM_GLSL);
}
function M(color, opts = {}) {
  const id = `${color}|${JSON.stringify(opts)}`;
  if (!matCache.has(id)) {
    const { season, ...rest } = opts;
    const m = new THREE.MeshToonMaterial({ color, gradientMap, ...rest });
    m.onBeforeCompile = rimOnly;
    m.userData.season = season ? SEASON_IDS[season] : 0;
    matCache.set(id, m);
  }
  return matCache.get(id);
}
const SM = (kind, color) => M(color, { season: kind });

const AUTUMN = [0xe0702a, 0xf0b02c];
const SEASON_TINT = {
  grass: [null, [0xc6d85a, 0.2], [0xd6aa52, 0.38], [0xeef4f6, 0.62]],
  leaf: [null, [0x2f7a2a, 0.15], ['autumn', 0.9], [0xe6eef2, 0.45]],
  pine: [null, null, [0x2f6a2a, 0.12], [0xe6eef2, 0.3]],
  rock: [null, null, null, [0xf6f9fc, 0.55]],
};

// ---------- geometry cache ----------
const geoCache = new Map();
const geo = (id, make) => {
  if (!geoCache.has(id)) {
    const g = make();
    g.deleteAttribute('uv');
    geoCache.set(id, g);
  }
  return geoCache.get(id);
};
const G = {
  soil: () => geo('soil', () => new THREE.CylinderGeometry(1, 1, 0.2, 6).translate(0, 0.1, 0)),
  layer: () => geo('layer', () => new THREE.CylinderGeometry(1, 1, 0.07, 6).translate(0, 0.235, 0)),
  lip: () => geo('lip', () => new THREE.CylinderGeometry(1, 1, 0.03, 6).translate(0, TOP - 0.015, 0)),
  ghost: () => geo('ghost', () => new THREE.CylinderGeometry(0.93, 0.93, 0.03, 6)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg)),
  cone: (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  sphere: () => geo('sphere', () => new THREE.IcosahedronGeometry(1, 2)),
  blob: () => geo('blob', () => new THREE.IcosahedronGeometry(1, 1)),
  prism: () => geo('prism', () => new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2)),
  ring: () => geo('ring', () => new THREE.RingGeometry(0.93, 0.985, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2)),
  disc: (seg = 6) => geo(`disc${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg)),
};

function mesh(g, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

const TOP_COLORS = {
  forest: 0x62b84a, meadow: 0x8fd35a, field: 0x84c955, mountain: 0xb2aa98,
  lake: 0x84c955, village: 0x93d35e, home: 0x8fd35a,
};
const SIDE = 0x9a6a40;

function pointsInHex(rng, n, { rMax = 0.68, minD = 0.2, avoidCenter = 0 } = {}) {
  const pts = [];
  let tries = 0;
  while (pts.length < n && tries++ < 300) {
    const a = rng() * Math.PI * 2;
    const r = Math.sqrt(rng()) * rMax;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (r < avoidCenter) continue;
    if (pts.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < minD * minD)) continue;
    pts.push({ x, z });
  }
  return pts;
}

// ---------- text sprites (textures cached) ----------
const texCache = new Map();
function drawText(text, { bg, fg, size, pad }) {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = `600 ${size}px Fredoka, Nunito, sans-serif`;
  ctx.font = font;
  c.width = Math.ceil(ctx.measureText(text).width) + pad * 2;
  c.height = size + pad * 1.4;
  ctx.font = font;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, c.height / 2);
    ctx.fill();
  }
  ctx.fillStyle = fg;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, w: c.width, h: c.height };
}
function textTexture(text, opts) {
  const id = `${text}|${opts.bg}|${opts.fg}|${opts.size}|${opts.pad}`;
  if (!texCache.has(id)) texCache.set(id, drawText(text, opts));
  return texCache.get(id);
}

function textSprite(text, { bg = 'rgba(20,28,38,0.85)', fg = '#fff', size = 44, pad = 16, scale = 0.012, cache = true } = {}) {
  const t = cache ? textTexture(text, { bg, fg, size, pad }) : drawText(text, { bg, fg, size, pad });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, depthTest: false, transparent: true }));
  s.scale.set(t.w * scale, t.h * scale, 1);
  s.renderOrder = 10;
  return s;
}
const iconTexCache = new Map();
function iconSprite(name, scale = 0.45, color = '#2f3a36') {
  const id = `${name}|${color}`;
  if (!iconTexCache.has(id)) {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      ctx.lineTo(64 + Math.cos(a) * 60, 64 + Math.sin(a) * 60);
    }
    ctx.closePath();
    ctx.fill();
    drawIcon(ctx, name, 28, 28, 72, color);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    iconTexCache.set(id, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: iconTexCache.get(id), depthTest: false, transparent: true }));
  s.scale.set(scale, scale, 1);
  s.renderOrder = 10;
  return s;
}

function questSprite(n, color) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 120;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    ctx.lineTo(48 + Math.cos(a) * 44, 48 + Math.sin(a) * 44);
  }
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(40, 88);
  ctx.lineTo(48, 112);
  ctx.lineTo(56, 88);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.font = '700 44px Fredoka, Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 48, 51);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  s.center.set(0.5, 0.05);
  s.scale.set(0.42, 0.52, 1);
  s.renderOrder = 11;
  return s;
}

// axial rounding from world x/z to a hex key
function hexKeyAt(x, z) {
  const r = z / 1.5;
  const q = x / Math.sqrt(3) - r / 2;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(-q - r);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs + q + r);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return key(rq, rr);
}

// ---------- tile badges: every badge on the map is one Points draw call using an icon atlas ----------
const BADGES = ['shield1', 'shield2', 'shield3', 'shield4', 'shield5', 'building', 'improved', 'crop', 'ruins', 'ruinsDone', 'mill', 'millDone', 'workshop'];
function buildBadgeAtlas() {
  const cell = 128;
  const c = document.createElement('canvas');
  c.width = c.height = cell * 4;
  const ctx = c.getContext('2d');
  BADGES.forEach((id, i) => {
    const x0 = (i % 4) * cell;
    const y0 = Math.floor(i / 4) * cell;
    const cx = x0 + cell / 2;
    const cy = y0 + cell / 2;
    const gold = id === 'improved' || id.endsWith('Done');
    ctx.fillStyle = gold ? '#f7d774' : '#ffffff';
    ctx.beginPath();
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3;
      ctx.lineTo(cx + Math.cos(a) * 58, cy + Math.sin(a) * 58);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(47,58,54,0.25)';
    ctx.lineWidth = 4;
    ctx.stroke();
    const ink = id === 'ruins' || id === 'mill' ? '#9aa8a2' : '#2f3a36';
    const glyph = id.startsWith('shield') ? 'shield' : id === 'building' || id === 'improved' ? 'hammer'
      : id === 'crop' ? 'plant' : id.startsWith('ruins') ? 'ruins' : id.startsWith('mill') ? 'mill' : 'workshop';
    drawIcon(ctx, glyph, cx - 34, cy - 34, 68, id === 'crop' ? '#4f9e38' : ink);
    if (id.startsWith('shield')) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 38px Fredoka, Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(id.slice(6), cx, cy + 2);
    }
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createBadgeMaterial(atlas) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uAtlas: { value: atlas }, uSize: { value: 0.46 }, uScale: { value: 400 }, uMin: { value: 26 } },
    vertexShader: /* glsl */ `
      attribute float aIcon;
      uniform float uSize, uScale, uMin;
      varying vec2 vCell;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = max(uSize * uScale / -mv.z, uMin); // never smaller than readable
        gl_Position = projectionMatrix * mv;
        vCell = vec2(mod(aIcon, 4.0), floor(aIcon / 4.0));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uAtlas;
      varying vec2 vCell;
      void main() {
        vec2 uv = vec2((vCell.x + gl_PointCoord.x) / 4.0, 1.0 - (vCell.y + gl_PointCoord.y) / 4.0);
        vec4 t = texture2D(uAtlas, uv);
        if (t.a < 0.05) discard;
        gl_FragColor = t;
        #include <colorspace_fragment>
      }
    `,
  });
}

// Floating "+2 [wood]" labels: one cached texture per distinct text, icons drawn with our glyphs
const floatTexCache = new Map();
const ICON_TINT = { wood: '#9a6a40', stone: '#7f8a87', grain: '#d69e1c', veg: '#e0702a', wool: '#9c86c2', gold: '#d9a514' };
function floatTexture(text) {
  if (floatTexCache.has(text)) return floatTexCache.get(text);
  const parts = [];
  const re = /([+−-]?\d+)?\s*(\p{Extended_Pictographic}\uFE0F?)?/gu;
  let m;
  while ((m = re.exec(text)) && m[0] !== '') {
    const icon = m[2] ? EMOJI_TO_ICON[m[2]] || EMOJI_TO_ICON[m[2].replace('\uFE0F', '')] : null;
    if (m[1] || icon) parts.push({ n: m[1] || '', icon });
  }
  const plain = text.replace(/\p{Extended_Pictographic}\uFE0F?/gu, '').trim();
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const font = '700 34px Fredoka, Nunito, sans-serif';
  ctx.font = font;
  const useParts = parts.length && parts.some((p) => p.icon);
  const widths = useParts ? parts.map((p) => ctx.measureText(p.n).width + (p.icon ? 36 : 0) + 10) : [ctx.measureText(plain).width + 10];
  c.width = Math.ceil(widths.reduce((a, b) => a + b, 0) + 26);
  c.height = 52;
  ctx.font = font;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.beginPath();
  ctx.roundRect(0, 0, c.width, c.height, 26);
  ctx.fill();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2f3a36';
  let x = 14;
  if (useParts) {
    parts.forEach((p, i) => {
      ctx.fillStyle = '#2f3a36';
      ctx.fillText(p.n, x, 28);
      const tw = ctx.measureText(p.n).width;
      if (p.icon) drawIcon(ctx, p.icon, x + tw + 2, 9, 34, ICON_TINT[p.icon] || '#2f3a36');
      x += widths[i];
    });
  } else {
    ctx.fillText(plain, x, 28);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const out = { tex, w: c.width, h: c.height };
  floatTexCache.set(text, out);
  return out;
}

// ---------- props ----------
function tree(rng, scale = 1) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(6), M(0x8a5a36), 0, 0.08, 0, 0.04, 0.16, 0.04));
  const greens = [0x3e9d45, 0x4fb24e, 0x2f8a3f, 0x58b846];
  const green = greens[Math.floor(rng() * greens.length)];
  if (rng() < 0.45) {
    const c = SM('pine', green);
    g.add(mesh(G.cone(8), c, 0, 0.3, 0, 0.2, 0.34, 0.2));
    g.add(mesh(G.cone(8), c, 0, 0.47, 0, 0.14, 0.26, 0.14));
  } else {
    const c = SM('leaf', green);
    g.add(mesh(G.blob(), c, 0, 0.3, 0, 0.19, 0.2, 0.19));
    g.add(mesh(G.blob(), c, 0.06, 0.4, 0.02, 0.12));
  }
  g.scale.setScalar(scale * (0.8 + rng() * 0.45));
  g.rotation.y = rng() * 6;
  g.userData.sway = rng() * 10;
  return g;
}

function house(w, h, d, wall, roof) {
  const g = new THREE.Group();
  g.add(mesh(G.box(), M(wall), 0, h / 2, 0, w, h, d));
  const sy = w * 0.5;
  g.add(mesh(G.prism(), M(roof), 0, h + 0.5 * sy, 0, (w * 0.64) / 0.866, sy, d * 1.14));
  g.add(mesh(G.box(), M(0x6b4226), 0, h * 0.3, d / 2 + 0.002, w * 0.22, h * 0.6, 0.01));
  return g;
}

function sheep(rng) {
  const g = new THREE.Group();
  g.add(mesh(G.blob(), M(0xfbf8f0), 0, 0.09, 0, 0.09, 0.075, 0.07));
  g.add(mesh(G.blob(), M(0x3a3230), 0.09, 0.11, 0, 0.038));
  g.rotation.y = rng() * 6;
  return g;
}

function fenceRing(r, color = 0xa8784a) {
  const g = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.add(mesh(G.box(), M(color), Math.cos(a) * r, 0.06, Math.sin(a) * r, 0.03, 0.12, 0.03));
    const b = mesh(G.box(), M(color), Math.cos(a + 0.26) * r, 0.08, Math.sin(a + 0.26) * r, 0.02, 0.025, (2 * Math.PI * r) / 12);
    b.rotation.y = -(a + 0.26);
    g.add(b);
  }
  return g;
}

function flag(color, h = 0.8) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(5), M(0x6b4a2b), 0, h / 2, 0, 0.018, h, 0.018));
  g.add(mesh(G.sphere(), M(0xf0c040), 0, h + 0.02, 0, 0.03));
  const pivot = new THREE.Group();
  pivot.add(mesh(G.box(), M(color), 0.13, h - 0.12, 0, 0.24, 0.18, 0.015));
  pivot.userData.dynamic = 'flap';
  pivot.userData.phase = Math.random() * 6;
  g.add(pivot);
  return g;
}

function figure(color) {
  const g = new THREE.Group();
  g.add(mesh(G.cyl(8), M(color), 0, 0.07, 0, 0.04, 0.14, 0.04));
  g.add(mesh(G.sphere(), M(0xf5d0a8), 0, 0.18, 0, 0.042));
  g.add(mesh(G.sphere(), M(0xc9ced6), 0, 0.205, 0, 0.044, 0.028, 0.044));
  return g;
}

// ---------- tile content ----------
function buildForest(rng, t, g) {
  const n = t.building === 'lumber' ? 6 : t.poi ? 7 : 14;
  for (const p of pointsInHex(rng, n, { rMax: 0.78, minD: 0.17, avoidCenter: t.building || t.poi ? 0.38 : 0 })) {
    const tr = tree(rng, 0.72);
    tr.position.set(p.x, TOP, p.z);
    g.add(tr);
  }
  if (t.building === 'lumber') {
    const h = house(0.3, 0.2, 0.26, 0xc9955e, 0x8a4a2e);
    h.position.set(-0.1, TOP, 0.05);
    g.add(h);
    for (let i = 0; i < 3; i++) {
      const log = mesh(G.cyl(8), M(0xa0683a), 0.2, TOP + 0.04 + (i === 2 ? 0.06 : 0), -0.05 + (i === 2 ? 0 : (i - 0.5) * 0.09), 0.04, 0.3, 0.04);
      log.rotation.z = Math.PI / 2;
      g.add(log);
    }
    if (t.upgraded) {
      // sawmill: second shed with a saw blade
      const saw = house(0.24, 0.16, 0.2, 0xd9a86a, 0x6b4a2b);
      saw.position.set(0.12, TOP, 0.4);
      g.add(saw);
      const blade = mesh(G.cyl(12), M(0xc9ced6), 0.26, TOP + 0.14, 0.4, 0.09, 0.01, 0.09);
      blade.rotation.x = Math.PI / 2;
      g.add(blade);
    }
  }
}

function buildMeadow(rng, t, g) {
  for (const p of pointsInHex(rng, 7, { minD: 0.15 })) {
    g.add(mesh(G.cone(5), SM('grass', 0x6cc043), p.x, TOP + 0.04, p.z, 0.045, 0.09, 0.045));
  }
  const flowers = [0xffffff, 0xffd84a, 0xff7fb0, 0xc49bff];
  for (const p of pointsInHex(rng, 7, { minD: 0.1 })) {
    g.add(mesh(G.blob(), M(flowers[Math.floor(rng() * 4)]), p.x, TOP + 0.02, p.z, 0.028));
  }
  if (t.building === 'pen') {
    const f = fenceRing(0.5);
    f.position.y = TOP;
    g.add(f);
    const h = house(0.22, 0.14, 0.2, 0xf6e7c8, 0xc0563a);
    h.position.set(0, TOP, 0.62);
    g.add(h);
    if (t.upgraded) {
      const shed = house(0.26, 0.16, 0.22, 0xf6e7c8, 0x4a86d0);
      shed.position.set(-0.55, TOP, 0.2);
      shed.rotation.y = 1.2;
      g.add(shed);
    }
  }
  const nSheep = t.building === 'pen' ? 4 : t.owner != null ? 1 : 0;
  for (const p of pointsInHex(rng, nSheep, { rMax: t.building === 'pen' ? 0.35 : 0.6 })) {
    const s = sheep(rng);
    s.position.set(p.x, TOP, p.z);
    g.add(s);
  }
}

function lerpColor(a, b, k) {
  return new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
}

function buildField(rng, t, g, game) {
  g.add(mesh(G.disc(6), M(0x9a6a44), 0, TOP + 0.01, 0, 0.8, 0.03, 0.8));
  const rows = [-0.45, -0.22, 0, 0.22, 0.45];
  const grow = t.crop ? game.growTime(t) : 1;
  const k = t.crop ? Math.min(1, (t.crop.progress + 0.35) / grow) : 0;
  const ripe = t.crop && t.crop.progress >= grow - 1;
  for (const z of rows) {
    const half = Math.sqrt(Math.max(0, 0.6 - z * z)) * 0.95;
    if (!t.crop) {
      g.add(mesh(G.box(), M(0x7a4e2e), 0, TOP + 0.035, z, half * 2, 0.035, 0.07));
      continue;
    }
    const type = t.crop.type;
    const n = Math.max(2, Math.round(half * 8));
    for (let i = 0; i < n; i++) {
      const x = -half + (i + 0.5) * ((half * 2) / n);
      if (type === 'wheat') {
        const h = 0.05 + 0.22 * k;
        g.add(mesh(G.box(), M(lerpColor(0x7cc84a, 0xf2cf4a, ripe ? 1 : k * 0.6)), x, TOP + 0.03 + h / 2, z, 0.08, h, 0.08));
      } else if (type === 'carrot') {
        g.add(mesh(G.cone(5), M(0x5cb03a), x, TOP + 0.05 + 0.04 * k, z, 0.05, 0.08 + 0.1 * k, 0.05));
        if (ripe) g.add(mesh(G.cone(6), M(0xff8a24), x, TOP + 0.03, z + 0.05, 0.028, 0.05, 0.028));
      } else {
        g.add(mesh(G.blob(), M(0x4a9a35), x, TOP + 0.04, z, 0.05));
        if (k > 0.3 && i % 2 === 0) {
          g.add(mesh(G.sphere(), M(ripe ? 0xff8a1a : 0xe2c04a), x, TOP + 0.06, z, 0.03 + 0.06 * k, 0.025 + 0.05 * k, 0.03 + 0.06 * k));
        }
      }
    }
  }
  if (t.building === 'barn') {
    const b = house(0.32, 0.24, 0.26, 0xd9483a, 0xf2eadb);
    b.position.set(0.52, TOP, -0.2);
    b.rotation.y = 0.5;
    g.add(b);
    if (t.upgraded) {
      // granary silo
      g.add(mesh(G.cyl(12), M(0xefe6d2), 0.3, TOP + 0.2, -0.55, 0.09, 0.4, 0.09));
      g.add(mesh(G.cone(12), M(0xd9483a), 0.3, TOP + 0.47, -0.55, 0.11, 0.14, 0.11));
    }
  }
}

function buildMountain(rng, t, g) {
  const peaks = t.building === 'quarry' || t.poi ? 2 : 3;
  const pts = pointsInHex(rng, peaks, { rMax: 0.4, minD: 0.3 });
  pts.forEach((p, i) => {
    const r = 0.32 + rng() * 0.18;
    const h = (i === 0 ? 0.9 : 0.55) + rng() * 0.35;
    const grey = [0xa89f92, 0x988f84, 0xb4ac9f][i % 3];
    const m = mesh(G.cone(7), SM('rock', grey), p.x, TOP + h / 2, p.z, r, h, r);
    m.rotation.y = rng() * 3;
    g.add(m);
    const hs = h * 0.34;
    const s = mesh(G.cone(7), M(0xffffff), p.x, TOP + h - hs / 2 + 0.005, p.z, r * 0.36, hs, r * 0.36);
    s.rotation.y = m.rotation.y;
    g.add(s);
  });
  for (const p of pointsInHex(rng, 4, { rMax: 0.75, avoidCenter: 0.5 })) {
    g.add(mesh(G.blob(), SM('rock', 0xa09a8e), p.x, TOP + 0.04, p.z, 0.06 + rng() * 0.05));
  }
  if (t.building === 'quarry') {
    for (let i = 0; i < 5; i++) {
      g.add(mesh(G.box(), M(0xe0dccf), 0.35 + (i % 3) * 0.13, TOP + 0.05 + Math.floor(i / 3) * 0.1, 0.35, 0.12, 0.1, 0.12));
    }
    g.add(mesh(G.box(), M(0x9a6a3e), -0.2, TOP + 0.07, 0.5, 0.2, 0.08, 0.13));
    if (t.upgraded) {
      // deep quarry: wooden crane
      g.add(mesh(G.box(), M(0x8a5a36), 0.55, TOP + 0.3, 0.1, 0.04, 0.6, 0.04));
      const arm = mesh(G.box(), M(0x8a5a36), 0.42, TOP + 0.58, 0.1, 0.3, 0.035, 0.035);
      g.add(arm);
    }
  }
}

const LAKE_MAT = new THREE.MeshStandardMaterial({ color: 0x4fc6ec, roughness: 0.12, metalness: 0.05 });
function buildLake(rng, t, g) {
  const water = new THREE.Mesh(G.disc(18), LAKE_MAT);
  water.position.set(0, TOP + 0.005, 0);
  water.scale.set(0.72, 0.03, 0.72);
  water.receiveShadow = true;
  water.userData.dynamic = 'static';
  g.add(water);
  for (const p of pointsInHex(rng, 5, { rMax: 0.82, avoidCenter: 0.74, minD: 0.1 })) {
    g.add(mesh(G.cyl(4), M(0x5e9a34), p.x, TOP + 0.08, p.z, 0.014, 0.16, 0.014));
  }
  for (const p of pointsInHex(rng, 2, { rMax: 0.5, minD: 0.3 })) {
    g.add(mesh(G.disc(8), M(0x5cb03a), p.x, TOP + 0.025, p.z, 0.07, 0.01, 0.07));
  }
  if (t.building === 'dock') {
    const d = mesh(G.box(), M(0xb3834f), 0.35, TOP + 0.04, 0.25, 0.14, 0.03, 0.5);
    d.rotation.y = 0.7;
    g.add(d);
    const boat = new THREE.Group();
    boat.add(mesh(G.box(), M(0x9a5a2e), 0, 0.03, 0, 0.26, 0.06, 0.1));
    boat.add(mesh(G.cyl(4), M(0x6b4a2b), 0, 0.17, 0, 0.01, 0.26, 0.01));
    boat.add(mesh(G.prism(), M(0xfff6e6), 0.05, 0.18, 0, 0.06, 0.16, 0.01));
    boat.position.set(-0.15, TOP + 0.01, -0.1);
    boat.userData.dynamic = 'bob';
    boat.userData.phase = rng() * 6;
    g.add(boat);
    if (t.upgraded) {
      // harbour: little lighthouse
      g.add(mesh(G.cyl(10), M(0xffffff), -0.55, TOP + 0.25, 0.3, 0.07, 0.5, 0.08));
      g.add(mesh(G.cyl(10), M(0xd9483a), -0.55, TOP + 0.3, 0.3, 0.075, 0.08, 0.085));
      g.add(mesh(G.cone(10), M(0xd9483a), -0.55, TOP + 0.57, 0.3, 0.09, 0.12, 0.09));
    }
  }
}

// Haven: a walled town of seven hexes in the middle of the map. The centre holds the keep,
// the six districts around it each get their own landmark, and one outer wall rings them all.
function havenWalls(t, g, T) {
  const wallC = M(0xd6ccb4);
  const roof = M(0x3f6fb8);
  const me = toWorld(t.key);
  for (const n of neighborKeys(t.key)) {
    if (distOrigin(n) < 2) continue;
    const o = toWorld(n);
    const dx = (o.x - me.x) / Math.sqrt(3);
    const dz = (o.z - me.z) / Math.sqrt(3);
    const mx = dx * 0.83;
    const mz = dz * 0.83;
    const wall = mesh(G.box(), wallC, mx, T + 0.1, mz, 0.06, 0.2, 0.96);
    wall.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
    g.add(wall);
    // one tower per wall segment, always on the same (clockwise) end, so every corner of the
    // ring gets exactly one tower instead of two overlapping ones
    const tx = mx - dz * 0.48;
    const tz = mz + dx * 0.48;
    g.add(mesh(G.cyl(10), wallC, tx, T + 0.16, tz, 0.08, 0.32, 0.08));
    g.add(mesh(G.cone(10), roof, tx, T + 0.38, tz, 0.1, 0.14, 0.1));
  }
}

function buildDistrict(rng, t, g, T) {
  const roofs = [0xe0503a, 0xf07a3a, 0xc2402e, 0x4a86d0];
  const d = t.district;
  // houses fill the inner half of every district
  for (const p of pointsInHex(rng, 4, { rMax: 0.55, minD: 0.3, avoidCenter: 0.12 })) {
    const h = house(0.2 + rng() * 0.06, 0.16 + rng() * 0.08, 0.18, 0xfbefd6, roofs[Math.floor(rng() * roofs.length)]);
    h.position.set(p.x, T, p.z);
    h.rotation.y = Math.floor(rng() * 6) * (Math.PI / 3);
    g.add(h);
  }
  if (d === 1) {
    // market square
    g.add(mesh(G.disc(16), M(0xf1e7cf), 0, T + 0.012, 0, 0.26, 0.01, 0.26));
    [0xf0c040, 0xe0503a, 0x4a86d0, 0x4f9e38].forEach((c, i) => {
      const a = (i / 4) * Math.PI * 2;
      g.add(mesh(G.box(), M(0xa8784a), Math.cos(a) * 0.14, T + 0.05, Math.sin(a) * 0.14, 0.1, 0.08, 0.08));
      g.add(mesh(G.prism(), M(c), Math.cos(a) * 0.14, T + 0.12, Math.sin(a) * 0.14, 0.08, 0.05, 0.11));
    });
  } else if (d === 2) {
    // windmill
    g.add(mesh(G.cyl(10), M(0xfbefd6), 0, T + 0.3, 0, 0.12, 0.6, 0.12));
    g.add(mesh(G.cone(10), M(0xe0503a), 0, T + 0.7, 0, 0.16, 0.2, 0.16));
    const blades = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2;
      holder.add(mesh(G.box(), M(0xfff6e6), 0, 0.2, 0, 0.07, 0.4, 0.01));
      blades.add(holder);
    }
    blades.position.set(0, T + 0.55, 0.15);
    blades.userData.dynamic = 'spin';
    g.add(blades);
  } else if (d === 3) {
    // harbour pond with boats
    g.add(mesh(G.disc(18), M(0x4fc6ec), 0, T + 0.01, 0, 0.34, 0.01, 0.34));
    const boat = new THREE.Group();
    boat.add(mesh(G.box(), M(0x9a5a2e), 0, 0.03, 0, 0.2, 0.05, 0.08));
    boat.add(mesh(G.prism(), M(0xfff6e6), 0.03, 0.14, 0, 0.05, 0.13, 0.01));
    boat.position.set(0.05, T + 0.01, 0.05);
    boat.userData.dynamic = 'bob';
    boat.userData.phase = rng() * 6;
    g.add(boat);
  } else if (d === 4) {
    // chapel
    g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.15, 0, 0.2, 0.3, 0.32));
    g.add(mesh(G.prism(), M(0x5a7ec0), 0, T + 0.36, 0, 0.14, 0.12, 0.34));
    g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.4, 0.13, 0.1, 0.5, 0.1));
    g.add(mesh(G.cone(4), M(0x5a7ec0), 0, T + 0.78, 0.13, 0.1, 0.26, 0.1));
  } else if (d === 5) {
    // orchard
    for (const p of pointsInHex(rng, 5, { rMax: 0.3, minD: 0.14 })) {
      const tr = tree(rng, 0.6);
      tr.position.set(p.x, T, p.z);
      g.add(tr);
    }
  } else {
    // garrison with a banner
    g.add(mesh(G.box(), M(0xd6ccb4), 0, T + 0.12, 0, 0.36, 0.24, 0.26));
    for (const x of [-0.14, 0, 0.14]) g.add(mesh(G.box(), M(0xd6ccb4), x, T + 0.27, 0.12, 0.06, 0.06, 0.03));
    const fl = flag(0xf0c040, 0.6);
    fl.position.set(0.12, T + 0.24, -0.06);
    g.add(fl);
  }
}

function buildVillage(rng, t, g) {
  const centre = !t.district;
  const lift = centre ? 0.14 : 0.06;
  const T = TOP + lift;
  // plinth sits just inside the tile edge so its sides never coincide with the tile's own sides
  g.add(mesh(G.soil(), [M(0xcfc2a4), M(0xcfc2a4), M(0xcfc2a4)], 0, TOP - 0.2 + lift, 0, 0.965, 1, 0.965));
  g.add(mesh(G.disc(6), centre ? M(0xe6dcc2) : SM('grass', 0x9fd26a), 0, T + 0.002, 0, 0.955, 0.006, 0.955));
  if (!centre) g.add(mesh(G.box(), M(0xe6dcc2), 0, T + 0.008, 0, 0.16, 0.006, 1.6));
  if (!centre) {
    buildDistrict(rng, t, g, T);
    havenWalls(t, g, T);
    return;
  }
  // the keep: plaza, fountain, hall and a tall tower that can be seen from anywhere
  g.add(mesh(G.disc(16), M(0xf1e7cf), 0, T + 0.012, 0.25, 0.3, 0.01, 0.3));
  g.add(mesh(G.cyl(12), M(0xbfb39a), 0, T + 0.04, 0.25, 0.07, 0.06, 0.07));
  g.add(mesh(G.cyl(12), M(0x7fd0f0), 0, T + 0.075, 0.25, 0.055, 0.01, 0.055));
  g.add(mesh(G.box(), M(0xefe6d2), 0, T + 0.22, -0.25, 0.56, 0.44, 0.36));
  g.add(mesh(G.prism(), M(0x3f6fb8), 0, T + 0.52, -0.25, 0.36, 0.16, 0.4));
  for (const x of [-0.3, 0.3]) {
    g.add(mesh(G.cyl(10), M(0xf4ecda), x, T + 0.3, -0.25, 0.09, 0.6, 0.09));
    g.add(mesh(G.cone(10), M(0x3f6fb8), x, T + 0.7, -0.25, 0.12, 0.2, 0.12));
  }
  g.add(mesh(G.cyl(12), M(0xf4ecda), 0, T + 0.62, -0.3, 0.13, 1.24, 0.13));
  g.add(mesh(G.cone(12), M(0x3f6fb8), 0, T + 1.39, -0.3, 0.18, 0.32, 0.18));
  g.add(mesh(G.box(), M(0x6b4226), 0, T + 0.1, -0.06, 0.12, 0.2, 0.01));
  const fl = flag(0xf0c040, 0.55);
  fl.position.set(0, T + 1.53, -0.3);
  g.add(fl);
  g.userData.chimney = new THREE.Vector3(0.3, T + 0.4, 0.3);
  const h = house(0.2, 0.2, 0.18, 0xfbefd6, 0xe0503a);
  h.position.set(0.42, T, 0.3);
  g.add(h);
  const h2 = house(0.2, 0.18, 0.18, 0xfbefd6, 0xf07a3a);
  h2.position.set(-0.42, T, 0.3);
  g.add(h2);
}

function buildHome(rng, t, g, game) {
  const p = game.players[t.owner];
  const main = house(0.42, 0.28, 0.34, 0xfbefd6, p.color);
  main.position.set(-0.05, TOP, 0.05);
  g.add(main);
  g.add(mesh(G.box(), M(0xb0a090), 0.08, TOP + 0.42, 0.1, 0.06, 0.16, 0.06));
  g.userData.chimney = new THREE.Vector3(0.08, TOP + 0.52, 0.1);
  if (t.level >= 2) {
    const barn = house(0.34, 0.26, 0.28, 0xd9483a, 0xf2eadb);
    barn.position.set(0.42, TOP, -0.25);
    barn.rotation.y = -0.6;
    g.add(barn);
    for (let i = 0; i < 3; i++) g.add(mesh(G.cyl(10), M(0xf2cf4a), -0.5 + i * 0.13, TOP + 0.06, -0.4, 0.06, 0.12, 0.06));
  }
  if (t.level >= 3) {
    g.add(mesh(G.cyl(10), M(0xefe6d2), -0.45, TOP + 0.3, 0.35, 0.12, 0.6, 0.12));
    g.add(mesh(G.cone(10), M(p.color), -0.45, TOP + 0.72, 0.35, 0.15, 0.25, 0.15));
    const f = fenceRing(0.78);
    f.position.y = TOP;
    g.add(f);
  }
  const fl = flag(p.color, 1.0);
  fl.position.set(0.35, TOP, 0.35);
  g.add(fl);
  // workshop perks show up as small props around the farm
  const perks = p.perks || [];
  if (perks.includes('cart')) {
    const cart = new THREE.Group();
    cart.add(mesh(G.box(), M(0xb3834f), 0, 0.07, 0, 0.18, 0.06, 0.11));
    for (const z of [-0.06, 0.06]) {
      const w = mesh(G.cyl(10), M(0x6b4a2b), 0, 0.04, z, 0.045, 0.015, 0.045);
      w.rotation.x = Math.PI / 2;
      cart.add(w);
    }
    cart.position.set(0.55, TOP, -0.05);
    cart.rotation.y = 0.8;
    g.add(cart);
  }
  if (perks.includes('watchtower')) {
    for (const [x, z] of [[-0.62, -0.1], [-0.52, -0.1], [-0.62, -0.2], [-0.52, -0.2]]) g.add(mesh(G.box(), M(0x8a5a36), x, TOP + 0.22, z, 0.025, 0.44, 0.025));
    g.add(mesh(G.box(), M(0xa8784a), -0.57, TOP + 0.45, -0.15, 0.16, 0.04, 0.16));
    g.add(mesh(G.cone(4), M(p.color), -0.57, TOP + 0.55, -0.15, 0.13, 0.14, 0.13));
  }
  if (perks.includes('seeds')) g.add(mesh(G.cyl(10), M(0xe6d7a8), 0.15, TOP + 0.06, -0.55, 0.07, 0.12, 0.07));
  if (perks.includes('surveyor')) g.add(mesh(G.cone(3), M(0x6b4a2b), 0.6, TOP + 0.12, 0.3, 0.07, 0.24, 0.07));
  if (perks.includes('guild')) g.add(mesh(G.cyl(12), M(0xf0c040), -0.35, TOP + 0.03, 0.6, 0.06, 0.03, 0.06));
  if (perks.includes('maproom')) {
    const mr = house(0.2, 0.16, 0.18, 0xefe6d2, 0x2f6fd6);
    mr.position.set(0.1, TOP, -0.6);
    g.add(mr);
  }
  for (let i = 0; i < p.guards; i++) {
    const a = 2.3 + i * 0.4;
    const fig = figure(p.color);
    fig.position.set(Math.cos(a) * 0.6, TOP, Math.sin(a) * 0.6);
    g.add(fig);
  }
}

const FIRE_MAT = new THREE.MeshBasicMaterial({ color: 0xffa040 });
function buildPoi(rng, t, g) {
  const poi = t.poi;
  if (!poi) return;
  if (poi.type === 'ruins') {
    const stoneC = poi.repaired ? 0xfffaf0 : 0xc9c2b2;
    g.add(mesh(G.box(), M(stoneC), 0, TOP + 0.03, 0, 0.62, 0.06, 0.46));
    const cols = [[-0.24, -0.15], [0, -0.15], [0.24, -0.15], [-0.24, 0.15], [0, 0.15], [0.24, 0.15]];
    cols.forEach(([x, z], i) => {
      const h = poi.repaired ? 0.36 : [0.3, 0.12, 0.22, 0.08, 0.28, 0.16][i];
      g.add(mesh(G.cyl(10), M(stoneC), x, TOP + 0.06 + h / 2, z, 0.05, h, 0.05));
    });
    if (poi.repaired) {
      g.add(mesh(G.box(), M(stoneC), 0, TOP + 0.44, 0, 0.64, 0.05, 0.44));
      g.add(mesh(G.prism(), M(0x5a86c8), 0, TOP + 0.5, 0, 0.36, 0.1, 0.46));
    } else {
      const fallen = mesh(G.cyl(10), M(stoneC), 0.3, TOP + 0.05, 0.38, 0.05, 0.3, 0.05);
      fallen.rotation.z = Math.PI / 2;
      fallen.rotation.y = 0.6;
      g.add(fallen);
    }
  } else if (poi.type === 'mill') {
    const c = poi.repaired ? 0xfbefd6 : 0xa89c88;
    g.add(mesh(G.cyl(10), M(c), 0, TOP + 0.3, 0, 0.13, 0.6, 0.13));
    g.add(mesh(G.cone(10), M(poi.repaired ? 0xe0503a : 0x6a5a48), 0, TOP + 0.7, 0, 0.17, 0.22, 0.17));
    const blades = new THREE.Group();
    const n = poi.repaired ? 4 : 2;
    for (let i = 0; i < n; i++) {
      const holder = new THREE.Group();
      holder.rotation.z = (i / 4) * Math.PI * 2 + (poi.repaired ? 0 : 0.4);
      holder.add(mesh(G.box(), M(poi.repaired ? 0xfff6e6 : 0x8a7a66), 0, 0.2, 0, 0.07, 0.4, 0.01));
      blades.add(holder);
    }
    blades.position.set(0, TOP + 0.55, 0.17);
    if (poi.repaired) blades.userData.dynamic = 'spin';
    g.add(blades);
  } else if (poi.type === 'bandits') {
    [[-0.3, -0.2], [0.3, -0.25], [0, 0.35]].forEach(([x, z], i) => {
      const tt = mesh(G.cone(4), M([0x6a4a36, 0x5a3e2e, 0x7a563c][i]), x, TOP + 0.14, z, 0.2, 0.28, 0.2);
      tt.rotation.y = i;
      g.add(tt);
    });
    g.add(mesh(G.cyl(8), M(0x4a3a2a), 0, TOP + 0.02, 0, 0.12, 0.04, 0.12));
    const fire = new THREE.Mesh(G.cone(6), FIRE_MAT);
    fire.position.set(0, TOP + 0.1, 0);
    fire.scale.set(0.07, 0.16, 0.07);
    fire.userData.dynamic = 'flicker';
    g.add(fire);
    const f = flag(0x1a1a1a, 0.9);
    f.position.set(-0.45, TOP, 0.25);
    g.add(f);
    const skull = iconSprite('skull', 0.4, '#8a2a1a');
    skull.position.set(0, TOP + 1.05, 0);
    g.add(skull);
    for (let i = 0; i < poi.strength; i++) {
      const fig = figure(0x333333);
      const a = i * 1.4 + 0.5;
      fig.position.set(Math.cos(a) * 0.5, TOP, Math.sin(a) * 0.5);
      g.add(fig);
    }
  }
}

// ---------- baking: collapse a tile's static meshes into one geometry ----------
const _inv = new THREE.Matrix4();
const _mtx = new THREE.Matrix4();
function bake(root) {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const geos = [];
  const keep = [];
  const visit = (o, sway) => {
    if (o !== root && (o.userData.dynamic || o.isSprite)) { keep.push(o); return; }
    const sw = o.userData.sway != null ? o.userData.sway : sway;
    if (o.isMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(_mtx.multiplyMatrices(_inv, o.matrixWorld));
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      const sea = new Float32Array(n);
      const swa = new Float32Array(n * 2);
      const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
      for (const gr of groups) {
        const m = mats[gr.materialIndex] || mats[0];
        for (let i = gr.start; i < Math.min(n, gr.start + gr.count); i++) {
          col[i * 3] = m.color.r;
          col[i * 3 + 1] = m.color.g;
          col[i * 3 + 2] = m.color.b;
          sea[i] = m.userData.season || 0;
        }
      }
      if (sw != null) {
        const pos = g.attributes.position;
        for (let i = 0; i < n; i++) {
          swa[i * 2] = Math.max(0, pos.getY(i) - TOP);
          swa[i * 2 + 1] = sw;
        }
      }
      g.clearGroups();
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('aSeason', new THREE.BufferAttribute(sea, 1));
      g.setAttribute('aSway', new THREE.BufferAttribute(swa, 2));
      geos.push(g);
    }
    for (const c of o.children) visit(c, sw);
  };
  visit(root, null);
  const out = new THREE.Group();
  if (geos.length) {
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    const m = new THREE.Mesh(merged, WORLD_MAT);
    m.customDepthMaterial = WORLD_DEPTH;
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.baked = true;
    out.add(m);
  }
  for (const k of keep) out.attach(k);
  out.userData.dyn = keep.filter((k) => ['flap', 'spin', 'flicker', 'bob'].includes(k.userData.dynamic));
  return out;
}

// ---------- instanced particles ----------
class Particles {
  constructor(scene, cap = 500) {
    this.cap = cap;
    this.mesh = new THREE.InstancedMesh(G.blob(), new THREE.MeshToonMaterial({ gradientMap }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color());
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.list = [];
    this.dummy = new THREE.Object3D();
    this.col = new THREE.Color();
  }

  spawn(p) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({ life: 0, drag: 0, grow: 0, ...p });
  }

  update(dt) {
    const d = this.dummy;
    let n = 0;
    this.list = this.list.filter((p) => {
      p.life += dt;
      const k = p.life / p.max;
      if (k >= 1) return false;
      const drag = Math.max(0, 1 - p.drag * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.pos.x += p.vx * dt;
      p.pos.y += p.vy * dt;
      p.pos.z += p.vz * dt;
      p.size += p.grow * dt;
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      d.position.copy(p.pos);
      d.scale.setScalar(Math.max(0.001, p.size * fade));
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, this.col.set(p.color));
      n++;
      return true;
    });
    if (n || this.mesh.count) {
      this.mesh.count = n;
      this.mesh.instanceMatrix.needsUpdate = true;
      this.mesh.instanceColor.needsUpdate = true;
    }
  }
}

// bloom at quarter resolution: the soft glow does not need more, and it is the priciest pass
class CheapBloom extends UnrealBloomPass {
  setSize(w, h) {
    super.setSize(Math.max(1, w / 2), Math.max(1, h / 2));
  }
}

const BG_COLORS = [0xbfe3ee, 0xc4e8f2, 0xdfe0d4, 0xdbe7ee];
const WATER_Y = 0.08;
const MASK_EXTENT = 18;
const MASK_SIZE = 512;
const GHOST_CAP = 400;
const HL_MAT = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.9, depthWrite: false });

// ---------- World ----------
export class World3D {
  constructor(el, game) {
    this.el = el;
    this.game = game;
    this.tileObjs = new Map();
    this.ghostKeys = [];
    this.ghostSet = new Set();
    this.anims = [];
    this.onClick = null;
    this.onHover = null;
    this.validSet = new Set();
    this.validColor = 0xffffff;
    this.hoverKey = null;
    this.previewType = null;
    this.highlightKeys = new Set();
    this.timer = new THREE.Timer();
    this.quality = 'high';
    this.season = 0;
    this.shadowFrames = 2;
    this.fps = { frames: 0, t: 0, good: 0, cool: 0 };
    this.dummy = new THREE.Object3D();
    this._c = new THREE.Color();

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }));
    this.maxPR = Math.min(devicePixelRatio, 2);
    this.pr = this.maxPR;
    this.refreshEst = 60;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.shadowMap.autoUpdate = false;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.0;
    el.appendChild(r.domElement);

    const scene = (this.scene = new THREE.Scene());
    this.bg = new THREE.Color(BG_COLORS[0]);
    scene.background = this.bg;
    scene.fog = new THREE.Fog(this.bg, 48, 110);

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.5, 200);
    this.camera.position.set(3, 13, 15);
    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true;
    c.maxPolarAngle = 1.05;
    c.minDistance = 6;
    c.maxDistance = 34;
    c.screenSpacePanning = false;
    c.target.set(0, 0, 1);
    c.addEventListener('start', () => {
      this.camGoal = null;
      this.camVelT?.set(0, 0, 0);
      this.camVelP?.set(0, 0, 0);
    });

    scene.add(new THREE.HemisphereLight(0xfff8ee, 0x7fa4c8, 1.6));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0d6, 2.2));
    sun.position.set(10, 22, 12);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = sc.bottom = -17;
    sc.right = sc.top = 17;
    sc.near = 5;
    sc.far = 60;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 4;
    scene.add(sun);

    // the sea: coastline mask (R = narrow falloff, G = wide shelf) drawn from the tile layout
    this.maskCanvas = document.createElement('canvas');
    this.maskShape = document.createElement('canvas');
    this.maskTint = document.createElement('canvas');
    for (const cv of [this.maskCanvas, this.maskShape, this.maskTint]) cv.width = cv.height = MASK_SIZE;
    this.maskTex = new THREE.CanvasTexture(this.maskCanvas);
    this.maskTex.flipY = false;
    this.waterMat = createWaterMaterial(this.maskTex, MASK_EXTENT);
    this.waterMat.uniforms.uMask.value = this.maskTex;
    const water = new THREE.Mesh(new THREE.PlaneGeometry(240, 240, 48, 48).rotateX(-Math.PI / 2), this.waterMat);
    water.position.y = WATER_Y;
    scene.add(water);
    this.maskDirty = true;
    this.maskTimer = 0;
    // sandy beach sloping from every open coast edge into the sea (one merged mesh)
    this.shore = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap }));
    this.shore.receiveShadow = true;
    scene.add(this.shore);

    // landing marker under the held tile
    this.landingMat = createLandingMaterial();
    this.landing = new THREE.Mesh(new THREE.CircleGeometry(1, 6, Math.PI / 6).rotateX(-Math.PI / 2), this.landingMat);
    this.landing.visible = false;
    this.landing.renderOrder = 2;
    scene.add(this.landing);

    this.tilesGroup = new THREE.Group();
    this.fxGroup = new THREE.Group();
    this.previewGroup = new THREE.Group();
    scene.add(this.tilesGroup, this.fxGroup, this.previewGroup);

    // frontier ghosts: one instanced mesh + one Points draw for the '?' markers
    this.ghosts = new THREE.InstancedMesh(G.ghost(), new THREE.MeshToonMaterial({
      gradientMap, transparent: true, opacity: 0.42, depthWrite: false,
    }), GHOST_CAP);
    this.ghosts.count = 0;
    this.ghosts.setColorAt(0, new THREE.Color());
    this.ghosts.frustumCulled = false;
    scene.add(this.ghosts);
    const q = textTexture('?', { bg: null, fg: '#9fb3ad', size: 90, pad: 10 });
    this.qPoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
      map: q.tex, size: 0.7, transparent: true, opacity: 0.8, depthWrite: false, alphaTest: 0.05,
    }));
    this.qPoints.frustumCulled = false;
    scene.add(this.qPoints);
    this.poiIcons = new Map();

    this.particles = new Particles(scene);

    // synergy preview: beads flowing from supporting neighbours into the hovered spot + rings on them
    this.synBeads = new THREE.InstancedMesh(G.sphere(), new THREE.MeshBasicMaterial({ color: 0xffffff }), 120);
    this.synBeads.count = 0;
    this.synBeads.frustumCulled = false;
    this.synBeads.renderOrder = 8;
    this.synBeads.setColorAt(0, new THREE.Color());
    scene.add(this.synBeads);
    this.synRings = new THREE.InstancedMesh(G.ring(), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false }), 12);
    this.synRings.count = 0;
    this.synRings.frustumCulled = false;
    this.synRings.setColorAt(0, new THREE.Color());
    scene.add(this.synRings);
    this.synergy = null;

    this.badges = new THREE.Points(new THREE.BufferGeometry(), createBadgeMaterial(buildBadgeAtlas()));
    this.badges.frustumCulled = false;
    this.badges.renderOrder = 9; // below name labels (10) and quest flags (11)
    scene.add(this.badges);

    // birds: one instanced draw call; small pale gulls circling low over the island
    const wing = new THREE.BufferGeometry();
    wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.03, 0.13, 0, 0, 0, 0, 0.035], 3));
    wing.computeVertexNormals();
    this.birdMesh = new THREE.InstancedMesh(wing, new THREE.MeshBasicMaterial({ color: 0xf8faf9, side: THREE.DoubleSide }), 40);
    this.birdMesh.frustumCulled = false;
    scene.add(this.birdMesh);
    this.flocks = [0, 1, 2].map((f) => ({
      a: f * 2.1, r: 4 + f * 2.5, speed: (0.16 + f * 0.03) * (f % 2 ? -1 : 1), h: 2.4 + f * 0.5, n: [5, 4, 6][f], cx: f - 1, cz: 1 - f,
    }));
    this.birdDummy = new THREE.Object3D();

    this.weather = createWeather();
    scene.add(this.weather);

    // post-processing: bloom + a single finish pass (tilt-shift, grade, vignette)
    const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(r, rt);
    this.composer.addPass(new RenderPass(scene, this.camera));
    this.bloom = new CheapBloom(new THREE.Vector2(1, 1), 0.22, 0.5, 1.02);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FinishShader);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._bindPointer();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    this.rect = null; // cached canvas rect (avoids forced layouts when projecting many points)
    // MSAA only when the pixel ratio is low; at high DPR the extra pixels already smooth edges
    const samples = this.pr >= 1.5 ? 0 : 4;
    for (const t of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (t.samples !== samples) { t.samples = samples; t.dispose(); }
    }
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.pr);
    this.composer.setSize(w, h);
    if (this.badges) {
      this.badges.material.uniforms.uScale.value = (h * this.pr) / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
      this.badges.material.uniforms.uMin.value = 26 * this.pr;
    }
    this.camera.aspect = w / h;
    // in the main menu the island sits right of centre, next to the menu text
    if (this.viewShift == null) this.viewShift = this.menuMode ? 0.16 : 0;
    this.applyViewShift();
  }

  setQuality(q) {
    this.quality = q;
    this.maxPR = q === 'high' ? Math.min(devicePixelRatio, 2) : 1;
    this.pr = Math.min(this.pr, this.maxPR);
    const size = q === 'high' ? 2048 : 1024;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.shadowFrames = 2;
    this.resize();
  }

  // Adapt render resolution to keep the frame rate smooth
  adaptResolution(dt) {
    const f = this.fps;
    f.frames++;
    f.t += dt;
    if (f.t < 1.5) return;
    const fps = f.frames / f.t;
    f.frames = 0;
    f.t = 0;
    this.lastFps = fps;
    // estimate the display refresh rate (60/120/144...) from the best observed frame rate
    const rate = [60, 75, 90, 120, 144, 165, 240].filter((r) => r <= fps * 1.05).pop() || 60;
    this.refreshEst = Math.max(this.refreshEst, rate);
    if (f.cool > 0) f.cool--;
    // only trade sharpness for speed when frames are genuinely dropping
    if (fps < Math.min(55, this.refreshEst * 0.85) && this.pr > 1) {
      this.pr = Math.max(1, this.pr - 0.25);
      f.good = 0;
      f.cool = 8; // avoid oscillating straight back up
      this.resize();
    } else if (fps > Math.min(58, this.refreshEst * 0.9)) {
      f.good++;
      if (f.good >= 3 && !f.cool && this.pr < this.maxPR) {
        this.pr = Math.min(this.maxPR, this.pr + 0.25);
        f.good = 0;
        this.resize();
      }
    }
  }

  setMenuMode(on) {
    this.menuMode = on;
    this.controls.autoRotate = on;
    this.controls.autoRotateSpeed = 0.5;
    this.controls.enabled = !on;
    // slide the menu's off-centre framing back to centre instead of snapping
    const from = this.viewShift ?? 0;
    const to = on ? 0.16 : 0;
    if (from === to) return this.resize();
    this.animate(on ? 0.01 : 1.6, (k) => {
      const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      this.viewShift = from + (to - from) * e;
      this.applyViewShift();
    });
  }

  applyViewShift() {
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (this.viewShift > 0.001 && w > 800) this.camera.setViewOffset(w, h, -w * this.viewShift, 0, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  // The one place camera moves are made. The camera is pulled towards a goal by a critically
  // damped spring, so changing the goal mid-flight never makes the view jump: position and
  // velocity always stay continuous. Grabbing the camera yourself cancels the pull.
  moveCamera(toTarget, toPos, dur, { kind = 'move' } = {}) {
    this.camVelT ??= new THREE.Vector3();
    this.camVelP ??= new THREE.Vector3();
    const prev = this.camGoal;
    this.camGoal = {
      t: toTarget.clone(), p: toPos.clone(), k: 4.2 / Math.max(0.3, dur), kind,
      // the spring chases a smoothed copy of the goal, so a new goal eases in instead of yanking
      ts: prev ? prev.ts : this.controls.target.clone(),
      ps: prev ? prev.ps : this.camera.position.clone(),
    };
    return this.camGoal;
  }

  _springTo(x, v, goal, k, dt) {
    const a = goal.clone().sub(x).multiplyScalar(k * k).addScaledVector(v, -2 * k);
    v.addScaledVector(a, dt);
    x.addScaledVector(v, dt);
  }

  updateCamera(dt) {
    const g = this.camGoal;
    if (!g) return;
    // sub-step so the spring stays smooth and stable on slow frames
    const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / steps;
    const f = 1 - Math.exp(-g.k * 1.6 * h);
    for (let i = 0; i < steps; i++) {
      g.ts.lerp(g.t, f);
      g.ps.lerp(g.p, f);
      this._springTo(this.controls.target, this.camVelT, g.ts, g.k, h);
      this._springTo(this.camera.position, this.camVelP, g.ps, g.k, h);
    }
    if (this.camera.position.distanceTo(g.p) < 0.01 && this.camVelP.length() < 0.01 && this.controls.target.distanceTo(g.t) < 0.01) {
      this.camGoal = null;
      this.camVelT.set(0, 0, 0);
      this.camVelP.set(0, 0, 0);
    }
  }

  // From wherever the camera is (e.g. the menu orbit) glide down to the player's corner of the map
  intro(k) {
    const { x, z } = toWorld(k);
    const to = new THREE.Vector3(x * 0.45, 0, z * 0.45 + 1);
    this.moveCamera(to, to.clone().add(new THREE.Vector3(2, 13, 14)), 2.2, { kind: 'intro' });
  }

  // Screen position (CSS px) of a hex's top centre, for anchoring DOM UI to the world
  projectKey(k, y = TOP + 0.3) {
    const { x, z } = toWorld(k);
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.rect || (this.rect = this.renderer.domElement.getBoundingClientRect());
    return { x: rect.left + ((v.x + 1) / 2) * rect.width, y: rect.top + ((1 - v.y) / 2) * rect.height, behind: v.z > 1 };
  }

  // Glide the view to a hex (or a list of hexes) without changing angle or zoom
  follow(keys, dur = 0.9) {
    const list = Array.isArray(keys) ? keys : [keys];
    if (!list.length) return;
    const c = list.map(toWorld).reduce((a, b) => ({ x: a.x + b.x / list.length, z: a.z + b.z / list.length }), { x: 0, z: 0 });
    const to = new THREE.Vector3(c.x, 0, c.z);
    const g = this.camGoal;
    if (g) {
      // already moving: keep the intended viewing offset and just pull towards the new spot;
      // an intro keeps its (slower) pace so the flight doesn't suddenly speed up
      const offset = g.p.clone().sub(g.t);
      this.moveCamera(to, to.clone().add(offset), g.kind === 'intro' ? 4.2 / g.k : dur, { kind: g.kind });
      return;
    }
    if (this.controls.target.distanceTo(to) < 0.5) return;
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.moveCamera(to, to.clone().add(offset), dur);
  }

  focus(k, dur = 0.8) {
    this.follow(k, dur);
  }

  reset() {
    for (const o of this.tileObjs.values()) this.disposeTile(o);
    this.tileObjs.clear();
    for (const s of this.poiIcons.values()) { this.scene.remove(s); this.disposeGroup(s); }
    this.poiIcons.clear();
    for (const m of this.questMarkers?.values() || []) { this.scene.remove(m.sprite); m.sprite.material.dispose(); }
    this.questMarkers?.clear();
    this.ghostKeys = [];
    this.ghostSet = new Set();
    this.ghosts.count = 0;
    this.fxGroup.clear();
    this.previewGroup.clear();
    this.particles.list = [];
    this.anims = [];
    this.camGoal = null;
    this.rebuildQueue?.clear();
    this.buildQueue = [];
    this.validSet = new Set();
    this.highlightKeys = new Set();
    this.previewType = null;
  }

  loadAll() {
    this.reset();
    for (const t of this.game.tiles.values()) this.addTile(t);
    this.syncFrontier();
    this.syncQuests();
    this.syncBadges();
    this.setSeason(this.game.season, true);
  }

  // Menu -> game without a cut: the menu island sinks away from the rim inwards while the real
  // world drops in from the centre outwards, and the camera glides from the menu view to the player
  transitionTo(homeKey) {
    const old = [...this.tileObjs.values()];
    this.tileObjs = new Map();
    this.maskDirty = true;
    this.menuFlight = null;
    this.highlightKeys = new Set();
    this.validSet = new Set();
    this.ghostKeys = [];
    this.ghostSet = new Set();
    this.ghosts.count = 0;
    this.qPoints.geometry.dispose();
    this.qPoints.geometry = new THREE.BufferGeometry();
    for (const sp of this.poiIcons.values()) { this.scene.remove(sp); this.disposeGroup(sp); }
    this.poiIcons.clear();
    for (const m of this.questMarkers?.values() || []) { this.scene.remove(m.sprite); m.sprite.material.dispose(); }
    this.questMarkers?.clear();
    this.badges.geometry.dispose();
    this.badges.geometry = new THREE.BufferGeometry();

    const maxD = Math.max(1, ...old.map((o) => Math.hypot(o.holder.position.x, o.holder.position.z)));
    for (const o of old) {
      const d = Math.hypot(o.holder.position.x, o.holder.position.z);
      const g = o.holder;
      const delay = (maxD - d) * 0.045 + Math.random() * 0.12;
      this.animate(0.55, (k) => {
        const e = k * k * k;
        g.position.y = -1.6 * e;
        g.scale.setScalar(1 - 0.25 * e);
      }, () => this.disposeTile(o), delay);
    }

    const fresh = [...this.game.tiles.values()].map((t) => {
      const { x, z } = toWorld(t.key);
      return { t, d: Math.hypot(x, z) };
    }).sort((a, b) => a.d - b.d);
    const start = Math.min(0.9, maxD * 0.045 * 0.6);
    let last = 0;
    // tiles are built from a queue with a per-frame time budget (see tick), each one starting its
    // fall when it is built; on a full map that keeps every frame light while the wave rolls out
    this.buildQueue = fresh.map(({ t, d }) => {
      const at = start + d * 0.09 + Math.random() * 0.1;
      last = Math.max(last, at);
      return { t, at };
    }).sort((a, b) => a.at - b.at);
    this.buildClock = 0;
    const finish = () => {
      if (this.buildQueue.length) return this.animate(0.01, () => {}, finish, 0.1);
      this.syncFrontier();
      this.syncQuests();
      this.syncBadges();
    };
    this.animate(0.01, () => {}, finish, last + 0.65);
    this.setSeason(this.game.season);

    const { x, z } = toWorld(homeKey);
    const to = new THREE.Vector3(x * 0.45, 0, z * 0.45 + 1);
    this.moveCamera(to, to.clone().add(new THREE.Vector3(2, 13, 14)), 2.6, { kind: 'intro' });
    return last + 0.65;
  }

  // Title sequence: the island assembles itself in rings while the camera swoops in
  playIntro() {
    this.reset();
    const tiles = [...this.game.tiles.values()].map((t) => {
      const { x, z } = toWorld(t.key);
      return { t, d: Math.hypot(x, z) };
    }).sort((a, b) => a.d - b.d);
    tiles.forEach(({ t, d }) => this.addTile(t, true, 0.5 + d * 0.13 + Math.random() * 0.15));
    const last = 0.5 + tiles[tiles.length - 1].d * 0.13 + 0.6;
    this.animate(0.01, () => {}, () => { this.syncFrontier(); this.syncBadges(); }, last);
    this.controls.autoRotate = false;
    const from = new THREE.Vector3(0.5, 42, 3);
    const to = new THREE.Vector3(10, 11, 15);
    this.camera.position.copy(from);
    this.controls.target.set(0, 0, 0);
    const token = (this.menuFlight = {});
    this.animate(4.2, (k) => {
      if (this.menuFlight !== token) return; // a game started: the spring camera takes over
      const e = 1 - (1 - k) ** 3;
      const a = (1 - e) * 1.6;
      const r = THREE.MathUtils.lerp(Math.hypot(from.x, from.z), Math.hypot(to.x, to.z), e);
      const base = Math.atan2(to.x, to.z);
      this.camera.position.set(Math.sin(base + a) * r, THREE.MathUtils.lerp(from.y, to.y, e), Math.cos(base + a) * r);
    }, () => { this.controls.autoRotate = this.menuMode; });
  }

  // ---------- seasons (pure uniform animation) ----------
  setSeason(season, instant = false) {
    this.season = season;
    const targets = [new THREE.Vector4()];
    for (const [kind, id] of Object.entries(SEASON_IDS)) {
      const t = SEASON_TINT[kind][season];
      if (!t) targets[id] = new THREE.Vector4(0, 0, 0, 0);
      else {
        const col = new THREE.Color(t[0] === 'autumn' ? AUTUMN[0] : t[0]);
        targets[id] = new THREE.Vector4(col.r, col.g, col.b, t[1]);
      }
    }
    const from = U.uTints.value.map((v) => v.clone());
    const apply = (k) => U.uTints.value.forEach((v, i) => {
      if (!i) return;
      const f = from[i];
      const to = targets[i];
      const tc = to.w > 0 ? to : f;
      const fc = f.w > 0 ? f : to;
      v.set(fc.x + (tc.x - fc.x) * k, fc.y + (tc.y - fc.y) * k, fc.z + (tc.z - fc.z) * k, f.w + (to.w - f.w) * k);
    });
    if (instant) apply(1);
    else this.animate(3, apply);

    const w = this.weather.material.uniforms;
    const cfg = [
      { c1: 0xffc4de, c2: 0xffffff, size: 2.5, speed: 0.4, op: 0.6, dens: 0.08 },
      { c1: 0xfff3a0, c2: 0xd9ff8a, size: 3, speed: 0.15, op: 0.0, dens: 0.1 },
      { c1: 0xe0702a, c2: 0xf0b02c, size: 5, speed: 0.6, op: 0.95, dens: 0.25 },
      { c1: 0xffffff, c2: 0xe6f2ff, size: 4.5, speed: 0.9, op: 0.95, dens: 0.9 },
    ][season];
    w.uColor.value.set(cfg.c1);
    w.uColor2.value.set(cfg.c2);
    w.uSize.value = cfg.size;
    w.uSpeed.value = cfg.speed;
    w.uDensity.value = cfg.dens;
    this.weather.visible = true;
    const op0 = w.uOpacity.value;
    const done = () => { this.weather.visible = cfg.op > 0; };
    if (instant) { w.uOpacity.value = cfg.op; done(); } else this.animate(3, (k) => { w.uOpacity.value = op0 + (cfg.op - op0) * k; }, done);

    const sunCols = [0xfff0d6, 0xfff4d0, 0xffd6a0, 0xe4ecff];
    const fromBg = this.bg.clone();
    const fromSun = this.sun.color.clone();
    const toBg = new THREE.Color(BG_COLORS[season]);
    const toSun = new THREE.Color(sunCols[season]);
    const f = (k) => {
      this.bg.lerpColors(fromBg, toBg, k);
      this.scene.fog.color.copy(this.bg);
      this.sun.color.lerpColors(fromSun, toSun, k);
    };
    if (instant) f(1);
    else this.animate(3, f);
  }

  // ---------- tiles ----------
  buildTileGroup(t, doBake = true) {
    const g = new THREE.Group();
    const rng = seededRng(t.key + t.type);
    const top = TOP_COLORS[t.type];
    const topM = t.type === 'mountain' ? SM('rock', top) : SM('grass', top);
    const soil = M(0x6e4a2f);
    const layer = M(t.type === 'mountain' ? 0x9a8d78 : SIDE);
    g.add(mesh(G.soil(), [soil, soil, soil]));
    g.add(mesh(G.layer(), [layer, layer, layer]));
    g.add(mesh(G.lip(), [topM, topM, topM]));

    const builders = {
      forest: buildForest, meadow: buildMeadow, field: buildField, mountain: buildMountain,
      lake: buildLake, village: buildVillage, home: buildHome,
    };
    builders[t.type](rng, t, g, this.game);
    buildPoi(rng, t, g);

    if (t.owner != null && t.type !== 'village') {
      const ring = mesh(G.ring(), M(this.game.players[t.owner].color));
      ring.position.y = TOP + 0.006;
      g.add(ring);
    }
    if (t.poi?.type === 'bandits') {
      const ring = mesh(G.ring(), M(0x4a1010));
      ring.position.y = TOP + 0.006;
      g.add(ring);
    }
    if (t.type === 'village' && !t.district) {
      const label = textSprite('Haven', { bg: '#2f3a36', fg: '#f7d774', size: 40, pad: 22, scale: 0.012 });
      label.position.set(0, TOP + 2.25, 0);
      g.add(label);
    }
    // neutral tiles around Haven get a dirt road leading into town
    if (t.owner == null && t.type !== 'village' && !t.poi && distOrigin(t.key) === 1) {
      const { x, z } = toWorld(t.key);
      const len = Math.hypot(x, z);
      const road = mesh(G.box(), M(0xe0c690), -x / len * 0.5, TOP + 0.012, -z / len * 0.5, 0.16, 0.012, 1.0);
      road.rotation.y = Math.atan2(-x, -z);
      road.receiveShadow = true;
      g.add(road);
    }
    if (t.type === 'home') {
      const p = this.game.players[t.owner];
      const label = textSprite(p.name, { bg: `#${p.color.toString(16).padStart(6, '0')}`, fg: '#ffffff', size: 34, scale: 0.01 });
      label.position.set(0, TOP + 1.35, 0);
      g.add(label);
    }
    if (!doBake) return g;
    const baked = bake(g);
    baked.userData.chimney = g.userData.chimney;
    return baked;
  }

  disposeGroup(g) {
    g.traverse((m) => {
      if (m.userData.baked) m.geometry.dispose();
      if (m.isSprite) m.material.dispose();
    });
  }

  disposeTile(o) {
    this.maskDirty = true;
    this.tilesGroup.remove(o.holder);
    this.disposeGroup(o.g);
  }

  addTile(t, animate = false, delay = 0, { quiet = false } = {}) {
    const { x, z } = toWorld(t.key);
    const holder = new THREE.Group();
    holder.position.set(x, 0, z);
    const g = this.buildTileGroup(t);
    holder.add(g);
    this.tilesGroup.add(holder);
    const o = { holder, g };
    this.tileObjs.set(t.key, o);
    this.maskDirty = true;
    if (this.highlightKeys.has(t.key)) this.addHL(o);
    this.shadowFrames = Math.max(this.shadowFrames, 2);
    if (animate) {
      const from = this.pendingDrop?.key === t.key ? this.pendingDrop.st : null;
      this.pendingDrop = null;
      const y0 = from ? from.pos.y : 3.5;
      const rx = from ? from.rot.x : 0;
      const rz = from ? from.rot.z : 0;
      const ry = from ? from.rot.y : -0.6;
      const ox = from ? from.pos.x - x : 0;
      const oz = from ? from.pos.z - z : 0;
      const dur = from ? 0.42 : 0.6;
      g.position.set(ox, y0, oz);
      g.rotation.set(rx, ry, rz);
      if (delay) g.visible = false;
      let landed = false;
      this.animate(dur, (k) => {
        g.visible = true;
        // gravity fall, then squash & bounce on impact
        const fall = Math.min(1, k / 0.55);
        const ease = fall * fall;
        g.position.x = ox * (1 - ease);
        g.position.z = oz * (1 - ease);
        g.rotation.set(rx * (1 - ease), ry * (1 - ease), rz * (1 - ease));
        if (k < 0.55) {
          g.position.y = y0 * (1 - ease);
          g.scale.set(0.96, 1.04, 0.96);
        } else {
          if (!landed) { landed = true; if (!quiet) { this.poof(x, z); this.shockwave(x, z); } }
          const b = (k - 0.55) / 0.45;
          const wob = Math.sin(b * Math.PI * 2.5) * (1 - b);
          g.position.y = Math.max(0, Math.sin(b * Math.PI) * 0.08 * (1 - b));
          g.scale.set(1 + wob * 0.08, 1 - wob * 0.14, 1 + wob * 0.08);
        }
      }, () => { g.scale.setScalar(1); g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); }, delay);
    }
  }

  // Non-urgent tile updates (crops growing, guards hired) are queued and rebuilt a few per frame
  refreshTile(t, opts = {}) {
    if (!opts.built && this.tileObjs.has(t.key)) {
      (this.rebuildQueue ??= new Map()).set(t.key, t);
      return;
    }
    this._refresh(t, opts);
  }

  _refresh(t, opts = {}) {
    const o = this.tileObjs.get(t.key);
    if (!o) return this.addTile(t, true);
    o.holder.remove(o.g);
    this.disposeGroup(o.g);
    o.g = this.buildTileGroup(t);
    o.holder.add(o.g);
    this.shadowFrames = Math.max(this.shadowFrames, 2);
    const g = o.g;
    if (opts.built) {
      const { x, z } = toWorld(t.key);
      this.poof(x, z, 0xfff3c4);
      this.sparkle(x, z);
      g.scale.setScalar(0.8);
      this.animate(0.45, (k) => g.scale.setScalar(0.8 + 0.2 * easeOutBack(k)));
    } else {
      g.scale.y = 0.9;
      this.animate(0.4, (k) => { g.scale.y = 0.9 + 0.1 * easeOutBack(k); });
    }
  }

  // Small icons on the front edge of tiles: guards, buildings, crops, ruins/mill, workshop perks
  syncBadges() {
    const game = this.game;
    const pos = [];
    const icon = [];
    for (const t of game.tiles.values()) {
      const list = [];
      if (t.type === 'home') {
        const p = game.players[t.owner];
        if (p.guards > 0) list.push(`shield${Math.min(5, p.guards)}`);
        if (p.perks?.length) list.push('workshop');
      }
      if (t.building) list.push(t.upgraded ? 'improved' : 'building');
      if (t.crop) list.push('crop');
      if (t.poi?.type === 'ruins') list.push(t.poi.repaired ? 'ruinsDone' : 'ruins');
      if (t.poi?.type === 'mill') list.push(t.poi.repaired ? 'millDone' : 'mill');
      if (!list.length) continue;
      const { x, z } = toWorld(t.key);
      list.forEach((id, i) => {
        pos.push(x + (i - (list.length - 1) / 2) * 0.44, TOP + 0.24, z + 0.6);
        icon.push(BADGES.indexOf(id));
      });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aIcon', new THREE.Float32BufferAttribute(icon, 1));
    this.badges.geometry.dispose();
    this.badges.geometry = g;
  }

  // ---------- quest markers (Dorfromantik-style flags with a remaining count) ----------
  syncQuests() {
    this.questMarkers ??= new Map();
    const game = this.game;
    const active = new Map(game.quests.filter((q) => !q.done).map((q) => [q.id, q]));
    for (const [id, m] of this.questMarkers) {
      if (!active.has(id)) {
        this.questMarkers.delete(id);
        const s = m.sprite;
        const start = s.scale.clone();
        this.animate(0.4, (k) => s.scale.copy(start).multiplyScalar(1 + k * 0.6), () => {
          this.scene.remove(s);
          s.material.map.dispose();
          s.material.dispose();
        });
        this.animate(0.4, (k) => { s.material.opacity = 1 - k; });
      }
    }
    for (const [id, q] of active) {
      const left = Math.max(0, q.target - game.questProgress(q));
      const m = this.questMarkers.get(id);
      if (m && m.left === left) continue;
      const color = `#${game.players[q.pid].color.toString(16).padStart(6, '0')}`;
      const sprite = questSprite(left, color);
      const { x, z } = toWorld(q.key);
      sprite.position.set(x, TOP + 1.05, z);
      if (m) {
        this.scene.remove(m.sprite);
        m.sprite.material.map.dispose();
        m.sprite.material.dispose();
      } else {
        const target = sprite.scale.clone();
        sprite.scale.multiplyScalar(0.01);
        this.animate(0.5, (k) => sprite.scale.copy(target).multiplyScalar(Math.max(0.01, easeOutBack(k))));
      }
      this.scene.add(sprite);
      this.questMarkers.set(id, { sprite, left });
    }
  }

  buildShore() {
    const keys = this.tileObjs;
    const pos = [];
    const col = [];
    const dry = new THREE.Color(0xf4e0a4);
    const wet = new THREE.Color(0xd6bd82);
    const yTop = 0.17;
    const yBot = WATER_Y - 0.06;
    const out = 0.4;
    for (const k of keys.keys()) {
      const c = toWorld(k);
      for (let i = 0; i < 6; i++) {
        const a0 = Math.PI / 2 + (i * Math.PI) / 3;
        const a1 = a0 + Math.PI / 3;
        const am = a0 + Math.PI / 6;
        const nx = Math.cos(am);
        const nz = Math.sin(am);
        if (keys.has(hexKeyAt(c.x + nx * Math.sqrt(3), c.z + nz * Math.sqrt(3)))) continue;
        const v0x = c.x + Math.cos(a0);
        const v0z = c.z + Math.sin(a0);
        const v1x = c.x + Math.cos(a1);
        const v1z = c.z + Math.sin(a1);
        // mitred outer corners so neighbouring beach strips meet on convex corners
        const ex = (v1x - v0x);
        const ez = (v1z - v0z);
        const m = out * 0.577;
        const o0x = v0x + nx * out - ex * m;
        const o0z = v0z + nz * out - ez * m;
        const o1x = v1x + nx * out + ex * m;
        const o1z = v1z + nz * out + ez * m;
        pos.push(v0x, yTop, v0z, o1x, yBot, o1z, v1x, yTop, v1z, v0x, yTop, v0z, o0x, yBot, o0z, o1x, yBot, o1z);
        for (const c2 of [dry, wet, dry, dry, wet, wet]) col.push(c2.r, c2.g, c2.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    this.shore.geometry.dispose();
    this.shore.geometry = g;
    this.shadowFrames = Math.max(this.shadowFrames, 1);
  }

  updateMask() {
    this.buildShore();
    this.maskDirty = false;
    const S = MASK_SIZE;
    const toPx = (v) => (v / (MASK_EXTENT * 2) + 0.5) * S;
    const sctx = this.maskShape.getContext('2d');
    sctx.clearRect(0, 0, S, S);
    sctx.fillStyle = '#fff';
    for (const k of this.tileObjs.keys()) {
      const { x, z } = toWorld(k);
      sctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = Math.PI / 2 + (i * Math.PI) / 3;
        const px = toPx(x + Math.cos(a) * 1.0);
        const pz = toPx(z + Math.sin(a) * 1.0);
        if (i) sctx.lineTo(px, pz);
        else sctx.moveTo(px, pz);
      }
      sctx.closePath();
      sctx.fill();
    }
    const ctx = this.maskCanvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S, S);
    ctx.globalCompositeOperation = 'lighter';
    const tctx = this.maskTint.getContext('2d');
    for (const [color, blur] of [['#ff0000', 5], ['#00ff00', 28]]) {
      tctx.globalCompositeOperation = 'source-over';
      tctx.clearRect(0, 0, S, S);
      tctx.drawImage(this.maskShape, 0, 0);
      tctx.globalCompositeOperation = 'source-in';
      tctx.fillStyle = color;
      tctx.fillRect(0, 0, S, S);
      ctx.filter = `blur(${blur}px)`;
      ctx.drawImage(this.maskTint, 0, 0);
    }
    ctx.filter = 'none';
    this.maskTex.needsUpdate = true;
  }

  // A scouted, unclaimed find: a little sand-and-grass islet carrying the ruin / mill / chest / camp,
  // bobbing in the water with a white (not player-coloured) rim so it clearly belongs to nobody
  buildIslet(k, secret) {
    const rng = seededRng(`${k}islet`);
    const g = new THREE.Group();
    const top = 0.2;
    g.add(mesh(G.disc(6), M(0xefdca2), 0, top - 0.07, 0, 0.8, 0.14, 0.8));
    g.add(mesh(G.disc(6), SM('grass', 0xa9d57a), 0, top + 0.005, 0, 0.66, 0.03, 0.66));
    for (const p of pointsInHex(rng, 3, { rMax: 0.55, avoidCenter: 0.4 })) {
      g.add(mesh(G.cone(5), SM('grass', 0x6cc043), p.x, top + 0.05, p.z, 0.04, 0.09, 0.04));
    }
    const inner = new THREE.Group();
    inner.position.y = top - TOP;
    inner.scale.setScalar(0.85);
    if (secret === 'treasure') {
      inner.add(mesh(G.box(), M(0x9a5a2e), 0, TOP + 0.08, 0, 0.3, 0.16, 0.2));
      inner.add(mesh(G.cyl(10), M(0xb36a36), 0, TOP + 0.17, 0, 0.1, 0.3, 0.1).rotateZ(Math.PI / 2));
      inner.add(mesh(G.box(), M(0xf0c040), 0, TOP + 0.12, 0.101, 0.05, 0.07, 0.01));
    } else {
      buildPoi(rng, { poi: { type: secret, repaired: false, strength: 2 } }, inner);
    }
    g.add(inner);
    const ring = mesh(G.ring(), M(0xffffff));
    ring.position.y = top + 0.02;
    ring.scale.setScalar(0.72);
    g.add(ring);
    const baked = bake(g);
    const { x, z } = toWorld(k);
    baked.position.set(x, 0, z);
    baked.userData.bob = rng() * 6;
    return baked;
  }

  // ---------- frontier ----------
  syncFrontier() {
    const game = this.game;
    this.ghostKeys = [...game.frontier()].slice(0, GHOST_CAP);
    this.ghostSet = new Set(this.ghostKeys);
    this.ghostPos = this.ghostKeys.map((k) => toWorld(k));
    this.ghosts.count = this.ghostKeys.length;
    const qPos = [];
    const want = new Map();
    this.ghostKeys.forEach((k, i) => {
      const { x, z } = this.ghostPos[i];
      const secret = game.revealed.has(k) ? (game.secrets.get(k) || 'none') : 'unknown';
      if (secret === 'unknown') qPos.push(x, 0.2, z);
      else if (secret !== 'none') want.set(k, secret);
    });
    this.qPoints.geometry.dispose();
    this.qPoints.geometry = new THREE.BufferGeometry();
    this.qPoints.geometry.setAttribute('position', new THREE.Float32BufferAttribute(qPos, 3));

    for (const [k, s] of this.poiIcons) {
      if (want.get(k) !== s.userData.secret) {
        this.scene.remove(s);
        this.disposeGroup(s);
        this.poiIcons.delete(k);
      }
    }
    for (const [k, secret] of want) {
      if (this.poiIcons.has(k)) continue;
      const islet = this.buildIslet(k, secret);
      islet.userData.secret = secret;
      islet.scale.setScalar(0.01);
      this.animate(0.6, (k2) => islet.scale.setScalar(Math.max(0.01, easeOutBack(k2))));
      this.scene.add(islet);
      this.poiIcons.set(k, islet);
    }
  }

  setValid(keys, color = 0xffffff) {
    this.validSet = new Set(keys);
    this.validColor = color;
    this.validTint = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45);
    this.updatePreview();
  }

  setPreview(type) {
    this.previewType = type;
    this.updatePreview();
  }

  addHL(o) {
    o.hl = new THREE.Mesh(G.ring(), HL_MAT);
    o.hl.position.y = TOP + 0.014;
    o.hl.scale.setScalar(0.9);
    o.holder.add(o.hl);
  }

  setHighlights(keys) {
    this.highlightKeys = new Set(keys);
    for (const [k, o] of this.tileObjs) {
      if (this.highlightKeys.has(k) && !o.hl) this.addHL(o);
      else if (!this.highlightKeys.has(k) && o.hl) {
        o.holder.remove(o.hl);
        o.hl = null;
      }
    }
  }

  // per frame: only instance data of ~100 ghosts
  styleGhosts(time) {
    const d = this.dummy;
    const c = this._c;
    const pulse = 0.82 + 0.18 * Math.sin(time * 4);
    const valid = this.validTint || c;
    for (let i = 0; i < this.ghostKeys.length; i++) {
      const k = this.ghostKeys[i];
      const { x, z } = this.ghostPos[i];
      const isV = this.validSet.has(k);
      const isH = this.highlightKeys.has(k);
      const hover = k === this.hoverKey && (isV || isH);
      d.position.set(x, hover ? 0.16 : 0.11, z);
      d.updateMatrix();
      this.ghosts.setMatrixAt(i, d.matrix);
      if (isV) c.copy(valid).multiplyScalar(hover ? 1.15 : pulse);
      else if (isH) c.setHex(0xfff2a8).multiplyScalar(hover ? 1.1 : pulse);
      else c.setHex(0xe6fbff);
      this.ghosts.setColorAt(i, c);
    }
    this.ghosts.instanceMatrix.needsUpdate = true;
    this.ghosts.instanceColor.needsUpdate = true;
  }

  // The tile in hand: built once per type, follows the cursor with a spring,
  // tilts into its motion and hovers over the slot it would drop into.
  updatePreview() {
    const type = this.previewType;
    if (type !== this.heldType) {
      if (this.held) {
        this.scene.remove(this.held);
        this.disposeGroup(this.held);
      }
      this.held = null;
      this.heldType = type;
      if (type) {
        const g = this.buildTileGroup({ key: 'held', type, owner: null, crop: null, poi: null, building: null });
        g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        this.held = new THREE.Group();
        this.held.add(g);
        this.held.visible = false;
        this.scene.add(this.held);
        this.heldState = null;
      }
    }
  }

  updateHeld(dt, time) {
    const h = this.held;
    const k = this.hoverKey;
    const valid = k && this.validSet.has(k);
    if (valid) {
      const { x, z } = toWorld(k);
      this.landing.position.set(x, 0.145, z);
      this.landingMat.uniforms.uColor.value.set(this.validColor);
    }
    this.landing.visible = !!(h && valid);
    if (!h) return;
    if (!this.cursorPoint && !valid) { h.visible = false; this.heldState = null; return; }
    const target = new THREE.Vector3();
    if (valid) {
      const { x, z } = toWorld(k);
      target.set(x, 0.85 + Math.sin(time * 2.6) * 0.06, z);
    } else {
      target.set(this.cursorPoint.x, 1.5 + Math.sin(time * 2.6) * 0.06, this.cursorPoint.z);
    }
    if (!this.heldState) {
      this.heldState = { pos: target.clone(), vel: new THREE.Vector3(), scale: 0.4 };
      h.position.copy(target);
    }
    const st = this.heldState;
    // critically-damped-ish spring toward the target
    const stiffness = valid ? 120 : 70;
    const damping = valid ? 16 : 12;
    const acc = target.clone().sub(st.pos).multiplyScalar(stiffness).addScaledVector(st.vel, -damping);
    st.vel.addScaledVector(acc, dt);
    st.pos.addScaledVector(st.vel, dt);
    st.scale += ((valid ? 1 : 0.8) - st.scale) * Math.min(1, dt * 10);
    h.visible = true;
    h.position.copy(st.pos);
    h.scale.setScalar(st.scale);
    h.rotation.x = THREE.MathUtils.clamp(st.vel.z * 0.05, -0.35, 0.35);
    h.rotation.z = THREE.MathUtils.clamp(-st.vel.x * 0.05, -0.35, 0.35);
    h.rotation.y = Math.sin(time * 1.3) * 0.05;
  }

  prepareDrop(k) {
    const st = this.takeHeld(k);
    if (st) this.pendingDrop = { key: k, st };
  }

  // Warm up the offscreen thumbnail renderer while nothing else is happening (menu idle)
  prewarmThumbs(types, stackHeights = [7]) {
    const jobs = [];
    for (const t of types) {
      jobs.push(() => this.thumb(t));
      for (const n of stackHeights) jobs.push(() => this.stackThumb(t, n));
    }
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 60));
    const step = () => {
      const job = jobs.shift();
      if (!job) return;
      job();
      idle(step);
    };
    idle(step);
  }

  // Render a tile type to an image for the hand cards (cached; one small offscreen renderer)
  thumb(type) {
    this.thumbs ??= new Map();
    if (this.thumbs.has(type)) return this.thumbs.get(type);
    if (!this.thumbR) {
      this.thumbR = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.thumbR.setSize(220, 220);
      this.thumbR.toneMapping = THREE.ACESFilmicToneMapping;
      this.thumbR.toneMappingExposure = 1.1;
      this.thumbScene = new THREE.Scene();
      this.thumbScene.add(new THREE.HemisphereLight(0xfff8ee, 0x7fa4c8, 1.7));
      const sun = new THREE.DirectionalLight(0xfff0d6, 2.2);
      sun.position.set(3, 6, 4);
      this.thumbScene.add(sun);
      this.thumbCam = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
      this.thumbCam.position.set(0, 3.2, 3.4);
      this.thumbCam.lookAt(0, 0.25, 0);
    }
    const g = this.buildTileGroup({ key: `thumb-${type}`, type, owner: null, crop: null, poi: null, building: null });
    this.thumbScene.add(g);
    this.thumbR.render(this.thumbScene, this.thumbCam);
    const url = this.thumbR.domElement.toDataURL('image/png');
    this.thumbScene.remove(g);
    this.disposeGroup(g);
    this.thumbs.set(type, url);
    return url;
  }

  // A tall stack of tiles with the next tile on top, rendered once per (type, height)
  stackThumb(type, n) {
    this.thumbs ??= new Map();
    const id = `stack|${type}|${n}`;
    if (this.thumbs.has(id)) return this.thumbs.get(id);
    this.thumb(type); // makes sure the offscreen renderer exists
    const r = this.thumbR;
    r.setSize(200, 320);
    const group = new THREE.Group();
    const slab = 0.3;
    const tops = [0x62b84a, 0x8fd35a, 0x84c955, 0xb2aa98];
    for (let i = 0; i < n; i++) {
      const base = new THREE.Group();
      const topM = M(tops[i % tops.length]);
      base.add(mesh(G.soil(), [M(0x6e4a2f), M(0x6e4a2f), M(0x6e4a2f)]));
      base.add(mesh(G.layer(), [M(SIDE), M(SIDE), M(SIDE)]));
      base.add(mesh(G.lip(), [topM, topM, topM]));
      base.position.y = i * slab;
      base.rotation.y = (i % 2) * 0.04;
      group.add(base);
    }
    const top = this.buildTileGroup({ key: `thumb-${type}`, type, owner: null, crop: null, poi: null, building: null });
    top.position.y = n * slab;
    group.add(top);
    this.thumbScene.add(group);
    const h = n * slab + 1;
    const cam = new THREE.PerspectiveCamera(24, 200 / 320, 0.1, 100);
    cam.position.set(0, h * 0.62 + 3.2, 6.4 + h * 0.35);
    cam.lookAt(0, h * 0.48, 0);
    r.render(this.thumbScene, cam);
    const url = r.domElement.toDataURL('image/png');
    this.thumbScene.remove(group);
    this.disposeGroup(top);
    r.setSize(220, 220);
    this.thumbs.set(id, url);
    return url;
  }

  showSynergy(k, links) {
    this.synergy = links.length ? { k, links } : null;
    if (!this.synergy) { this.synBeads.count = 0; this.synRings.count = 0; }
  }

  clearSynergy() {
    this.showSynergy(null, []);
  }

  updateSynergy(time) {
    const s = this.synergy;
    if (!s) return;
    const d = this.dummy;
    const c = this._c;
    const to = toWorld(s.k);
    let bi = 0;
    s.links.forEach((l, li) => {
      const from = toWorld(l.key);
      const color = l.kind === 'water' ? 0x7fe9ff : 0xffd24a;
      for (let i = 0; i < 7 && bi < 120; i++) {
        const t = (time * 0.7 + i / 7 + li * 0.13) % 1;
        const e = t * t * (3 - 2 * t);
        d.position.set(from.x + (to.x - from.x) * e, TOP + 0.25 + Math.sin(Math.PI * e) * 0.55, from.z + (to.z - from.z) * e);
        d.scale.setScalar(0.05 + Math.sin(Math.PI * t) * 0.05);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        this.synBeads.setMatrixAt(bi, d.matrix);
        this.synBeads.setColorAt(bi, c.setHex(color));
        bi++;
      }
      if (li < 12) {
        d.position.set(from.x, TOP + 0.03, from.z);
        d.scale.setScalar(0.94 + Math.sin(time * 5) * 0.03);
        d.updateMatrix();
        this.synRings.setMatrixAt(li, d.matrix);
        this.synRings.setColorAt(li, c.setHex(color));
      }
    });
    this.synBeads.count = bi;
    this.synRings.count = Math.min(12, s.links.length);
    this.synBeads.instanceMatrix.needsUpdate = true;
    this.synBeads.instanceColor.needsUpdate = true;
    this.synRings.instanceMatrix.needsUpdate = true;
    this.synRings.instanceColor.needsUpdate = true;
  }

  // Supporting tiles give a little hop when a tile lands next to them
  pulseTiles(keys, delay = 0.45) {
    for (const k of keys) {
      const o = this.tileObjs.get(k);
      if (!o) continue;
      const { x, z } = toWorld(k);
      this.animate(0.5, (q) => {
        const b = Math.sin(Math.PI * q);
        o.g.position.y = b * 0.12;
        o.g.scale.set(1 + b * 0.04, 1 + b * 0.06, 1 + b * 0.04);
      }, () => { o.g.position.y = 0; o.g.scale.setScalar(1); this.sparkle(x, z); }, delay);
    }
  }

  // Hand the held tile's transform to the placed tile so the drop continues from there
  takeHeld(k) {
    if (!this.held?.visible || this.hoverKey !== k) return null;
    const st = { pos: this.held.position.clone(), rot: this.held.rotation.clone() };
    this.held.visible = false;
    this.landing.visible = false;
    this.heldState = null;
    return st;
  }

  // ---------- fx ----------
  animate(dur, fn, done, delay = 0) {
    this.anims.push({ t: -delay, dur, fn, done });
  }

  poof(x, z, color = 0xffffff) {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this.particles.spawn({
        pos: new THREE.Vector3(x + Math.cos(a) * 0.85, 0.42, z + Math.sin(a) * 0.85),
        vx: Math.cos(a) * 1.1, vz: Math.sin(a) * 1.1, vy: 0.7, size: 0.12, grow: 0.25, drag: 2.5, max: 0.8, color,
      });
    }
  }

  sparkle(x, z) {
    for (let i = 0; i < 16; i++) {
      this.particles.spawn({
        pos: new THREE.Vector3(x + (Math.random() - 0.5) * 1.2, 0.5, z + (Math.random() - 0.5) * 1.2),
        vx: 0, vz: 0, vy: 1 + Math.random(), size: 0.04, grow: -0.01, max: 1 + Math.random() * 0.6, color: 0xffe28a,
      });
    }
  }

  shockwave(x, z) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
    const m = new THREE.Mesh(G.ring(), mat);
    m.position.set(x, TOP + 0.02, z);
    this.fxGroup.add(m);
    this.animate(0.6, (k) => {
      m.scale.setScalar(1 + k * 0.9);
      mat.opacity = 0.8 * (1 - k);
    }, () => { this.fxGroup.remove(m); mat.dispose(); });
  }

  floatText(k, text) {
    // keep bursts (the harvest) cheap: only tiles in view, at most ~30 labels alive at once
    this.floatsAlive ??= 0;
    if (this.floatsAlive >= 30) return;
    const sp = this.projectKey(k);
    if (sp.behind || sp.x < -50 || sp.y < -50 || sp.x > innerWidth + 50 || sp.y > innerHeight + 50) return;
    this.floatsAlive++;
    const { x, z } = toWorld(k);
    const delay = Math.random() * 0.6;
    let s = null;
    this.animate(2.2, (q) => {
      if (!s) {
        const t = floatTexture(text);
        s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, depthTest: false, transparent: true }));
        s.scale.set(t.w * 0.009, t.h * 0.009, 1);
        s.renderOrder = 12;
        this.fxGroup.add(s);
      }
      s.position.set(x, 1.1 + q * 1.1, z);
      s.material.opacity = (q < 0.7 ? 1 : 1 - (q - 0.7) / 0.3) * Math.min(1, q * 12);
    }, () => {
      this.floatsAlive--;
      if (s) { this.fxGroup.remove(s); s.material.dispose(); }
    }, delay);
  }

  // ---------- input (analytic picking, throttled to once per frame) ----------
  _bindPointer() {
    const dom = this.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved > 6 || e.button !== 0 || this.menuMode) return;
      const k = this.pick(e);
      if (k && this.onClick) this.onClick(k);
    });
    dom.addEventListener('pointermove', (e) => { if (!this.menuMode) this._lastMove = e; });
    dom.addEventListener('pointerleave', () => { this._lastMove = null; this.cursorPoint = null; this.setHover(null); });
  }

  setHover(k, e) {
    if (k !== this.hoverKey) {
      this.hoverKey = k;
      this.renderer.domElement.style.cursor = k && (this.validSet.has(k) || this.highlightKeys.has(k)) ? 'pointer' : 'default';
    }
    this.onHover?.(k, e);
  }

  _planePoint(y) {
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    if (t < 0) return null;
    return { x: ray.origin.x + ray.direction.x * t, z: ray.origin.z + ray.direction.z * t };
  }

  _hexAt(y) {
    const p = this._planePoint(y);
    return p ? hexKeyAt(p.x, p.z) : null;
  }

  pick(e) {
    const rect = this.rect || (this.rect = this.renderer.domElement.getBoundingClientRect());
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const ray = this.raycaster.ray;
    if (ray.direction.y < -1e-4) {
      const t = (0.3 - ray.origin.y) / ray.direction.y;
      this.cursorPoint = ray.origin.clone().addScaledVector(ray.direction, t);
    }
    const SLOT_Y = 0.13; // floating slots sit just above the water
    // stickiness: while the cursor is still inside the hex we're hovering, keep it,
    // so edges between neighbours don't flicker back and forth
    const cur = this.hoverKey;
    if (cur) {
      const y = this.tileObjs.has(cur) ? TOP : SLOT_Y;
      const p = this._planePoint(y);
      const c = toWorld(cur);
      if (p && Math.hypot(p.x - c.x, p.z - c.z) < 0.93 && (this.tileObjs.has(cur) || this.ghostSet.has(cur))) {
        // a raised tile in front still wins (it covers the slot on screen)
        const kt = this._hexAt(TOP);
        if (!(kt && kt !== cur && this.tileObjs.has(kt))) return cur;
      }
    }
    const kt = this._hexAt(TOP);
    if (kt && this.tileObjs.has(kt)) return kt;
    const kg = this._hexAt(SLOT_Y);
    if (kg && this.ghostSet.has(kg)) return kg;
    return null;
  }

  updateBirds(time, dt) {
    const dm = this.birdDummy;
    let i = 0;
    for (const f of this.flocks) {
      f.a += dt * f.speed;
      const dir = Math.sign(f.speed);
      for (let b = 0; b < f.n; b++) {
        const a = f.a - dir * b * 0.12;
        const r = f.r + Math.sin(b * 2.3) * 0.35;
        const x = f.cx + Math.cos(a) * r;
        const z = f.cz + Math.sin(a) * r;
        const y = f.h + Math.sin(time * 0.8 + b) * 0.15;
        const heading = Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir); // face along the circle
        const flap = Math.sin(time * 10 + b * 1.9) * 0.7;
        for (let w = 0; w < 2; w++) {
          dm.position.set(x, y, z);
          dm.rotation.set(0, heading, 0);
          dm.rotateZ(w ? Math.PI - flap : flap);
          dm.updateMatrix();
          this.birdMesh.setMatrixAt(i++, dm.matrix);
        }
      }
    }
    this.birdMesh.count = i;
    this.birdMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------- loop ----------
  tick() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const time = this.timer.getElapsed();
    this.updateCamera(dt);
    this.controls.update();
    U.uTime.value = time;
    this.landingMat.uniforms.uTime.value = time;
    this.waterMat.uniforms.uTime.value = time;
    // redraw the coastline at most ~4x per second, however many tiles change
    this.maskTimer -= dt;
    if (this.maskDirty && this.maskTimer <= 0) {
      this.updateMask();
      this.maskTimer = 0.25;
    }
    this.weather.material.uniforms.uTime.value = time;

    if (this._lastMove) {
      const e = this._lastMove;
      this._lastMove = null;
      this.setHover(this.pick(e), e);
    }

    if (this.buildQueue?.length) {
      this.buildClock += dt;
      const t0 = performance.now();
      while (this.buildQueue.length && this.buildQueue[0].at <= this.buildClock && performance.now() - t0 < 4) {
        this.addTile(this.buildQueue.shift().t, true, 0, { quiet: true });
      }
    }
    if (this.rebuildQueue?.size) {
      const t0 = performance.now();
      for (const [k, t] of this.rebuildQueue) {
        this.rebuildQueue.delete(k);
        if (this.tileObjs.has(k)) this._refresh(t);
        if (performance.now() - t0 > 3) break;
      }
    }
    if (this.anims.length) this.shadowFrames = Math.max(this.shadowFrames, 1);
    this.anims = this.anims.filter((a) => {
      a.t += dt;
      if (a.t < 0) return true;
      const k = Math.min(1, a.t / a.dur);
      a.fn(k);
      if (k >= 1) { a.done?.(); return false; }
      return true;
    });

    this._smokeT = (this._smokeT || 0) + dt;
    const smoke = this._smokeT > 0.5;
    if (smoke) this._smokeT = 0;

    HL_MAT.opacity = 0.55 + 0.35 * Math.sin(time * 4);
    for (const [k, o] of this.tileObjs) {
      const { holder, g } = o;
      const lift = k === this.hoverKey && this.highlightKeys.has(k) ? 0.1 : 0;
      if (holder.position.y !== lift) {
        holder.position.y += (lift - holder.position.y) * Math.min(1, dt * 12);
        if (Math.abs(holder.position.y - lift) < 0.002) holder.position.y = lift;
      }
      if (smoke && g.userData.chimney) {
        this.particles.spawn({
          pos: g.userData.chimney.clone().add(holder.position), vx: 0.08, vz: 0.03, vy: 0.35,
          size: 0.05, grow: 0.07, max: 2.6, color: 0xf2f2f2,
        });
      }
      const dyn = g.userData.dyn;
      if (!dyn) continue;
      for (const d of dyn) {
        const kind = d.userData.dynamic;
        const ph = d.userData.phase || 0;
        if (kind === 'flap') d.rotation.y = Math.sin(time * 3 + ph) * 0.25;
        else if (kind === 'spin') d.rotation.z += dt * 1.2;
        else if (kind === 'flicker') d.scale.y = 0.16 * (0.8 + Math.sin(time * 17) * 0.15 + Math.random() * 0.15);
        else if (kind === 'bob') d.position.y = TOP + 0.01 + Math.sin(time * 2 + ph) * 0.012;
      }
    }

    this.styleGhosts(time);
    for (const islet of this.poiIcons.values()) {
      islet.position.y = Math.sin(time * 1.2 + islet.userData.bob) * 0.025;
      for (const d of islet.userData.dyn || []) if (d.userData.dynamic === 'flicker') d.scale.y = 0.16 * (0.8 + Math.random() * 0.3);
    }
    this.particles.update(dt);



    this.updateBirds(time, dt);
    this.updateSynergy(time);
    this.updateHeld(dt, time);

    this._shadowT = (this._shadowT || 0) + dt;
    if (this.shadowFrames > 0 || this._shadowT > 0.05 || this.held?.visible) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowFrames = Math.max(0, this.shadowFrames - 1);
      this._shadowT = 0;
    }
    if (this.quality === 'high') this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
    this.adaptResolution(dt);
  }
}

function easeOutBounce(x) {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
}

function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

// Canvas textures: text labels, icon sprites, quest flags, the badge atlas and floating harvest labels.
import * as THREE from 'three';









import { drawIcon, EMOJI_TO_ICON, ICON_COLOR } from '../ui/icons.js';



export const LABEL_SCALE = matchMedia('(pointer: coarse)').matches && innerWidth <= 760 ? 0.0065 : 0.01;

// ---------- text sprites (textures cached) ----------
export const texCache = new Map();
export function drawText(text, { bg, fg, size, pad }) {
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
export function textTexture(text, opts) {
  const id = `${text}|${opts.bg}|${opts.fg}|${opts.size}|${opts.pad}`;
  if (!texCache.has(id)) texCache.set(id, drawText(text, opts));
  return texCache.get(id);
}

export function textSprite(text, { bg = 'rgba(20,28,38,0.85)', fg = '#fff', size = 44, pad = 16, scale = 0.012, cache = true } = {}) {
  const t = cache ? textTexture(text, { bg, fg, size, pad }) : drawText(text, { bg, fg, size, pad });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t.tex, depthTest: false, transparent: true }));
  s.scale.set(t.w * scale, t.h * scale, 1);
  s.renderOrder = 10;
  return s;
}
export const iconTexCache = new Map();
export function iconSprite(name, scale = 0.45, color = '#2f3a36') {
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

export function questSprite(n, color) {
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

// ---------- tile badges: every badge on the map is one Points draw call using an icon atlas ----------
export const BADGES = ['shield1', 'shield2', 'shield3', 'shield4', 'shield5', 'building', 'improved', 'crop', 'ruins', 'ruinsDone', 'mill', 'millDone', 'workshop'];
export function buildBadgeAtlas() {
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

export function createBadgeMaterial(atlas) {
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
export const floatTexCache = new Map();
export function floatTexture(text) {
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
      if (p.icon) drawIcon(ctx, p.icon, x + tw + 2, 9, 34, ICON_COLOR[p.icon] || '#2f3a36');
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

// Shared toon materials, the season/sway shader patch and the geometry cache used by every tile.
import * as THREE from 'three';













export const TOP = 0.3;
// world-space name labels read fine on a monitor but crowd a phone screen
export const SEASON_IDS = { grass: 1, leaf: 2, pine: 3, rock: 4 };

// ---------- toon materials (Link's Awakening-ish: soft bands, rim light, plastic glint) ----------
export const gradientMap = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 196, 236, 255]), 4, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
})();

export const RIM_GLSL = /* glsl */ `
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

export const U = {
  uTime: { value: 0 },
  uTints: { value: [0, 1, 2, 3, 4].map(() => new THREE.Vector4(0, 0, 0, 0)) },
  uLeaf2: { value: new THREE.Color(0xf0b02c) },
};

export function worldShader(sh) {
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

export const WORLD_MAT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap });
WORLD_MAT.onBeforeCompile = worldShader;

// shadow depth pass must sway exactly like the colour pass, otherwise trees self-shadow in stripes
export const SWAY_GLSL = `transformed.x += sin(uTime * 1.4 + aSway.y) * aSway.x * 0.07;
      transformed.z += cos(uTime * 1.1 + aSway.y * 1.3) * aSway.x * 0.04;`;
export const WORLD_DEPTH = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
WORLD_DEPTH.onBeforeCompile = (sh) => {
  sh.uniforms.uTime = U.uTime;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uTime;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>\n${SWAY_GLSL}`);
};

export const matCache = new Map();
export function rimOnly(sh) {
  sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', RIM_GLSL);
}
export function M(color, opts = {}) {
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
export const SM = (kind, color) => M(color, { season: kind });

export const AUTUMN = [0xe0702a, 0xf0b02c];
export const SEASON_TINT = {
  grass: [null, [0xc6d85a, 0.2], [0xd6aa52, 0.38], [0xeef4f6, 0.62]],
  leaf: [null, [0x2f7a2a, 0.15], ['autumn', 0.9], [0xe6eef2, 0.45]],
  pine: [null, null, [0x2f6a2a, 0.12], [0xe6eef2, 0.3]],
  rock: [null, null, null, [0xf6f9fc, 0.55]],
};

// ---------- geometry cache ----------
export const geoCache = new Map();
export const geo = (id, make) => {
  if (!geoCache.has(id)) {
    const g = make();
    g.deleteAttribute('uv');
    geoCache.set(id, g);
  }
  return geoCache.get(id);
};
export const G = {
  soil: () => geo('soil', () => new THREE.CylinderGeometry(1, 1, 0.2, 6).translate(0, 0.1, 0)),
  layer: () => geo('layer', () => new THREE.CylinderGeometry(1, 1, 0.07, 6).translate(0, 0.235, 0)),
  lip: () => geo('lip', () => new THREE.CylinderGeometry(1, 1, 0.03, 6).translate(0, TOP - 0.015, 0)),
  ghost: () => geo('ghost', () => new THREE.CylinderGeometry(0.93, 0.93, 0.03, 6)),
  slotFill: () => geo('slotFill', () => new THREE.CircleGeometry(0.9, 6, Math.PI / 6).rotateX(-Math.PI / 2)),
  // the outline sits exactly on the hex edge, so neighbouring slots share one line instead of two
  slotRing: () => geo('slotRing', () => new THREE.RingGeometry(0.975, 1.0, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  cyl: (seg = 8) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg)),
  cone: (seg = 8) => geo(`cone${seg}`, () => new THREE.ConeGeometry(1, 1, seg)),
  sphere: () => geo('sphere', () => new THREE.IcosahedronGeometry(1, 2)),
  blob: () => geo('blob', () => new THREE.IcosahedronGeometry(1, 1)),
  prism: () => geo('prism', () => new THREE.CylinderGeometry(1, 1, 1, 3).rotateX(-Math.PI / 2)),
  ring: () => geo('ring', () => new THREE.RingGeometry(0.93, 0.985, 6, 1, Math.PI / 6).rotateX(-Math.PI / 2)),
  disc: (seg = 6) => geo(`disc${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg)),
};

export function mesh(g, m, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

export const TOP_COLORS = {
  forest: 0x62b84a, meadow: 0x8fd35a, field: 0x84c955, mountain: 0xb2aa98,
  lake: 0x84c955, village: 0x93d35e, home: 0x8fd35a,
};
export const SIDE = 0x9a6a40;

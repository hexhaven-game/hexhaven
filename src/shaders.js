import * as THREE from 'three';

const NOISE = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  vec2 hash2(vec2 p) { return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453); }
  // distance to cell border (F2 - F1): thin bright web like light caustics
  float cells(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(i + g);
      o = 0.5 + 0.4 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
    }
    return f2 - f1;
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
`;

// Link's Awakening-style sea: bright turquoise shelf around the island, a sandy rim with a
// moving foam line on the coast, white squiggle highlights and sun glints further out.
export function createWaterMaterial(maskTex, extent) {
  return new THREE.ShaderMaterial({
    fog: true,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uMask: { value: null },
        uMaskPrev: { value: null },
        uMaskMix: { value: 1 },
        uExtent: { value: extent },
        uDeep: { value: new THREE.Color(0x3a9fd8) },
        uShallow: { value: new THREE.Color(0x5fe0da) },
        uSand: { value: new THREE.Color(0xf3e3b3) },
        uFoam: { value: new THREE.Color(0xffffff) },
        uSunDir: { value: new THREE.Vector3(10, 22, 12).normalize() },
        uShore: { value: 1 },
      },
    ]),
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        wp.y += sin(wp.x * 0.7 + uTime * 1.1) * 0.012 + sin(wp.z * 0.9 - uTime * 0.8) * 0.01;
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform sampler2D uMask, uMaskPrev;
      uniform float uMaskMix;
      uniform float uExtent;
      uniform vec3 uDeep, uShallow, uSand, uFoam, uSunDir;
      uniform float uShore;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        float t = uTime;
        // uShore scales the whole coastline mask around the world origin, so the sand and foam
        // grow out of the sea in one smooth move while the banks are coming up
        vec2 maskUv = vWorld.xz / (uExtent * 2.0 * uShore) + 0.5;
        vec4 mask = mix(texture2D(uMaskPrev, maskUv), texture2D(uMask, maskUv), uMaskMix);
        float coast = mask.r;   // narrow falloff around the tiles
        float shelf = mask.g;   // wide falloff: shallow water

        vec3 col = mix(uDeep, uShallow, smoothstep(0.03, 0.8, shelf));

        // white squiggles drifting on the surface (stronger over the shelf)
        vec2 p = vWorld.xz * 1.6 + vec2(t * 0.12, -t * 0.08);
        float n = noise(p) * 0.65 + noise(p * 2.3 + 7.1) * 0.35;
        float camFade = 1.0 - smoothstep(18.0, 45.0, length(cameraPosition - vWorld));
        float squig = smoothstep(0.012, 0.0, abs(n - 0.52)) * 0.12 * (1.0 - shelf) * camFade;
        col = mix(col, uFoam, squig);
        // light caustics dancing on the shallow shelf
        float web = 1.0 - smoothstep(0.02, 0.09, cells(vWorld.xz * 1.35, t * 0.6));
        col = mix(col, vec3(0.86, 1.0, 0.98), web * smoothstep(0.2, 0.7, shelf) * 0.35 * camFade);

        // soft rings rolling towards the coast
        float rings = smoothstep(0.75, 1.0, 0.5 + 0.5 * sin(shelf * 26.0 + t * 1.6)) * smoothstep(0.15, 0.4, shelf) * (1.0 - smoothstep(0.3, 0.42, coast));
        col = mix(col, uFoam, rings * 0.28);

        // sandy rim right at the tile edges, with a foam line that breathes
        // keep the rim and foam line hugging the hexagonal coast instead of wobbling into a beach
        float wob = (noise(vWorld.xz * 3.0 + t * 0.4) - 0.5) * 0.014 + sin(t * 1.3) * 0.005;
        float sand = smoothstep(0.34, 0.42, coast + wob * 0.5);
        col = mix(col, uSand, sand);
        float f = coast + wob;
        float foam = smoothstep(0.24, 0.29, f) * (1.0 - smoothstep(0.33, 0.37, f));
        col = mix(col, uFoam, foam * 0.95);

        // sun glints far from the coast
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vec3((noise(p * 3.0) - 0.5) * 0.25, 1.0, (noise(p * 3.0 + 4.0) - 0.5) * 0.25));
        float spec = pow(max(dot(N, normalize(uSunDir + V)), 0.0), 300.0);
        col += vec3(1.0) * spec * 1.4 * (1.0 - shelf);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

// Landing marker under the held tile: soft hex glow with rings rippling inward
export function createLandingMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xffffff) } },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vP;
      void main() {
        vec2 p = abs(vP);
        float d = max(p.x, p.x * 0.5 + p.y * 0.8660254) / 0.8660254; // 0 centre .. 1 edge (pointy along z)
        float edge = smoothstep(0.8, 0.96, d) * (1.0 - smoothstep(0.97, 1.0, d));
        float ring = smoothstep(0.08, 0.0, abs(fract(d - uTime * 0.9) - 0.5) - 0.38);
        float fill = 0.18 * (1.0 - d);
        float a = edge * 0.9 + ring * 0.35 * (1.0 - d * 0.6) + fill;
        vec3 col = mix(uColor, vec3(1.0), 0.35 + 0.25 * sin(uTime * 4.0));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }
    `,
  });
}

// Falling particles (snow / leaves / petals) fully animated on the GPU
export function createWeather(count = 1400, area = 34, height = 12) {
  const pos = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = Math.random() * height;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area;
    seed[i] = Math.random();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uHeight: { value: height },
      uColor: { value: new THREE.Color(0xffffff) },
      uColor2: { value: new THREE.Color(0xffffff) },
      uSize: { value: 5 },
      uSpeed: { value: 0.8 },
      uOpacity: { value: 0 },
      uDensity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime, uHeight, uSize, uSpeed, uDensity;
      attribute float aSeed;
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vSeed = aSeed;
        vec3 p = position;
        p.y = mod(p.y - uTime * uSpeed * (0.6 + aSeed * 0.8), uHeight);
        p.x += sin(uTime * 0.7 + aSeed * 20.0) * 0.6;
        p.z += cos(uTime * 0.5 + aSeed * 13.0) * 0.4;
        vAlpha = smoothstep(0.0, 1.0, p.y) * smoothstep(uHeight, uHeight - 2.0, p.y) * step(aSeed, uDensity);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = uSize * (0.6 + aSeed * 0.8) * (40.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uColor2;
      uniform float uOpacity;
      varying float vSeed;
      varying float vAlpha;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        if (d > 0.5) discard;
        float a = smoothstep(0.5, 0.2, d) * uOpacity * vAlpha;
        gl_FragColor = vec4(mix(uColor, uColor2, vSeed), a);
        #include <colorspace_fragment>
      }
    `,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// Final pass: saturation, warm grade and a soft vignette (kept sharp: no depth-of-field blur)
export const FinishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.18 },
    uSat: { value: 1.15 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSat;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb *= vec3(1.03, 1.0, 0.97);
      float v = smoothstep(0.85, 0.3, length(vUv - 0.5));
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = c;
    }
  `,
};

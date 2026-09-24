// Instanced particles and the quarter-resolution bloom pass.
import * as THREE from 'three';



import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';






import { gradientMap, G } from './materials.js';


// ---------- instanced particles ----------
export class Particles {
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
export class CheapBloom extends UnrealBloomPass {
  setSize(w, h) {
    super.setSize(Math.max(1, w / 2), Math.max(1, h / 2));
  }
}

// The tile hand, where tiles may go, what a placement would earn, and placing them.
// Mixed into Game.prototype (see ../game.js), so `this` is the game.
import { RES_INFO, TILE_TYPES, PLACEABLE, POIS } from '../data.js';
import { neighborKeys, dist, inMap } from '../hex.js';

const rand = (n) => Math.floor(Math.random() * n);

export const Placement = {
  frontier() {
    const set = new Set();
    for (const t of this.tiles.values()) {
      for (const n of neighborKeys(t.key)) if (!this.tiles.has(n) && inMap(n)) set.add(n);
    }
    return set;
  },

  validPlacements(pid) {
    return [...this.frontier()].filter((k) =>
      neighborKeys(k).some((n) => this.tiles.get(n)?.owner === pid));
  },

  explorable(pid) {
    const own = this.owned(pid);
    return [...this.frontier()].filter((k) =>
      !this.revealed.has(k) && own.some((t) => dist(t.key, k) <= 2));
  },

  drawOffer(n = 3) {
    const out = [];
    while (out.length < n) {
      const total = PLACEABLE.reduce((s, t) => s + TILE_TYPES[t].weight, 0);
      let x = Math.random() * total;
      for (const t of PLACEABLE) {
        x -= TILE_TYPES[t].weight;
        if (x <= 0) {
          if (!out.includes(t)) out.push(t);
          break;
        }
      }
    }
    return out;
  },

  tilePrice(pid) {
    return 10 + 6 * (this.players[pid].tilesBought || 0);
  },

  // Gold sink: buy an extra tile for the next placement phase (once per round)
  buyTile(pid) {
    const p = this.players[pid];
    const price = this.tilePrice(pid);
    if (p.boughtRound === this.round || p.res.gold < price) return false;
    p.res.gold -= price;
    p.tilesBought = (p.tilesBought || 0) + 1;
    p.boughtRound = this.round;
    p.bonusTiles++;
    this.log(`🪙 ${p.name} buys an extra tile for ${price}🪙.`, pid);
    this.emit('state');
    return true;
  },

  // What placing `type` at `k` would do, so the UI can show how tiles support each other
  placementPreview(pid, type, k) {
    const nbs = neighborKeys(k).map((n) => this.tiles.get(n)).filter(Boolean);
    const same = nbs.filter((t) => t.type === type);
    const gain = 1 + Math.min(same.length, 3);
    const links = same.map((t) => ({ key: t.key, kind: 'match' }));
    const notes = [];
    const main = Object.keys(TILE_TYPES[type].prod)[0];
    if (main && same.length >= 2) notes.push({ icon: main, text: `cluster: +1 ${RES_INFO[main].name.toLowerCase()} here` });
    if (main) {
      // neighbours that reach the cluster bonus thanks to this tile
      const boosted = same.filter((t) => t.owner === pid
        && neighborKeys(t.key).filter((n) => this.tiles.get(n)?.type === type).length === 1).length;
      if (boosted) notes.push({ icon: main, text: `${boosted} neighbour${boosted > 1 ? 's' : ''} +1 ${RES_INFO[main].name.toLowerCase()}` });
    }
    if (type === 'field') {
      const lakes = nbs.filter((t) => t.type === 'lake');
      if (lakes.length) {
        notes.push({ icon: 'plant', text: 'watered: crops grow a round faster' });
        lakes.forEach((t) => links.push({ key: t.key, kind: 'water' }));
      }
    }
    if (type === 'lake') {
      const fields = nbs.filter((t) => t.type === 'field' && t.owner === pid && !this.irrigated(t));
      if (fields.length) {
        notes.push({ icon: 'plant', text: `waters ${fields.length} field${fields.length > 1 ? 's' : ''}` });
        fields.forEach((t) => links.push({ key: t.key, kind: 'water' }));
      }
    }
    for (const q of this.quests) {
      if (q.done || q.pid !== pid || q.type !== type) continue;
      const cl = this.cluster(q.key);
      if (neighborKeys(k).some((n) => cl.has(n))) notes.push({ icon: 'flag', text: `goal ${Math.min(q.target, cl.size + 1)} / ${q.target}` });
    }
    const sec = this.revealed.has(k) ? this.secrets.get(k) : null;
    if (sec) notes.push({ icon: { ruins: 'ruins', mill: 'mill', treasure: 'treasure', bandits: 'skull' }[sec], text: POIS[sec].name });
    return { gain, links, notes };
  },

  // ---------- placement ----------
  placeTile(pid, type, k) {
    const p = this.players[pid];
    const t = this.addTile(k, type, pid);
    const same = neighborKeys(k).filter((n) => this.tiles.get(n)?.type === type).length;
    const gain = 1 + Math.min(same, 3);
    p.prosp += gain;
    const secret = this.secrets.get(k);
    this.secrets.delete(k);
    this.revealed.delete(k);
    let msg = `${p.name} places ${TILE_TYPES[type].name.toLowerCase()}${same ? ` (${same} matching)` : ''}.`;
    if (secret === 'bandits') {
      t.owner = null;
      t.poi = { type: 'bandits', strength: 2 + rand(2) + (this.round > 6 ? 1 : 0) };
      msg += ` ☠️ A bandit camp! (strength ${t.poi.strength})`;
    } else if (secret === 'treasure') {
      p.res.gold += 4;
      msg += ' 💰 Hidden treasure: +4 gold!';
      this.emit('float', k, '💰 +4🪙');
    } else if (secret) {
      t.poi = { type: secret, repaired: false };
      msg += ` ${POIS[secret].icon} Found: ${POIS[secret].name.toLowerCase()}.`;
    }
    this.log(msg, pid);
    this.emit('tilePlaced', t);
    if (t.owner === pid) this.maybeCreateQuest(t, p);
    this.checkQuests(pid);
    this.emit('quests');
    this.emit('state');
    return { tile: t, gain, secret };
  },
};

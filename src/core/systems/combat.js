// Bandit camps: raids and fights with guards.
// Mixed into Game.prototype (see ../game.js), so `this` is the game.

import { neighborKeys, dist } from '../hex.js';

const rand = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[rand(arr.length)];

export const Combat = {
  isBandit(t) {
    return t?.poi?.type === 'bandits';
  },

  banditsNear(pid) {
    return [...this.tiles.values()].filter((t) =>
      this.isBandit(t) && neighborKeys(t.key).some((n) => this.tiles.get(n)?.owner === pid));
  },

  spawnRaid() {
    const richest = [...this.players].sort((a, b) => b.prosp - a.prosp)[0];
    const own = this.owned(richest.id);
    const cands = [...this.frontier()].filter((k) =>
      own.some((t) => dist(t.key, k) <= 2) && dist(k, richest.home) >= 2);
    if (!cands.length) return null;
    const k = pick(cands);
    const t = this.addTile(k, pick(['forest', 'mountain', 'meadow']), null);
    t.poi = { type: 'bandits', strength: 2 + this.year + (richest.prosp > 60 ? 1 : 0) };
    this.secrets.delete(k);
    this.revealed.delete(k);
    this.log(`Raiders have set up camp near ${richest.name} (strength ${t.poi.strength}).`);
    this.emit('tilePlaced', t, { raid: true });
    return t;
  },

  winChance(guards, strength) {
    let win = 0;
    for (let a = 1; a <= 6; a++) for (let d = 1; d <= 6; d++) if (guards + a >= strength + d) win++;
    return win / 36;
  },

  challenge(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, this.isBandit(t) && this.banditsNear(pid).includes(t), 'No bandits next to your land.');
      this._check(p, p.guards > 0, 'You need guards.');
      p.actionsLeft--;
      const a = 1 + rand(6);
      const d = 1 + rand(6);
      const atk = p.guards + a;
      const def = t.poi.strength + d;
      if (atk >= def) {
        t.poi = null;
        t.owner = pid;
        p.res.gold += 3;
        p.prosp += 4;
        this.log(`⚔️ ${p.name} drives out the bandits (${atk} vs ${def}): +3🪙 +4 prosperity.`, pid);
        this.emit('tileChanged', t, { built: true });
        this.emit('float', k, '⚔️ Overwinning!');
        return { won: true };
      }
      p.guards--;
      this.log(`${p.name} loses the fight (${atk} vs ${def}) and a guard.`, pid);
      this.emit('tileChanged', this.homeTile(pid));
      this.emit('float', k, '💥 Verloren');
      return { won: false };
    });
  },
};

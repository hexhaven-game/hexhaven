// Tile goals: grow a connected area of one terrain to a target size for a bonus.
// Mixed into Game.prototype (see ../game.js), so `this` is the game.
import { TILE_TYPES, QUEST_TYPES, costText } from '../data.js';
import { neighborKeys } from '../hex.js';

const rand = (n) => Math.floor(Math.random() * n);

export const Quests = {
  // ---------- quests: grow a connected area of one terrain to a target size ----------
  cluster(k) {
    const start = this.tiles.get(k);
    if (!start) return new Set();
    const seen = new Set([k]);
    const stack = [k];
    while (stack.length) {
      const cur = stack.pop();
      for (const n of neighborKeys(cur)) {
        const t = this.tiles.get(n);
        if (!seen.has(n) && t && t.type === start.type && t.owner === start.owner) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
    return seen;
  },

  questProgress(q) {
    return this.cluster(q.key).size;
  },

  maybeCreateQuest(t, p) {
    if (!QUEST_TYPES.includes(t.type) || t.owner !== p.id) return null;
    const active = this.quests.filter((q) => q.pid === p.id && !q.done);
    if (active.length >= 2 || active.some((q) => this.cluster(q.key).has(t.key))) return null;
    if (Math.random() > 0.35) return null;
    const size = this.cluster(t.key).size;
    const q = { id: ++this.questSeq, key: t.key, pid: p.id, type: t.type, target: size + 3 + rand(3), done: false };
    this.quests.push(q);
    this.log(`🚩 New goal for ${p.name}: grow this ${TILE_TYPES[t.type].name.toLowerCase()} to ${q.target} tiles.`, p.id);
    return q;
  },

  checkQuests(pid) {
    const done = [];
    for (const q of this.quests) {
      if (q.done || q.pid !== pid) continue;
      if (this.questProgress(q) >= q.target) {
        q.done = true;
        const p = this.players[pid];
        const main = Object.keys(TILE_TYPES[q.type].prod)[0] || 'grain';
        const reward = { [main]: 3 };
        p.prosp += 6;
        p.bonusTiles++;
        this.gain(p, reward);
        this.log(`🚩 ${p.name} completes a goal: +6 prosperity, ${costText(reward)} and a bonus tile.`, pid);
        this.emit('float', q.key, 'Goal complete!');
        done.push(q);
      }
    }
    if (done.length) this.emit('quests');
    return done;
  },
};

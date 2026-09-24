// Headless balance check: plays AI-only games and reports pacing.
import { Game } from '../src/core/game.js';
import { choosePlacement, aiStep } from '../src/core/ai.js';
import { HOME_LEVELS, WIN_GOAL } from '../src/core/data.js';

const N = Number(process.argv[2] || 30);
const results = [];
for (let n = 0; n < N; n++) {
  const g = new Game();
  g.setup({ name: 'A', bonus: 'farmer' });
  for (const p of g.players) p.isAI = true;
  g.players[0].kind = 'farmer';
  let endRound = null;
  const curve = [];
  let quests = 0;
  let extra = 0;
  while (g.round < g.lastRound) {
    g.startRound();
    for (const pid of g.order) {
      const p = g.players[pid];
      let places = 1;
      while (places-- > 0) {
        const c = choosePlacement(g, p);
        if (c) g.placeTile(pid, c.type, c.key);
        if (p.bonusTiles > 0) { p.bonusTiles--; places++; extra++; p.offer = g.drawOffer(); }
      }
    }
    for (const pid of g.order) {
      const p = g.players[pid];
      p.actionsLeft = HOME_LEVELS[g.homeTile(pid).level].actions;
      const st = {};
      for (let i = 0; i < 14 && aiStep(g, p, st); i++);
    }
    g.worldPhase();
    const lead = g.leader().prosp;
    curve.push(lead);
    if (!endRound && lead >= WIN_GOAL) { endRound = g.round; break; }
  }
  quests = g.quests.filter((q) => q.done).length;
  const ranked = [...g.players].sort((a, b) => b.prosp - a.prosp);
  results.push({ winPerks: ranked[0].perks.length, otherPerks: ranked.slice(1).reduce((s, p) => s + p.perks.length, 0) / 3, upgraded: [...g.tiles.values()].filter((t) => t.upgraded).length, endRound: endRound || g.round, curve, quests, extra, tiles: g.tiles.size, levels: g.players.map((p) => g.homeTile(p.id).level), top: g.leader().prosp });
}
const avg = (a) => (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1);
console.log('end round avg', avg(results.map((r) => r.endRound)), 'min', Math.min(...results.map((r) => r.endRound)), 'max', Math.max(...results.map((r) => r.endRound)));
console.log('goal reached in', results.filter((r) => r.top >= WIN_GOAL).length, '/', N);
console.log('leader prosp at r6/12/18/24:', [5, 11, 17, 23].map((i) => avg(results.map((r) => r.curve[Math.min(i, r.curve.length - 1)]))).join(' / '));
console.log('quests done avg', avg(results.map((r) => r.quests)), 'extra tiles', avg(results.map((r) => r.extra)), 'tiles', avg(results.map((r) => r.tiles)));
console.log('home levels sample', JSON.stringify(results.slice(0, 5).map((r) => r.levels)));
console.log('perks winner vs others', avg(results.map((r) => r.winPerks)), 'vs', avg(results.map((r) => r.otherPerks)), '| improved buildings per game', avg(results.map((r) => r.upgraded)));

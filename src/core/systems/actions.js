// Things a player spends actions on: crops, buildings, perks, repairs, scouting, guards, the farm.
// Mixed into Game.prototype (see ../game.js), so `this` is the game.
import { BUILDINGS, CROPS, HOME_LEVELS, POIS, GUARD_COST, MAX_GUARDS, BUILDING_UPGRADES, PERKS } from '../data.js';



export const Actions = {
  // ---------- actions (cost 1 action unless noted) ----------
  _check(p, cond, msg) {
    if (!cond) throw new Error(msg);
  },

  _act(pid, fn) {
    const p = this.players[pid];
    try {
      const res = fn(p);
      this.emit('state');
      return { ok: true, ...res };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  },

  plant(pid, k, crop) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const c = CROPS[crop];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && t.type === 'field' && !t.crop, 'You can’t plant here.');
      const cost = this.cropCost(p, crop);
      this._check(p, this.canAfford(p, cost), 'Not enough resources.');
      this.pay(p, cost);
      t.crop = { type: crop, progress: 0 };
      p.actionsLeft--;
      const g = this.growTime(t);
      this.log(`🌱 ${p.name} plants ${c.name.toLowerCase()} (${g} round${g === 1 ? '' : 's'}).`, pid);
      this.emit('tileChanged', t);
    });
  },

  build(pid, k, bid) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const b = BUILDINGS[bid];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && t.type === b.on && !t.building, 'You can’t build that here.');
      this._check(p, this.canAfford(p, b.cost), 'Not enough resources.');
      this.pay(p, b.cost);
      t.building = bid;
      p.prosp += b.prosp;
      p.actionsLeft--;
      this.log(`🔨 ${p.name} builds a ${b.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  },

  upgradeBuilding(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const up = t?.building && BUILDING_UPGRADES[t.building];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && up && !t.upgraded, 'Nothing to improve here.');
      this._check(p, this.canAfford(p, up.cost), 'Not enough resources.');
      this.pay(p, up.cost);
      t.upgraded = true;
      p.prosp += up.prosp;
      p.actionsLeft--;
      this.log(`🔨 ${p.name} improves a building into a ${up.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  },

  perkAvailable(p, id) {
    return !this.hasPerk(p, id) && this.homeTile(p.id).level >= PERKS[id].level;
  },

  buyPerk(pid, id) {
    return this._act(pid, (p) => {
      const perk = PERKS[id];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, perk && !this.hasPerk(p, id), 'You already have that.');
      this._check(p, this.homeTile(pid).level >= perk.level, 'Your farm needs to grow first.');
      this._check(p, this.canAfford(p, perk.cost), 'Not enough resources.');
      this.pay(p, perk.cost);
      p.perks = [...(p.perks || []), id];
      p.prosp += perk.prosp;
      p.actionsLeft--;
      if (id === 'maproom') p.freeExplore++;
      this.log(`🏡 ${p.name} builds a ${perk.name.toLowerCase()}.`, pid);
      this.emit('tileChanged', this.homeTile(pid), { built: true });
    });
  },

  repair(pid, k) {
    return this._act(pid, (p) => {
      const t = this.tiles.get(k);
      const poi = t?.poi && POIS[t.poi.type];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, t?.owner === pid && poi?.repair && !t.poi.repaired, 'Nothing to restore.');
      this._check(p, this.canAfford(p, poi.repair), 'Not enough resources.');
      this.pay(p, poi.repair);
      t.poi.repaired = true;
      p.prosp += poi.prosp;
      p.actionsLeft--;
      this.log(`${p.name} restores the ${poi.name.toLowerCase()}: +${poi.prosp} prosperity.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  },

  explore(pid, k) {
    return this._act(pid, (p) => {
      this._check(p, p.freeExplore || p.actionsLeft > 0, 'No actions left.');
      this._check(p, this.explorable(pid).includes(k), 'You can’t scout there.');
      if (p.freeExplore) p.freeExplore--;
      else p.actionsLeft--;
      this.revealed.add(k);
      const secret = this.secrets.get(k);
      if (secret) p.prosp += 1;
      this.log(`🧭 ${p.name} scouts: ${secret ? `${POIS[secret].icon} ${POIS[secret].name.toLowerCase()}` : 'nothing there'}.`, pid);
      this.emit('revealed', k);
      return { secret };
    });
  },

  recruit(pid) {
    return this._act(pid, (p) => {
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, p.guards < MAX_GUARDS, 'You have the maximum number of guards.');
      this._check(p, this.canAfford(p, GUARD_COST), 'Not enough resources.');
      this.pay(p, GUARD_COST);
      p.guards++;
      p.actionsLeft--;
      this.log(`🛡️ ${p.name} hires a guard (${p.guards}).`, pid);
      this.emit('tileChanged', this.homeTile(pid));
    });
  },

  upgradeHome(pid) {
    return this._act(pid, (p) => {
      const t = this.homeTile(pid);
      const next = HOME_LEVELS[t.level + 1];
      this._check(p, p.actionsLeft > 0, 'No actions left.');
      this._check(p, next, 'Already fully grown.');
      this._check(p, this.canAfford(p, next.cost), 'Not enough resources.');
      this.pay(p, next.cost);
      t.level++;
      p.prosp += next.prosp;
      p.actionsLeft--;
      this.log(`🏡 ${p.name}'s farm grows into a ${next.name.toLowerCase()}: +${next.prosp} prosperity.`, pid);
      this.emit('tileChanged', t, { built: true });
    });
  },
};

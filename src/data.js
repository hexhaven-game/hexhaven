export const RES = ['wood', 'stone', 'grain', 'veg', 'wool', 'gold'];
export const TRADE_RES = ['wood', 'stone', 'grain', 'veg', 'wool'];

export const RES_INFO = {
  wood: { name: 'Wood', icon: '🪵' },
  stone: { name: 'Stone', icon: '🪨' },
  grain: { name: 'Grain', icon: '🌾' },
  veg: { name: 'Veg', icon: '🥕' },
  wool: { name: 'Wool', icon: '🐑' },
  gold: { name: 'Gold', icon: '🪙' },
};

export const TILE_TYPES = {
  forest: { name: 'Forest', icon: '🌲', prod: { wood: 1 }, weight: 3, desc: '+1 wood each round' },
  meadow: { name: 'Meadow', icon: '🌿', prod: { wool: 1 }, weight: 3, desc: '+1 wool each round' },
  field: { name: 'Field', icon: '🌱', prod: {}, weight: 3, desc: 'Grow crops here' },
  mountain: { name: 'Mountain', icon: '⛰️', prod: { stone: 1 }, weight: 2.2, desc: '+1 stone each round' },
  lake: { name: 'Lake', icon: '🌊', prod: {}, weight: 1.5, desc: 'Waters fields next to it' },
  village: { name: 'Haven', icon: '🏘️', prod: {} },
  home: { name: 'Farm', icon: '🏡', prod: {} },
};
export const PLACEABLE = ['forest', 'meadow', 'field', 'mountain', 'lake'];

export const BUILDINGS = {
  lumber: { name: 'Lumber camp', icon: '🪓', on: 'forest', cost: { stone: 1, gold: 2 }, prod: { wood: 2 }, prosp: 2, desc: '+2 wood each round' },
  quarry: { name: 'Quarry', icon: '⛏️', on: 'mountain', cost: { wood: 2, gold: 1 }, prod: { stone: 2 }, prosp: 2, desc: '+2 stone each round' },
  pen: { name: 'Sheep pen', icon: '🐑', on: 'meadow', cost: { wood: 2, grain: 1 }, prod: { wool: 2 }, prosp: 2, desc: '+2 wool each round' },
  barn: { name: 'Barn', icon: '🛖', on: 'field', cost: { wood: 3, stone: 1 }, prod: {}, prosp: 2, desc: '+2 on every harvest' },
  dock: { name: 'Fishing dock', icon: '⚓', on: 'lake', cost: { wood: 3 }, prod: { gold: 1, veg: 1 }, prosp: 2, desc: '+1 gold and +1 veg (fish) each round' },
};

export const CROPS = {
  wheat: { name: 'Wheat', icon: '🌾', grow: 2, yield: { grain: 3 }, cost: {}, prosp: 1 },
  carrot: { name: 'Carrots', icon: '🥕', grow: 3, yield: { veg: 4 }, cost: { grain: 1 }, prosp: 1 },
  pumpkin: { name: 'Pumpkins', icon: '🎃', grow: 4, yield: { veg: 5, gold: 2 }, cost: { grain: 1, gold: 1 }, prosp: 3 },
};

export const HOME_LEVELS = [
  null,
  { name: 'Farm', actions: 2, gold: 0 },
  { name: 'Homestead', actions: 2, gold: 1, cost: { wood: 4, stone: 2, grain: 2 }, prosp: 4 },
  { name: 'Manor', actions: 3, gold: 2, cost: { wood: 3, stone: 5, wool: 3, veg: 3 }, prosp: 6 },
  { name: 'Village', actions: 3, gold: 3, cost: { wood: 6, stone: 6, grain: 4, wool: 4, gold: 6 }, prosp: 10 },
  { name: 'Town', actions: 4, gold: 4, cost: { wood: 6, stone: 10, veg: 6, wool: 6, gold: 12 }, prosp: 16 },
];

export const POIS = {
  ruins: { name: 'Old ruins', icon: '🏛️', repair: { stone: 3, wood: 2 }, prosp: 5, desc: 'Restore for +5 prosperity and +1 gold each round' },
  mill: { name: 'Abandoned mill', icon: '🏚️', repair: { wood: 3, stone: 1 }, prosp: 3, desc: 'Restore so your fields next to it harvest +2' },
  treasure: { name: 'Hidden treasure', icon: '💰', desc: '+4 gold for whoever finds it' },
  bandits: { name: 'Bandit camp', icon: '☠️', desc: 'Steals from its neighbours every round. Beat it with guards.' },
};

export const GUARD_COST = { grain: 2, gold: 2 };
export const MAX_GUARDS = 5;

export const SEASONS = [
  { name: 'Spring', icon: '🌸', desc: 'Crops grow.' },
  { name: 'Summer', icon: '☀️', desc: 'Crops grow. Wool sells well.' },
  { name: 'Autumn', icon: '🍂', desc: 'Every harvest gives +1.' },
  { name: 'Winter', icon: '❄️', desc: 'Nothing grows. Build and trade.' },
];
export const ROUNDS_PER_SEASON = 3;
export const TOTAL_ROUNDS = 24;
export const ROUNDS_PER_YEAR = 12;
export const WIN_GOAL = 300;
export const QUEST_TYPES = ['forest', 'meadow', 'field', 'mountain', 'lake'];

export const MARKET_BASE = { grain: 2, veg: 3, wool: 4, wood: 3, stone: 3 };

export const PERSONALITIES = {
  farmer: { name: 'Farmer', icon: '🌾', tiles: { field: 2.5, meadow: 1.5, lake: 1.2, forest: 0.5, mountain: 0.2 }, explore: 0.2, margin: 1.05 },
  explorer: { name: 'Explorer', icon: '🧭', tiles: { forest: 1, mountain: 1, meadow: 0.8, field: 0.8, lake: 0.6 }, explore: 1.5, margin: 1.1 },
  merchant: { name: 'Merchant', icon: '🪙', tiles: { lake: 1.8, mountain: 1.2, forest: 1.2, meadow: 1, field: 0.8 }, explore: 0.4, margin: 1.25 },
  human: { name: 'Player', icon: '🙂', tiles: {}, explore: 0.5, margin: 1.1 },
};

export const BONUSES = {
  shepherd: { name: 'Shepherd', icon: '🐑', desc: 'Start with a sheep pen on your meadow.' },
  farmer: { name: 'Farmer', icon: '🌾', desc: 'All your crops grow one round faster.' },
  explorer: { name: 'Explorer', icon: '🧭', desc: 'One free scout every round.' },
};

export const costText = (cost) =>
  Object.entries(cost)
    .filter(([, n]) => n > 0)
    .map(([r, n]) => `${n}${RES_INFO[r].icon}`)
    .join(' ') || 'free';

// Second step for each building: small, logical bump (+1 of what it already does)
export const BUILDING_UPGRADES = {
  lumber: { name: 'Sawmill', cost: { stone: 2, gold: 2 }, prod: { wood: 1 }, prosp: 1, desc: '+1 wood each round' },
  quarry: { name: 'Deep quarry', cost: { wood: 3, gold: 2 }, prod: { stone: 1 }, prosp: 1, desc: '+1 stone each round' },
  pen: { name: 'Shearing shed', cost: { wood: 3, stone: 1 }, prod: { wool: 1 }, prosp: 1, desc: '+1 wool each round' },
  barn: { name: 'Granary', cost: { wood: 2, stone: 2 }, prod: {}, harvest: 1, prosp: 1, desc: '+1 more on every harvest' },
  dock: { name: 'Harbour', cost: { wood: 3, stone: 2 }, prod: { gold: 1 }, prosp: 1, desc: '+1 gold each round' },
};

// Personal workshop perks: one of each per player, unlocked by the size of your farm
export const PERKS = {
  cart: { name: 'Cart', level: 1, cost: { wood: 3, gold: 2 }, prosp: 2, desc: 'No transport fee when selling, even before you reach Haven.' },
  seeds: { name: 'Seed store', level: 1, cost: { wood: 2, grain: 3 }, prosp: 2, desc: 'Crops cost 1 grain less to plant.' },
  surveyor: { name: 'Surveyor', level: 2, cost: { wool: 3, gold: 4 }, prosp: 2, desc: 'Choose from 4 tiles instead of 3.' },
  watchtower: { name: 'Watchtower', level: 2, cost: { stone: 4, wood: 2 }, prosp: 2, desc: 'Guards block raids more often and bandits take at most 1.' },
  guild: { name: 'Guild seal', level: 3, cost: { gold: 8, wool: 2 }, prosp: 2, desc: 'Buying at the market costs 1 gold less.' },
  maproom: { name: 'Map room', level: 3, cost: { wool: 2, stone: 3, gold: 3 }, prosp: 2, desc: 'One extra free scout every round.' },
};

// Game state and simulation: economy, research, governments, armies, ships, aircraft and combat.
// In multiplayer only the host runs this simulation; clients receive snapshots (see snapshot/applySnapshot).
'use strict';

const Game = {
  time: 0,
  speed: 1,
  paused: false,
  over: false,
  winner: -1,
  player: -1,          // nation controlled on this screen
  hadHumans: false,
  difficulty: 'normal',
  tiles: [],           // per World tile: owner, units, buildings, core
  nations: [],
  armies: [],
  units: [],           // ships and aircraft
  effects: [],         // visual effects for the renderer
  log: [],
  dirty: true,         // ownership changed -> renderer rebuilds caches
  needRecount: false,
  nextId: 1,
  combatTimer: 0,
  dmgAcc: new Map(),   // fractional bombardment damage per tile
  net: false,          // true on a multiplayer host: collect logs/effects for clients
  out: { logs: [], effects: [] },
  sig: [],             // last sent tile state (multiplayer delta)
  snapCount: 0,

  // humans: nation indexes controlled by people; local: the nation on this screen.
  init(humans, local, difficulty) {
    this.player = local;
    this.difficulty = difficulty;
    this.hadHumans = humans.length > 0;
    this.time = 0; this.over = false; this.winner = -1; this.speed = 1; this.paused = false;
    this.armies = []; this.units = []; this.effects = []; this.log = [];
    this.dmgAcc = new Map(); this.sig = []; this.out = { logs: [], effects: [] };
    const { owner, capitals } = World.assignTerritories();

    this.nations = NATIONS.map((def, i) => ({
      idx: i, def, name: def.name, color: nationColor(i),
      alive: true, isPlayer: humans.includes(i),
      gold: ECON.startGold, gp: 0,
      tech: { inf: 0, arc: 0, cav: 0 }, era: 0, finalTech: false, mil: {},
      research: null,      // { kind, branch?, id?, level, remaining, total }
      gov: 'tribe', govs: new Set(['tribe']), govResearch: null, govCooldown: 0,
      capital: capitals[i], levyTimer: Math.random() * ECON.levyInterval,
      tileCount: 0, built: {}, troops: 0, specials: 0,
      ai: { timer: Math.random() * 2, style: Math.random() },
      income: { gold: 0, gp: 0 },
    }));

    this.tiles = World.tiles.map(t => {
      const o = owner[t.id];
      const units = { inf: 0, arc: 0, cav: 0 };
      if (o >= 0) {
        if (capitals[o] === t.id) { units.inf = 12; units.arc = 6; units.cav = 4; }
        else { units.inf = 3; units.arc = 1; }
      } else {
        units.inf = 3 + Math.floor(Math.random() * 7);
        if (Math.random() < 0.4) units.arc = 1 + Math.floor(Math.random() * 4);
      }
      const tile = { id: t.id, owner: o, core: o, units };
      for (const k of BUILD_KEYS) tile[k] = false;
      return tile;
    });
    this.recount(true);
    this.dirty = true;
  },

  // ---------- helpers ----------
  nation(i) { return i >= 0 ? this.nations[i] : null; },

  mods(n) {
    const m = { atk: 0, def: 0, gold: 0, gp: 0, recruit: 0, levy: 0, speed: 0, factory: 0 };
    if (!n) return m;
    const g = GOVS[n.gov].mods;
    for (const k in g) m[k] += g[k];
    if (n.finalTech) for (const k in FINAL_TECH.mods) m[k] += FINAL_TECH.mods[k];
    m.gold += n.era * ERA_GOLD_BONUS;
    return m;
  },

  tiers(ownerIdx) {
    const n = this.nation(ownerIdx);
    return n ? n.tech : { inf: 0, arc: 0, cav: 0 };
  },

  total(u) { return u.inf + u.arc + u.cav; },
  zero() { return { inf: 0, arc: 0, cav: 0 }; },

  // Recomputes per-nation totals. Building counts are kept up to date incrementally
  // (build/capture) and only rebuilt when `buildings` is set.
  recount(buildings = false) {
    this.needRecount = false;
    for (const n of this.nations) {
      n.tileCount = 0; n.troops = 0; n.specials = 0;
      if (buildings) for (const k of BUILD_KEYS) n.built[k] = 0;
    }
    for (const t of this.tiles) {
      if (t.owner < 0) continue;
      const n = this.nations[t.owner];
      n.tileCount++;
      n.troops += t.units.inf + t.units.arc + t.units.cav;
      if (buildings) for (const k of BUILD_KEYS) if (t[k]) n.built[k]++;
    }
    for (const a of this.armies) this.nations[a.owner].troops += this.total(a.units);
    for (const u of this.units) {
      const n = this.nations[u.owner];
      n.specials++;
      n.troops += this.total(u.cargo);
    }
  },

  title(n) {
    return `${GOVS[n.gov].title} ${n.name}`;
  },

  sizeRank(n) {
    let label = SIZE_RANKS[0][1];
    for (const [min, l] of SIZE_RANKS) if (n.tileCount >= min) label = l;
    return label;
  },

  goldIncome(n) {
    const m = this.mods(n);
    let g = ECON.baseGold + ECON.goldPerTile * n.tileCount + ECON.factoryGold * n.built.factory;
    g *= 1 + m.gold;
    if (!n.isPlayer) g *= DIFFICULTY[this.difficulty].aiIncome;
    return g - this.upkeep(n);
  },

  upkeep(n) {
    return (n.troops || 0) * ECON.upkeep + (n.specials || 0) * ECON.specialUpkeep;
  },

  gpIncome(n) {
    const m = this.mods(n);
    let g = ECON.baseGP + ECON.gpPerTile * n.tileCount + ECON.templeGP * n.built.temple;
    return g * (1 + m.gp);
  },

  buildCost(n, kind) {
    const b = BUILDINGS[kind];
    let c = b.base + b.step * n.built[kind];
    if (kind === 'factory') c *= 1 + this.mods(n).factory;
    return Math.round(c);
  },

  unitCost(n, type) {
    return UNITS[type].cost * TIER_COST[n.tech[type]] * (1 + this.mods(n).recruit);
  },

  // to: nation index the message is meant for, or -1 for everyone.
  addLog(msg, kind = 'info', to = -1) {
    const entry = { msg, kind, to, time: this.time };
    this.log.unshift(entry);
    if (this.log.length > 80) this.log.pop();
    if (this.net) this.out.logs.push(entry);
  },

  fx(e) {
    e.t = 0;
    this.effects.push(e);
    if (this.net) this.out.effects.push(e);
  },

  // ---------- commands (player input, also arriving over the network) ----------
  command(ni, c) {
    const n = this.nations[ni];
    if (!n || !n.alive || this.over || !c) return false;
    switch (c.t) {
      case 'recruit': return this.recruit(ni, c.tile, c.type, c.n);
      case 'build': return this.build(ni, c.tile, c.kind);
      case 'send': return this.sendArmy(ni, c.from, c.to, c.frac, c.types);
      case 'research': {
        const opt = this.researchOptions(n).find(o => o.kind === c.kind
          && (c.kind !== 'unit' || o.branch === c.branch) && (c.kind !== 'mil' || o.id === c.id));
        return !!opt && this.startResearch(ni, opt);
      }
      case 'gov': return this.startGovResearch(ni, c.id);
      case 'adopt': return this.adoptGov(ni, c.id);
      case 'special': return this.buildSpecial(ni, c.tile, c.type);
      case 'order': return this.orderUnit(ni, c.u, c.o);
      case 'load': return this.loadUnit(ni, c.u, c.tile, c.frac, c.types);
    }
    return false;
  },

  recruit(ni, tileId, type, count) {
    const n = this.nations[ni], t = this.tiles[tileId];
    if (!t || t.owner !== ni || !UNITS[type] || !(count > 0)) return false;
    const cost = this.unitCost(n, type) * count;
    if (n.gold < cost) return false;
    n.gold -= cost;
    t.units[type] += count;
    n.troops += count;
    return true;
  },

  canBuild(n, tileId, kind) {
    const b = BUILDINGS[kind], t = this.tiles[tileId];
    if (!b || !t || t.owner !== n.idx) return { ok: false, why: 'Niet jouw gebied' };
    if (t[kind]) return { ok: false, why: 'Al gebouwd' };
    if (b.req && !n.mil[b.req]) return { ok: false, why: 'Vereist ' + milTech(b.req).name };
    if (b.coastal && !World.tiles[tileId].seaAdj.length) return { ok: false, why: 'Alleen aan de kust' };
    const cost = this.buildCost(n, kind);
    return { ok: n.gold >= cost, cost, why: n.gold >= cost ? '' : `${cost} goud` };
  },

  build(ni, tileId, kind) {
    const n = this.nations[ni];
    const c = this.canBuild(n, tileId, kind);
    if (!c.ok) return false;
    n.gold -= c.cost;
    this.tiles[tileId][kind] = true;
    n.built[kind]++;
    return true;
  },

  // Which research options exist right now for nation n.
  researchOptions(n) {
    const opts = [];
    for (const b of UNIT_TYPES) {
      const lvl = n.tech[b] + 1;
      if (lvl >= TIER_POWER.length) continue;
      opts.push({ kind: 'unit', branch: b, level: lvl, cost: TIER_TECH_COST[lvl], time: 8 + 5 * lvl,
        ok: n.era >= lvl, why: n.era >= lvl ? '' : `Vereist ${ERAS[lvl]}` });
    }
    for (const m of MIL_TECHS) {
      if (n.mil[m.id]) continue;
      const why = n.era < m.era ? `Vereist ${ERAS[m.era]}` : m.req && !n.mil[m.req] ? `Vereist ${milTech(m.req).name}` : '';
      opts.push({ kind: 'mil', id: m.id, level: 0, cost: m.cost, time: m.time, ok: !why, why });
    }
    if (n.era + 1 < ERAS.length) {
      const lvl = n.era + 1;
      const atLevel = UNIT_TYPES.filter(b => n.tech[b] >= n.era).length;
      opts.push({ kind: 'era', level: lvl, cost: ERA_COST[lvl], time: 15 + 8 * lvl,
        ok: atLevel >= 2, why: atLevel >= 2 ? '' : `2 eenheden op tier ${n.era + 1} nodig` });
    } else if (!n.finalTech) {
      const ok = UNIT_TYPES.every(b => n.tech[b] >= TIER_POWER.length - 1);
      opts.push({ kind: 'final', level: 0, cost: FINAL_TECH.cost, time: FINAL_TECH.time,
        ok, why: ok ? '' : 'Alle eenheden op tier 6 nodig' });
    }
    return opts;
  },

  startResearch(ni, opt) {
    const n = this.nations[ni];
    if (n.research || !opt.ok || n.gold < opt.cost) return false;
    n.gold -= opt.cost;
    n.research = { kind: opt.kind, branch: opt.branch, id: opt.id, level: opt.level, remaining: opt.time, total: opt.time };
    return true;
  },

  govStatus(n, id) {
    const g = GOVS[id];
    if (n.govs.has(id)) return { state: 'unlocked' };
    if (!g.reqAny.some(r => n.govs.has(r))) return { state: 'locked', why: 'Vereist ' + g.reqAny.map(r => GOVS[r].name).join(' of ') };
    if (g.minTiles && n.tileCount < g.minTiles) return { state: 'locked', why: `Vereist ${g.minTiles} gebieden` };
    if (g.minEra && n.era < g.minEra) return { state: 'locked', why: `Vereist ${ERAS[g.minEra]}` };
    return { state: 'available' };
  },

  startGovResearch(ni, id) {
    const n = this.nations[ni], g = GOVS[id];
    if (!g || n.govResearch || this.govStatus(n, id).state !== 'available' || n.gp < g.cost) return false;
    n.gp -= g.cost;
    const time = 8 + g.cost / 40;
    n.govResearch = { id, remaining: time, total: time };
    return true;
  },

  adoptGov(ni, id) {
    const n = this.nations[ni];
    if (!n.govs.has(id) || n.gov === id || n.govCooldown > 0) return false;
    n.gov = id;
    n.govCooldown = GOV_SWITCH_COOLDOWN;
    this.addLog(`Nieuwe regeringsvorm: ${GOVS[id].name}`, 'good', ni);
    return true;
  },

  // Shortest path from a tile to a target; intermediate tiles must be owned by the mover.
  findPath(ni, from, to) {
    if (from === to) return null;
    const prev = new Map([[from, -1]]);
    const q = [from];
    for (let i = 0; i < q.length; i++) {
      const id = q[i];
      if (id === to) break;
      if (id !== from && this.tiles[id].owner !== ni) continue;
      for (const nb of World.tiles[id].adj) {
        if (!prev.has(nb)) { prev.set(nb, id); q.push(nb); }
      }
    }
    if (!prev.has(to)) return null;
    const path = [];
    for (let id = to; id !== -1; id = prev.get(id)) path.push(id);
    return path.reverse();
  },

  atPeace() { return this.time < ECON.peaceTime; },

  // During the opening peace nations may only attack neutral land.
  canAttack(ni, tileId) {
    const o = this.tiles[tileId].owner;
    return o === ni || o < 0 || !this.atPeace();
  },

  // Send part of a tile's garrison along a path. fraction applies per selected unit type.
  sendArmy(ni, from, to, fraction = 1, types = UNIT_TYPES) {
    const t = this.tiles[from];
    if (!t || !this.tiles[to] || t.owner !== ni || !this.canAttack(ni, to)) return false;
    const path = this.findPath(ni, from, to);
    if (!path) return false;
    const units = this.take(t.units, fraction, types);
    if (this.total(units) === 0) return false;
    this.armies.push({ id: this.nextId++, owner: ni, units, path, seg: 0, prog: 0 });
    return true;
  },

  // Removes part of a unit stack and returns what was taken (optionally capped).
  take(from, fraction, types, cap = Infinity) {
    const want = this.zero();
    for (const k of types || UNIT_TYPES) {
      if (!from[k]) continue;
      want[k] = fraction >= 1 ? from[k] : Math.floor(from[k] * fraction);
    }
    const tot = this.total(want);
    if (tot > cap) {
      const f = cap / tot;
      for (const k of UNIT_TYPES) want[k] = Math.floor(want[k] * f);
      if (!this.total(want) && cap > 0) {
        const k = (types || UNIT_TYPES).filter(x => from[x] > 0).sort((a, b) => from[b] - from[a])[0];
        if (k) want[k] = 1;
      }
    }
    for (const k of UNIT_TYPES) from[k] -= want[k];
    return want;
  },

  armySpeed(a) {
    let s = Infinity;
    for (const k of UNIT_TYPES) if (a.units[k] > 0) s = Math.min(s, UNITS[k].speed);
    return s * (1 + this.mods(this.nation(a.owner)).speed);
  },

  // ---------- land combat ----------
  power(units, tiers, mode, enemy, bonus) {
    const et = Math.max(1, this.total(enemy));
    let p = 0;
    for (const k of UNIT_TYPES) {
      if (!units[k]) continue;
      const u = UNITS[k];
      const weakTo = UNIT_TYPES.find(x => UNITS[x].beats === k);
      const mult = 1 + 0.6 * (enemy[u.beats] / et) - 0.3 * (enemy[weakTo] / et);
      p += units[k] * TIER_POWER[tiers[k]] * u[mode] * mult;
    }
    return p * (1 + bonus);
  },

  defenseBonus(tile) {
    const n = this.nation(tile.owner);
    let b = ECON.baseDef + this.mods(n).def;
    if (tile.fort) b += ECON.fortDef;
    if (n && n.capital === tile.id) b += ECON.capitalDef;
    return b;
  },

  // Returns attack power / defense power estimate (used by AI and UI).
  odds(attOwner, units, tile, atkMod = 0) {
    const dp = this.power(tile.units, this.tiers(tile.owner), 'def', units, this.defenseBonus(tile));
    const ap = this.power(units, this.tiers(attOwner), 'atk', tile.units, this.mods(this.nation(attOwner)).atk + atkMod);
    return dp <= 0 ? Infinity : ap / dp;
  },

  scale(units, f) {
    const total = this.total(units);
    const out = {};
    for (const k of UNIT_TYPES) out[k] = Math.round(units[k] * f);
    if (f > 0 && total > 0 && this.total(out) === 0) {
      const k = UNIT_TYPES.reduce((a, b) => units[a] >= units[b] ? a : b);
      out[k] = 1;
    }
    return out;
  },

  resolveAttack(army, tileId, atkMod = 0) {
    const tile = this.tiles[tileId];
    const att = this.nations[army.owner];
    const defOwner = tile.owner;
    const ratio = this.odds(army.owner, army.units, tile, atkMod);
    const w = World.tiles[tileId];
    this.fx({ kind: 'battle', x: w.x, y: w.y, color: att.color });

    if (ratio > 1) {
      const surv = Math.sqrt(1 - 1 / (ratio * ratio));
      tile.units = this.scale(army.units, ratio === Infinity ? 1 : surv);
      this.capture(tile, army.owner, defOwner);
    } else {
      const surv = Math.sqrt(Math.max(0, 1 - ratio * ratio));
      tile.units = this.scale(tile.units, surv);
      if (defOwner >= 0) this.addLog(`${att.name} werd afgeslagen!`, 'good', defOwner);
      this.addLog(`Aanval mislukt tegen ${defOwner >= 0 ? this.nations[defOwner].name : 'stammen'}`, 'bad', army.owner);
    }
    this.needRecount = true;
  },

  capture(tile, newOwner, oldOwner) {
    const att = this.nations[newOwner];
    tile.owner = newOwner;
    att.gold += ECON.plunder;
    att.tileCount++;
    this.dirty = true;
    this.needRecount = true;
    const old = this.nation(oldOwner);
    for (const k of BUILD_KEYS) {
      if (!tile[k]) continue;
      att.built[k]++;
      if (old) old.built[k]--;
    }
    if (!old) return;
    old.tileCount--;
    if (old.capital === tile.id) {
      const loot = Math.floor(old.gold * 0.3);
      old.gold -= loot; att.gold += loot;
      const remaining = this.tiles.filter(t => t.owner === oldOwner);
      if (remaining.length) old.capital = (remaining.find(t => t.core === oldOwner) || remaining[0]).id;
      this.addLog(`${att.name} heeft je hoofdstad ingenomen!`, 'bad', oldOwner);
      this.addLog(`Hoofdstad van ${old.name} veroverd! (+${loot} goud)`, 'good', newOwner);
    } else {
      this.addLog(`${att.name} veroverde een gebied van je`, 'bad', oldOwner);
    }
    if (old.tileCount <= 0 && old.alive) this.eliminate(old, att);
  },

  eliminate(n, by) {
    n.alive = false;
    n.research = null; n.govResearch = null;
    this.armies = this.armies.filter(a => a.owner !== n.idx);
    this.units = this.units.filter(u => u.owner !== n.idx);
    by.gold += Math.floor(n.gold);
    n.gold = 0;
    this.addLog(`${n.name} is vernietigd door ${by.name}`, n.isPlayer ? 'bad' : 'event');
    this.needRecount = true;
  },

  // ---------- ships & aircraft ----------
  unitById(id) { return this.units.find(u => u.id === id); },

  eraMult(n) { return 1 + SPECIAL_ERA_SCALE * (n ? n.era : 0); },

  specialName(u) {
    const d = SPECIALS[u.type];
    return d.names ? d.names[this.nations[u.owner].era] : d.name;
  },

  isSea(u) { return SPECIALS[u.type].domain === 'sea'; },

  // Grid cell a unit is in (ships: their sea cell, aircraft: the cell below them).
  unitCR(u) {
    if (this.isSea(u)) { const s = World.sea[u.sea]; return [s.c, s.r]; }
    return World.pickCR(u.x, u.y);
  },

  canBuildSpecial(n, tileId, type) {
    const d = SPECIALS[type], t = this.tiles[tileId];
    if (!d || !t || t.owner !== n.idx) return { ok: false, why: 'Niet jouw gebied' };
    if (!n.mil[d.tech]) return { ok: false, why: 'Vereist ' + milTech(d.tech).name };
    const bld = d.domain === 'sea' ? 'harbor' : 'airfield';
    if (!t[bld]) return { ok: false, why: 'Vereist ' + BUILDINGS[bld].name };
    return { ok: n.gold >= d.cost, why: n.gold >= d.cost ? '' : `${d.cost} goud` };
  },

  buildSpecial(ni, tileId, type) {
    const n = this.nations[ni];
    if (!this.canBuildSpecial(n, tileId, type).ok) return false;
    const d = SPECIALS[type], w = World.tiles[tileId], m = this.eraMult(n);
    n.gold -= d.cost;
    const u = { id: this.nextId++, type, owner: ni, hp: d.hp * m, maxHp: d.hp * m, cargo: this.zero(), home: tileId,
      sea: -1, path: null, seg: 0, prog: 0, dest: null, mission: null, armed: true, rearm: 0, x: w.x, y: w.y };
    if (d.domain === 'sea') {
      const s = World.sea[w.seaAdj[Math.floor(Math.random() * w.seaAdj.length)]];
      u.sea = s.id; u.x = s.x; u.y = s.y;
    }
    this.units.push(u);
    n.specials++;
    return true;
  },

  // o: { sea } | { tile, act: 'move'|'unload' } | { unit } | { home: true }
  orderUnit(ni, uid, o) {
    const u = this.unitById(uid);
    if (!u || u.owner !== ni || !o) return false;
    return this.isSea(u) ? this.orderShip(u, o) : this.orderAir(u, o);
  },

  orderShip(u, o) {
    let goal, mission = null;
    if (o.sea !== undefined) {
      if (!World.sea[o.sea]) return false;
      goal = s => s === o.sea;
    } else if (o.tile !== undefined) {
      const w = World.tiles[o.tile];
      if (!w || !w.seaAdj.length) return false;
      const act = o.act === 'unload' && this.total(u.cargo) ? 'unload' : 'move';
      if (act === 'unload' && !this.canAttack(u.owner, o.tile)) return false;
      const coast = new Set(w.seaAdj);
      goal = s => coast.has(s);
      mission = { kind: act, tile: o.tile };
    } else if (o.unit !== undefined) {
      const t = this.unitById(o.unit);
      if (!t || t.owner === u.owner) return false;
      let sid;
      if (this.isSea(t)) sid = t.sea;
      else { const [c, r] = World.pickCR(t.x, t.y); sid = World.seaAt(c, r); }
      if (sid < 0) return false;
      goal = s => s === sid;
      mission = { kind: 'hunt', unit: t.id };
    } else if (o.home) {
      const coast = new Set(World.tiles[u.home].seaAdj);
      goal = s => coast.has(s);
    } else return false;
    const path = World.seaPath(u.sea, goal);
    if (!path) return false;
    u.mission = mission;
    u.seg = 0; u.prog = 0;
    u.path = path.length > 1 ? path : null;
    if (!u.path) this.shipArrived(u);
    return true;
  },

  shipArrived(u) {
    const m = u.mission;
    if (!m) return;
    if (m.kind !== 'hunt') u.mission = null;
    if (m.kind === 'unload' && World.sea[u.sea].coast.includes(m.tile)) this.unload(u, m.tile);
  },

  orderAir(u, o) {
    let x, y, mission = { kind: 'move' };
    if (o.home) return this.sendHome(u);
    if (o.sea !== undefined) {
      const s = World.sea[o.sea];
      if (!s) return false;
      x = s.x; y = s.y;
    } else if (o.tile !== undefined) {
      const w = World.tiles[o.tile];
      if (!w) return false;
      x = w.x; y = w.y;
      const enemy = this.tiles[o.tile].owner !== u.owner;
      if (u.type === 'bomber' && enemy) mission = { kind: 'bomb', tile: o.tile };
      else if (o.act === 'unload' && this.total(u.cargo)) mission = { kind: 'unload', tile: o.tile };
      else mission = { kind: 'move', tile: o.tile };
    } else if (o.unit !== undefined) {
      const t = this.unitById(o.unit);
      if (!t || t.owner === u.owner || u.type !== 'bomber') return false;
      x = t.x; y = t.y;
      mission = { kind: 'bomb', unit: t.id };
    } else return false;
    if (mission.kind === 'bomb' && (!u.armed || this.atPeace())) return false;
    if (mission.kind === 'unload' && !this.canAttack(u.owner, mission.tile)) return false;
    u.dest = { x, y };
    u.mission = mission;
    return true;
  },

  // Fly back to the home airfield (or the nearest other one).
  sendHome(u) {
    if (this.isSea(u)) return this.orderShip(u, { home: true });
    const ok = id => this.tiles[id].owner === u.owner && this.tiles[id].airfield;
    let home = ok(u.home) ? u.home : -1;
    if (home < 0) {
      let best = Infinity;
      for (const t of this.tiles) {
        if (!ok(t.id)) continue;
        const w = World.tiles[t.id], d = (w.x - u.x) ** 2 + (w.y - u.y) ** 2;
        if (d < best) { best = d; home = t.id; }
      }
    }
    if (home < 0) { u.dest = null; u.mission = null; return false; }
    u.home = home;
    const w = World.tiles[home];
    u.dest = { x: w.x, y: w.y };
    u.mission = { kind: 'home', tile: home };
    return true;
  },

  airArrived(u) {
    const m = u.mission;
    u.mission = null;
    if (!m) return;
    if (m.kind === 'unload') this.unload(u, m.tile);
    else if (m.kind === 'bomb') { this.dropBombs(u, m); this.sendHome(u); }
    else if (m.kind === 'home' && !u.armed) u.rearm = SPECIALS[u.type].rearm;
  },

  // Is the transport next to (ship) or above (aircraft) this land tile?
  canReach(u, tileId) {
    if (this.isSea(u)) return !u.path && World.sea[u.sea].coast.includes(tileId);
    return !u.dest && World.pick(u.x, u.y) === tileId;
  },

  loadUnit(ni, uid, tileId, frac = 1, types = UNIT_TYPES) {
    const u = this.unitById(uid), tile = this.tiles[tileId];
    if (!u || u.owner !== ni || !tile || tile.owner !== ni) return false;
    const cap = SPECIALS[u.type].capacity;
    if (!cap || !this.canReach(u, tileId)) return false;
    const space = cap - this.total(u.cargo);
    if (space <= 0) return false;
    const got = this.take(tile.units, frac, types, space);
    if (!this.total(got)) return false;
    for (const k of UNIT_TYPES) u.cargo[k] += got[k];
    return true;
  },

  unload(u, tileId) {
    if (!this.total(u.cargo) || !this.canAttack(u.owner, tileId)) return false;
    const sea = this.isSea(u);
    if (sea ? !World.sea[u.sea].coast.includes(tileId) : World.pick(u.x, u.y) !== tileId) return false;
    const tile = this.tiles[tileId];
    const cargo = u.cargo;
    u.cargo = this.zero();
    if (tile.owner === u.owner) {
      for (const k of UNIT_TYPES) tile.units[k] += cargo[k];
    } else if (this.total(tile.units) === 0) {
      tile.units = { ...cargo };
      this.capture(tile, u.owner, tile.owner);
    } else {
      this.resolveAttack({ owner: u.owner, units: cargo }, tileId, sea ? -AMPHIBIOUS_PENALTY : 0);
    }
    this.needRecount = true;
    return true;
  },

  // Removes troops worth `power` (fractional damage carries over).
  killTroops(tile, power) {
    const tiers = this.tiers(tile.owner);
    let acc = (this.dmgAcc.get(tile.id) || 0) + power, killed = 0;
    while (this.total(tile.units) > 0) {
      const k = UNIT_TYPES.reduce((a, b) => tile.units[a] >= tile.units[b] ? a : b);
      const cost = TIER_POWER[tiers[k]] * UNITS[k].def;
      if (acc < cost) break;
      acc -= cost; tile.units[k]--; killed++;
    }
    if (!this.total(tile.units)) acc = 0;
    this.dmgAcc.set(tile.id, acc);
    if (killed) this.needRecount = true;
    return killed;
  },

  dropBombs(u, m) {
    const n = this.nations[u.owner];
    const dmg = SPECIALS.bomber.payload * this.eraMult(n);
    u.armed = false;
    this.fx({ kind: 'boom', x: u.x, y: u.y, color: n.color });
    if (m.unit !== undefined) {
      const t = this.unitById(m.unit);
      if (t && Math.hypot(t.x - u.x, t.y - u.y) < HEX_W * 1.5) { t.hp -= dmg; t.killer = u.owner; }
      return;
    }
    const tile = this.tiles[m.tile];
    if (tile.owner === u.owner) return;
    const killed = this.killTroops(tile, dmg);
    this.addLog(`Bombardement: ${killed} vijanden gedood`, 'good', u.owner);
    if (tile.owner >= 0) this.addLog(`${n.name} bombardeerde je troepen (−${killed})`, 'bad', tile.owner);
  },

  nearestEnemy(owner, c, r, range, domain, cells) {
    let best = null, bd = Infinity;
    for (const u of this.units) {
      if (u.owner === owner || u.hp <= 0 || SPECIALS[u.type].domain !== domain) continue;
      const [uc, ur] = cells.get(u);
      if (Math.abs(ur - r) > range) continue;
      const d = World.cellDist(c, r, uc, ur);
      if (d <= range && d < bd) { bd = d; best = u; }
    }
    return best;
  },

  // Auto-fire of warships, coastal batteries and anti-air, every COMBAT_TICK seconds.
  combatTick(dt) {
    if (this.atPeace() || !this.units.length) return;
    const cells = new Map(this.units.map(u => [u, this.unitCR(u)]));
    const shoot = (owner, x, y, target, dmg) => {
      target.hp -= dmg;
      target.killer = owner;
      this.fx({ kind: 'shot', x, y, x2: target.x, y2: target.y, color: this.nations[owner].color });
    };
    for (const a of this.units) {
      const d = SPECIALS[a.type];
      if (!d.range) continue;
      const [ac, ar] = cells.get(a);
      const m = this.eraMult(this.nations[a.owner]);
      if (d.antiShip) { const t = this.nearestEnemy(a.owner, ac, ar, d.range, 'sea', cells); if (t) shoot(a.owner, a.x, a.y, t, d.antiShip * m * dt); }
      if (d.antiAir) { const t = this.nearestEnemy(a.owner, ac, ar, d.range, 'air', cells); if (t) shoot(a.owner, a.x, a.y, t, d.antiAir * m * dt); }
      if (d.bombard) {
        let target = null;
        for (const id of World.sea[a.sea].coast) {
          const t = this.tiles[id];
          if (t.owner === a.owner || !this.total(t.units)) continue;
          if (!target || this.total(t.units) > this.total(target.units)) target = t;
        }
        if (target) {
          this.killTroops(target, d.bombard * m * dt);
          const w = World.tiles[target.id];
          this.fx({ kind: 'shot', x: a.x, y: a.y, x2: w.x, y2: w.y, color: this.nations[a.owner].color });
        }
      }
    }
    for (const t of this.tiles) {
      if (t.owner < 0 || !(t.coastal || t.flak)) continue;
      const w = World.tiles[t.id], m = this.eraMult(this.nations[t.owner]);
      for (const key of ['coastal', 'flak']) {
        if (!t[key]) continue;
        const D = DEFENSES[key];
        const e = this.nearestEnemy(t.owner, w.c, w.r, D.range, D.vs, cells);
        if (e) shoot(t.owner, w.x, w.y, e, D.dps * m * dt);
      }
    }
    const dead = this.units.filter(u => u.hp <= 0);
    if (!dead.length) return;
    for (const u of dead) {
      const name = this.specialName(u);
      this.fx({ kind: 'boom', x: u.x, y: u.y, color: '#ff9a3c' });
      this.addLog(`Je ${name} is ${this.isSea(u) ? 'tot zinken gebracht' : 'neergeschoten'}`, 'bad', u.owner);
      if (u.killer >= 0) this.addLog(`${name} van ${this.nations[u.owner].name} vernietigd`, 'good', u.killer);
    }
    this.units = this.units.filter(u => u.hp > 0);
    this.needRecount = true;
  },

  updateUnits(dt) {
    for (const u of this.units) {
      const d = SPECIALS[u.type];
      const speed = d.speed * (1 + this.mods(this.nations[u.owner]).speed);
      if (d.domain === 'sea') this.moveShip(u, speed, dt);
      else this.moveAir(u, speed, dt);
    }
  },

  moveShip(u, speed, dt) {
    if (u.path) {
      u.prog += dt * speed;
      while (u.path && u.prog >= 1) {
        u.prog -= 1; u.seg++;
        u.sea = u.path[u.seg];
        if (u.seg >= u.path.length - 1) { u.path = null; u.prog = 0; this.shipArrived(u); }
      }
    } else if (u.mission && u.mission.kind === 'hunt') {
      u.huntTimer = (u.huntTimer || 0) - dt;
      if (u.huntTimer <= 0) {
        u.huntTimer = 1;
        const t = this.unitById(u.mission.unit);
        if (!t) u.mission = null;
        else {
          const [tc, tr] = this.unitCR(t), s = World.sea[u.sea];
          if (World.cellDist(s.c, s.r, tc, tr) > 1) this.orderShip(u, { unit: t.id });
        }
      }
    }
    if (u.path) {
      const A = World.sea[u.path[u.seg]], B = World.sea[u.path[u.seg + 1]];
      if (Math.abs(B.x - A.x) > World.width / 2) { const S = u.prog < 0.5 ? A : B; u.x = S.x; u.y = S.y; }
      else { u.x = A.x + (B.x - A.x) * u.prog; u.y = A.y + (B.y - A.y) * u.prog; }
    } else {
      const S = World.sea[u.sea];
      u.x = S.x; u.y = S.y;
    }
  },

  moveAir(u, speed, dt) {
    if (u.mission && u.mission.unit !== undefined) {
      const t = this.unitById(u.mission.unit);
      if (!t) { u.mission = null; this.sendHome(u); }
      else u.dest = { x: t.x, y: t.y };
    }
    if (u.dest) {
      const step = speed * HEX_W * dt;
      const dx = u.dest.x - u.x, dy = u.dest.y - u.y, dist = Math.hypot(dx, dy);
      if (dist <= step) { u.x = u.dest.x; u.y = u.dest.y; u.dest = null; this.airArrived(u); }
      else { u.x += dx / dist * step; u.y += dy / dist * step; }
    } else if (!u.armed && u.rearm > 0) {
      const tile = World.pick(u.x, u.y);
      if (tile >= 0 && this.tiles[tile].owner === u.owner && this.tiles[tile].airfield) {
        u.rearm -= dt;
        if (u.rearm <= 0) { u.rearm = 0; u.armed = true; }
      }
    }
  },

  // ---------- simulation ----------
  update(dt) {
    if (this.over) return;
    this.time += dt;

    for (const n of this.nations) {
      if (!n.alive) continue;
      n.income.gold = this.goldIncome(n);
      n.income.gp = this.gpIncome(n);
      n.gold = Math.max(0, n.gold + n.income.gold * dt);
      n.gp += n.income.gp * dt;
      if (n.govCooldown > 0) n.govCooldown = Math.max(0, n.govCooldown - dt);

      if (n.research) {
        n.research.remaining -= dt;
        if (n.research.remaining <= 0) this.finishResearch(n);
      }
      if (n.govResearch) {
        n.govResearch.remaining -= dt;
        if (n.govResearch.remaining <= 0) {
          const id = n.govResearch.id;
          n.govs.add(id); n.govResearch = null;
          this.addLog(`Regeringsvorm ontgrendeld: ${GOVS[id].name}`, 'good', n.idx);
          if (n.govCooldown <= 0) { n.gov = id; n.govCooldown = GOV_SWITCH_COOLDOWN; }
        }
      }

      n.levyTimer -= dt * (1 + this.mods(n).levy);
      if (n.levyTimer <= 0) {
        n.levyTimer += ECON.levyInterval;
        for (const t of this.tiles) {
          if (t.owner === n.idx && t.core === n.idx && this.total(t.units) < ECON.levyCap) { t.units.inf++; n.troops++; }
        }
      }
    }

    this.updateArmies(dt);
    this.updateUnits(dt);
    this.combatTimer += dt;
    if (this.combatTimer >= COMBAT_TICK) { this.combatTick(this.combatTimer); this.combatTimer = 0; }
    this.ageEffects(dt);
    if (this.needRecount) this.recount();
    this.checkVictory();
  },

  ageEffects(dt) {
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < (e.kind === 'shot' ? 0.35 : 1.2));
  },

  finishResearch(n) {
    const r = n.research;
    n.research = null;
    let msg;
    if (r.kind === 'unit') { n.tech[r.branch] = r.level; msg = `${UNITS[r.branch].tiers[r.level]} beschikbaar`; }
    else if (r.kind === 'mil') { n.mil[r.id] = true; msg = `${milTech(r.id).name} onderzocht: ${milTech(r.id).desc}`; }
    else if (r.kind === 'era') {
      n.era = r.level; msg = `Nieuw tijdperk: ${ERAS[r.level]}`;
      if (!n.isPlayer && n.era >= 4) this.addLog(`${n.name} bereikt de ${ERAS[n.era]}`, 'event');
    } else { n.finalTech = true; msg = `${FINAL_TECH.name} bereikt!`; this.addLog(`${n.name} is een ${FINAL_TECH.name} geworden`, 'event'); }
    this.addLog(msg, 'good', n.idx);
  },

  updateArmies(dt) {
    let done = 0;
    for (const a of this.armies) {
      const from = a.path[a.seg], to = a.path[a.seg + 1];
      const sea = World.tiles[from].sea.includes(to);
      a.prog += dt * this.armySpeed(a) / (sea ? 2 : 1);
      if (a.prog < 1) continue;
      a.prog = 0; a.seg++;
      const tile = this.tiles[to];
      const last = a.seg >= a.path.length - 1;
      if (tile.owner === a.owner) {
        if (last) { for (const k of UNIT_TYPES) tile.units[k] += a.units[k]; a.done = true; done++; }
      } else {
        if (this.total(tile.units) === 0) {
          tile.units = { ...a.units };
          this.capture(tile, a.owner, tile.owner);
        } else this.resolveAttack(a, to);
        a.done = true; done++;
      }
    }
    if (done) {
      this.armies = this.armies.filter(a => !a.done);
      this.needRecount = true;
    }
  },

  checkVictory() {
    if (this.over) return;
    const alive = this.nations.filter(n => n.alive);
    let winner = alive.find(n => n.tileCount >= this.tiles.length * WIN_SHARE) || (alive.length === 1 ? alive[0] : null);
    if (!winner && this.hadHumans && !alive.some(n => n.isPlayer)) {
      winner = alive.reduce((a, b) => b.tileCount > a.tileCount ? b : a);
    }
    if (winner) {
      this.over = true;
      this.winner = winner.idx;
      this.addLog(`${this.title(winner)} heeft de wereld veroverd!`, 'event');
    }
  },

  // ---------- multiplayer sync ----------
  snapshot(full) {
    const tiles = [];
    for (const t of this.tiles) {
      let mask = 0;
      BUILD_KEYS.forEach((k, i) => { if (t[k]) mask |= 1 << i; });
      const row = [t.id, t.owner, t.core, t.units.inf, t.units.arc, t.units.cav, mask];
      const key = row.join(',');
      if (full || this.sig[t.id] !== key) { tiles.push(row); this.sig[t.id] = key; }
    }
    const r1 = v => Math.round(v * 10) / 10;
    // Nation details change slowly: send them with every third snapshot.
    const withNations = full || this.snapCount++ % 3 === 0;
    const s = {
      time: this.time, speed: this.speed, paused: this.paused, over: this.over, winner: this.winner,
      tiles,
      nations: withNations && this.nations.map(n => ({
        gold: r1(n.gold), gp: r1(n.gp), tech: n.tech, era: n.era, finalTech: n.finalTech, mil: n.mil,
        research: n.research, gov: n.gov, govs: [...n.govs], govResearch: n.govResearch, govCooldown: r1(n.govCooldown),
        capital: n.capital, alive: n.alive, isPlayer: n.isPlayer,
        income: { gold: r1(n.income.gold), gp: r1(n.income.gp) },
      })),
      armies: this.armies.map(a => [a.id, a.owner, a.units.inf, a.units.arc, a.units.cav, a.seg, Math.round(a.prog * 100) / 100, a.path]),
      units: this.units.map(u => ({
        id: u.id, type: u.type, owner: u.owner, x: r1(u.x), y: r1(u.y), sea: u.sea, hp: r1(u.hp), maxHp: u.maxHp,
        cargo: u.cargo, armed: u.armed, rearm: r1(u.rearm), home: u.home,
        path: u.path ? u.path.slice(u.seg + 1) : null, dest: u.dest, mk: u.mission ? u.mission.kind : null,
      })),
      logs: this.out.logs, fx: this.out.effects,
    };
    this.out = { logs: [], effects: [] };
    return s;
  },

  applySnapshot(s) {
    Object.assign(this, { time: s.time, speed: s.speed, paused: s.paused, over: s.over, winner: s.winner });
    for (const row of s.tiles) {
      const t = this.tiles[row[0]];
      if (t.owner !== row[1]) this.dirty = true;
      t.owner = row[1]; t.core = row[2];
      t.units = { inf: row[3], arc: row[4], cav: row[5] };
      BUILD_KEYS.forEach((k, i) => { t[k] = !!(row[6] & (1 << i)); });
    }
    if (s.nations) s.nations.forEach((d, i) => {
      const n = this.nations[i];
      if (n.capital !== d.capital) this.dirty = true;
      Object.assign(n, d);
      n.govs = new Set(d.govs);
    });
    this.armies = s.armies.map(([id, owner, inf, arc, cav, seg, prog, path]) => ({ id, owner, units: { inf, arc, cav }, seg, prog, path }));
    // Clients get the remaining path only; seg -1 makes path.slice(seg + 1) the whole remainder.
    this.units = s.units.map(u => ({ ...u, seg: -1, prog: 0, mission: u.mk ? { kind: u.mk } : null }));
    for (const l of s.logs) { this.log.unshift(l); if (this.log.length > 80) this.log.pop(); }
    for (const e of s.fx) this.effects.push({ ...e, t: 0 });
    this.recount(true);
  },
};

const COMBAT_TICK = 0.5;

function milTech(id) { return MIL_TECHS.find(m => m.id === id); }

function nationColor(i) {
  const hue = (i * 137.508 + 10) % 360;
  const sat = 48 + (i % 3) * 10;
  const light = 42 + ((i * 7) % 4) * 6;
  return `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
}

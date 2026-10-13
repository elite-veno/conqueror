// Game state and simulation: economy, research, governments, armies and combat.
'use strict';

const Game = {
  time: 0,
  speed: 1,
  paused: false,
  over: null,          // null | 'win' | 'lose'
  player: -1,
  difficulty: 'normal',
  tiles: [],           // per World tile: owner, units, buildings, core
  nations: [],
  armies: [],
  effects: [],         // battle flashes for the renderer
  log: [],
  dirty: true,         // ownership changed -> renderer rebuilds caches
  nextArmyId: 1,

  init(playerIdx, difficulty) {
    this.player = playerIdx;
    this.difficulty = difficulty;
    this.time = 0; this.over = null; this.winner = -1; this.armies = []; this.effects = []; this.log = [];
    const { owner, capitals } = World.assignTerritories();

    this.nations = NATIONS.map((def, i) => ({
      idx: i, def, name: def.name, color: nationColor(i),
      alive: true, isPlayer: i === playerIdx,
      gold: ECON.startGold, gp: 0,
      tech: { inf: 0, arc: 0, cav: 0 }, era: 0, finalTech: false,
      research: null,      // { kind, branch?, level, remaining, total }
      gov: 'tribe', govs: new Set(['tribe']), govResearch: null, govCooldown: 0,
      capital: capitals[i], levyTimer: Math.random() * ECON.levyInterval,
      tileCount: 0, built: {},
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
      return { id: t.id, owner: o, core: o, units, factory: false, temple: false, fort: false };
    });
    this.recount();
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

  recount() {
    for (const n of this.nations) { n.tileCount = 0; n.built = Object.fromEntries(BUILD_KEYS.map(k => [k, 0])); n.troops = 0; }
    for (const t of this.tiles) {
      const n = this.nation(t.owner);
      if (!n) continue;
      n.tileCount++;
      n.troops += this.total(t.units);
      for (const k of BUILD_KEYS) if (t[k]) n.built[k]++;
    }
    for (const a of this.armies) { const n = this.nation(a.owner); if (n) n.troops += this.total(a.units); }
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
    return (n.troops || 0) * ECON.upkeep;
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

  addLog(msg, kind = 'info') {
    this.log.unshift({ msg, kind, time: this.time });
    if (this.log.length > 40) this.log.pop();
  },

  // ---------- player / AI actions ----------
  recruit(ni, tileId, type, count) {
    const n = this.nations[ni], t = this.tiles[tileId];
    if (t.owner !== ni) return false;
    const cost = this.unitCost(n, type) * count;
    if (n.gold < cost) return false;
    n.gold -= cost;
    t.units[type] += count;
    return true;
  },

  build(ni, tileId, kind) {
    const n = this.nations[ni], t = this.tiles[tileId];
    if (t.owner !== ni || t[kind]) return false;
    const cost = this.buildCost(n, kind);
    if (n.gold < cost) return false;
    n.gold -= cost;
    t[kind] = true;
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
    n.research = { kind: opt.kind, branch: opt.branch, level: opt.level, remaining: opt.time, total: opt.time };
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
    if (n.govResearch || this.govStatus(n, id).state !== 'available' || n.gp < g.cost) return false;
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
    if (n.isPlayer) this.addLog(`Nieuwe regeringsvorm: ${GOVS[id].name}`, 'good');
    return true;
  },

  // Shortest path from a tile to a target; intermediate tiles must be owned by the mover.
  findPath(ni, from, to) {
    if (from === to) return null;
    const prev = new Map([[from, -1]]);
    const q = [from];
    while (q.length) {
      const id = q.shift();
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
    if (t.owner !== ni || !this.canAttack(ni, to)) return false;
    const path = this.findPath(ni, from, to);
    if (!path) return false;
    const units = { inf: 0, arc: 0, cav: 0 };
    for (const k of types) {
      const n = fraction >= 1 ? t.units[k] : Math.floor(t.units[k] * fraction);
      units[k] = n; t.units[k] -= n;
    }
    if (this.total(units) === 0) return false;
    this.armies.push({ id: this.nextArmyId++, owner: ni, units, path, seg: 0, prog: 0 });
    return true;
  },

  armySpeed(a) {
    let s = Infinity;
    for (const k of UNIT_TYPES) if (a.units[k] > 0) s = Math.min(s, UNITS[k].speed);
    return s * (1 + this.mods(this.nation(a.owner)).speed);
  },

  // ---------- combat ----------
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
  odds(attOwner, units, tile) {
    const dp = this.power(tile.units, this.tiers(tile.owner), 'def', units, this.defenseBonus(tile));
    const ap = this.power(units, this.tiers(attOwner), 'atk', tile.units, this.mods(this.nation(attOwner)).atk);
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

  resolveAttack(army, tileId) {
    const tile = this.tiles[tileId];
    const att = this.nation(army.owner);
    const defOwner = tile.owner;
    const ratio = this.odds(army.owner, army.units, tile);
    const w = World.tiles[tileId];
    this.effects.push({ x: w.x, y: w.y, t: 0, color: att.color });

    if (ratio > 1) {
      const surv = Math.sqrt(1 - 1 / (ratio * ratio));
      tile.units = this.scale(army.units, ratio === Infinity ? 1 : surv);
      this.capture(tile, army.owner, defOwner);
    } else {
      const surv = Math.sqrt(Math.max(0, 1 - ratio * ratio));
      tile.units = this.scale(tile.units, surv);
      if (defOwner === this.player) this.addLog(`${att.name} werd afgeslagen!`, 'good');
      else if (army.owner === this.player) this.addLog(`Aanval mislukt tegen ${defOwner >= 0 ? this.nations[defOwner].name : 'stammen'}`, 'bad');
    }
  },

  capture(tile, newOwner, oldOwner) {
    const att = this.nations[newOwner];
    tile.owner = newOwner;
    att.gold += ECON.plunder;
    this.dirty = true;
    const old = this.nation(oldOwner);
    if (old) {
      if (old.capital === tile.id) {
        const loot = Math.floor(old.gold * 0.3);
        old.gold -= loot; att.gold += loot;
        const remaining = this.tiles.filter(t => t.owner === oldOwner);
        if (remaining.length) {
          const core = remaining.find(t => t.core === oldOwner) || remaining[0];
          old.capital = core.id;
        }
        if (oldOwner === this.player) this.addLog(`${att.name} heeft je hoofdstad ingenomen!`, 'bad');
        else if (newOwner === this.player) this.addLog(`Hoofdstad van ${old.name} veroverd! (+${loot} goud)`, 'good');
      } else if (oldOwner === this.player) {
        this.addLog(`${att.name} veroverde een gebied van je`, 'bad');
      }
    }
    this.recount();
    if (old && old.tileCount === 0 && old.alive) this.eliminate(old, att);
  },

  eliminate(n, by) {
    n.alive = false;
    this.armies = this.armies.filter(a => a.owner !== n.idx);
    by.gold += Math.floor(n.gold);
    n.gold = 0;
    this.addLog(`${n.name} is vernietigd door ${by.name}`, n.isPlayer ? 'bad' : 'event');
    if (n.isPlayer) this.over = 'lose';
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
          if (n.isPlayer) this.addLog(`Regeringsvorm ontgrendeld: ${GOVS[id].name}`, 'good');
          if (n.govCooldown <= 0) { n.gov = id; n.govCooldown = GOV_SWITCH_COOLDOWN; }
        }
      }

      n.levyTimer -= dt * (1 + this.mods(n).levy);
      if (n.levyTimer <= 0) {
        n.levyTimer += ECON.levyInterval;
        for (const t of this.tiles) {
          if (t.owner === n.idx && t.core === n.idx && this.total(t.units) < ECON.levyCap) t.units.inf++;
        }
      }
    }

    this.updateArmies(dt);
    for (const e of this.effects) e.t += dt;
    this.effects = this.effects.filter(e => e.t < 1.2);
    this.checkVictory();
  },

  finishResearch(n) {
    const r = n.research;
    n.research = null;
    let msg;
    if (r.kind === 'unit') { n.tech[r.branch] = r.level; msg = `${UNITS[r.branch].tiers[r.level]} beschikbaar`; }
    else if (r.kind === 'era') { n.era = r.level; msg = `Nieuw tijdperk: ${ERAS[r.level]}`; if (!n.isPlayer && n.era >= 4) this.addLog(`${n.name} bereikt het ${ERAS[n.era]}`, 'event'); }
    else { n.finalTech = true; msg = `${FINAL_TECH.name} bereikt!`; this.addLog(`${n.name} is een ${FINAL_TECH.name} geworden`, 'event'); }
    if (n.isPlayer) this.addLog(msg, 'good');
  },

  updateArmies(dt) {
    const done = [];
    for (const a of this.armies) {
      const from = a.path[a.seg], to = a.path[a.seg + 1];
      const sea = World.tiles[from].sea.includes(to);
      a.prog += dt * this.armySpeed(a) / (sea ? 2 : 1);
      if (a.prog < 1) continue;
      a.prog = 0; a.seg++;
      const tile = this.tiles[to];
      const last = a.seg >= a.path.length - 1;
      if (tile.owner === a.owner) {
        if (last) { for (const k of UNIT_TYPES) tile.units[k] += a.units[k]; done.push(a); }
      } else {
        if (this.total(tile.units) === 0) {
          tile.units = { ...a.units };
          this.capture(tile, a.owner, tile.owner);
        } else this.resolveAttack(a, to);
        done.push(a);
      }
    }
    if (done.length) {
      this.armies = this.armies.filter(a => !done.includes(a));
      this.recount();
    }
  },

  checkVictory() {
    if (this.over) return;
    const p = this.nations[this.player];
    const rivals = this.nations.filter(n => n.alive && !n.isPlayer).length;
    if (p.tileCount >= this.tiles.length * WIN_SHARE || rivals === 0) {
      this.over = 'win';
      this.addLog('Je hebt de wereld veroverd!', 'good');
      return;
    }
    const rival = this.nations.find(n => n.alive && !n.isPlayer && n.tileCount >= this.tiles.length * WIN_SHARE);
    if (rival) {
      this.over = 'lose';
      this.winner = rival.idx;
      this.addLog(`${this.title(rival)} heeft de wereld veroverd`, 'bad');
    }
  },
};

function nationColor(i) {
  const hue = (i * 137.508 + 10) % 360;
  const sat = 48 + (i % 3) * 10;
  const light = 42 + ((i * 7) % 4) * 6;
  return `hsl(${hue.toFixed(0)}, ${sat}%, ${light}%)`;
}

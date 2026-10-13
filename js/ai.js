// Computer-controlled nations. Every nation follows the same rules and tech tree as the player.
'use strict';

const AI_SPECIAL_COOLDOWN = 25;   // seconds between ships/aircraft built by one AI nation

const AI = {
  update(dt) {
    for (const n of Game.nations) {
      if (!n.alive || n.isPlayer) continue;
      n.ai.timer -= dt;
      if (n.ai.timer > 0) continue;
      n.ai.timer = 2 + Math.random() * 1.5;
      this.think(n);
    }
  },

  think(n) {
    const G = Game;
    const mine = [], border = [];
    for (const t of G.tiles) if (t.owner === n.idx) mine.push(t);
    if (!mine.length) return;
    for (const t of mine) if (World.tiles[t.id].adj.some(a => G.tiles[a].owner !== n.idx)) border.push(t);

    this.research(n);
    this.government(n);
    this.buildings(n, mine, border);
    this.recruit(n, border.length ? border : mine);
    this.attack(n, border);
    this.consolidate(n, mine, border);
    const mySpecials = G.units.filter(u => u.owner === n.idx);
    this.navy(n, mine, mySpecials);
    this.airforce(n, mine, border, mySpecials);
    this.defenses(n, mine);
  },

  // ---------- navy ----------
  navy(n, mine, mySpecials) {
    const G = Game;
    if (!n.mil.naval1) return;
    const coastal = mine.filter(t => World.tiles[t.id].seaAdj.length);
    if (!coastal.length) return;
    const res = this.reserve(n);
    if (n.built.harbor < 1 + Math.floor(mine.length / 40) && n.gold > G.buildCost(n, 'harbor') + res + 30) {
      const spot = coastal.filter(t => !t.harbor).sort((a, b) => G.total(b.units) - G.total(a.units))[0];
      if (spot) G.build(n.idx, spot.id, 'harbor');
    }
    const harbors = coastal.filter(t => t.harbor);
    const count = type => mySpecials.filter(u => u.type === type).length;
    if (harbors.length && G.time >= (n.ai.navyAt || 0)) {
      const before = G.units.length;
      const h = harbors[Math.floor(Math.random() * harbors.length)];
      // Build one of the ship types that is below its target count.
      const want = [
        ['transport', 1 + Math.floor(mine.length / 30)],
        ['destroyer', 1 + Math.floor(mine.length / 25)],
        ['battleship', Math.floor(mine.length / 35)],
      ].filter(([type, max]) => n.mil[SPECIALS[type].tech] && count(type) < max && n.gold > SPECIALS[type].cost + res + 40);
      if (want.length) G.buildSpecial(n.idx, h.id, want[Math.floor(Math.random() * want.length)][0]);
      if (G.units.length > before) n.ai.navyAt = G.time + AI_SPECIAL_COOLDOWN;
    }
    for (const u of mySpecials) {
      if (u.path || (u.mission && u.mission.kind === 'hunt')) continue;
      if (u.type === 'transport') this.useTransport(n, u);
      else if (u.type === 'destroyer') this.useDestroyer(n, u);
      else if (u.type === 'battleship') this.useBattleship(n, u);
    }
  },

  // Load at an own coast, then sail to a weak foreign coast and land.
  useTransport(n, u) {
    const G = Game;
    const here = World.sea[u.sea];
    if (!G.total(u.cargo)) {
      const src = here.coast.map(id => G.tiles[id])
        .filter(t => t.owner === n.idx && G.total(t.units) >= 10)
        .sort((a, b) => G.total(b.units) - G.total(a.units))[0];
      if (src) { G.loadUnit(n.idx, u.id, src.id, 0.7); return; }
      const best = G.tiles.filter(t => t.owner === n.idx && G.total(t.units) >= 15 && World.tiles[t.id].seaAdj.length)
        .sort((a, b) => G.total(b.units) - G.total(a.units)).slice(0, 3);
      for (const t of best) if (G.orderShip(u, { tile: t.id, act: 'move' })) return;
      return;
    }
    const aggro = DIFFICULTY[G.difficulty].aiAggro;
    const memo = new Map();
    const good = id => {
      if (!memo.has(id)) {
        const t = G.tiles[id];
        memo.set(id, t.owner !== n.idx && G.canAttack(n.idx, id)
          && G.odds(n.idx, u.cargo, t, -AMPHIBIOUS_PENALTY) >= (t.owner < 0 ? 1.2 : aggro));
      }
      return memo.get(id);
    };
    const path = World.seaPath(u.sea, sid => World.sea[sid].coast.some(good), 60);
    if (path) {
      const target = World.sea[path[path.length - 1]].coast.find(good);
      G.orderShip(u, { tile: target, act: 'unload' });
      u.aiWait = 0;
      return;
    }
    // Nothing worth invading: give the troops back after a while.
    u.aiWait = (u.aiWait || 0) + 1;
    if (u.aiWait > 10) {
      const home = here.coast.find(id => G.tiles[id].owner === n.idx);
      if (home !== undefined) G.unload(u, home);
      u.aiWait = 0;
    }
  },

  useDestroyer(n, u) {
    const G = Game;
    const enemyCells = new Map();
    for (const e of G.units) if (e.owner !== n.idx && G.isSea(e)) enemyCells.set(e.sea, e);
    if (!enemyCells.size || G.atPeace()) return;
    const path = World.seaPath(u.sea, sid => enemyCells.has(sid), 25);
    if (path) G.orderShip(u, { unit: enemyCells.get(path[path.length - 1]).id });
  },

  useBattleship(n, u) {
    const G = Game;
    if (G.atPeace()) return;
    const target = sid => World.sea[sid].coast.some(id => {
      const t = G.tiles[id];
      return t.owner >= 0 && t.owner !== n.idx && G.total(t.units) >= 8;
    });
    if (target(u.sea)) return;
    const path = World.seaPath(u.sea, target, 30);
    if (path) G.orderShip(u, { sea: path[path.length - 1] });
  },

  // ---------- air force ----------
  airforce(n, mine, border, mySpecials) {
    const G = Game;
    if (!n.mil.air1) return;
    const res = this.reserve(n);
    if (n.built.airfield < 1 + Math.floor(mine.length / 60) && n.gold > G.buildCost(n, 'airfield') + res + 50) {
      const interior = mine.filter(t => !t.airfield && !border.includes(t));
      const pool = interior.length ? interior : mine.filter(t => !t.airfield);
      if (pool.length) G.build(n.idx, pool[Math.floor(Math.random() * pool.length)].id, 'airfield');
    }
    const fields = mine.filter(t => t.airfield);
    const count = type => mySpecials.filter(u => u.type === type).length;
    if (fields.length && G.time >= (n.ai.airAt || 0)) {
      const f = fields[Math.floor(Math.random() * fields.length)];
      const before = G.units.length;
      if (n.mil.air2 && count('bomber') < 1 + Math.floor(mine.length / 30) && n.gold > SPECIALS.bomber.cost + res + 40) G.buildSpecial(n.idx, f.id, 'bomber');
      else if (count('helicopter') < 1 + Math.floor(mine.length / 50) && n.gold > SPECIALS.helicopter.cost + res + 40) G.buildSpecial(n.idx, f.id, 'helicopter');
      if (G.units.length > before) n.ai.airAt = G.time + AI_SPECIAL_COOLDOWN;
    }
    for (const u of mySpecials) {
      if (u.dest || G.isSea(u)) continue;
      if (u.type === 'bomber') this.useBomber(n, u);
      else if (u.type === 'helicopter') this.useHelicopter(n, u, border);
    }
  },

  // Tiles within `range` cells of a point, filtered.
  tilesNear(x, y, range, filter) {
    const [c, r] = World.pickCR(x, y);
    return Game.tiles.filter(t => {
      const w = World.tiles[t.id];
      return Math.abs(w.r - r) <= range && World.cellDist(c, r, w.c, w.r) <= range && filter(t);
    });
  },

  useBomber(n, u) {
    const G = Game;
    if (!u.armed || G.atPeace()) return;
    const targets = this.tilesNear(u.x, u.y, 10, t => t.owner >= 0 && t.owner !== n.idx && G.total(t.units) >= 6);
    if (!targets.length) return;
    const t = targets.reduce((a, b) => G.total(b.units) > G.total(a.units) ? b : a);
    G.orderAir(u, { tile: t.id });
  },

  useHelicopter(n, u, border) {
    const G = Game;
    const here = World.pick(u.x, u.y);
    if (!G.total(u.cargo)) {
      if (here >= 0 && G.tiles[here].owner === n.idx && G.total(G.tiles[here].units) >= 8) { G.loadUnit(n.idx, u.id, here, 0.6); return; }
      const src = border.filter(t => G.total(t.units) >= 12).sort((a, b) => G.total(b.units) - G.total(a.units))[0];
      if (src && src.id !== here) G.orderAir(u, { tile: src.id, act: 'move' });
      return;
    }
    const aggro = DIFFICULTY[G.difficulty].aiAggro;
    const targets = this.tilesNear(u.x, u.y, 8, t => t.owner !== n.idx && G.canAttack(n.idx, t.id)
      && G.odds(n.idx, u.cargo, t) >= (t.owner < 0 ? 1.2 : aggro));
    if (targets.length) {
      const score = t => (t.factory ? 1 : 0) + (t.owner >= 0 && G.nations[t.owner].capital === t.id ? 2 : 0);
      const t = targets.reduce((a, b) => score(b) > score(a) ? b : a);
      G.orderAir(u, { tile: t.id, act: 'unload' });
    } else if (here >= 0 && G.tiles[here].owner === n.idx) {
      G.unload(u, here);
    }
  },

  // Coastal batteries and anti-air where enemy ships/aircraft show up.
  defenses(n, mine) {
    const G = Game;
    if (!n.mil.naval2 && !n.mil.air1) return;
    const res = this.reserve(n);
    for (const e of G.units) {
      if (e.owner === n.idx) continue;
      const sea = G.isSea(e);
      const kind = sea ? 'coastal' : 'flak';
      if ((sea && !n.mil.naval2) || (!sea && !n.mil.air1)) continue;
      if (n.built[kind] >= 2 + Math.floor(mine.length / 20) || n.gold < G.buildCost(n, kind) + res + 60) continue;
      const near = this.tilesNear(e.x, e.y, 2, t => t.owner === n.idx && !t[kind] && (!sea || World.tiles[t.id].seaAdj.length));
      if (near.length) { G.build(n.idx, near[0].id, kind); return; }
    }
  },

  research(n) {
    if (n.research) return;
    const opts = Game.researchOptions(n).filter(o => o.ok);
    if (!opts.length) return;
    const era = opts.find(o => o.kind !== 'unit');
    const pick = era || opts.reduce((a, b) => (a.cost < b.cost || (a.cost === b.cost && Math.random() < 0.5)) ? a : b);
    if (n.gold >= pick.cost + 15) Game.startResearch(n.idx, pick);
  },

  government(n) {
    if (n.govResearch) return;
    const avail = Object.keys(GOVS).filter(id => Game.govStatus(n, id).state === 'available' && n.gp >= GOVS[id].cost);
    if (!avail.length) return;
    // Aggressive AIs favour military governments, others favour economy.
    const military = ['despot', 'theocracy', 'empire', 'dictatorship', 'feudal'];
    avail.sort((a, b) => {
      const pa = military.includes(a) === (n.ai.style > 0.5) ? 1 : 0;
      const pb = military.includes(b) === (n.ai.style > 0.5) ? 1 : 0;
      return pb - pa || GOVS[b].cost - GOVS[a].cost;
    });
    Game.startGovResearch(n.idx, avail[0]);
  },

  reserve(n) {
    if (n.research) return 0;
    const opt = Game.researchOptions(n).find(o => o.ok);
    return opt ? opt.cost * (n.ai.style > 0.5 ? 0.4 : 0.8) : 0;
  },

  buildings(n, mine, border) {
    const G = Game;
    const res = this.reserve(n);
    const fc = G.buildCost(n, 'factory');
    if (n.built.factory < mine.length * 0.6 && n.gold > fc + res * 0.5) {
      const spots = mine.filter(t => !t.factory);
      const interior = spots.filter(t => !border.includes(t));
      const pool = interior.length ? interior : spots;
      if (pool.length) G.build(n.idx, pool[Math.floor(Math.random() * pool.length)].id, 'factory');
    }
    const tc = G.buildCost(n, 'temple');
    if (n.built.temple < Math.floor(mine.length / 8) + 1 && n.gold > tc + res + 30) {
      const spots = mine.filter(t => !t.temple);
      if (spots.length) G.build(n.idx, spots[Math.floor(Math.random() * spots.length)].id, 'temple');
    }
    const cap = G.tiles[n.capital];
    if (cap.owner === n.idx && !cap.fort && border.includes(cap) && n.gold > G.buildCost(n, 'fort') + res + 50) {
      G.build(n.idx, cap.id, 'fort');
    }
  },

  threat(n, t) {
    let worst = 0;
    for (const a of World.tiles[t.id].adj) {
      const o = Game.tiles[a];
      if (o.owner === n.idx || o.owner < 0) continue;
      worst = Math.max(worst, Game.total(o.units));
    }
    return worst - Game.total(t.units);
  },

  recruit(n, border) {
    const G = Game;
    const budget = n.gold - this.reserve(n) - 20;
    if (budget < 15) return;
    const tile = border.reduce((a, b) => this.threat(n, b) > this.threat(n, a) ? b : a);
    // Counter the dominant enemy unit type nearby, otherwise a balanced mix.
    const seen = { inf: 0, arc: 0, cav: 0 };
    for (const a of World.tiles[tile.id].adj) {
      const o = G.tiles[a];
      if (o.owner !== n.idx) for (const k of UNIT_TYPES) seen[k] += o.units[k];
    }
    let type;
    const dom = UNIT_TYPES.reduce((a, b) => seen[a] >= seen[b] ? a : b);
    if (G.total(seen) > 5 && Math.random() < 0.6) type = UNIT_TYPES.find(k => UNITS[k].beats === dom);
    else { const r = Math.random(); type = r < 0.5 ? 'inf' : r < 0.78 ? 'arc' : 'cav'; }
    const count = Math.floor(budget * 0.7 / G.unitCost(n, type));
    if (count > 0) G.recruit(n.idx, tile.id, type, count);
  },

  attack(n, border) {
    const G = Game;
    const aggro = DIFFICULTY[G.difficulty].aiAggro;
    const targeted = new Set(G.armies.filter(a => a.owner === n.idx).map(a => a.path[a.path.length - 1]));
    let attacks = 0;
    for (const t of shuffled(border)) {
      if (attacks >= 2) break;
      if (G.total(t.units) < 3) continue;
      const send = G.scale(t.units, 0.85);
      let best = null, bestScore = 0;
      for (const a of World.tiles[t.id].adj) {
        const target = G.tiles[a];
        if (target.owner === n.idx || targeted.has(a) || !G.canAttack(n.idx, a)) continue;
        const odds = G.odds(n.idx, send, target);
        const need = target.owner < 0 ? 1.1 : aggro;
        if (odds < need) continue;
        let score = Math.min(odds, 4) + (target.owner < 0 ? 0.5 : 0) + (target.factory ? 0.5 : 0);
        if (target.owner >= 0 && G.nations[target.owner].capital === a) score += 1;
        if (score > bestScore) { bestScore = score; best = a; }
      }
      if (best !== null) {
        targeted.add(best);
        attacks++;
        G.sendArmy(n.idx, t.id, best, 0.85);
      }
    }
  },

  // Move troops from the interior towards the borders.
  consolidate(n, mine, border) {
    const G = Game;
    const dist = new Map();
    const q = [];
    for (const t of border) { dist.set(t.id, 0); q.push(t.id); }
    while (q.length) {
      const id = q.shift();
      for (const a of World.tiles[id].adj) {
        if (G.tiles[a].owner !== n.idx || dist.has(a)) continue;
        dist.set(a, dist.get(id) + 1); q.push(a);
      }
    }
    for (const t of mine) {
      const d = dist.get(t.id);
      if (!d || G.total(t.units) < 2) continue;
      const next = World.tiles[t.id].adj.find(a => G.tiles[a].owner === n.idx && dist.get(a) === d - 1);
      if (next !== undefined) G.sendArmy(n.idx, t.id, next, 1);
    }
  },
};

function shuffled(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

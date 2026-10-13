// Computer-controlled nations. Every nation follows the same rules and tech tree as the player.
'use strict';

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

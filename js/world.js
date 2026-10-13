// Hex-grid world: geometry, adjacency (land + sea crossings) and initial territories.
'use strict';

const HEX = 10;                       // hex radius in world units
const HEX_W = Math.sqrt(3) * HEX;     // pointy-top hex width
const ROW_H = 1.5 * HEX;

const World = {
  cols: 0, rows: 0,
  tiles: [],          // land tiles only
  grid: null,         // grid[r][c] -> tile id or -1
  width: 0, height: 0,
  seaLinks: [],       // [a, b] pairs crossing water
  sea: [],            // navigable sea cells
  seaGrid: null,      // seaGrid[r][c] -> sea cell id or -1

  build() {
    const md = window.MAPDATA;
    this.cols = md.cols; this.rows = md.rows;
    this.grid = [];
    for (let r = 0; r < md.rows; r++) {
      const row = [];
      for (let c = 0; c < md.cols; c++) {
        if (md.grid[r][c] === '#') {
          const p = this.center(c, r);
          row.push(this.tiles.length);
          this.tiles.push({ id: this.tiles.length, c, r, x: p.x, y: p.y, adj: [], landAdj: [], sea: [], seaAdj: [] });
        } else row.push(-1);
      }
      this.grid.push(row);
    }
    this.width = (md.cols + 0.5) * HEX_W;
    this.height = (md.rows - 1) * ROW_H + 2 * HEX;

    for (const t of this.tiles) {
      for (const [c, r] of this.neighborCoords(t.c, t.r)) {
        const id = this.at(c, r);
        if (id >= 0) { t.landAdj.push(id); t.adj.push(id); }
      }
    }
    this.buildSeaLinks();
    this.buildSea();
  },

  // Every non-land cell is navigable water. Sea adjacency wraps around the date line.
  buildSea() {
    this.seaGrid = [];
    for (let r = 0; r < this.rows; r++) {
      const row = [];
      for (let c = 0; c < this.cols; c++) {
        if (this.grid[r][c] >= 0) { row.push(-1); continue; }
        const p = this.center(c, r);
        row.push(this.sea.length);
        this.sea.push({ id: this.sea.length, c, r, x: p.x, y: p.y, adj: [], coast: [] });
      }
      this.seaGrid.push(row);
    }
    for (const s of this.sea) {
      for (let [c, r] of this.neighborCoords(s.c, s.r)) {
        if (r < 0 || r >= this.rows) continue;
        c = (c + this.cols) % this.cols;
        const sid = this.seaGrid[r][c];
        if (sid >= 0) s.adj.push(sid);
        else {
          const land = this.grid[r][c];
          s.coast.push(land);
          this.tiles[land].seaAdj.push(s.id);
        }
      }
    }
  },

  seaAt(c, r) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return -1;
    return this.seaGrid[r][c];
  },

  // BFS over water from a sea cell to the nearest cell accepted by `isGoal`.
  seaPath(from, isGoal, maxLen = Infinity) {
    if (isGoal(from)) return [from];
    const prev = new Map([[from, -1]]);
    let frontier = [from], depth = 0, found = -1;
    while (frontier.length && found < 0 && depth < maxLen) {
      const next = [];
      for (const id of frontier) {
        for (const n of this.sea[id].adj) {
          if (prev.has(n)) continue;
          prev.set(n, id);
          if (isGoal(n)) { found = n; break; }
          next.push(n);
        }
        if (found >= 0) break;
      }
      frontier = next; depth++;
    }
    if (found < 0) return null;
    const path = [];
    for (let id = found; id !== -1; id = prev.get(id)) path.push(id);
    return path.reverse();
  },

  cellDist(c1, r1, c2, r2) {
    const A = this.cube(c1, r1), B = this.cube(c2, r2);
    return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
  },

  center(c, r) {
    return { x: HEX_W * (c + 0.5 * (r & 1)) + HEX_W / 2, y: ROW_H * r + HEX };
  },

  at(c, r) {
    if (r < 0 || r >= this.rows || c < 0 || c >= this.cols) return -1;
    return this.grid[r][c];
  },

  neighborCoords(c, r) {
    const d = (r & 1)
      ? [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]]
      : [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
    return d.map(([dc, dr]) => [c + dc, r + dr]);
  },

  cube(c, r) {
    const q = c - (r - (r & 1)) / 2;
    return [q, r, -q - r];
  },

  hexDist(a, b) {
    const A = this.cube(a.c, a.r), B = this.cube(b.c, b.r);
    return Math.max(Math.abs(A[0] - B[0]), Math.abs(A[1] - B[1]), Math.abs(A[2] - B[2]));
  },

  // World point -> tile id (or -1 for sea / outside).
  pick(x, y) {
    const [c, r] = this.pickCR(x, y);
    return this.at(c, r);
  },

  // World point -> grid [col, row] (may be outside the grid).
  pickCR(x, y) {
    x -= HEX_W / 2; y -= HEX;
    const q = (Math.sqrt(3) / 3 * x - y / 3) / HEX;
    const r = (2 / 3 * y) / HEX;
    let rx = Math.round(q), rz = Math.round(r), ry = Math.round(-q - r);
    const dx = Math.abs(rx - q), dz = Math.abs(rz - r), dy = Math.abs(ry + q + r);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy <= dz) rz = -rx - ry;
    return [rx + (rz - (rz & 1)) / 2, rz];
  },

  // Link tiles separated by a narrow strait when there is no short land route between them.
  buildSeaLinks() {
    const MAX_SEA = 3, LAND_DEPTH = 8;
    const candidates = [];
    for (const a of this.tiles) {
      const near = this.landDistances(a.id, LAND_DEPTH);
      for (let dr = -MAX_SEA; dr <= MAX_SEA; dr++) {
        for (let dc = -MAX_SEA - 1; dc <= MAX_SEA + 1; dc++) {
          const bid = this.at(a.c + dc, a.r + dr);
          if (bid <= a.id) continue;
          const b = this.tiles[bid];
          const d = this.hexDist(a, b);
          if (d < 2 || d > MAX_SEA || near.has(bid)) continue;
          candidates.push([d, a.id, bid]);
        }
      }
    }
    candidates.sort((x, y) => x[0] - y[0]);
    const linked = new Set();
    const key = (a, b) => a < b ? a + ':' + b : b + ':' + a;
    for (const [, a, b] of candidates) {
      // Skip if a neighbouring pair is already linked (avoid a fan of parallel crossings).
      const na = [a, ...this.tiles[a].landAdj], nb = [b, ...this.tiles[b].landAdj];
      let dup = false;
      for (const x of na) { for (const y of nb) if (linked.has(key(x, y))) { dup = true; break; } if (dup) break; }
      if (dup) continue;
      linked.add(key(a, b));
      this.seaLinks.push([a, b]);
      this.tiles[a].adj.push(b); this.tiles[a].sea.push(b);
      this.tiles[b].adj.push(a); this.tiles[b].sea.push(a);
    }
  },

  landDistances(start, maxDepth) {
    const dist = new Map([[start, 0]]);
    const q = [start];
    while (q.length) {
      const id = q.shift();
      const d = dist.get(id);
      if (d >= maxDepth) continue;
      for (const n of this.tiles[id].landAdj) if (!dist.has(n)) { dist.set(n, d + 1); q.push(n); }
    }
    return dist;
  },

  latLonToTile(lat, lon) {
    const md = window.MAPDATA;
    const r = Math.max(0, Math.min(this.rows - 1, Math.floor((md.latTop - lat) / md.dlat)));
    const c = Math.floor((lon + 180) / md.dlon - (r & 1) * 0.5);
    let best = -1, bestD = Infinity;
    for (const t of this.tiles) {
      const d = (t.c - c) ** 2 + ((t.r - r) * 0.9) ** 2;
      if (d < bestD) { bestD = d; best = t.id; }
    }
    return best;
  },

  // Weighted shortest distances over the whole map (sea crossings cost more).
  dijkstra(start) {
    const dist = new Float64Array(this.tiles.length).fill(Infinity);
    dist[start] = 0;
    const open = [start];
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      const id = open[bi]; open[bi] = open[open.length - 1]; open.pop();
      const t = this.tiles[id];
      for (const n of t.adj) {
        const nd = dist[id] + (t.sea.includes(n) ? 2.5 : 1);
        if (nd < dist[n]) { if (dist[n] === Infinity) open.push(n); dist[n] = nd; }
      }
    }
    return dist;
  },

  // Assigns starting territory: returns owner per tile (-1 = neutral) and the capital per nation.
  assignTerritories() {
    const n = NATIONS.length;
    const capitals = [];
    const used = new Set();
    for (const nat of NATIONS) {
      let cap = this.latLonToTile(nat.lat, nat.lon);
      if (used.has(cap)) cap = this.tiles[cap].landAdj.find(x => !used.has(x)) ?? cap;
      used.add(cap); capitals.push(cap);
    }
    const dists = capitals.map(c => this.dijkstra(c));
    const owner = new Array(this.tiles.length).fill(-1);
    const best = new Array(this.tiles.length).fill(Infinity);
    for (let i = 0; i < n; i++) {
      for (let t = 0; t < this.tiles.length; t++) {
        if (dists[i][t] < best[t]) { best[t] = dists[i][t]; owner[t] = i; }
      }
    }
    const counts = new Array(n).fill(0);
    // Keep only the closest `size` tiles of each Voronoi cell.
    for (let i = 0; i < n; i++) {
      const mine = [];
      for (let t = 0; t < owner.length; t++) if (owner[t] === i) mine.push(t);
      mine.sort((a, b) => dists[i][a] - dists[i][b]);
      mine.forEach((t, k) => { if (k >= NATIONS[i].size) owner[t] = -1; });
      counts[i] = Math.min(mine.length, NATIONS[i].size);
    }
    // Guarantee the minimum: grab nearest neutral tiles, or steal from big neighbours.
    for (let i = 0; i < n; i++) {
      let guard = 0;
      while (counts[i] < MIN_NATION_TILES && guard++ < 50) {
        let pick = -1, pd = Infinity;
        for (let t = 0; t < owner.length; t++) {
          if (owner[t] === i || capitals.includes(t)) continue;
          if (owner[t] >= 0 && counts[owner[t]] <= MIN_NATION_TILES + 1) continue;
          if (!this.tiles[t].adj.some(a => owner[a] === i)) continue;
          if (dists[i][t] < pd) { pd = dists[i][t]; pick = t; }
        }
        if (pick < 0) break;
        if (owner[pick] >= 0) counts[owner[pick]]--;
        owner[pick] = i; counts[i]++;
      }
    }
    capitals.forEach((c, i) => { owner[c] = i; });
    return { owner, capitals };
  },
};

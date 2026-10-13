// Canvas renderer with pan/zoom camera.
'use strict';

const NEUTRAL_COLOR = '#8f8670';

const Render = {
  canvas: null, ctx: null, dpr: 1,
  cam: { x: 0, y: 0, zoom: 1 },
  cache: null,
  hexPath: null,       // all hexes, for grid lines
  hover: -1,
  selected: -1,
  preview: null,       // path preview tile ids

  init(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.hexPath = new Path2D();
    for (const t of World.tiles) this.addHex(this.hexPath, t.x, t.y);
    this.fit();
  },

  resize() {
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(window.innerWidth * this.dpr);
    this.canvas.height = Math.round(window.innerHeight * this.dpr);
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
  },

  get w() { return window.innerWidth; },
  get h() { return window.innerHeight; },

  // Fit the whole world on screen; leftPad keeps a strip on the left free (start menu).
  fit(leftPad = 0) {
    const w = this.w - leftPad;
    this.cam.zoom = Math.min(w / World.width, this.h / World.height) * 0.98;
    this.cam.x = World.width / 2 - leftPad / 2 / this.cam.zoom;
    this.cam.y = World.height / 2;
  },

  centerOn(tileId, zoom) {
    const t = World.tiles[tileId];
    this.cam.x = t.x; this.cam.y = t.y;
    if (zoom) this.cam.zoom = zoom;
  },

  clampCam() {
    const minZoom = Math.min(this.w / World.width, this.h / World.height) * 0.6;
    this.cam.zoom = Math.max(minZoom, Math.min(8, this.cam.zoom));
    this.cam.x = Math.max(0, Math.min(World.width, this.cam.x));
    this.cam.y = Math.max(0, Math.min(World.height, this.cam.y));
  },

  toWorld(sx, sy) {
    return { x: (sx - this.w / 2) / this.cam.zoom + this.cam.x, y: (sy - this.h / 2) / this.cam.zoom + this.cam.y };
  },
  toScreen(x, y) {
    return { x: (x - this.cam.x) * this.cam.zoom + this.w / 2, y: (y - this.cam.y) * this.cam.zoom + this.h / 2 };
  },

  addHex(path, x, y, s = HEX) {
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 30);
      const px = x + s * Math.cos(a), py = y + s * Math.sin(a);
      if (i === 0) path.moveTo(px, py); else path.lineTo(px, py);
    }
    path.closePath();
  },

  edgeNeighbor(c, r, k) {
    const d = (r & 1)
      ? [[1, 0], [1, 1], [0, 1], [-1, 0], [0, -1], [1, -1]]
      : [[1, 0], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];
    return World.at(c + d[k][0], r + d[k][1]);
  },

  corner(x, y, i) {
    const a = Math.PI / 180 * (60 * i - 30);
    return [x + HEX * Math.cos(a), y + HEX * Math.sin(a)];
  },

  rebuild() {
    const owners = new Map();
    const borders = new Path2D(), coast = new Path2D(), playerEdge = new Path2D();
    const sums = new Map();
    for (const wt of World.tiles) {
      const gt = Game.tiles[wt.id];
      const o = gt ? gt.owner : -1;
      if (!owners.has(o)) owners.set(o, new Path2D());
      this.addHex(owners.get(o), wt.x, wt.y);
      if (o >= 0) {
        const s = sums.get(o) || { x: 0, y: 0, n: 0, tiles: [] };
        s.x += wt.x; s.y += wt.y; s.n++; s.tiles.push(wt);
        sums.set(o, s);
      }
      for (let k = 0; k < 6; k++) {
        const nb = this.edgeNeighbor(wt.c, wt.r, k);
        const [x1, y1] = this.corner(wt.x, wt.y, k), [x2, y2] = this.corner(wt.x, wt.y, k + 1);
        if (nb < 0) { coast.moveTo(x1, y1); coast.lineTo(x2, y2); continue; }
        const no = Game.tiles[nb] ? Game.tiles[nb].owner : -1;
        if (no !== o && nb > wt.id) { borders.moveTo(x1, y1); borders.lineTo(x2, y2); }
        if (o === Game.player && no !== o) { playerEdge.moveTo(x1, y1); playerEdge.lineTo(x2, y2); }
      }
    }
    // Label anchor: tile nearest to the centroid of the territory.
    const labels = [];
    for (const [o, s] of sums) {
      const cx = s.x / s.n, cy = s.y / s.n;
      const anchor = s.tiles.reduce((a, b) => ((a.x - cx) ** 2 + (a.y - cy) ** 2 <= (b.x - cx) ** 2 + (b.y - cy) ** 2 ? a : b));
      labels.push({ o, x: anchor.x, y: anchor.y, n: s.n });
    }
    this.cache = { owners, borders, coast, playerEdge, labels };
    Game.dirty = false;
  },

  color(o) { return o >= 0 ? Game.nations[o].color : NEUTRAL_COLOR; },

  draw() {
    if (!this.cache || Game.dirty) this.rebuild();
    const { ctx, cam } = this;
    const z = cam.zoom;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const grad = ctx.createLinearGradient(0, 0, 0, this.h);
    grad.addColorStop(0, '#0f2a44'); grad.addColorStop(1, '#0b1f33');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.w, this.h);

    const tx = this.w / 2 - cam.x * z, ty = this.h / 2 - cam.y * z;
    ctx.setTransform(z * this.dpr, 0, 0, z * this.dpr, tx * this.dpr, ty * this.dpr);

    // Sea crossings
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(170,205,235,0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, b] of World.seaLinks) {
      ctx.moveTo(World.tiles[a].x, World.tiles[a].y); ctx.lineTo(World.tiles[b].x, World.tiles[b].y);
    }
    ctx.stroke();
    ctx.restore();

    for (const [o, p] of this.cache.owners) { ctx.fillStyle = this.color(o); ctx.fill(p); }

    if (z > 1.2) {
      ctx.strokeStyle = 'rgba(0,0,0,0.13)';
      ctx.lineWidth = 0.6 / z * 1.5;
      ctx.stroke(this.hexPath);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(220,235,245,0.45)';
    ctx.lineWidth = 1.4 / z;
    ctx.stroke(this.cache.coast);
    ctx.strokeStyle = 'rgba(15,10,5,0.85)';
    ctx.lineWidth = Math.max(1.2 / z, 0.9);
    ctx.stroke(this.cache.borders);
    if (Game.player >= 0 && !UI.choosing) {
      ctx.strokeStyle = 'rgba(255,224,130,0.95)';
      ctx.lineWidth = Math.max(2.2 / z, 1.4);
      ctx.stroke(this.cache.playerEdge);
    }

    // Highlights
    const hl = (id, fill, stroke, lw) => {
      const t = World.tiles[id];
      const p = new Path2D(); this.addHex(p, t.x, t.y, HEX * 0.92);
      if (fill) { ctx.fillStyle = fill; ctx.fill(p); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw / z; ctx.stroke(p); }
    };
    if (UI.choosing && UI.chosen >= 0) {
      for (const t of Game.tiles) if (t.owner === UI.chosen) hl(t.id, 'rgba(255,255,255,0.25)', null, 0);
    }
    if (this.preview) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([6 / z, 4 / z]);
      ctx.beginPath();
      this.preview.forEach((id, i) => { const t = World.tiles[id]; i ? ctx.lineTo(t.x, t.y) : ctx.moveTo(t.x, t.y); });
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (this.hover >= 0) hl(this.hover, 'rgba(255,255,255,0.18)', 'rgba(255,255,255,0.6)', 1.5);
    if (this.selected >= 0) hl(this.selected, 'rgba(255,230,120,0.25)', '#ffe27a', 2.5);

    // Effects
    for (const e of Game.effects) {
      const k = e.t / 1.2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, HEX * (0.4 + k * 1.4), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,${Math.round(200 - 150 * k)},80,${1 - k})`;
      ctx.lineWidth = 2.5 / z;
      ctx.stroke();
    }

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawTileOverlays();
    this.drawArmies();
    this.drawLabels();
  },

  visible(x, y, m = 40) { return x > -m && y > -m && x < this.w + m && y < this.h + m; },

  drawTileOverlays() {
    const { ctx } = this;
    const px = HEX * this.cam.zoom;          // hex radius on screen
    const showNums = px >= 13;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of Game.tiles) {
      const wt = World.tiles[t.id];
      const s = this.toScreen(wt.x, wt.y);
      if (!this.visible(s.x, s.y)) continue;
      const n = Game.nation(t.owner);
      if (n && n.capital === t.id) {
        this.star(s.x, s.y - (showNums ? px * 0.48 : 0), Math.max(3.5, px * 0.32), '#ffe27a');
      }
      if (!showNums) continue;
      const total = Game.total(t.units);
      if (total > 0) {
        ctx.font = `600 ${Math.round(Math.min(15, px * 0.55))}px system-ui, sans-serif`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.strokeText(fmt(total), s.x, s.y + (n && n.capital === t.id ? px * 0.05 : 0));
        ctx.fillStyle = t.owner === Game.player ? '#fff6d6' : '#ffffff';
        ctx.fillText(fmt(total), s.x, s.y + (n && n.capital === t.id ? px * 0.05 : 0));
      }
      if (px >= 16) {
        const icons = (t.factory ? BUILDINGS.factory.icon : '') + (t.fort ? BUILDINGS.fort.icon : '') + (t.temple ? BUILDINGS.temple.icon : '');
        if (icons) {
          ctx.font = `${Math.round(px * 0.36)}px system-ui, sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(icons, s.x, s.y + px * 0.52);
        }
      }
    }
  },

  star(x, y, r, color) {
    const { ctx } = this;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
    }
    ctx.closePath();
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = 1; ctx.stroke();
  },

  armyPos(a) {
    const A = World.tiles[a.path[a.seg]], B = World.tiles[a.path[a.seg + 1]];
    return { x: A.x + (B.x - A.x) * a.prog, y: A.y + (B.y - A.y) * a.prog };
  },

  drawArmies() {
    const { ctx } = this;
    const z = this.cam.zoom;
    const r = Math.max(4, Math.min(11, HEX * z * 0.4));
    for (const a of Game.armies) {
      const p = this.armyPos(a);
      const s = this.toScreen(p.x, p.y);
      if (!this.visible(s.x, s.y)) continue;
      if (a.owner === Game.player) {
        ctx.strokeStyle = 'rgba(255,226,122,0.6)';
        ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y);
        for (let i = a.seg + 1; i < a.path.length; i++) { const q = World.tiles[a.path[i]]; const qs = this.toScreen(q.x, q.y); ctx.lineTo(qs.x, qs.y); }
        ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = Game.nations[a.owner].color;
      ctx.fill();
      ctx.lineWidth = a.owner === Game.player ? 2 : 1.2;
      ctx.strokeStyle = a.owner === Game.player ? '#ffe27a' : 'rgba(0,0,0,0.8)';
      ctx.stroke();
      if (r >= 7) {
        ctx.font = `700 ${Math.round(r * 0.95)}px system-ui, sans-serif`;
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(fmt(Game.total(a.units)), s.x, s.y + 0.5);
      }
    }
  },

  drawLabels() {
    const { ctx } = this;
    const px = HEX * this.cam.zoom;
    if (px >= 15) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const placed = [];
    const labels = this.cache.labels.slice().sort((a, b) => (b.o === Game.player) - (a.o === Game.player) || b.n - a.n);
    for (const l of labels) {
      const n = Game.nations[l.o];
      const s = this.toScreen(l.x, l.y);
      if (!this.visible(s.x, s.y, 100)) continue;
      const size = Math.max(9, Math.min(22, px * (0.9 + Math.sqrt(l.n) * 0.18)));
      ctx.font = `700 ${Math.round(size)}px Georgia, 'Times New Roman', serif`;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const text = n.name.toUpperCase();
      const bw = ctx.measureText(text).width / 2 + 2, by = s.y + size * 0.9;
      if (placed.some(p => Math.abs(p.x - s.x) < p.w + bw && Math.abs(p.y - by) < size)) continue;
      placed.push({ x: s.x, y: by, w: bw });
      ctx.strokeText(text, s.x, s.y + size * 0.9);
      ctx.fillStyle = l.o === Game.player ? '#ffe27a' : 'rgba(255,255,255,0.92)';
      ctx.fillText(text, s.x, s.y + size * 0.9);
    }
  },
};

function fmt(n) {
  n = Math.floor(n);
  if (n >= 10000) return Math.round(n / 1000) + 'k';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

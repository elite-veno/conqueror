// HUD, side panels, start/end screens and map input.
'use strict';

const $ = sel => document.querySelector(sel);

const UI = {
  choosing: true,
  chosen: -1,
  started: false,
  tab: 'tile',
  sendFrac: 1,
  sendTypes: { inf: true, arc: true, cav: true },
  holding: false,
  lastPanel: '',
  panelTimer: 0,
  mouse: { x: 0, y: 0 },

  init() {
    if (window.innerWidth > 760) Render.fit(510);
    this.buildStart();
    this.bindMap();
    this.bindPanel();
    this.bindKeys();
    $('#speed').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const v = b.dataset.speed;
      if (v === 'pause') Game.paused = !Game.paused;
      else { Game.speed = +v; Game.paused = false; }
      this.renderSpeed();
    });
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      this.tab = b.dataset.tab; this.lastPanel = ''; this.renderTabs(); this.renderPanel();
    });
  },

  // ---------------- start screen ----------------
  buildStart() {
    const list = $('#nation-list');
    list.innerHTML = REGIONS.map(([name, a, b]) => `
      <div class="region"><h3>${name}</h3><div class="chips">
        ${NATIONS.slice(a, b).map((n, k) => `<button class="chip" data-n="${a + k}"><span class="sw" style="background:${nationColor(a + k)}"></span>${n.name}</button>`).join('')}
      </div></div>`).join('');
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-n]'); if (b) this.choose(+b.dataset.n);
    });
    $('#start-btn').addEventListener('click', () => this.startGame());
    $('#random-btn').addEventListener('click', () => this.choose(Math.floor(Math.random() * NATIONS.length)));
  },

  choose(i) {
    this.chosen = i;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.n === i));
    const n = Game.nations[i];
    $('#chosen').innerHTML = `<span class="sw big" style="background:${n.color}"></span>
      <div><b>${n.name}</b><small>${n.tileCount} gebieden · start als ${GOVS.tribe.name}</small></div>`;
    $('#start-btn').disabled = false;
    Render.centerOn(n.capital, Math.max(Render.cam.zoom, 2.2));
  },

  startGame() {
    if (this.chosen < 0) return;
    const diff = document.querySelector('input[name=diff]:checked').value;
    Game.init(this.chosen, diff);
    this.choosing = false; this.started = true;
    $('#start').classList.add('hidden');
    for (const id of ['#topbar', '#side', '#log']) $(id).classList.remove('hidden');
    const cap = Game.nations[Game.player].capital;
    Render.centerOn(cap, 3);
    Render.selected = cap;
    Game.addLog(`Welkom, heerser van ${Game.nations[Game.player].name}! Verover de wereld.`, 'good');
    Game.addLog('Selecteer een vakje en klik op een buurvakje om aan te vallen.', 'info');
    Game.addLog(`De eerste ${ECON.peaceTime}s is er vrede: verover vrije stammen (grijs) en bouw fabrieken.`, 'event');
    this.renderTabs(); this.renderSpeed();
  },

  // ---------------- map input ----------------
  bindMap() {
    const cv = Render.canvas;
    let down = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      down = { x: e.clientX, y: e.clientY, cx: Render.cam.x, cy: Render.cam.y, drag: false, button: e.button };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      this.mouse = { x: e.clientX, y: e.clientY };
      if (down) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (!down.drag && Math.hypot(dx, dy) > 6) down.drag = true;
        if (down.drag) {
          Render.cam.x = down.cx - dx / Render.cam.zoom;
          Render.cam.y = down.cy - dy / Render.cam.zoom;
          Render.clampCam();
        }
      }
      this.updateHover();
    });
    cv.addEventListener('pointerup', e => {
      if (down && !down.drag) this.mapClick(down.button === 2);
      down = null;
    });
    cv.addEventListener('pointerleave', () => { Render.hover = -1; Render.preview = null; $('#tooltip').classList.add('hidden'); });
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const before = Render.toWorld(e.clientX, e.clientY);
      Render.cam.zoom *= Math.exp(-e.deltaY * 0.0015);
      Render.clampCam();
      const after = Render.toWorld(e.clientX, e.clientY);
      Render.cam.x += before.x - after.x; Render.cam.y += before.y - after.y;
      Render.clampCam();
      this.updateHover();
    }, { passive: false });
  },

  hoverTile() {
    const w = Render.toWorld(this.mouse.x, this.mouse.y);
    return World.pick(w.x, w.y);
  },

  updateHover() {
    const id = this.hoverTile();
    Render.hover = id;
    Render.preview = null;
    const tip = $('#tooltip');
    if (id < 0) { tip.classList.add('hidden'); return; }
    const t = Game.tiles[id];
    const n = Game.nation(t.owner);
    let html = `<b>${n ? Game.title(n) : 'Vrije stammen'}</b>`;
    html += `<div>${unitLine(t.units)}</div>`;
    if (this.started && Render.selected >= 0 && Render.selected !== id && Game.tiles[Render.selected].owner === Game.player) {
      const path = Game.findPath(Game.player, Render.selected, id);
      if (path) {
        Render.preview = path;
        if (t.owner !== Game.player) {
          const units = this.sendUnits(Game.tiles[Render.selected]);
          const odds = Game.total(units) ? Game.odds(Game.player, units, t) : 0;
          html += Game.canAttack(Game.player, id)
            ? `<div class="odds ${oddsClass(odds)}">${oddsLabel(odds)}</div><small>klik = aanvallen</small>`
            : `<small>Vredesperiode: nog ${Math.ceil(ECON.peaceTime - Game.time)}s</small>`;
        } else html += `<small>rechtsklik = troepen verplaatsen</small>`;
      } else if (t.owner !== Game.player) html += `<small class="muted">Niet bereikbaar</small>`;
    } else if (this.choosing && n) html += `<small>klik om te kiezen</small>`;
    tip.innerHTML = html;
    tip.style.left = (this.mouse.x + 16) + 'px';
    tip.style.top = (this.mouse.y + 16) + 'px';
    tip.classList.remove('hidden');
  },

  sendUnits(tile) {
    const types = UNIT_TYPES.filter(k => this.sendTypes[k]);
    const u = { inf: 0, arc: 0, cav: 0 };
    for (const k of types) u[k] = this.sendFrac >= 1 ? tile.units[k] : Math.floor(tile.units[k] * this.sendFrac);
    return u;
  },

  mapClick(right) {
    const id = this.hoverTile();
    if (this.choosing) {
      if (id >= 0 && Game.tiles[id].owner >= 0) this.choose(Game.tiles[id].owner);
      return;
    }
    if (!this.started || Game.over) return;
    if (id < 0) { Render.selected = -1; this.lastPanel = ''; return; }
    const sel = Render.selected;
    const t = Game.tiles[id];
    const canSend = sel >= 0 && sel !== id && Game.tiles[sel].owner === Game.player;
    if (canSend && (right || t.owner !== Game.player)) {
      const ok = Game.sendArmy(Game.player, sel, id, this.sendFrac, UNIT_TYPES.filter(k => this.sendTypes[k]));
      if (!ok) this.flash(!Game.canAttack(Game.player, id) ? 'Vredesperiode — verover eerst vrije stammen'
        : Game.findPath(Game.player, sel, id) ? 'Geen troepen om te sturen' : 'Doel niet bereikbaar');
      this.updateHover();
      return;
    }
    Render.selected = id;
    this.tab = 'tile'; this.renderTabs();
    this.lastPanel = '';
  },

  flash(msg) {
    const el = $('#flash');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.add('hidden'), 1400);
  },

  bindKeys() {
    window.addEventListener('keydown', e => {
      if (!this.started) return;
      const sel = Render.selected;
      if (e.code === 'Space') { Game.paused = !Game.paused; this.renderSpeed(); e.preventDefault(); }
      else if (e.key === 'Escape') { Render.selected = -1; this.lastPanel = ''; }
      else if (e.key === '1' || e.key === '2' || e.key === '3') { Game.speed = +e.key; Game.paused = false; this.renderSpeed(); }
      else if (sel >= 0 && Game.tiles[sel].owner === Game.player) {
        const map = { q: 'inf', w: 'arc', e: 'cav' };
        if (map[e.key]) Game.recruit(Game.player, sel, map[e.key], e.shiftKey ? 1 : 5);
        if (e.key === 'f') Game.build(Game.player, sel, 'factory');
      }
      if (e.key === 'c') { Render.centerOn(Game.nations[Game.player].capital); }
    });
  },

  // ---------------- panels ----------------
  bindPanel() {
    const panel = $('#panel');
    panel.addEventListener('pointerdown', () => { this.holding = true; });
    window.addEventListener('pointerup', () => { this.holding = false; });
    panel.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const p = Game.player, n = Game.nations[p], sel = Render.selected;
      const [act, a1, a2] = b.dataset.act.split(':');
      if (act === 'recruit') Game.recruit(p, sel, a1, +a2);
      else if (act === 'build') Game.build(p, sel, a1);
      else if (act === 'frac') this.sendFrac = +a1;
      else if (act === 'type') this.sendTypes[a1] = !this.sendTypes[a1];
      else if (act === 'research') {
        const opt = Game.researchOptions(n).find(o => o.kind === a1 && (a1 !== 'unit' || o.branch === a2));
        if (opt) Game.startResearch(p, opt);
      }
      else if (act === 'gov') Game.startGovResearch(p, a1);
      else if (act === 'adopt') Game.adoptGov(p, a1);
      else if (act === 'goto') { Render.centerOn(+a1); Render.selected = +a1; this.tab = 'tile'; this.renderTabs(); }
      this.lastPanel = '';
      this.renderPanel();
    });
  },

  renderTabs() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === this.tab));
  },

  renderSpeed() {
    document.querySelectorAll('#speed button').forEach(b => {
      const v = b.dataset.speed;
      b.classList.toggle('on', v === 'pause' ? Game.paused : (!Game.paused && +v === Game.speed));
    });
  },

  update(dt) {
    if (!this.started) return;
    this.renderTop();
    this.renderLog();
    this.panelTimer -= dt;
    if (this.panelTimer <= 0) { this.panelTimer = 0.25; this.renderPanel(); }
    if (Game.over && !this.endShown) this.showEnd();
  },

  renderTop() {
    const n = Game.nations[Game.player];
    $('#tb-swatch').style.background = n.color;
    $('#tb-title').textContent = Game.title(n);
    $('#tb-sub').textContent = `${Game.sizeRank(n)} · ${ERAS[n.era]}`;
    $('#tb-gold').textContent = fmt(n.gold);
    const g = n.income.gold;
    $('#tb-goldrate').textContent = `${g >= 0 ? '+' : ''}${g.toFixed(1)}/s`;
    $('#tb-goldrate').className = g < 0 ? 'neg' : '';
    $('#tb-goldrate').parentElement.title = `Goud — inkomen ${(g + Game.upkeep(n)).toFixed(1)}/s, legeronderhoud −${Game.upkeep(n).toFixed(1)}/s`;
    $('#tb-gp').textContent = fmt(n.gp);
    $('#tb-gprate').textContent = `+${n.income.gp.toFixed(1)}/s`;
    $('#tb-tiles').textContent = n.tileCount;
    $('#tb-tilegoal').textContent = `/ ${Math.ceil(Game.tiles.length * WIN_SHARE)}`;
    $('#tb-troops').textContent = fmt(n.troops);
    const m = Math.floor(Game.time / 60), s = Math.floor(Game.time % 60);
    $('#tb-time').textContent = Game.atPeace() ? `Vrede ${Math.ceil(ECON.peaceTime - Game.time)}s` : `${m}:${String(s).padStart(2, '0')}`;
  },

  renderLog() {
    const html = Game.log.slice(0, 6).map(l => {
      const age = Game.time - l.time;
      return `<div class="msg ${l.kind}" style="opacity:${Math.max(0.35, 1 - age / 40)}">${l.msg}</div>`;
    }).join('');
    const el = $('#log');
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  },

  renderPanel() {
    if (this.holding || !this.started) return;
    const html = this.tab === 'tile' ? this.tilePanel()
      : this.tab === 'tech' ? this.techPanel()
      : this.tab === 'gov' ? this.govPanel()
      : this.rankPanel();
    if (html !== this.lastPanel) { $('#panel').innerHTML = html; this.lastPanel = html; }
  },

  tilePanel() {
    const p = Game.player, n = Game.nations[p];
    const sel = Render.selected;
    if (sel < 0) {
      return `<div class="hint">
        <h2>Geen vakje geselecteerd</h2>
        <p><b>Klik</b> op een eigen vakje om het te selecteren.</p>
        <p><b>Klik</b> daarna op een vijandig of vrij vakje om aan te vallen — je leger loopt via je eigen gebied.</p>
        <p><b>Rechtsklik</b> op een eigen vakje om troepen te verplaatsen.</p>
        <p><b>Slepen</b> = kaart verschuiven, <b>scrollen</b> = zoomen, <b>C</b> = naar hoofdstad, <b>spatie</b> = pauze.</p>
        <p>${counterLine()}</p></div>`;
    }
    const t = Game.tiles[sel];
    const owner = Game.nation(t.owner);
    const mine = t.owner === p;
    const tiers = Game.tiers(t.owner);
    let h = `<div class="tile-head"><span class="sw" style="background:${owner ? owner.color : NEUTRAL_COLOR}"></span>
      <div><h2>${owner ? Game.title(owner) : 'Vrije stammen'}</h2>
      <small>${[owner && owner.capital === sel ? '★ Hoofdstad' : '', t.core >= 0 && t.core === t.owner ? 'Kerngebied (lichting)' : '',
        t.core >= 0 && t.core !== t.owner ? `Oorspronkelijk ${Game.nations[t.core].name}` : ''].filter(Boolean).join(' · ') || 'Gebied'}</small></div></div>`;

    h += `<div class="units">`;
    for (const k of UNIT_TYPES) {
      h += `<div class="unit"><span class="uic">${UNITS[k].icon}</span><div><b>${UNITS[k].tiers[tiers[k]]}</b>
        <small>${UNITS[k].name} · tier ${tiers[k] + 1}</small></div><span class="cnt">${t.units[k]}</span></div>`;
    }
    h += `</div>`;
    const bl = Object.keys(BUILDINGS).filter(b => t[b]).map(b => `${BUILDINGS[b].icon} ${BUILDINGS[b].name}`);
    if (!mine) {
      h += bl.length ? `<p class="muted">Gebouwen: ${bl.join(', ')}</p>` : '';
      h += `<p class="muted">Selecteer een eigen vakje en klik hierop om aan te vallen.</p>`;
      return h;
    }

    h += `<h3>Rekruteren</h3><div class="grid3">`;
    for (const k of UNIT_TYPES) {
      const c = Game.unitCost(n, k);
      h += `<button data-act="recruit:${k}:5" ${n.gold < c * 5 ? 'disabled' : ''}>
        <span class="uic">${UNITS[k].icon}</span> +5<small>${Math.ceil(c * 5)} goud</small></button>`;
    }
    h += `</div><div class="grid3 small">`;
    for (const k of UNIT_TYPES) {
      const c = Game.unitCost(n, k);
      h += `<button data-act="recruit:${k}:1" ${n.gold < c ? 'disabled' : ''}>+1 ${UNITS[k].short} <small>${Math.ceil(c)}</small></button>`;
    }
    h += `</div>`;

    h += `<h3>Gebouwen</h3><div class="builds">`;
    for (const [k, b] of Object.entries(BUILDINGS)) {
      if (b.req) continue;   // navy/air buildings: not playable yet
      if (t[k]) { h += `<div class="built">${b.icon} ${b.name} <small>${b.desc}</small><span>✓</span></div>`; continue; }
      const c = Game.buildCost(n, k);
      h += `<button data-act="build:${k}" ${n.gold < c ? 'disabled' : ''}>${b.icon} ${b.name} <small>${b.desc}</small><span>${c} goud</span></button>`;
    }
    h += `</div>`;

    h += `<h3>Troepen sturen</h3><div class="seg">`;
    for (const f of [0.25, 0.5, 0.75, 1]) h += `<button data-act="frac:${f}" class="${this.sendFrac === f ? 'on' : ''}">${f * 100}%</button>`;
    h += `</div><div class="seg">`;
    for (const k of UNIT_TYPES) h += `<button data-act="type:${k}" class="${this.sendTypes[k] ? 'on' : ''}">${UNITS[k].icon} ${UNITS[k].short}</button>`;
    h += `</div><p class="muted small">Klik vijandig vakje = aanvallen · rechtsklik eigen vakje = verplaatsen<br>Sneltoetsen: Q/W/E = +5 inf/boog/cav, F = fabriek</p>`;
    return h;
  },

  techPanel() {
    const n = Game.nations[Game.player];
    const opts = Game.researchOptions(n);
    let h = `<h2>Technologie</h2>`;
    h += this.progress(n.research, r => r.kind === 'unit' ? UNITS[r.branch].tiers[r.level] : r.kind === 'era' ? ERAS[r.level] : FINAL_TECH.name);
    h += `<div class="eras">${ERAS.map((e, i) => `<div class="era ${i < n.era ? 'done' : i === n.era ? 'cur' : ''}" title="${e}">${i + 1}</div>`).join('')}</div>`;
    h += `<p class="era-name">Tijdperk: <b>${ERAS[n.era]}</b> <small>(+${Math.round(n.era * ERA_GOLD_BONUS * 100)}% goud)</small></p>`;
    const eraOpt = opts.find(o => o.kind !== 'unit');
    if (eraOpt) h += this.techButton(n, eraOpt, eraOpt.kind === 'era' ? `Volgend tijdperk: ${ERAS[eraOpt.level]}` : `${FINAL_TECH.name} (+25% alles)`, `research:${eraOpt.kind}`);
    else if (n.finalTech) h += `<div class="final done">🏛 ${FINAL_TECH.name} bereikt</div>`;

    h += `<div class="tree">`;
    for (const k of UNIT_TYPES) {
      h += `<div class="branch"><div class="bh">${UNITS[k].icon} ${UNITS[k].name}</div>`;
      UNITS[k].tiers.forEach((name, lvl) => {
        const done = n.tech[k] >= lvl;
        const next = n.tech[k] + 1 === lvl;
        const opt = next && opts.find(o => o.kind === 'unit' && o.branch === k);
        const busy = n.research && n.research.kind === 'unit' && n.research.branch === k && n.research.level === lvl;
        let cls = done ? 'done' : busy ? 'busy' : opt && opt.ok ? 'avail' : 'locked';
        let inner = `<b>${name}</b><small>kracht ${TIER_POWER[lvl]}× · ${ERAS[lvl]}</small>`;
        if (opt && !done && !busy) {
          const can = opt.ok && !n.research && n.gold >= opt.cost;
          h += `<button class="node ${cls}" data-act="research:unit:${k}" ${can ? '' : 'disabled'}>${inner}<span>${opt.ok ? opt.cost + ' goud' : opt.why}</span></button>`;
        } else h += `<div class="node ${cls}">${inner}${busy ? '<span>bezig…</span>' : ''}</div>`;
      });
      h += `</div>`;
    }
    h += `</div><p class="muted small">${counterLine()}<br>Bestaande troepen worden automatisch opgewaardeerd.</p>`;
    return h;
  },

  techButton(n, opt, label, act) {
    const can = opt.ok && !n.research && n.gold >= opt.cost;
    return `<button class="wide" data-act="${act}" ${can ? '' : 'disabled'}>${label}
      <span>${opt.ok ? `${opt.cost} goud · ${opt.time}s` : opt.why}</span></button>`;
  },

  progress(r, nameFn) {
    if (!r) return `<div class="prog idle">Geen onderzoek bezig</div>`;
    const pct = 100 * (1 - r.remaining / r.total);
    return `<div class="prog"><div class="bar" style="width:${pct.toFixed(1)}%"></div><span>${nameFn(r)} · ${Math.ceil(r.remaining)}s</span></div>`;
  },

  govPanel() {
    const n = Game.nations[Game.player];
    const cur = GOVS[n.gov];
    let h = `<h2>Regering</h2><div class="gov-cur"><b>${cur.name}</b><small>${modText(cur.mods) || 'geen bonussen'}</small></div>`;
    h += this.progress(n.govResearch, r => GOVS[r.id].name);
    if (n.govCooldown > 0) h += `<p class="muted small">Wisselen mogelijk over ${Math.ceil(n.govCooldown)}s</p>`;
    h += `<div class="govtree">`;
    for (const layer of GOV_LAYOUT) {
      h += `<div class="layer">`;
      for (const id of layer) {
        const g = GOVS[id];
        const st = Game.govStatus(n, id);
        const active = n.gov === id;
        let action = '';
        if (active) action = `<span class="tag">actief</span>`;
        else if (st.state === 'unlocked') action = `<button data-act="adopt:${id}" ${n.govCooldown > 0 ? 'disabled' : ''}>Aannemen</button>`;
        else if (n.govResearch && n.govResearch.id === id) action = `<span class="tag">bezig…</span>`;
        else if (st.state === 'available') action = `<button data-act="gov:${id}" ${n.gp < g.cost || n.govResearch ? 'disabled' : ''}>${g.cost} BP</button>`;
        else action = `<span class="why">${st.why}</span>`;
        h += `<div class="gov ${active ? 'active' : st.state}"><b>${g.name}</b><small>${modText(g.mods) || g.desc}</small>${action}</div>`;
      }
      h += `</div>`;
    }
    h += `</div><p class="muted small">Bestuurspunten (BP) krijg je per gebied en via tempels.</p>`;
    return h;
  },

  rankPanel() {
    const list = Game.nations.filter(n => n.alive).sort((a, b) => b.tileCount - a.tileCount);
    let h = `<h2>Ranglijst</h2><p class="muted small">${list.length} naties over · winst bij ${Math.ceil(Game.tiles.length * WIN_SHARE)} gebieden</p><table class="rank">`;
    h += `<tr><th></th><th>Natie</th><th>Gebied</th><th>Leger</th><th>Tijdp.</th></tr>`;
    list.forEach((n, i) => {
      h += `<tr class="${n.isPlayer ? 'me' : ''}" data-act="goto:${n.capital}"><td>${i + 1}</td>
        <td><span class="sw" style="background:${n.color}"></span>${Game.title(n)}</td>
        <td>${n.tileCount}</td><td>${fmt(n.troops)}</td><td>${n.era + 1}</td></tr>`;
    });
    return h + `</table>`;
  },

  showEnd() {
    this.endShown = true;
    const n = Game.nations[Game.player];
    const win = Game.over === 'win';
    $('#end-title').textContent = win ? 'Overwinning!' : Game.winner >= 0 ? 'Verslagen' : 'Je rijk is gevallen';
    $('#end-text').textContent = win
      ? `${Game.title(n)} heerst over ${n.tileCount} gebieden na ${Math.floor(Game.time / 60)} minuten.`
      : Game.winner >= 0 ? `${Game.title(Game.nations[Game.winner])} heeft de wereld veroverd na ${Math.floor(Game.time / 60)} minuten.`
      : `${n.name} is van de kaart geveegd na ${Math.floor(Game.time / 60)} minuten.`;
    $('#end').classList.remove('hidden');
  },
};

function unitLine(u) {
  return UNIT_TYPES.map(k => `${UNITS[k].icon} ${u[k]}`).join('&nbsp;&nbsp;');
}
function counterLine() {
  return `${UNITS.inf.icon} Infanterie verslaat ${UNITS.cav.icon} cavalerie, die verslaat ${UNITS.arc.icon} boogschutters, die verslaan ${UNITS.inf.icon} infanterie.`;
}
function modText(m) {
  return Object.entries(m).map(([k, v]) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}% ${MOD_LABELS[k]}`).join(', ');
}
function oddsLabel(o) {
  if (o === Infinity) return 'Onverdedigd';
  if (o >= 1.6) return `Grote kans (${o.toFixed(1)}×)`;
  if (o >= 1.1) return `Goede kans (${o.toFixed(1)}×)`;
  if (o >= 0.9) return `Onzeker (${o.toFixed(1)}×)`;
  return `Slechte kans (${o.toFixed(1)}×)`;
}
function oddsClass(o) { return o >= 1.1 ? 'good' : o >= 0.9 ? 'mid' : 'bad'; }

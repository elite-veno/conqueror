// HUD, side panels, start/lobby/end screens and map input.
'use strict';

const $ = sel => document.querySelector(sel);

const UI = {
  choosing: true,
  chosen: -1,
  started: false,
  mode: 'solo',        // start screen tab: 'solo' | 'mp'
  tab: 'tile',
  selUnit: -1,         // selected ship/aircraft id (exclusive with Render.selected)
  sendFrac: 1,
  sendTypes: { inf: true, arc: true, cav: true },
  holding: false,
  lastPanel: '',
  panelTimer: 0,
  mouse: { x: 0, y: 0 },
  endShown: false,
  deadShown: false,

  init() {
    if (window.innerWidth > 760) Render.fit(510);
    this.buildStart();
    this.bindMap();
    this.bindPanel();
    this.bindKeys();
    $('#speed').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || Net.role === 'client') return;
      const v = b.dataset.speed;
      if (v === 'pause') Game.paused = !Game.paused;
      else { Game.speed = +v; Game.paused = false; }
      this.renderSpeed();
    });
    $('#tabs').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      this.tab = b.dataset.tab; this.lastPanel = ''; this.renderTabs(); this.renderPanel();
    });
    $('#end-close').addEventListener('click', () => $('#end').classList.add('hidden'));
  },

  // ---------------- start screen & lobby ----------------
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
    $('#random-btn').addEventListener('click', () => {
      const free = NATIONS.map((_, i) => i).filter(i => !this.takenBy(i));
      this.choose(free[Math.floor(Math.random() * free.length)]);
    });
    $('#mode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b || Net.role !== 'solo') return;
      this.mode = b.dataset.mode;
      document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
      $('#mp-box').classList.toggle('hidden', this.mode !== 'mp');
      $('#mp-offline').classList.toggle('hidden', Net.available());
      $('#mp-connect').classList.toggle('hidden', !Net.available());
      this.renderStartButton();
    });
    document.querySelectorAll('input[name=diff]').forEach(r => r.addEventListener('change', () => {
      if (Net.role === 'host') Net.setDifficulty(r.value);
    }));
    try { $('#mp-name').value = localStorage.getItem('conqueror-name') || ''; } catch (e) { /* storage blocked */ }
    const name = () => {
      const v = $('#mp-name').value.trim() || 'Speler';
      try { localStorage.setItem('conqueror-name', v); } catch (e) { /* storage blocked */ }
      return v;
    };
    const attempt = p => p.catch(err => this.lobbyMessage(err.message, true));
    $('#mp-create').addEventListener('click', () => attempt(Net.create(name(), new URLSearchParams(location.search).get('room'))));
    $('#mp-join').addEventListener('click', () => {
      const code = $('#mp-code').value.trim().toUpperCase();
      if (code.length !== 4) { this.lobbyMessage('Vul een code van 4 letters in', true); return; }
      attempt(Net.join(code, name()));
    });
  },

  takenBy(i) {
    return Net.role !== 'solo' ? Net.players.find(p => p.nation === i && p.id !== Net.myId) : null;
  },

  choose(i) {
    if (i === undefined || i < 0) return;
    if (Net.role !== 'solo') {
      if (this.takenBy(i)) { this.lobbyMessage(`${NATIONS[i].name} is al gekozen`, true); return; }
      Net.pick(i);
    }
    this.chosen = i;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', +c.dataset.n === i));
    const n = Game.nations[i];
    $('#chosen').innerHTML = `<span class="sw big" style="background:${n.color}"></span>
      <div><b>${n.name}</b><small>${n.tileCount} gebieden · start als ${GOVS.tribe.name}</small></div>`;
    this.renderStartButton();
    Render.centerOn(n.capital, Math.max(Render.cam.zoom, 2.2));
  },

  renderStartButton() {
    const b = $('#start-btn');
    if (this.mode === 'solo' && Net.role === 'solo') { b.textContent = 'Start veldtocht'; b.disabled = this.chosen < 0; return; }
    if (Net.role === 'host') { b.textContent = 'Start multiplayer'; b.disabled = !Net.canStart(); return; }
    b.textContent = Net.role === 'client' ? 'Wachten op host…' : 'Maak of join een kamer';
    b.disabled = true;
  },

  lobbyMessage(msg, bad) {
    const el = $('#mp-msg');
    el.textContent = msg;
    el.className = 'small ' + (bad ? 'bad' : 'muted');
  },

  showLobby() {
    $('#mp-connect').classList.add('hidden');
    $('#mp-offline').classList.add('hidden');
    $('#mp-lobby').classList.remove('hidden');
    $('#mp-roomcode').textContent = Net.code;
    document.querySelectorAll('#mode button').forEach(b => { b.disabled = true; });
    document.querySelectorAll('input[name=diff]').forEach(r => { r.disabled = Net.role !== 'host'; });
    this.lobbyMessage(Net.role === 'host' ? 'Kies allemaal een land; daarna kun jij starten.' : 'Kies een land en wacht tot de host start.');
    this.renderLobby();
  },

  renderLobby() {
    if (Net.role === 'solo') return;
    $('#mp-players').innerHTML = Net.players.map((p, i) => {
      const n = p.nation >= 0 ? NATIONS[p.nation] : null;
      return `<li><span class="sw" style="background:${n ? nationColor(p.nation) : '#555'}"></span>
        <b>${escapeHtml(p.name)}</b>${p.id === Net.myId ? ' <small>(jij)</small>' : ''}${i === 0 ? ' <small>host</small>' : ''}
        <span class="pick">${n ? n.name : 'kiest nog…'}</span></li>`;
    }).join('');
    document.querySelectorAll('.chip').forEach(c => {
      const p = this.takenBy(+c.dataset.n);
      c.classList.toggle('taken', !!p);
      c.title = p ? `Gekozen door ${p.name}` : '';
    });
    const radio = document.querySelector(`input[name=diff][value=${Net.difficulty}]`);
    if (radio) radio.checked = true;
    this.renderStartButton();
  },

  startGame() {
    if (Net.role === 'host') { Net.startHost(); return; }
    if (Net.role !== 'solo' || this.chosen < 0) return;
    const diff = document.querySelector('input[name=diff]:checked').value;
    Game.init([this.chosen], this.chosen, diff);
    this.beginGame();
  },

  beginGame() {
    this.choosing = false; this.started = true;
    $('#start').classList.add('hidden');
    for (const id of ['#topbar', '#side', '#log']) $(id).classList.remove('hidden');
    $('#speed').classList.toggle('hidden', Net.role === 'client');
    const n = Game.nations[Game.player];
    Render.centerOn(n.capital, 3);
    Render.selected = n.capital;
    const p = Game.player;
    Game.addLog(`Welkom, heerser van ${n.name}! Verover de wereld.`, 'good', p);
    Game.addLog('Selecteer een vakje en klik op een buurvakje om aan te vallen.', 'info', p);
    Game.addLog(`De eerste ${ECON.peaceTime}s is er vrede: verover vrije stammen (grijs) en bouw fabrieken.`, 'event', p);
    if (Net.role !== 'solo') Game.addLog(`Multiplayer: ${Net.players.map(q => `${q.name} (${NATIONS[q.nation].name})`).join(', ')}`, 'event', p);
    this.renderTabs(); this.renderSpeed();
  },

  connectionLost(msg) {
    $('#end-title').textContent = 'Verbinding verbroken';
    $('#end-text').textContent = msg;
    $('#end-close').classList.add('hidden');
    $('#end').classList.remove('hidden');
    this.endShown = true;
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
    cv.addEventListener('pointerup', () => {
      if (down && !down.drag) this.mapClick(down.button === 2);
      down = null;
    });
    cv.addEventListener('pointerleave', () => {
      Render.hover = -1; Render.hoverSea = -1; Render.preview = null;
      $('#tooltip').classList.add('hidden');
    });
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

  // What is under the mouse: { tile, sea, unit }.
  pointed() {
    const w = Render.toWorld(this.mouse.x, this.mouse.y);
    const [c, r] = World.pickCR(w.x, w.y);
    return { tile: World.at(c, r), sea: World.seaAt(c, r), unit: this.started ? Render.unitAt(this.mouse.x, this.mouse.y) : null };
  },

  selectedUnit() {
    if (this.selUnit < 0) return null;
    const u = Game.unitById(this.selUnit);
    if (!u || u.owner !== Game.player) { this.selUnit = -1; return null; }
    return u;
  },

  updateHover() {
    const { tile: id, sea, unit } = this.pointed();
    const su = this.selectedUnit();
    Render.hover = id;
    Render.hoverSea = su && id < 0 ? sea : -1;
    Render.preview = null;
    const tip = $('#tooltip');
    let html = '';
    if (unit) {
      const own = Game.nations[unit.owner];
      html = `<b>${Game.specialName(unit)}</b><small>${Game.title(own)} · ${Math.ceil(unit.hp)}/${Math.round(unit.maxHp)} HP</small>`;
      if (Game.total(unit.cargo)) html += `<div>${unitLine(unit.cargo)}</div>`;
      if (su && unit.owner !== Game.player) html += `<small>${su.type === 'bomber' ? 'klik = bombarderen' : SPECIALS[su.type].antiShip ? 'klik = aanvallen' : ''}</small>`;
    } else if (su) {
      html = this.unitHoverTip(su, id, sea);
    } else if (id >= 0) {
      const t = Game.tiles[id];
      const n = Game.nation(t.owner);
      html = `<b>${n ? Game.title(n) : 'Vrije stammen'}</b><div>${unitLine(t.units)}</div>`;
      if (this.started && Render.selected >= 0 && Render.selected !== id && Game.tiles[Render.selected].owner === Game.player) {
        const path = Game.findPath(Game.player, Render.selected, id);
        if (path) {
          Render.preview = path;
          if (t.owner !== Game.player) {
            const units = this.sendUnits(Game.tiles[Render.selected]);
            html += Game.canAttack(Game.player, id) ? oddsHtml(Game.player, units, t, 0) + '<small>klik = aanvallen</small>'
              : `<small>Vredesperiode: nog ${Math.ceil(ECON.peaceTime - Game.time)}s</small>`;
          } else html += `<small>rechtsklik = troepen verplaatsen</small>`;
        } else if (t.owner !== Game.player) html += `<small class="muted">Niet bereikbaar over land</small>`;
      } else if (this.choosing && n) html += `<small>klik om te kiezen</small>`;
    }
    if (!html) { tip.classList.add('hidden'); return; }
    tip.innerHTML = html;
    tip.style.left = (this.mouse.x + 16) + 'px';
    tip.style.top = (this.mouse.y + 16) + 'px';
    tip.classList.remove('hidden');
  },

  unitHoverTip(su, id, sea) {
    const d = SPECIALS[su.type], air = d.domain === 'air';
    if (id < 0) return sea >= 0 ? `<small>klik = ${air ? 'vliegen' : 'varen'} naar hier</small>` : '';
    const t = Game.tiles[id], n = Game.nation(t.owner);
    let html = `<b>${n ? Game.title(n) : 'Vrije stammen'}</b><div>${unitLine(t.units)}</div>`;
    if (t.owner === Game.player) return html + `<small>rechtsklik = ${Game.total(su.cargo) ? 'troepen afzetten' : (air ? 'hierheen vliegen' : 'naar deze kust varen')}</small>`;
    if (!Game.canAttack(Game.player, id)) return html + `<small>Vredesperiode: nog ${Math.ceil(ECON.peaceTime - Game.time)}s</small>`;
    if (!air && !World.tiles[id].seaAdj.length) return html + '<small class="muted">Ligt niet aan zee</small>';
    if (su.type === 'bomber') return html + (su.armed ? '<small>klik = bombarderen</small>' : '<small class="muted">Bommenwerper herlaadt</small>');
    if (Game.total(su.cargo)) return html + oddsHtml(Game.player, su.cargo, t, air ? 0 : -AMPHIBIOUS_PENALTY) + `<small>klik = ${air ? 'luchtlanding' : 'amfibische landing (−20%)'}</small>`;
    if (d.bombard) return html + '<small>klik = kust beschieten</small>';
    return html + '<small>klik = hierheen</small>';
  },

  sendUnits(tile) {
    const types = UNIT_TYPES.filter(k => this.sendTypes[k]);
    const u = { inf: 0, arc: 0, cav: 0 };
    for (const k of types) u[k] = this.sendFrac >= 1 ? tile.units[k] : Math.floor(tile.units[k] * this.sendFrac);
    return u;
  },

  selectUnit(u) {
    this.selUnit = u.id;
    Render.selected = -1;
    this.tab = 'tile'; this.renderTabs();
    this.lastPanel = '';
  },

  selectTile(id) {
    this.selUnit = -1;
    Render.selected = id;
    this.tab = 'tile'; this.renderTabs();
    this.lastPanel = '';
  },

  mapClick(right) {
    const { tile: id, sea, unit } = this.pointed();
    if (this.choosing) {
      if (id >= 0 && Game.tiles[id].owner >= 0) this.choose(Game.tiles[id].owner);
      return;
    }
    if (!this.started || Game.over || !Game.nations[Game.player].alive) return;
    const su = this.selectedUnit();
    if (su) {
      if (unit && unit.owner !== Game.player) { this.order(su, { unit: unit.id }); return; }
      if (unit && unit.id !== su.id && !right) { this.selectUnit(unit); return; }
      if (id >= 0) {
        const t = Game.tiles[id];
        if (t.owner !== Game.player) { this.order(su, { tile: id, act: 'unload' }); return; }
        if (right) { this.order(su, { tile: id, act: Game.total(su.cargo) ? 'unload' : 'move' }); return; }
      } else if (sea >= 0) { this.order(su, { sea }); return; }
      else { this.selectTile(-1); return; }
    } else if (unit && unit.owner === Game.player) { this.selectUnit(unit); return; }

    if (id < 0) { this.selectTile(-1); return; }
    const sel = Render.selected;
    const t = Game.tiles[id];
    const canSend = sel >= 0 && sel !== id && Game.tiles[sel].owner === Game.player;
    if (canSend && (right || t.owner !== Game.player)) {
      if (!Game.canAttack(Game.player, id)) this.flash('Vredesperiode — verover eerst vrije stammen');
      else if (!Game.findPath(Game.player, sel, id)) this.flash('Doel niet bereikbaar over land — gebruik schepen of helikopters');
      else if (!Game.total(this.sendUnits(Game.tiles[sel]))) this.flash('Geen troepen om te sturen');
      else Net.cmd({ t: 'send', from: sel, to: id, frac: this.sendFrac, types: UNIT_TYPES.filter(k => this.sendTypes[k]) });
      this.updateHover();
      return;
    }
    this.selectTile(id);
  },

  // Give an order to a ship or aircraft, with local checks for feedback.
  order(u, o) {
    const air = !Game.isSea(u);
    if (o.tile !== undefined && Game.tiles[o.tile].owner !== Game.player && !Game.canAttack(Game.player, o.tile)) {
      this.flash('Vredesperiode — nog geen aanvallen op landen'); return;
    }
    if (u.type === 'bomber' && !u.armed && (o.unit !== undefined || (o.tile !== undefined && Game.tiles[o.tile].owner !== Game.player))) {
      this.flash('Bommenwerper herlaadt nog — eerst terug naar een vliegveld'); return;
    }
    if (o.unit !== undefined && !air && !SPECIALS[u.type].antiShip) { this.flash('Dit schip kan niet aanvallen'); return; }
    if (o.unit !== undefined && air && u.type !== 'bomber') { this.flash('Helikopters kunnen niet aanvallen'); return; }
    if (!air) {
      let goal;
      if (o.sea !== undefined) goal = s => s === o.sea;
      else if (o.tile !== undefined) {
        const coast = new Set(World.tiles[o.tile].seaAdj);
        if (!coast.size) { this.flash('Dit gebied ligt niet aan zee'); return; }
        goal = s => coast.has(s);
      }
      if (goal && !World.seaPath(u.sea, goal)) { this.flash('Niet bereikbaar over zee'); return; }
    }
    Net.cmd({ t: 'order', u: u.id, o });
  },

  flash(msg) {
    const el = $('#flash');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => el.classList.add('hidden'), 1600);
  },

  bindKeys() {
    window.addEventListener('keydown', e => {
      if (!this.started || e.target.tagName === 'INPUT') return;
      const sel = Render.selected;
      const host = Net.role !== 'client';
      if (e.code === 'Space' && host) { Game.paused = !Game.paused; this.renderSpeed(); e.preventDefault(); }
      else if (e.key === 'Escape') this.selectTile(-1);
      else if ((e.key === '1' || e.key === '2' || e.key === '3') && host) { Game.speed = +e.key; Game.paused = false; this.renderSpeed(); }
      else if (e.key === 'c') Render.centerOn(Game.nations[Game.player].capital);
      else if (sel >= 0 && Game.tiles[sel].owner === Game.player) {
        const map = { q: 'inf', w: 'arc', e: 'cav' };
        if (map[e.key.toLowerCase()]) Net.cmd({ t: 'recruit', tile: sel, type: map[e.key.toLowerCase()], n: e.shiftKey ? 1 : 5 });
        if (e.key === 'f') Net.cmd({ t: 'build', tile: sel, kind: 'factory' });
      } else if (e.key === 'h' && this.selectedUnit()) Net.cmd({ t: 'order', u: this.selUnit, o: { home: true } });
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
      const sel = Render.selected;
      const [act, a1, a2] = b.dataset.act.split(':');
      const types = UNIT_TYPES.filter(k => this.sendTypes[k]);
      if (act === 'recruit') Net.cmd({ t: 'recruit', tile: sel, type: a1, n: +a2 });
      else if (act === 'build') Net.cmd({ t: 'build', tile: sel, kind: a1 });
      else if (act === 'special') Net.cmd({ t: 'special', tile: sel, type: a1 });
      else if (act === 'frac') this.sendFrac = +a1;
      else if (act === 'type') this.sendTypes[a1] = !this.sendTypes[a1];
      else if (act === 'research') Net.cmd({ t: 'research', kind: a1, branch: a2, id: a2 });
      else if (act === 'gov') Net.cmd({ t: 'gov', id: a1 });
      else if (act === 'adopt') Net.cmd({ t: 'adopt', id: a1 });
      else if (act === 'goto') { Render.centerOn(+a1); this.selectTile(+a1); }
      else if (act === 'load') Net.cmd({ t: 'load', u: this.selUnit, tile: +a1, frac: this.sendFrac, types });
      else if (act === 'unload') Net.cmd({ t: 'order', u: this.selUnit, o: { tile: +a1, act: 'unload' } });
      else if (act === 'home') Net.cmd({ t: 'order', u: this.selUnit, o: { home: true } });
      else if (act === 'unit') {
        const u = Game.unitById(+a1);
        if (u) { Render.cam.x = u.x; Render.cam.y = u.y; this.selectUnit(u); }
      }
      this.lastPanel = '';
      setTimeout(() => { this.lastPanel = ''; this.renderPanel(); }, Net.role === 'client' ? 200 : 0);
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
    if (this.panelTimer <= 0) { this.panelTimer = 0.25; this.renderPanel(); if (Net.role === 'client') this.renderSpeed(); }
    if (Game.over && !this.endShown) this.showEnd();
    else if (!Game.over && !Game.nations[Game.player].alive && !this.deadShown) this.showDead();
  },

  renderTop() {
    const n = Game.nations[Game.player];
    $('#tb-swatch').style.background = n.color;
    $('#tb-title').textContent = Game.title(n);
    $('#tb-sub').textContent = `${Game.sizeRank(n)} · ${ERAS[n.era]}${Net.role !== 'solo' ? ' · kamer ' + Net.code : ''}`;
    $('#tb-gold').textContent = fmt(n.gold);
    const g = n.income.gold;
    $('#tb-goldrate').textContent = `${g >= 0 ? '+' : ''}${g.toFixed(1)}/s`;
    $('#tb-goldrate').className = g < 0 ? 'neg' : '';
    $('#tb-goldrate').parentElement.title = `Goud — inkomen ${(g + Game.upkeep(n)).toFixed(1)}/s, onderhoud leger/vloot −${Game.upkeep(n).toFixed(1)}/s`;
    $('#tb-gp').textContent = fmt(n.gp);
    $('#tb-gprate').textContent = `+${n.income.gp.toFixed(1)}/s`;
    $('#tb-tiles').textContent = n.tileCount;
    $('#tb-tilegoal').textContent = `/ ${Math.ceil(Game.tiles.length * WIN_SHARE)}`;
    $('#tb-troops').textContent = fmt(n.troops);
    const m = Math.floor(Game.time / 60), s = Math.floor(Game.time % 60);
    $('#tb-time').textContent = Game.atPeace() ? `Vrede ${Math.ceil(ECON.peaceTime - Game.time)}s` : `${m}:${String(s).padStart(2, '0')}`;
  },

  renderLog() {
    const html = Game.log.filter(l => l.to === undefined || l.to < 0 || l.to === Game.player).slice(0, 6).map(l => {
      const age = Game.time - l.time;
      return `<div class="msg ${l.kind}" style="opacity:${Math.max(0.35, 1 - age / 40)}">${l.msg}</div>`;
    }).join('');
    const el = $('#log');
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
  },

  renderPanel() {
    if (this.holding || !this.started) return;
    const html = this.tab === 'tile' ? (this.selectedUnit() ? this.unitPanel(this.selectedUnit()) : this.tilePanel())
      : this.tab === 'tech' ? this.techPanel()
      : this.tab === 'gov' ? this.govPanel()
      : this.rankPanel();
    if (html !== this.lastPanel) { $('#panel').innerHTML = html; this.lastPanel = html; }
  },

  sendControls() {
    let h = `<div class="seg">`;
    for (const f of [0.25, 0.5, 0.75, 1]) h += `<button data-act="frac:${f}" class="${this.sendFrac === f ? 'on' : ''}">${f * 100}%</button>`;
    h += `</div><div class="seg">`;
    for (const k of UNIT_TYPES) h += `<button data-act="type:${k}" class="${this.sendTypes[k] ? 'on' : ''}">${UNITS[k].icon} ${UNITS[k].short}</button>`;
    return h + `</div>`;
  },

  fleetList() {
    const mine = Game.units.filter(u => u.owner === Game.player);
    if (!mine.length) return '';
    return `<h3>Vloot & luchtmacht</h3><div class="fleet">${mine.map(u => `<button data-act="unit:${u.id}">
      ${SPECIALS[u.type].domain === 'sea' ? '⛴' : '✈'} ${Game.specialName(u)}
      <small>${Game.total(u.cargo) ? fmt(Game.total(u.cargo)) + ' troepen · ' : ''}${Math.ceil(u.hp)} HP</small></button>`).join('')}</div>`;
  },

  tilePanel() {
    const p = Game.player, n = Game.nations[p];
    const sel = Render.selected;
    if (sel < 0) {
      return `<div class="hint">
        <h2>Geen vakje geselecteerd</h2>
        <p><b>Klik</b> op een eigen vakje om het te selecteren, en daarna op een vijandig of vrij vakje om aan te vallen.</p>
        <p><b>Rechtsklik</b> op een eigen vakje om troepen te verplaatsen.</p>
        <p><b>Schepen & vliegtuigen:</b> klik erop om te selecteren, klik op zee/land om te varen of vliegen, op een vijand om aan te vallen.</p>
        <p><b>Slepen</b> = kaart verschuiven, <b>scrollen</b> = zoomen, <b>C</b> = naar hoofdstad.</p>
        <p>${counterLine()}</p></div>` + this.fleetList();
    }
    const t = Game.tiles[sel];
    const owner = Game.nation(t.owner);
    const mine = t.owner === p;
    const tiers = Game.tiers(t.owner);
    let h = `<div class="tile-head"><span class="sw" style="background:${owner ? owner.color : NEUTRAL_COLOR}"></span>
      <div><h2>${owner ? Game.title(owner) : 'Vrije stammen'}</h2>
      <small>${[owner && owner.capital === sel ? '★ Hoofdstad' : '', t.core >= 0 && t.core === t.owner ? 'Kerngebied (lichting)' : '',
        t.core >= 0 && t.core !== t.owner ? `Oorspronkelijk ${Game.nations[t.core].name}` : '',
        World.tiles[sel].seaAdj.length ? 'Kust' : ''].filter(Boolean).join(' · ') || 'Gebied'}</small></div></div>`;

    h += `<div class="units">`;
    for (const k of UNIT_TYPES) {
      h += `<div class="unit"><span class="uic">${UNITS[k].icon}</span><div><b>${UNITS[k].tiers[tiers[k]]}</b>
        <small>${UNITS[k].name} · tier ${tiers[k] + 1}</small></div><span class="cnt">${t.units[k]}</span></div>`;
    }
    h += `</div>`;
    const bl = BUILD_KEYS.filter(b => t[b]).map(b => `${BUILDINGS[b].icon} ${BUILDINGS[b].name}`);
    if (!mine) {
      h += bl.length ? `<p class="muted">Gebouwen: ${bl.join(', ')}</p>` : '';
      h += `<p class="muted">Selecteer een eigen vakje, schip of helikopter en klik hierop om aan te vallen.</p>`;
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

    if (t.harbor) h += this.yard(n, sel, 'sea', 'Scheepswerf');
    if (t.airfield) h += this.yard(n, sel, 'air', 'Vliegveld');

    h += `<h3>Gebouwen</h3><div class="builds">`;
    for (const [k, b] of Object.entries(BUILDINGS)) {
      if (t[k]) { h += `<div class="built">${b.icon} ${b.name} <small>${b.desc}</small><span>✓</span></div>`; continue; }
      const c = Game.canBuild(n, sel, k);
      const locked = c.cost === undefined;
      if (locked && b.coastal && !World.tiles[sel].seaAdj.length) continue;
      h += `<button data-act="build:${k}" ${c.ok ? '' : 'disabled'} class="${locked ? 'locked' : ''}">${b.icon} ${b.name} <small>${b.desc}</small>
        <span>${locked ? c.why : c.cost + ' goud'}</span></button>`;
    }
    h += `</div>`;

    h += `<h3>Troepen sturen</h3>` + this.sendControls();
    h += `<p class="muted small">Klik vijandig vakje = aanvallen · rechtsklik eigen vakje = verplaatsen<br>Sneltoetsen: Q/W/E = +5 inf/boog/cav, F = fabriek</p>`;
    return h;
  },

  // Build buttons for ships (harbor) or aircraft (airfield).
  yard(n, tileId, domain, title) {
    let h = `<h3>${title}</h3><div class="builds">`;
    for (const [type, d] of Object.entries(SPECIALS)) {
      if (d.domain !== domain) continue;
      const c = Game.canBuildSpecial(n, tileId, type);
      const name = d.names ? d.names[n.era] : d.name;
      const locked = !n.mil[d.tech];
      h += `<button data-act="special:${type}" ${c.ok ? '' : 'disabled'} class="${locked ? 'locked' : ''}">
        ${domain === 'sea' ? '⛴' : '✈'} ${name} <small>${d.desc}</small><span>${locked ? c.why : d.cost + ' goud'}</span></button>`;
    }
    return h + `</div>`;
  },

  unitPanel(u) {
    const d = SPECIALS[u.type], n = Game.nations[u.owner];
    const name = Game.specialName(u);
    const m = Game.eraMult(n);
    const pct = Math.max(0, u.hp / u.maxHp * 100);
    let status = 'Klaar voor bevelen';
    if (u.path || u.dest) status = u.mk === 'bomb' || (u.mission && u.mission.kind === 'bomb') ? 'Op bombardementsvlucht' : 'Onderweg';
    if ((u.mission && u.mission.kind === 'hunt') || u.mk === 'hunt') status = 'Jaagt op vijand';
    if (u.type === 'bomber' && !u.armed) status = u.rearm > 0 && !u.dest ? `Herladen… ${Math.ceil(u.rearm)}s` : 'Ongewapend — terug naar vliegveld';

    let h = `<div class="tile-head"><span class="sw" style="background:${n.color}"></span>
      <div><h2>${name}</h2><small>${name !== d.name ? d.name + ' · ' : ''}${Game.title(n)}</small></div></div>
      <div class="hp"><div style="width:${pct.toFixed(0)}%"></div><span>${Math.ceil(u.hp)} / ${Math.round(u.maxHp)} HP</span></div>
      <p class="muted small">${d.desc}</p><p class="status">${status}</p>`;

    const stats = [];
    if (d.antiShip) stats.push(`Anti-schip ${(d.antiShip * m).toFixed(0)}/s`);
    if (d.antiAir) stats.push(`Luchtafweer ${(d.antiAir * m).toFixed(0)}/s`);
    if (d.bombard) stats.push(`Kustbeschieting ${(d.bombard * m).toFixed(1)}/s`);
    if (d.payload) stats.push(`Bommenlast ${(d.payload * m).toFixed(0)}`);
    if (d.range) stats.push(`bereik ${d.range}`);
    if (stats.length) h += `<p class="small">${stats.join(' · ')}</p>`;

    if (d.capacity) {
      const cargo = Game.total(u.cargo);
      h += `<h3>Lading ${cargo} / ${d.capacity}</h3><div class="units">`;
      for (const k of UNIT_TYPES) {
        h += `<div class="unit"><span class="uic">${UNITS[k].icon}</span><div><b>${UNITS[k].tiers[n.tech[k]]}</b></div><span class="cnt">${u.cargo[k]}</span></div>`;
      }
      h += `</div>`;
      const reach = Game.isSea(u) ? (u.path ? [] : World.sea[u.sea].coast) : (u.dest ? [] : [World.pick(u.x, u.y)].filter(id => id >= 0));
      const own = reach.filter(id => Game.tiles[id].owner === Game.player);
      if (own.length) {
        h += `<h3>Laden & lossen</h3>` + this.sendControls() + `<div class="builds">`;
        for (const id of own) {
          const tr = Game.total(Game.tiles[id].units);
          h += `<button data-act="load:${id}" ${tr && cargo < d.capacity ? '' : 'disabled'}>⤓ Laden uit gebied <small>${fmt(tr)} troepen</small></button>`;
          if (cargo) h += `<button data-act="unload:${id}">⤒ Afzetten in eigen gebied</button>`;
        }
        h += `</div>`;
      } else {
        h += `<p class="muted small">${Game.isSea(u) ? 'Vaar naast een eigen kustgebied om troepen te laden.' : 'Vlieg naar een eigen gebied om troepen te laden.'}</p>`;
      }
      if (cargo) h += `<p class="small">Klik op een vijandig ${Game.isSea(u) ? 'kustvakje voor een amfibische landing (−20% aanval)' : 'vakje voor een luchtlanding'}.</p>`;
    }
    h += `<div class="builds"><button data-act="home">↩ Terug naar ${Game.isSea(u) ? 'haven' : 'vliegveld'} <small>H</small></button></div>`;
    h += `<p class="muted small">Klik zee/land = ${Game.isSea(u) ? 'varen' : 'vliegen'} · klik vijand = aanvallen · Esc = deselecteren</p>`;
    return h + this.fleetList();
  },

  techPanel() {
    const n = Game.nations[Game.player];
    const opts = Game.researchOptions(n);
    let h = `<h2>Technologie</h2>`;
    h += this.progress(n.research, r => r.kind === 'unit' ? UNITS[r.branch].tiers[r.level]
      : r.kind === 'era' ? ERAS[r.level] : r.kind === 'mil' ? milTech(r.id).name : FINAL_TECH.name);
    h += `<div class="eras">${ERAS.map((e, i) => `<div class="era ${i < n.era ? 'done' : i === n.era ? 'cur' : ''}" title="${e}">${i + 1}</div>`).join('')}</div>`;
    h += `<p class="era-name">Tijdperk: <b>${ERAS[n.era]}</b> <small>(+${Math.round(n.era * ERA_GOLD_BONUS * 100)}% goud)</small></p>`;
    const eraOpt = opts.find(o => o.kind === 'era' || o.kind === 'final');
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
        const cls = done ? 'done' : busy ? 'busy' : opt && opt.ok ? 'avail' : 'locked';
        const inner = `<b>${name}</b><small>kracht ${TIER_POWER[lvl]}× · ${ERAS[lvl]}</small>`;
        if (opt && !done && !busy) {
          const can = opt.ok && !n.research && n.gold >= opt.cost;
          h += `<button class="node ${cls}" data-act="research:unit:${k}" ${can ? '' : 'disabled'}>${inner}<span>${opt.ok ? opt.cost + ' goud' : opt.why}</span></button>`;
        } else h += `<div class="node ${cls}">${inner}${busy ? '<span>bezig…</span>' : ''}</div>`;
      });
      h += `</div>`;
    }
    h += `</div>`;

    h += `<h3>Marine & luchtmacht</h3><div class="mil">`;
    for (const m of MIL_TECHS) {
      const done = n.mil[m.id];
      const busy = n.research && n.research.kind === 'mil' && n.research.id === m.id;
      const opt = opts.find(o => o.kind === 'mil' && o.id === m.id);
      const inner = `<b>${m.name}</b><small>${m.desc} · ${ERAS[m.era]}</small>`;
      if (done || busy || !opt) h += `<div class="node ${done ? 'done' : 'busy'}">${inner}${busy ? '<span>bezig…</span>' : ''}</div>`;
      else {
        const can = opt.ok && !n.research && n.gold >= opt.cost;
        h += `<button class="node ${opt.ok ? 'avail' : 'locked'}" data-act="research:mil:${m.id}" ${can ? '' : 'disabled'}>${inner}<span>${opt.ok ? opt.cost + ' goud' : opt.why}</span></button>`;
      }
    }
    h += `</div><p class="muted small">${counterLine()}<br>Bestaande troepen worden automatisch opgewaardeerd. Schepen en vliegtuigen worden sterker per tijdperk.</p>`;
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
        let action;
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
    const human = i => Net.role !== 'solo' ? Net.players.find(p => p.nation === i) : null;
    let h = `<h2>Ranglijst</h2><p class="muted small">${list.length} naties over · winst bij ${Math.ceil(Game.tiles.length * WIN_SHARE)} gebieden</p><table class="rank">`;
    h += `<tr><th></th><th>Natie</th><th>Gebied</th><th>Leger</th><th>Tijdp.</th></tr>`;
    list.forEach((n, i) => {
      const p = human(n.idx);
      h += `<tr class="${n.idx === Game.player ? 'me' : ''}" data-act="goto:${n.capital}"><td>${i + 1}</td>
        <td><span class="sw" style="background:${n.color}"></span>${Game.title(n)}${p ? ` <small class="who">${escapeHtml(p.name)}</small>` : ''}</td>
        <td>${n.tileCount}</td><td>${fmt(n.troops)}</td><td>${n.era + 1}</td></tr>`;
    });
    return h + `</table>`;
  },

  showDead() {
    this.deadShown = true;
    $('#end-title').textContent = 'Je rijk is gevallen';
    $('#end-text').textContent = `${Game.nations[Game.player].name} is van de kaart geveegd na ${Math.floor(Game.time / 60)} minuten.`
      + (Net.role === 'host' ? ' Laat dit venster open: jij bent de host.' : '');
    $('#end-close').textContent = 'Verder kijken';
    $('#end-close').classList.toggle('hidden', Net.role === 'solo');
    $('#end').classList.remove('hidden');
  },

  showEnd() {
    this.endShown = true;
    const n = Game.nations[Game.player];
    const w = Game.nations[Game.winner];
    const win = Game.winner === Game.player;
    $('#end-title').textContent = win ? 'Overwinning!' : 'Verslagen';
    $('#end-text').textContent = win
      ? `${Game.title(n)} heerst over ${n.tileCount} gebieden na ${Math.floor(Game.time / 60)} minuten.`
      : w ? `${Game.title(w)} heeft de wereld veroverd na ${Math.floor(Game.time / 60)} minuten.` : 'Het spel is voorbij.';
    $('#end-close').textContent = 'Kaart bekijken';
    $('#end-close').classList.remove('hidden');
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
function oddsHtml(owner, units, tile, atkMod) {
  const o = Game.total(units) ? Game.odds(owner, units, tile, atkMod) : 0;
  return `<div class="odds ${oddsClass(o)}">${oddsLabel(o)}</div>`;
}
function oddsLabel(o) {
  if (o === Infinity) return 'Onverdedigd';
  if (o >= 1.6) return `Grote kans (${o.toFixed(1)}×)`;
  if (o >= 1.1) return `Goede kans (${o.toFixed(1)}×)`;
  if (o >= 0.9) return `Onzeker (${o.toFixed(1)}×)`;
  return `Slechte kans (${o.toFixed(1)}×)`;
}
function oddsClass(o) { return o >= 1.1 ? 'good' : o >= 0.9 ? 'mid' : 'bad'; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

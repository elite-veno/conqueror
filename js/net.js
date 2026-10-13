// Multiplayer over WebSocket (see server.py). The host runs the simulation and broadcasts
// snapshots; clients send their commands to the host.
'use strict';

const SNAPSHOT_INTERVAL = 0.15;   // seconds between state broadcasts

const Net = {
  role: 'solo',      // 'solo' | 'host' | 'client'
  ws: null,
  myId: null,
  name: '',
  code: '',
  players: [],       // lobby: [{ id, name, nation }]
  difficulty: 'normal',
  started: false,
  sendTimer: 0,

  available() { return location.protocol === 'http:' || location.protocol === 'https:'; },

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Geen verbinding met de server'));
      ws.onmessage = e => this.onMessage(JSON.parse(e.data));
      ws.onclose = () => this.onClose();
      this.ws = ws;
    });
  },

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  },

  async create(name, code) {
    this.name = name;
    await this.connect();
    this.send({ t: 'create', name, code });
  },

  async join(code, name) {
    this.name = name;
    await this.connect();
    this.send({ t: 'join', code, name });
  },

  onMessage(m) {
    switch (m.t) {
      case 'room':
        this.code = m.code; this.myId = m.you; this.role = m.host ? 'host' : 'client';
        if (m.host) { this.players = [{ id: m.you, name: this.name, nation: -1 }]; this.pushLobby(); }
        UI.showLobby();
        break;
      case 'error': UI.lobbyMessage(m.msg, true); break;
      // received by the host
      case 'joined':
        if (this.started) { this.send({ t: 'to', id: m.id, data: { t: 'error', msg: 'Het spel is al begonnen' } }); return; }
        this.players.push({ id: m.id, name: m.name, nation: -1 });
        this.pushLobby();
        break;
      case 'left': this.playerLeft(m.id); break;
      case 'msg': this.fromClient(m.from, m.data); break;
      // received by clients
      case 'lobby': this.players = m.players; this.difficulty = m.difficulty; UI.renderLobby(); break;
      case 'start': this.startClient(m); break;
      case 'snap': if (this.started) Game.applySnapshot(m.s); break;
      case 'hostLeft': UI.connectionLost('De host heeft het spel verlaten.'); break;
    }
  },

  onClose() {
    this.ws = null;
    if (this.role === 'client') UI.connectionLost('De verbinding met de server is verbroken.');
    else if (this.role === 'host') UI.flash('Verbinding met de server verbroken');
  },

  pushLobby() {
    this.send({ t: 'broadcast', data: { t: 'lobby', players: this.players, difficulty: this.difficulty } });
    UI.renderLobby();
  },

  pick(nation) {
    if (this.role === 'host') this.setPick(this.myId, nation);
    else this.send({ t: 'to_host', data: { t: 'pick', nation } });
  },

  setPick(id, nation) {
    if (nation >= 0 && this.players.some(p => p.nation === nation && p.id !== id)) return;
    const p = this.players.find(q => q.id === id);
    if (p) { p.nation = nation; this.pushLobby(); }
  },

  setDifficulty(d) {
    if (this.role !== 'host' || !DIFFICULTY[d]) return;
    this.difficulty = d;
    this.pushLobby();
  },

  fromClient(id, d) {
    if (!d) return;
    if (d.t === 'pick' && !this.started) this.setPick(id, d.nation);
    else if (d.t === 'cmd' && this.started) {
      const p = this.players.find(q => q.id === id);
      if (p && p.nation >= 0) Game.command(p.nation, d.c);
    }
  },

  playerLeft(id) {
    const p = this.players.find(q => q.id === id);
    if (!p) return;
    if (!this.started) {
      this.players = this.players.filter(q => q.id !== id);
      this.pushLobby();
      return;
    }
    const n = Game.nations[p.nation];
    n.isPlayer = false;
    Game.addLog(`${p.name} heeft het spel verlaten; de computer neemt ${n.name} over`, 'event');
  },

  canStart() { return this.role === 'host' && this.players.length > 0 && this.players.every(p => p.nation >= 0); },

  startHost() {
    if (!this.canStart()) return;
    const me = this.players.find(p => p.id === this.myId);
    Game.init(this.players.map(p => p.nation), me.nation, this.difficulty);
    Game.net = true;
    this.started = true;
    this.send({ t: 'broadcast', data: { t: 'start', players: this.players, difficulty: this.difficulty, snap: Game.snapshot(true) } });
    UI.beginGame();
  },

  startClient(m) {
    const me = m.players.find(p => p.id === this.myId);
    if (!me) return;
    this.players = m.players;
    Game.init(m.players.map(p => p.nation), me.nation, m.difficulty);
    Game.applySnapshot(m.snap);
    this.started = true;
    UI.beginGame();
  },

  // Player input: executed locally (solo/host) or sent to the host.
  cmd(c) {
    if (this.role === 'client') { this.send({ t: 'to_host', data: { t: 'cmd', c } }); return true; }
    return Game.command(Game.player, c);
  },

  tick(dt) {
    if (this.role !== 'host' || !this.started) return;
    this.sendTimer -= dt;
    if (this.sendTimer > 0) return;
    this.sendTimer = SNAPSHOT_INTERVAL;
    this.send({ t: 'broadcast', data: { t: 'snap', s: Game.snapshot(false) } });
  },
};

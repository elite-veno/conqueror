// Static game data: nations, units, technology, governments, buildings.
'use strict';

// Historical nations. lat/lon is where the capital is placed, size is the target number of starting tiles.
const NATIONS = [
  // Europa
  { id: 'rome',      name: 'Rome',          lat: 42,  lon: 12.5, size: 8 },
  { id: 'gaul',      name: 'Gallië',        lat: 47,  lon: 2.5,  size: 9 },
  { id: 'germania',  name: 'Germanië',      lat: 52,  lon: 11,   size: 9 },
  { id: 'britannia', name: 'Britannia',     lat: 53,  lon: -1.5, size: 7 },
  { id: 'hispania',  name: 'Hispania',      lat: 40,  lon: -4,   size: 8 },
  { id: 'macedon',   name: 'Macedonië',     lat: 40.5,lon: 22.5, size: 7 },
  { id: 'norse',     name: 'Noormannen',    lat: 61,  lon: 12,   size: 10 },
  { id: 'rus',       name: 'Kievse Rus',    lat: 54,  lon: 33,   size: 12 },
  // Midden-Oosten & Noord-Afrika
  { id: 'carthage',  name: 'Carthago',      lat: 35,  lon: 9,    size: 8 },
  { id: 'egypt',     name: 'Egypte',        lat: 27,  lon: 31,   size: 10 },
  { id: 'ottoman',   name: 'Ottomanen',     lat: 39,  lon: 33,   size: 8 },
  { id: 'persia',    name: 'Perzië',        lat: 32,  lon: 54,   size: 12 },
  { id: 'arabia',    name: 'Arabië',        lat: 23,  lon: 45,   size: 11 },
  { id: 'scythia',   name: 'Scythen',       lat: 47,  lon: 62,   size: 12 },
  { id: 'sibir',     name: 'Sibir',         lat: 58,  lon: 72,   size: 12 },
  // Azië
  { id: 'maurya',    name: 'Maurya',        lat: 23,  lon: 79,   size: 12 },
  { id: 'tibet',     name: 'Tibet',         lat: 31,  lon: 89,   size: 9 },
  { id: 'han',       name: 'Han',           lat: 32,  lon: 112,  size: 12 },
  { id: 'mongols',   name: 'Mongolen',      lat: 47,  lon: 103,  size: 12 },
  { id: 'jurchen',   name: 'Jurchen',       lat: 45,  lon: 127,  size: 9 },
  { id: 'japan',     name: 'Japan',         lat: 37,  lon: 139,  size: 7 },
  { id: 'khmer',     name: 'Khmer',         lat: 13,  lon: 104,  size: 9 },
  { id: 'majapahit', name: 'Majapahit',     lat: -7,  lon: 110,  size: 8 },
  // Afrika
  { id: 'mali',      name: 'Mali',          lat: 15,  lon: -4,   size: 12 },
  { id: 'aksum',     name: 'Aksum',         lat: 11,  lon: 39,   size: 10 },
  { id: 'kongo',     name: 'Kongo',         lat: -4,  lon: 17,   size: 12 },
  { id: 'zulu',      name: 'Zoeloes',       lat: -27, lon: 28,   size: 10 },
  // Amerika's
  { id: 'aztec',     name: 'Azteken',       lat: 20,  lon: -100, size: 8 },
  { id: 'maya',      name: 'Maya',          lat: 16,  lon: -90,  size: 6 },
  { id: 'inca',      name: 'Inca',          lat: -13, lon: -73,  size: 10 },
  { id: 'tupi',      name: 'Tupi',          lat: -10, lon: -47,  size: 12 },
  { id: 'mapuche',   name: 'Mapuche',       lat: -38, lon: -69,  size: 8 },
  { id: 'iroquois',  name: 'Irokezen',      lat: 43,  lon: -77,  size: 10 },
  { id: 'lakota',    name: 'Lakota',        lat: 44,  lon: -101, size: 11 },
  { id: 'pueblo',    name: 'Pueblo',        lat: 35,  lon: -110, size: 9 },
  { id: 'inuit',     name: 'Inuit',         lat: 64,  lon: -98,  size: 11 },
];

const MIN_NATION_TILES = 6;

// Unit types. Counter cycle: infantry beats cavalry, cavalry beats archers, archers beat infantry.
const UNIT_TYPES = ['inf', 'arc', 'cav'];
const UNITS = {
  inf: {
    name: 'Infanterie', short: 'Inf', icon: '⚔', cost: 6, atk: 1.0, def: 1.25, speed: 0.55, beats: 'cav',
    tiers: ['Krijgers', 'Speerdragers', 'Legionairs', 'Pikeniers', 'Geweerschutters', 'Mariniers'],
  },
  arc: {
    name: 'Boogschutters', short: 'Boog', icon: '➶', cost: 8, atk: 1.1, def: 1.15, speed: 0.55, beats: 'inf',
    tiers: ['Slingeraars', 'Boogschutters', 'Kruisbogen', 'Arkebusiers', 'Kanonniers', 'Artillerie'],
  },
  cav: {
    name: 'Cavalerie', short: 'Cav', icon: '♞', cost: 12, atk: 1.4, def: 0.9, speed: 1.0, beats: 'arc',
    tiers: ['Strijdwagens', 'Ruiters', 'Ridders', 'Kurassiers', 'Dragonders', 'Tanks'],
  },
};
const TIER_POWER = [1, 1.6, 2.5, 3.8, 5.6, 8];
const TIER_COST = [1, 1.3, 1.7, 2.2, 2.8, 3.5];
const TIER_TECH_COST = [0, 100, 300, 700, 1400, 2600];

const ERAS = ['Oudheid', 'Klassieke Oudheid', 'Middeleeuwen', 'Renaissance', 'Industrieel Tijdperk', 'Moderne Tijd'];
const ERA_COST = [0, 150, 450, 1000, 2000, 3600];
const ERA_GOLD_BONUS = 0.1; // extra gold income per era reached

// Military technology: navy, air force and their counters. Researched with gold like the unit tiers.
const MIL_TECHS = [
  { id: 'naval1', name: 'Scheepsbouw', era: 1, cost: 150, time: 15, desc: 'Haven + transportschepen' },
  { id: 'naval2', name: 'Oorlogsvloot', era: 2, cost: 400, time: 20, req: 'naval1', desc: 'Torpedobootjagers + kustbatterij' },
  { id: 'naval3', name: 'Linieschepen', era: 3, cost: 800, time: 25, req: 'naval2', desc: 'Slagschepen die de kust beschieten' },
  { id: 'air1',   name: 'Luchtvaart', era: 4, cost: 1300, time: 30, desc: 'Vliegveld, helikopters + luchtafweer' },
  { id: 'air2',   name: 'Luchtmacht', era: 4, cost: 1800, time: 30, req: 'air1', desc: 'Bommenwerpers' },
];

// Individually controlled ships and aircraft. Names follow the owner's era; stats scale with era too.
const SPECIALS = {
  transport:  { name: 'Transportschip', domain: 'sea', tech: 'naval1', cost: 45, hp: 40, speed: 1.3, capacity: 40,
                names: ['Vrachtschip', 'Vrachtgalei', 'Kogge', 'Galjoen', 'Stoomtransport', 'Troepenschip'],
                desc: 'Vervoert tot 40 troepen over zee.' },
  destroyer:  { name: 'Torpedobootjager', domain: 'sea', tech: 'naval2', cost: 110, hp: 100, speed: 1.5, range: 2, antiShip: 12, antiAir: 12,
                names: ['Oorlogsgalei', 'Oorlogsgalei', 'Oorlogsgalei', 'Fregat', 'Kruiser', 'Torpedobootjager'],
                desc: 'Jaagt op schepen en schiet vliegtuigen neer.' },
  battleship: { name: 'Slagschip', domain: 'sea', tech: 'naval3', cost: 200, hp: 180, speed: 1.0, range: 2, antiShip: 7, antiAir: 2, bombard: 3,
                names: ['Linieschip', 'Linieschip', 'Linieschip', 'Linieschip', 'Pantserschip', 'Slagschip'],
                desc: 'Beschiet troepen in kustgebieden naast het schip.' },
  helicopter: { name: 'Transporthelikopter', domain: 'air', tech: 'air1', cost: 90, hp: 45, speed: 1.8, capacity: 15,
                desc: 'Vliegt 15 troepen over land en zee.' },
  bomber:     { name: 'Bommenwerper', domain: 'air', tech: 'air2', cost: 150, hp: 60, speed: 2.6, payload: 60, rearm: 10,
                desc: 'Bombardeert troepen of schepen en keert terug om te herladen.' },
};
const SPECIAL_ERA_SCALE = 0.2;   // +20% hp/damage per era
const AMPHIBIOUS_PENALTY = 0.2;  // attack malus when landing from a ship
const DEFENSES = {               // buildings that shoot at units in range
  coastal: { vs: 'sea', dps: 12, range: 2 },
  flak:    { vs: 'air', dps: 20, range: 2 },
};

// Final node of the tech tree.
const FINAL_TECH = { name: 'Moderne Natie', cost: 7000, time: 60, mods: { atk: 0.25, def: 0.25, gold: 0.25 } };

// Governments, researched with government points (GP). reqAny: one of these must be unlocked.
const GOVS = {
  tribe:      { name: 'Stamverband', title: 'Stammen van', cost: 0, reqAny: [], mods: {},
                desc: 'Losse stammen zonder centraal gezag.' },
  despot:     { name: 'Despotie', title: 'Despotaat', cost: 80, reqAny: ['tribe'], mods: { atk: 0.15, levy: 0.5, gold: -0.05 },
                desc: 'Eén heerser met ijzeren vuist.' },
  monarchy:   { name: 'Monarchie', title: 'Koninkrijk', cost: 80, reqAny: ['tribe'], mods: { gold: 0.1, def: 0.1 },
                desc: 'Erfelijk koningschap brengt stabiliteit.' },
  theocracy:  { name: 'Theocratie', title: 'Heilig Rijk', cost: 250, reqAny: ['despot'], mods: { gp: 0.5, def: 0.15 },
                desc: 'Priesters en goden leiden de staat.' },
  feudal:     { name: 'Feodalisme', title: 'Feodaal Rijk', cost: 250, reqAny: ['monarchy', 'despot'], mods: { recruit: -0.25, levy: 0.75, def: 0.1 },
                desc: 'Vazallen leveren goedkope troepen.' },
  republic:   { name: 'Republiek', title: 'Republiek', cost: 300, reqAny: ['monarchy'], mods: { gold: 0.25, gp: 0.25, atk: -0.05 },
                desc: 'Gekozen bestuurders en bloeiende handel.' },
  empire:     { name: 'Keizerrijk', title: 'Keizerrijk', cost: 650, reqAny: ['feudal', 'theocracy'], minTiles: 25,
                mods: { atk: 0.2, def: 0.1, gold: 0.15, speed: 0.1 }, desc: 'Een keizer heerst over vele volkeren.' },
  merchant:   { name: 'Handelsrepubliek', title: 'Handelsrepubliek', cost: 600, reqAny: ['republic'], mods: { gold: 0.5, factory: -0.25 },
                desc: 'Kooplieden bepalen de koers; fabrieken goedkoper.' },
  constitutional: { name: 'Constitutionele Monarchie', title: 'Kroon', cost: 800, reqAny: ['republic', 'feudal'], minEra: 3,
                mods: { gold: 0.3, def: 0.2, gp: 0.3 }, desc: 'De koning regeert onder een grondwet.' },
  dictatorship: { name: 'Militaire Dictatuur', title: 'Militair Bewind', cost: 1100, reqAny: ['empire'], minEra: 4,
                mods: { atk: 0.4, speed: 0.25, recruit: -0.2, gold: -0.1 }, desc: 'Het leger is de staat.' },
  democracy:  { name: 'Democratie', title: 'Volksstaat', cost: 1300, reqAny: ['merchant', 'constitutional'], minEra: 4,
                mods: { gold: 0.6, gp: 0.5, recruit: -0.1 }, desc: 'Het volk beslist; welvaart voor iedereen.' },
};
const GOV_LAYOUT = [
  ['tribe'],
  ['despot', 'monarchy'],
  ['theocracy', 'feudal', 'republic'],
  ['empire', 'constitutional', 'merchant'],
  ['dictatorship', 'democracy'],
];
const GOV_SWITCH_COOLDOWN = 30;

const MOD_LABELS = {
  atk: 'aanval', def: 'verdediging', gold: 'goud', gp: 'bestuurspunten', recruit: 'rekruteringskosten',
  levy: 'lichting', speed: 'snelheid', factory: 'fabriekskosten',
};

const BUILDINGS = {
  factory: { name: 'Fabriek', icon: '⚒', base: 40, step: 20, desc: '+3 goud/s' },
  temple:  { name: 'Tempel', icon: '✦', base: 60, step: 30, desc: '+0.75 bestuurspunten/s' },
  fort:    { name: 'Fort', icon: '▣', base: 50, step: 10, desc: '+50% verdediging' },
  harbor:  { name: 'Haven', icon: '⚓', base: 80, step: 40, desc: 'Bouwt schepen', coastal: true, req: 'naval1' },
  coastal: { name: 'Kustbatterij', icon: '◎', base: 90, step: 20, desc: 'Anti-schip, bereik 2', coastal: true, req: 'naval2' },
  airfield:{ name: 'Vliegveld', icon: '✈', base: 150, step: 60, desc: 'Bouwt luchtmacht', req: 'air1' },
  flak:    { name: 'Luchtafweer', icon: '✷', base: 100, step: 20, desc: 'Anti-lucht, bereik 2', req: 'air1' },
};
const BUILD_KEYS = Object.keys(BUILDINGS);

const ECON = {
  startGold: 100,
  baseGold: 2,
  goldPerTile: 0.15,
  factoryGold: 3,
  baseGP: 0.5,
  gpPerTile: 0.05,
  templeGP: 0.75,
  levyInterval: 10,
  levyCap: 12,
  peaceTime: 60,      // seconds at the start in which nations can only take neutral land
  plunder: 5,
  upkeep: 0.015,      // gold per unit per second
  specialUpkeep: 0.3, // gold per ship/aircraft per second
  fortDef: 0.5,
  capitalDef: 0.5,
  baseDef: 0.25,
};

const SIZE_RANKS = [
  [0, 'Stamgebied'], [12, 'Regionale macht'], [25, 'Grootmacht'], [50, 'Rijk'], [90, 'Wereldrijk'],
];
const WIN_SHARE = 0.5;

const DIFFICULTY = {
  easy:   { name: 'Makkelijk', aiIncome: 0.7, aiAggro: 1.7 },
  normal: { name: 'Normaal',   aiIncome: 1.0, aiAggro: 1.45 },
  hard:   { name: 'Moeilijk',  aiIncome: 1.3, aiAggro: 1.25 },
};

// Regions for the nation picker (index ranges into NATIONS).
const REGIONS = [
  ['Europa', 0, 8], ['Midden-Oosten & Steppen', 8, 15], ['Azië', 15, 23], ['Afrika', 23, 27], ["Amerika's", 27, 36],
];

// ============================================
// CONSTANTS — extracted from game.original.js
// ============================================

export const GAME_VERSION = 5;
export const SAVE_KEY = 'openciv_save';

export const HEX_SIZE = 28;
export const MAP_COLS = 60;
export const MAP_ROWS = 40;
export const MAX_TURNS = 100;
export const SQRT3 = Math.sqrt(3);

export const CITY_DEFENSE = {
  BASE_HP: 100,
  BASE_COMBAT_STRENGTH: 15,
  WALLS_BONUS: 8,
  FORTRESS_BONUS: 5,
  GARRISON_MULTIPLIER: 0.5,
  TERRAIN_HILLS_BONUS: 3,
  RANGED_STRIKE_RANGE: 2,
  RANGED_STRIKE_STRENGTH: 12,
  HP_HEAL_PER_TURN: 5,
  HP_HEAL_NOT_ATTACKED: 10,
  CAPTURE_MELEE_ONLY: true,
};

export const BASE_TERRAIN = {
  ocean:     { name: 'Ocean',     baseColor: '#0e2a42', food: 1, prod: 0, gold: 0, movable: false, moveCost: 99, group: 'water' },
  coast:     { name: 'Coast',     baseColor: '#184060', food: 1, prod: 0, gold: 1, movable: false, moveCost: 99, group: 'water' },
  grassland: { name: 'Grassland', baseColor: '#4a8a3a', food: 2, prod: 0, gold: 0, movable: true,  moveCost: 1, group: 'flat' },
  plains:    { name: 'Plains',    baseColor: '#6a8d4e', food: 1, prod: 1, gold: 0, movable: true,  moveCost: 1, group: 'flat' },
  desert:    { name: 'Desert',    baseColor: '#c4a84a', food: 0, prod: 0, gold: 0, movable: true,  moveCost: 1, group: 'flat' },
  tundra:    { name: 'Tundra',    baseColor: '#6a7e80', food: 1, prod: 0, gold: 0, movable: true,  moveCost: 1, group: 'flat' },
  snow:      { name: 'Snow',      baseColor: '#b8c4cc', food: 0, prod: 0, gold: 0, movable: true,  moveCost: 1, group: 'flat' },
  lake:      { name: 'Lake',      baseColor: '#184060', food: 2, prod: 0, gold: 1, movable: false, moveCost: 99, group: 'water' },
};

// Features overlay on base terrain and add yields/move costs
export const TERRAIN_FEATURES = {
  hills:      { name: 'Hills',      food: 0, prod: 1, gold: 0, moveCost: 2, color: 'rgba(120,100,60,0.25)' },
  woods:      { name: 'Woods',      food: 0, prod: 1, gold: 0, moveCost: 2, color: 'rgba(20,60,20,0.3)' },
  rainforest: { name: 'Rainforest', food: 1, prod: 0, gold: 0, moveCost: 2, color: 'rgba(10,80,30,0.35)' },
  marsh:      { name: 'Marsh',      food: 1, prod: 0, gold: 0, moveCost: 2, color: 'rgba(60,90,70,0.3)' },
  floodplains:{ name: 'Floodplains',food: 3, prod: 0, gold: 0, moveCost: 0, color: 'rgba(100,160,60,0.2)' },
};

// UNIT_TYPES is `let` because the game mod system can add new unit types at runtime
export let UNIT_TYPES = {
  scout:     { name: 'Scout',         cost: 15, combat: 10, rangedCombat: 0, range: 0, movePoints: 3, icon: '👁', class: 'recon',    desc: 'Fast explorer, weak in combat' },
  warrior:   { name: 'Warrior',       cost: 20, combat: 20, rangedCombat: 0, range: 0, movePoints: 2, icon: '⚔', class: 'melee',    desc: 'Basic melee infantry' },
  slinger:   { name: 'Slinger',       cost: 20, combat: 5,  rangedCombat: 15,range: 1, movePoints: 2, icon: '◎', class: 'ranged',   desc: 'Cheap ranged unit' },
  archer:    { name: 'Archer',        cost: 30, combat: 15, rangedCombat: 25,range: 2, movePoints: 2, icon: '🏹', class: 'ranged',   desc: 'Strong ranged attacker, range 2' },
  spearman:  { name: 'Spearman',      cost: 35, combat: 25, rangedCombat: 0, range: 0, movePoints: 2, icon: '🔱', class: 'anti-cav', desc: '+10 vs cavalry units' },
  chariot:   { name: 'Heavy Chariot', cost: 40, combat: 28, rangedCombat: 0, range: 0, movePoints: 2, icon: '🐎', class: 'cavalry',  desc: 'Powerful mobile unit' },
  worker:    { name: 'Worker',        cost: 30, combat: 0,  rangedCombat: 0, range: 0, movePoints: 2, icon: '👷', class: 'civilian', desc: 'Builds improvements on tiles' },
  settler:   { name: 'Settler',       cost: 60, combat: 0,  rangedCombat: 0, range: 0, movePoints: 2, icon: '🏕', class: 'civilian', desc: 'Founds new cities' },
  horseman:  { name: 'Horseman', cost: 45, combat: 30, rangedCombat: 0, range: 0, movePoints: 3, icon: '\u{1F40E}', class: 'cavalry', desc: 'Fast cavalry unit, 3 moves' },
  ballista:  { name: 'Ballista', cost: 50, combat: 10, rangedCombat: 30, range: 2, movePoints: 1, icon: '\u{1F3AF}', class: 'siege', desc: 'Siege engine, +50% vs cities' },
  galley:    { name: 'Galley', cost: 35, combat: 25, rangedCombat: 0, range: 0, movePoints: 3, icon: '\u{26F5}', class: 'naval', desc: 'Coastal patrol vessel' },
  phalanx:   { name: 'Phalanx', cost: 40, combat: 30, rangedCombat: 0, range: 0, movePoints: 2, icon: '\u{1F6E1}', class: 'anti-cav', desc: 'Heavy infantry, +15 vs cavalry' },
};

// ============================================
// UNIT UPGRADE PATHS
// ============================================
export const UNIT_UPGRADES = {
  warrior:  { to: 'phalanx',  cost: 30, requires: 'iron_working' },
  slinger:  { to: 'archer',   cost: 25, requires: 'archery' },
  spearman: { to: 'phalanx',  cost: 20, requires: 'iron_working' },
  chariot:  { to: 'horseman', cost: 25, requires: 'horseback_riding' },
};

export const RESOURCES = {
  iron:     { name: 'Iron',     icon: '⛏',  color: '#9a9aaa', bonus: { prod: 1 }, category: 'strategic' },
  gold_ore: { name: 'Gold Ore', icon: '◈',  color: '#d4b45a', bonus: { gold: 2 }, category: 'luxury' },
  horses:   { name: 'Horses',   icon: '♞',  color: '#a0785a', bonus: { prod: 1 }, category: 'strategic' },
  gems:     { name: 'Gems',     icon: '◆',  color: '#9b6fc5', bonus: { gold: 1, culture: 1 }, category: 'luxury' },
  wheat:    { name: 'Wheat',    icon: '⌇',  color: '#c9b04c', bonus: { food: 2 }, category: 'bonus' },
  stone:    { name: 'Stone',    icon: '▢',  color: '#8a8a8a', bonus: { prod: 2 }, category: 'bonus' },
  fish:     { name: 'Fish',     icon: '⋈',  color: '#5ba8d9', bonus: { food: 2 }, category: 'bonus' },
  spices:   { name: 'Spices',   icon: '❋',  color: '#d98a5b', bonus: { gold: 2 }, category: 'luxury' },
  silk:     { name: 'Silk',     icon: '≈',  color: '#c495d9', bonus: { gold: 1, culture: 1 }, category: 'luxury' },
  copper:   { name: 'Copper',   icon: '⊕',  color: '#c88a5a', bonus: { prod: 1, gold: 1 }, category: 'strategic' },
  marble:   { name: 'Marble',   icon: '\u25A1', color: '#d0c8b8', bonus: { prod: 1, gold: 1 }, category: 'bonus' },
  incense:  { name: 'Incense',  icon: '\u2604', color: '#b8a0d0', bonus: { gold: 1, culture: 1 }, category: 'luxury' },
  ivory:    { name: 'Ivory',    icon: '\u2658', color: '#f0e8d0', bonus: { gold: 2 }, category: 'luxury' },
  dyes:     { name: 'Dyes',     icon: '\u2740', color: '#d05080', bonus: { gold: 1, culture: 1 }, category: 'luxury' },
  furs:     { name: 'Furs',     icon: '\u2248', color: '#8a6040', bonus: { gold: 2 }, category: 'luxury' },
  salt:     { name: 'Salt',     icon: '\u2662', color: '#e8e0d0', bonus: { food: 1, gold: 1 }, category: 'bonus' },
  obsidian: { name: 'Obsidian', icon: '\u25C6', color: '#303030', bonus: { prod: 2 }, category: 'strategic' },
  jade:     { name: 'Jade',     icon: '\u25C9', color: '#50a060', bonus: { gold: 1, culture: 1 }, category: 'luxury' },
  wine:     { name: 'Wine',     icon: '\u2617', color: '#8a2040', bonus: { gold: 2 }, category: 'luxury' },
  cotton:   { name: 'Cotton',   icon: '\u2055', color: '#e8e8f0', bonus: { gold: 1 }, category: 'bonus' },
};

// BUILDINGS is `let` because the game mod system can add new buildings at runtime
export let BUILDINGS = [
  { id: 'granary',     name: 'Granary',       cost: 40,  desc: '+2 Food per turn', effect: { food: 2 } },
  { id: 'market',      name: 'Market',        cost: 50,  desc: '+3 Gold per turn', effect: { gold: 3 } },
  { id: 'barracks',    name: 'Barracks',      cost: 45,  desc: '+3 Military, unlock units', effect: { military: 3 } },
  { id: 'library',     name: 'Library',       cost: 55,  desc: '+2 Science per turn', effect: { science: 2 } },
  { id: 'walls',       name: 'City Walls',    cost: 60,  desc: '+5 Defense', effect: { defense: 5 } },
  { id: 'workshop',    name: 'Workshop',      cost: 65,  desc: '+2 Production per turn', effect: { production: 2 } },
  { id: 'temple',      name: 'Temple',        cost: 50,  desc: '+1 Culture, +1 Gold', effect: { culture: 1, gold: 1 } },
  { id: 'harbor',      name: 'Harbor',        cost: 70,  desc: '+3 Gold, +1 Food (coastal)', effect: { gold: 3, food: 1 } },
  { id: 'university',  name: 'University',    cost: 100, desc: '+4 Science per turn', effect: { science: 4 } },
  { id: 'bank',        name: 'Bank',          cost: 90,  desc: '+5 Gold per turn', effect: { gold: 5 } },
  { id: 'fortress',    name: 'Fortress',      cost: 110, desc: '+8 Military, +3 Defense', effect: { military: 8, defense: 3 } },
  { id: 'monument', name: 'Monument', cost: 30, desc: '+2 Culture per turn', effect: { culture: 2 } },
  { id: 'garden', name: 'Garden', cost: 45, desc: '+2 Food, +1 Happiness', effect: { food: 2 } },
  { id: 'arena', name: 'Arena', cost: 55, desc: '+2 Culture, +1 Military', effect: { culture: 2, military: 1 } },
  { id: 'lighthouse', name: 'Lighthouse', cost: 60, desc: '+3 Gold, +1 Food (coastal)', effect: { gold: 3, food: 1 } },
  { id: 'amphitheater', name: 'Amphitheater', cost: 70, desc: '+3 Culture per turn', effect: { culture: 3 } },
  { id: 'academy', name: 'Academy', cost: 80, desc: '+3 Science per turn', effect: { science: 3 } },
  { id: 'blacksmith', name: 'Blacksmith', cost: 50, desc: '+2 Production, military units +3 combat', effect: { production: 2 } },
  { id: 'bath', name: 'Bath', cost: 55, desc: '+2 Food, +1 Gold', effect: { food: 2, gold: 1 } },
];

export const TECHNOLOGIES = [
  { id: 'agriculture', name: 'Agriculture',     cost: 20,  desc: 'Unlock Granary', unlocks: ['granary'] },
  { id: 'mining',      name: 'Mining',          cost: 20,  desc: 'Unlock Workshop', unlocks: ['workshop'] },
  { id: 'writing',     name: 'Writing',         cost: 30,  desc: 'Unlock Library', unlocks: ['library'] },
  { id: 'currency', name: 'Currency', cost: 35, desc: 'Unlock Market, Bath', unlocks: ['market', 'bath'] },
  { id: 'masonry',     name: 'Masonry',         cost: 30,  desc: 'Unlock City Walls', unlocks: ['walls'] },
  { id: 'mysticism', name: 'Mysticism', cost: 25, desc: 'Unlock Temple, Monument', unlocks: ['temple', 'monument'] },
  { id: 'sailing',     name: 'Sailing',         cost: 40,  desc: 'Unlock Harbor', unlocks: ['harbor'] },
  { id: 'archery',     name: 'Archery',         cost: 25,  desc: 'Unlock Archers', unlocks: ['archer'] },
  { id: 'bronze_working', name: 'Bronze Working', cost: 30, desc: 'Unlock Spearmen', unlocks: ['spearman'] },
  { id: 'wheel',       name: 'The Wheel',       cost: 35,  desc: 'Unlock Heavy Chariots', unlocks: ['chariot'] },
  { id: 'military_tactics', name: 'Military Tactics', cost: 35, desc: 'Unlock Barracks', unlocks: ['barracks'] },
  { id: 'education',   name: 'Education',       cost: 60,  desc: 'Unlock University', unlocks: ['university'], requires: ['writing'] },
  { id: 'banking',     name: 'Banking',         cost: 70,  desc: 'Unlock Bank', unlocks: ['bank'], requires: ['currency'] },
  { id: 'fortification', name: 'Fortification', cost: 80,  desc: 'Unlock Fortress', unlocks: ['fortress'], requires: ['masonry', 'military_tactics'] },
  { id: 'animal_husbandry', name: 'Animal Husbandry', cost: 25, desc: 'Unlock Pastures, Camps, reveals Horses', unlocks: ['pasture','camp'] },
  { id: 'pottery', name: 'Pottery', cost: 20, desc: 'Unlock Shrine, storage', unlocks: [] },
  { id: 'irrigation_tech', name: 'Irrigation', cost: 30, desc: 'Unlock Irrigation improvement, Garden', unlocks: ['irrigation', 'garden'], requires: ['agriculture'] },
  { id: 'construction', name: 'Construction', cost: 50, desc: 'Better buildings and roads', unlocks: [], requires: ['masonry'] },
  { id: 'iron_working', name: 'Iron Working', cost: 45, desc: 'Reveals Iron, stronger units', unlocks: [], requires: ['bronze_working'] },
  { id: 'mathematics', name: 'Mathematics', cost: 70, desc: 'Unlock Academy, Pyramid of Sun', unlocks: ['academy'], requires: ['engineering'] },
  { id: 'philosophy', name: 'Philosophy', cost: 60, desc: '+1 Envoy, cultural growth', unlocks: [], requires: ['mysticism', 'writing'] },
  { id: 'theology', name: 'Theology', cost: 65, desc: 'Temple upgrades', unlocks: [], requires: ['philosophy'] },
  { id: 'engineering', name: 'Engineering', cost: 55, desc: 'Unlock Amphitheater, bridges', unlocks: ['amphitheater'], requires: ['bronze_working', 'currency'] },
  { id: 'navigation', name: 'Navigation', cost: 55, desc: 'Unlock Lighthouse, Quadrireme', unlocks: ['lighthouse'], requires: ['currency'] },
  { id: 'military_training', name: 'Military Training', cost: 55, desc: 'Unlock Arena, Blacksmith, flanking', unlocks: ['arena', 'blacksmith'], requires: ['wheel'] },
];

export const CIVICS = [
  { id: 'code_of_laws', name: 'Code of Laws', cost: 20, desc: 'Unlock Despotism government', unlocks: ['despotism_gov'], category: 'governance' },
  { id: 'craftsmanship', name: 'Craftsmanship', cost: 20, desc: '+1 Production on improved tiles', unlocks: [], category: 'economy' },
  { id: 'foreign_trade', name: 'Foreign Trade', cost: 25, desc: '+1 Gold on trade routes', unlocks: [], requires: ['code_of_laws'], category: 'economy' },
  { id: 'military_tradition', name: 'Military Tradition', cost: 25, desc: 'Units gain XP 25% faster', unlocks: [], requires: ['craftsmanship'], category: 'military' },
  { id: 'state_workforce', name: 'State Workforce', cost: 30, desc: 'Unlock Oligarchy government', unlocks: ['oligarchy_gov'], requires: ['code_of_laws'], category: 'governance' },
  { id: 'early_empire', name: 'Early Empire', cost: 35, desc: '+1 Population growth, +1 settler', unlocks: [], requires: ['foreign_trade'], category: 'expansion' },
  { id: 'mysticism_civic', name: 'Mysticism', cost: 30, desc: 'Unlock Pantheon selection', unlocks: ['pantheon'], requires: ['code_of_laws'], category: 'religion' },
  { id: 'drama_poetry', name: 'Drama & Poetry', cost: 40, desc: 'Unlock Classical Republic, +2 Culture', unlocks: ['republic_gov'], requires: ['early_empire'], category: 'governance' },
  { id: 'games_recreation', name: 'Games & Recreation', cost: 35, desc: '+2 Happiness from Arenas', unlocks: [], requires: ['state_workforce', 'military_tradition'], category: 'culture' },
  { id: 'political_philosophy', name: 'Political Philosophy', cost: 45, desc: '+1 Social policy slot', unlocks: [], requires: ['drama_poetry', 'state_workforce'], category: 'governance' },
  { id: 'theology_civic', name: 'Theology', cost: 45, desc: 'Unlock full Religion founding', unlocks: ['religion'], requires: ['mysticism_civic'], category: 'religion' },
  { id: 'recorded_history', name: 'Recorded History', cost: 50, desc: '+2 Science from Libraries', unlocks: [], requires: ['drama_poetry', 'political_philosophy'], category: 'culture' },
];

export const GREAT_PEOPLE_TYPES = [
  { type: 'great_scientist', name: 'Great Scientist', trigger: 'science', threshold: 100, icon: '\u{1F9EA}', effect: 'Instantly completes current research', effectType: 'instant_research' },
  { type: 'great_engineer', name: 'Great Engineer', trigger: 'production', threshold: 120, icon: '\u{1F527}', effect: 'Instantly completes current production', effectType: 'instant_production' },
  { type: 'great_merchant', name: 'Great Merchant', trigger: 'gold', threshold: 150, icon: '\u{1F4B0}', effect: '+100 Gold immediately', effectType: 'gold_bonus' },
  { type: 'great_general', name: 'Great General', trigger: 'military', threshold: 80, icon: '\u{2694}', effect: 'All units +5 combat for 10 turns', effectType: 'combat_bonus' },
  { type: 'great_prophet', name: 'Great Prophet', trigger: 'culture', threshold: 100, icon: '\u{1F54C}', effect: 'Found a Religion', effectType: 'found_religion' },
  { type: 'great_artist', name: 'Great Artist', trigger: 'culture', threshold: 130, icon: '\u{1F3A8}', effect: '+50 Culture, Golden Age for 5 turns', effectType: 'golden_age' },
];

// ============================================
// PANTHEON / RELIGION SYSTEM
// ============================================
export const PANTHEONS = [
  { id: 'god_of_the_sea', name: 'God of the Sea', desc: '+1 Food from fishing boats', icon: '\u{1F30A}' },
  { id: 'god_of_the_forge', name: 'God of the Forge', desc: '+25% Production on military units', icon: '\u{1F525}' },
  { id: 'goddess_of_harvest', name: 'Goddess of the Harvest', desc: '+1 Food from farms', icon: '\u{1F33E}' },
  { id: 'god_of_war', name: 'God of War', desc: '+5 Combat strength to all units', icon: '\u{2694}' },
  { id: 'goddess_of_wisdom', name: 'Goddess of Wisdom', desc: '+2 Science per turn', icon: '\u{1F4D6}' },
  { id: 'god_of_craftsmen', name: 'God of Craftsmen', desc: '+1 Production from mines', icon: '\u{2692}' },
  { id: 'earth_goddess', name: 'Earth Goddess', desc: '+1 Culture from natural features', icon: '\u{1F30D}' },
  { id: 'monument_gods', name: 'Monument to the Gods', desc: '+15% Production towards Wonders', icon: '\u{1F3DB}' },
];

export const UNIT_UNLOCKS = {
  scout: null,     // available immediately
  warrior: null,   // available immediately
  slinger: null,   // available immediately
  archer: 'archery',
  spearman: 'bronze_working',
  chariot: 'wheel',
  worker: 'agriculture',
  settler: null,  // Available from the start
  horseman: 'iron_working',
  ballista: 'wheel',
  galley: 'sailing',
  phalanx: 'bronze_working',
};

export const UNIT_PROMOTIONS = {
  battlecry: { name: 'Battlecry', desc: '+7 combat vs melee', combatBonus: 7, vsClass: 'melee', icon: '\u{1F4E3}' },
  tortoise: { name: 'Tortoise', desc: '+10 defense fortified', fortifyBonus: 10, icon: '\u{1F422}' },
  commando: { name: 'Commando', desc: '+1 Movement', moveBonus: 1, icon: '\u{1F97E}' },
  volley: { name: 'Volley', desc: '+5 ranged vs fortified', rangedBonus: 5, icon: '\u{1F3AF}' },
  garrison: { name: 'Garrison', desc: '+10 combat in city', cityBonus: 10, icon: '\u{1F3F0}' },
  charge: { name: 'Charge', desc: '+10 vs wounded', woundedBonus: 10, icon: '\u26A1' },
  pursuit: { name: 'Pursuit', desc: '+1 Move, move after attack', moveBonus: 1, icon: '\u{1F3C7}' },
  medic: { name: 'Medic', desc: 'Heal 10 HP/turn to adjacent', healAura: 10, icon: '\u{2695}' },
  elite: { name: 'Elite', desc: '+5 combat strength', combatBonus: 5, icon: '\u2B50' },
};

export const PROMOTION_PATHS = {
  melee: [['battlecry', 'tortoise'], ['commando', 'elite']],
  ranged: [['volley', 'garrison'], ['elite', 'medic']],
  'anti-cav': [['battlecry', 'tortoise'], ['elite', 'medic']],
  cavalry: [['charge', 'pursuit'], ['commando', 'elite']],
  siege: [['volley', 'garrison'], ['elite', 'medic']],
  recon: [['commando', 'pursuit'], ['medic', 'elite']],
};

export const PROMOTION_XP_THRESHOLDS = [15, 40];

export const LUXURY_RESOURCES = ['gold_ore', 'gems', 'spices', 'silk', 'incense', 'ivory', 'dyes', 'furs', 'jade', 'wine'];

export const NATURAL_WONDERS = [
  { id: 'grand_mesa', name: 'Grand Mesa', icon: '\u26F0', color: '#c49858', yields: { prod: 2, gold: 2 }, desc: 'A towering flat-topped mountain', terrain: ['plains', 'desert'], feature: 'hills' },
  { id: 'great_barrier_reef', name: 'Great Barrier Reef', icon: '\u{1F41A}', color: '#40c0c0', yields: { food: 3, gold: 2 }, desc: 'A sprawling underwater coral wonder', terrain: ['coast'], feature: null },
  { id: 'krakatoa', name: 'Krakatoa', icon: '\u{1F30B}', color: '#d04020', yields: { prod: 3, science: 2 }, desc: 'An active volcanic island', terrain: ['coast', 'ocean'], feature: null },
  { id: 'old_faithful', name: 'Old Faithful', icon: '\u2668', color: '#80b0d0', yields: { science: 3, gold: 1 }, desc: 'A legendary erupting geyser', terrain: ['plains', 'grassland'], feature: null },
  { id: 'fountain_of_youth', name: 'Fountain of Youth', icon: '\u2B50', color: '#f0d060', yields: { food: 2, culture: 3 }, desc: 'A mythical healing spring', terrain: ['grassland'], feature: 'woods' },
];

export const TERRAIN_TILE_MAP = {
  // Base terrain -> hex tile variants (6 variants each, Gemini-generated)
  'grassland': ['grassland', 'grassland_v2', 'grassland_v3', 'grassland_v4', 'grassland_v5', 'grassland_v6'],
  'plains':    ['plains', 'plains_v2', 'plains_v3', 'plains_v4', 'plains_v5', 'plains_v6'],
  'desert':    ['desert', 'desert_v2', 'desert_v3', 'desert_v4', 'desert_v5', 'desert_v6'],
  'ocean':     ['ocean', 'ocean_v2', 'ocean_v3', 'ocean_v4', 'ocean_v5', 'ocean_v6'],
  'coast':     ['coast', 'coast_v2', 'coast_v3', 'coast_v4', 'coast_v5', 'coast_v6'],
  'lake':      ['lake', 'lake_v2', 'lake_v3', 'lake_v4', 'lake_v5', 'lake_v6'],
  'tundra':    ['tundra', 'tundra_v2', 'tundra_v3', 'tundra_v4', 'tundra_v5', 'tundra_v6'],
  'snow':      ['snow', 'snow_v2', 'snow_v3', 'snow_v4', 'snow_v5', 'snow_v6'],
};

export const FEATURE_TILE_MAP = {
  'mountain':    ['mountain', 'mountain_v2', 'mountain_v3', 'mountain_v4', 'mountain_v5', 'mountain_v6'],
  'hills':       ['hills', 'hills_v2', 'hills_v3', 'hills_v4', 'hills_v5', 'hills_v6'],
  'woods':       ['woods', 'woods_v2', 'woods_v3', 'woods_v4', 'woods_v5', 'woods_v6'],
  'rainforest':  ['rainforest', 'rainforest_v2', 'rainforest_v3', 'rainforest_v4', 'rainforest_v5', 'rainforest_v6'],
  'marsh':       ['marsh', 'marsh_v2', 'marsh_v3', 'marsh_v4', 'marsh_v5', 'marsh_v6'],
  'floodplains': ['floodplains', 'floodplains_v2', 'floodplains_v3', 'floodplains_v4', 'floodplains_v5', 'floodplains_v6'],
};

export const PORTRAIT_MAP = {
  'emperor_valerian': 'aethelred',
  'shadow_kael': 'kael',
  'merchant_prince_castellan': 'tariq',
  'pirate_queen_elara': 'pythia',
  'rebel_leader_sera': 'ula',
};

export const UNIT_SPRITE_MAP = {
  warrior: { x: 1549, y: 1770, w: 95, h: 81 },
  scout: { x: 1240, y: 1592, w: 95, h: 81 },
  archer: { x: 4, y: 1770, w: 95, h: 81 },
  slinger: { x: 313, y: 1681, w: 95, h: 81 },
  spearman: { x: 519, y: 880, w: 95, h: 81 },
  chariot: { x: 1034, y: 1146, w: 77, h: 70 },
  horseman: { x: 1119, y: 1093, w: 77, h: 70 },
  ballista: { x: 1868, y: 1964, w: 77, h: 65 },
  galley: { x: 1966, y: 1658, w: 64, h: 56 },
  phalanx: { x: 1451, y: 1859, w: 95, h: 81 },
  worker: { x: 210, y: 496, w: 95, h: 81 },
  settler: { x: 4, y: 407, w: 95, h: 81 },
  great_general: { x: 568, y: 446, w: 77, h: 100 },
  great_scientist: { x: 725, y: 1770, w: 95, h: 81 },
  great_merchant: { x: 653, y: 381, w: 77, h: 70 },
  great_engineer: { x: 416, y: 1592, w: 95, h: 81 },
  great_prophet: { x: 107, y: 1236, w: 95, h: 81 },
  great_artist: { x: 627, y: 1859, w: 95, h: 81 }
};

export const REALISTIC_TERRAIN_MAP = {
  desert:    { x: 0,   y: 0   },
  tundra:    { x: 128, y: 0   },
  woods:     { x: 256, y: 0   },
  grassland: { x: 128, y: 128 },
  plains:    { x: 256, y: 128 },
  coast:     { x: 128, y: 256 },
  lake:      { x: 128, y: 256 },
  ocean:     { x: 0,   y: 256 },
  snow:      { x: 128, y: 384 },
  marsh:     { x: 256, y: 384 },
};

export const TILE_IMPROVEMENTS = {
  // Farming & Food
  farm:        { name: 'Farm',         icon: '🌾', turns: 3, requires: 'agriculture', validOn: ['grassland','plains','floodplains'], yields: { food: 2 }, requiresRiver: false, desc: '+2 Food (better near rivers)' },
  irrigation:  { name: 'Irrigation',   icon: '💧', turns: 4, requires: 'agriculture', validOn: ['grassland','plains','desert'], yields: { food: 2, gold: 1 }, requiresRiver: true, desc: '+2 Food, +1 Gold (requires river)' },
  pasture:     { name: 'Pasture',      icon: '🐄', turns: 3, requires: 'animal_husbandry', validOn: ['grassland','plains'], yields: { food: 1, prod: 1 }, requiresResource: ['horses'], desc: '+1 Food, +1 Prod (on Horses)' },
  camp:        { name: 'Camp',         icon: '⛺', turns: 3, requires: 'animal_husbandry', validOn: ['grassland','plains','tundra'], yields: { gold: 2 }, desc: '+2 Gold (hunting camp)' },
  fishing_boats:{ name: 'Fishing Boats',icon: '🎣', turns: 2, requires: 'sailing',   validOn: ['coast','ocean'], yields: { food: 2, gold: 1 }, requiresResource: ['fish'], desc: '+2 Food, +1 Gold (on Fish)' },

  // Production & Mining
  mine:        { name: 'Mine',         icon: '⛏️', turns: 4, requires: 'mining',      validOn: ['hills'], yields: { prod: 2 }, desc: '+2 Production' },
  quarry:      { name: 'Quarry',       icon: '🪨', turns: 4, requires: 'masonry',     validOn: ['hills','plains'], yields: { prod: 1, gold: 1 }, requiresResource: ['stone'], desc: '+1 Prod, +1 Gold (on Stone)' },
  lumber_mill: { name: 'Lumber Mill',  icon: '🪓', turns: 3, requires: 'mining',      validFeature: ['woods','rainforest'], yields: { prod: 2 }, desc: '+2 Production (in forest)' },

  // Infrastructure
  road:        { name: 'Road',         icon: '🛤️', turns: 2, requires: null,          validOn: ['grassland','plains','desert','tundra','hills'], yields: {}, moveCostReduction: true, desc: 'Halves movement cost, +1 Gold between cities' },

  // Terraforming
  clear_forest:{ name: 'Clear Forest', icon: '🪓', turns: 2, requires: 'mining',      validFeature: ['woods','rainforest'], yields: {}, terraform: { removeFeature: true, prodBonus: 20 }, desc: 'Remove forest, gain 20 production' },
  plant_forest:{ name: 'Plant Forest', icon: '🌲', turns: 4, requires: 'mysticism',   validOn: ['grassland','plains'], yields: {}, terraform: { addFeature: 'woods' }, desc: 'Grow forest on empty land' },
  drain_marsh: { name: 'Drain Marsh',  icon: '🏗️', turns: 3, requires: 'masonry',     validFeature: ['marsh'], yields: {}, terraform: { removeFeature: true, food: 1 }, desc: 'Drain marsh, gain fertile land' },
};

// Worker unit type
export const WORKER_TYPE = { name: 'Worker', cost: 30, combat: 0, rangedCombat: 0, range: 0, movePoints: 2, icon: '👷', class: 'civilian', desc: 'Builds tile improvements' };

export const FACTIONS = {
  emperor_valerian:         { name: 'High Chieftain Aethelred', city: 'Nordhaven',      color: '#e03030', unitColor: '#ff4444', portrait: 'A', type: 'leader',  title: 'High Chieftain of the Northern Trade',  portraitClass: 'portrait-leader', portraitImg: 'assets/character-portraits.jpg' },
  shadow_kael:              { name: 'Warlord Kael',             city: 'Ashland Hold',   color: '#8030c0', unitColor: '#a050e0', portrait: 'K', type: 'general', title: 'Warlord of the Ashland Hegemony',        portraitClass: 'portrait-general' },
  merchant_prince_castellan:{ name: 'Queen Tariq',              city: 'Red Harbour',    color: '#e0a020', unitColor: '#f0c030', portrait: 'T', type: 'tycoon',  title: 'Queen of Red Sea Commerce',             portraitClass: 'portrait-tycoon' },
  pirate_queen_elara:       { name: 'Pythia Ione',              city: 'Marble Isle',    color: '#2090e0', unitColor: '#40b0ff', portrait: 'P', type: 'oracle',  title: 'Oracle of the Marble Isle',              portraitClass: 'portrait-oracle' },
  commander_thane:          { name: 'Commander Thane',          city: 'Iron Keep',      color: '#e07020', unitColor: '#f09040', portrait: 'T', type: 'general', title: 'Supreme Marshal of the Iron Legions',   portraitClass: 'portrait-general' },
  rebel_leader_sera:        { name: "High Priestess 'Ula",      city: 'Elder Grove',    color: '#20b040', unitColor: '#40d060', portrait: 'U', type: 'priestess', title: 'High Priestess of the Levantine Grove', portraitClass: 'portrait-priestess' },
};

// ============================================
// FACTION PERSONALITY TRAITS (Civ-style)
// ============================================
export const FACTION_TRAITS = {
  emperor_valerian: {
    archetype: 'expansionist', expansion: 0.8, military: 0.6, culture: 0.3, science: 0.4, diplomacy: 0.5, espionage: 0.2,
    improvePriority: ['farm','pasture','road','mine'], settlerThreshold: 1500, patrolRange: 5, warThreshold: -25,
  },
  shadow_kael: {
    archetype: 'militaristic', expansion: 0.3, military: 0.9, culture: 0.1, science: 0.5, diplomacy: 0.2, espionage: 0.7,
    improvePriority: ['mine','quarry','camp','road'], settlerThreshold: 3000, patrolRange: 7, warThreshold: -15,
  },
  merchant_prince_castellan: {
    archetype: 'diplomatic', expansion: 0.5, military: 0.3, culture: 0.5, science: 0.4, diplomacy: 0.9, espionage: 0.3,
    improvePriority: ['farm','road','fishing_boats','pasture'], settlerThreshold: 2000, patrolRange: 4, warThreshold: -40,
  },
  pirate_queen_elara: {
    archetype: 'cultural', expansion: 0.4, military: 0.2, culture: 0.9, science: 0.8, diplomacy: 0.5, espionage: 0.4,
    improvePriority: ['farm','irrigation','quarry','road'], settlerThreshold: 2500, patrolRange: 3, warThreshold: -45,
  },
  commander_thane: {
    archetype: 'militaristic', expansion: 0.6, military: 0.95, culture: 0.1, science: 0.3, diplomacy: 0.3, espionage: 0.5,
    improvePriority: ['mine','quarry','camp','lumber_mill'], settlerThreshold: 1800, patrolRange: 8, warThreshold: -10,
  },
  rebel_leader_sera: {
    archetype: 'cultural', expansion: 0.3, military: 0.4, culture: 0.7, science: 0.7, diplomacy: 0.6, espionage: 0.3,
    improvePriority: ['farm','irrigation','pasture','road'], settlerThreshold: 2500, patrolRange: 4, warThreshold: -50,
  },
};

export const GOVERNMENTS = {
  chiefdom: { name: 'Chiefdom', desc: 'Basic tribal leadership', bonuses: {}, slots: 0, unlockTech: null },
  despotism: { name: 'Despotism', desc: '+20% Science, +30% military unit production', bonuses: { scienceBonus: 0.2, militaryProdBonus: 0.3 }, slots: 1, unlockTech: 'writing', icon: '\u{1F451}' },
  classical_republic: { name: 'Classical Republic', desc: '+20% Culture, +15% wonder production', bonuses: { cultureBonus: 0.2, wonderProdBonus: 0.15 }, slots: 2, unlockTech: 'philosophy', icon: '\u{1F3DB}' },
  oligarchy: { name: 'Oligarchy', desc: '+20% Food, +30% building production', bonuses: { foodBonus: 0.2, buildingProdBonus: 0.3 }, slots: 1, unlockTech: 'currency', icon: '\u{1F3E6}' },
};

// ============================================
// WONDERS SYSTEM
// ============================================
export const WONDERS = [
  { id: 'hanging_gardens', name: 'Hanging Gardens', cost: 150, desc: '+1 Food on all farms, +10% growth', effect: { foodPerFarm: 1, growthBonus: 0.1 }, requires: 'irrigation_tech', placement: 'river', icon: '\u{1F33F}' },
  { id: 'pyramids', name: 'Pyramids', cost: 120, desc: '+1 Gold and +1 Production on river tiles', effect: { riverGold: 1, riverProd: 1 }, requires: 'masonry', placement: 'desert_or_flat', icon: '\u{1F4D0}' },
  { id: 'great_library', name: 'Great Library', cost: 200, desc: '+4 Science, +1 Science on all science buildings', effect: { science: 4, scienceOnBuildings: 1 }, requires: 'education', placement: 'any', icon: '\u{1F4DA}' },
  { id: 'colossus', name: 'Colossus', cost: 160, desc: '+3 Gold, +3 Resource capacity', effect: { gold: 3 }, requires: 'currency', placement: 'coastal', icon: '\u{1F5FF}' },
  { id: 'oracle', name: 'Oracle', cost: 140, desc: '+2 Culture, +20 Culture per rumour event', effect: { culture: 2, rumourCulture: 20 }, requires: 'mysticism', placement: 'any', icon: '\u{1F52E}' },
  { id: 'great_lighthouse', name: 'Great Lighthouse', cost: 140, desc: '+3 Gold, +1 Sight for all units', effect: { gold: 3, sightBonus: 1 }, requires: 'sailing', placement: 'coastal', icon: '\u{1F6E4}' },
  { id: 'terracotta_army', name: 'Terracotta Army', cost: 180, desc: '+2 Production, free Army unit, +25% combat XP', effect: { production: 2, freeUnit: 'warrior' }, requires: 'iron_working', placement: 'any', icon: '\u{1F5FF}' },
  { id: 'petra', name: 'Petra', cost: 160, desc: '+2 Gold, +1 Prod on desert tiles in territory', effect: { gold: 2, desertProd: 1 }, requires: 'currency', placement: 'desert', icon: '\u{1F3DC}' },
];

export const BARBARIAN_UNITS = {
  barbarian_warrior: { name: 'Barbarian Warrior', combat: 20, icon: '\u{1F9D4}', class: 'melee', desc: 'Basic barbarian raider' },
  horse_raider:      { name: 'Horse Raider',      combat: 28, icon: '\u{1F40E}', class: 'cavalry', desc: 'Fast mounted raider, +3 move', movePoints: 3, special: 'pillage' },
  berserker:         { name: 'Berserker',          combat: 30, icon: '\u{1F4A2}', class: 'melee', desc: '+50% attack but -25% defense', special: 'frenzy' },
  war_drummer:       { name: 'War Drummer',        combat: 10, icon: '\u{1F941}', class: 'support', desc: 'Adjacent allies +5 combat', special: 'inspire' },
  shaman:            { name: 'Shaman',             combat: 8,  icon: '\u{1F9D9}', class: 'support', desc: 'Heals adjacent units 10 HP/turn', special: 'heal_aura' },
};

export const DIR_TO_EDGE = [4, 5, 3, 0, 2, 1];

export const ZOOM_MIN = 0.5, ZOOM_MAX = 1.8, ZOOM_STEP = 0.1;

export const DRAG_THRESHOLD = 8; // pixels before mouse-down becomes a drag

// Civ-style gold purchasing: 1 production = 4 gold
export const GOLD_PER_PRODUCTION = 4;
export function goldCost(prodCost) { return prodCost * GOLD_PER_PRODUCTION; }

// Unit maintenance costs per turn (basic units free, advanced cost gold)
export const UNIT_MAINTENANCE = {
  warrior: 0, scout: 0, slinger: 0, worker: 0, settler: 0,
  archer: 1, spearman: 1, chariot: 2, horseman: 2,
  phalanx: 2, ballista: 2, galley: 1,
};

// Utility function for terrain rendering
export function rgbStr(r, g, b, a) {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a === undefined ? 1 : a})`;
}

export const TERRAIN_PALETTES = {
  // Upgraded palettes inspired by hand-painted hex art — warmer, richer, more varied
  ocean:     { base: [{r:18,g:52,b:88},{r:22,g:62,b:105},{r:28,g:72,b:118},{r:14,g:42,b:75},{r:32,g:80,b:130}] },
  coast:     { base: [{r:48,g:128,b:158},{r:62,g:148,b:172},{r:80,g:165,b:185},{r:120,g:175,b:165},{r:90,g:155,b:140}] },
  grassland: { base: [{r:55,g:138,b:42},{r:70,g:155,b:50},{r:85,g:168,b:58},{r:48,g:122,b:35},{r:62,g:145,b:45}] },
  plains:    { base: [{r:148,g:155,b:72},{r:158,g:165,b:82},{r:168,g:175,b:90},{r:138,g:145,b:62},{r:152,g:160,b:78}] },
  desert:    { base: [{r:215,g:182,b:100},{r:228,g:195,b:115},{r:238,g:205,b:128},{r:200,g:168,b:88},{r:222,g:190,b:108}] },
  tundra:    { base: [{r:155,g:168,b:175},{r:170,g:182,b:188},{r:185,g:196,b:202},{r:142,g:155,b:162},{r:160,g:172,b:180}] },
  snow:      { base: [{r:210,g:218,b:228},{r:220,g:228,b:238},{r:235,g:242,b:248},{r:200,g:210,b:220},{r:225,g:232,b:240}] },
  lake:      { base: [{r:48,g:128,b:158},{r:62,g:148,b:172},{r:80,g:165,b:185},{r:120,g:175,b:165},{r:90,g:155,b:140}] },
};

// Flat base colours matching tile-world-preview.html (used by terrain renderer)
export const BASE_COLORS = {
  ocean:[22,62,95], coast:[35,105,140], lake:[35,92,125],
  grassland:[65,125,50], plains:[125,140,65], desert:[180,155,68],
  tundra:[110,125,110], snow:[195,205,215],
  mountain:[95,95,110], hills:[80,110,65], woods:[35,78,35],
  rainforest:[22,62,22], marsh:[50,78,50], floodplains:[65,95,50],
};

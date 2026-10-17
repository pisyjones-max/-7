import * as THREE from 'three';
import {
  CHARS, CRATE_WEAPONS, DEATH_JOKES, ENEMIES, EVENTS, HURT_QUIPS, KILL_STREAK, BEAR_QUIPS, PLAYER_QUIPS, RANKS,
  UPGRADES, WAVE_SUBS, WEAPONS, pick, todayMutator, continuesFor, NPC_SHOUTS, NPC_BRAVE,
  type CharDef, type EnemyDef, type EnemyKind, type Mutator, type Stats, type UpgradeDef, type WeaponDef,
} from './data';
import { animateBear, animateRig, box, buildBear, buildHuman, flashMat, merge, setFlash, vcMat, warnMat, type Rig } from './models';
import { ARENA, LOCATIONS, buildLocation, resolveCircle, type AABB, type Level, type LocDef, type NpcKind, type Shelter } from './level';
import type { Input } from './input';
import { audio } from './audio';
import { save, commit } from './save';

export interface HudState {
  hp: number; maxHp: number; xp: number; xpNext: number; lvl: number; wave: number; score: number; coins: number;
  locName: string; locNo: number; locTotal: number; wavesPer: number; continues: number; items: Record<ItemKind, number>; itemCd: number; points: number; bombFrac: number; weaponIcon: string; weaponName: string; weaponFrac: number; combo: number; mult: number; left: number;
}
export interface RunResult {
  score: number; wave: number; kills: number; coins: number; lvl: number; title: string; rank: string; joke: string; loc: string; victory: boolean; newBest: boolean; time: number;
}
export interface GameEvents {
  weaponChoice(cards: WeaponDef[]): void;
  continuePrompt(left: number, wave: number): void;
  finish(on: boolean): void;
  hud(s: HudState): void;
  quip(text: string, who: 'p' | 'b' | 'sys'): void;
  banner(title: string, sub: string, kind: 'wave' | 'boss' | 'event' | 'combo' | 'info' | 'fatal'): void;
  float(sx: number, sy: number, text: string, cls: string): void;
  levelUp(cards: UpgradeDef[]): void;
  gameOver(r: RunResult): void;
  bossBar(frac: number | null, name: string): void;
  hurt(): void;
}

type Mode = 'menu' | 'play' | 'choose' | 'paused' | 'dying' | 'over' | 'continue';

interface Enemy {
  def: EnemyDef; rig: Rig; x: number; z: number; vx: number; vz: number; hp: number; maxHp: number; r: number;
  spd: number; dmg: number; flash: number; atkCd: number; t: number; face: number; stun: number; slow: number;
  shootCd: number; side: number; dead: boolean; deadT: number; fvx: number; fvz: number; fy: number; fvy: number;
  tkind: 'player' | 'npc' | 'lure' | 'wander' | 'door'; tnpc: Npc | null; tx: number; tz: number; retarget: number; lureT: number; lureX: number; lureZ: number;
  recoilT: number; aggro: Npc | null; aggroT: number; blockT: number; detourT: number; detourSign: number; wAng: number; netT: number;
  fin: number; finT: number; sawCd: number; lunge: number; lungeCd: number; enraged: boolean; rear: number; rearT: number; rearCd: number;
  bState: 'chase' | 'wind' | 'charge' | 'rest'; bT: number; bCd: number; cx: number; cz: number; sum1: boolean; sum2: boolean; ring: number;
}
type NpcState = 'work' | 'flee' | 'toShelter' | 'hidden' | 'return' | 'fight' | 'follow' | 'down' | 'dead';
interface Npc {
  id: number; rig: Rig; kind: NpcKind; color: number; x: number; z: number; hx: number; hz: number; r: number; hp: number; maxHp: number;
  state: NpcState; fear: number; t: number; face: number; flash: number; downT: number; yellCd: number; throwCd: number; warnT: number;
  stuckT: number; detourT: number; detourSign: number; px: number; pz: number; shelter: Shelter | null; slot: number; stage: number;
  calmT: number; coverT: number; cx: number; cz: number; hasCover: boolean; leaving: Shelter | null; invuln: number; mv: number; throwAnim: number;
}
type ItemKind = 'frag' | 'smoke' | 'decoy' | 'net';
const ITEM_KINDS: ItemKind[] = ['frag', 'smoke', 'decoy', 'net'];
const ITEM_INFO: Record<ItemKind, { icon: string; name: string; quip: string }> = {
  frag: { icon: '💣', name: 'Граната', quip: 'Граната! Всем лечь!' },
  smoke: { icon: '🌫️', name: 'Дымовая', quip: 'Дымовуха! Ничего не видно!' },
  decoy: { icon: '📻', name: 'Приманка', quip: 'Баян на всю катушку!' },
  net: { icon: '🕸️', name: 'Сеть', quip: 'Лови сеть, косолапый!' },
};
const ITEM_CAP = 8, ITEM_MAX = 4;
interface Grenade { kind: ItemKind; x0: number; z0: number; x1: number; z1: number; x: number; z: number; t: number; dur: number; landed: boolean; ttl: number; mesh: THREE.Mesh; bark: number }
interface Smoke { x: number; z: number; r: number; t: number; puff: number }
const NPC_THROW: WeaponDef = { id: 'npcThrow', name: 'Бросок', icon: '🪨', rate: 1, dmg: 6, speed: 11, life: 1.1, pellets: 1, spread: 0, jitter: 0, pierce: 0, knock: 2, size: 0.3, color: 0xcaa070, explode: 0, sfx: 'shoot', quip: '' };
function npcDef(outfit: string, kind: NpcKind): CharDef {
  const base = { name: '', emoji: '', desc: '', cost: 0, skin: 0xe8c09a, hp: 1, speed: 1, rate: 1, dmg: 1, hitR: 0.4 };
  const shirt = { coward: 0x4a4e54, brave: 0x8a2a2a, helper: 0x2a7a4a }[kind];
  if (outfit === 'convict') return { ...base, id: 'npc_convict_' + kind, shirt, pants: 0x34383e, hat: 'kepka', stripes: 'tel' };
  if (outfit === 'soldier') return { ...base, id: 'npc_soldier_' + kind, shirt: kind === 'coward' ? 0x5a6a3a : kind === 'brave' ? 0x6a3a2a : 0x2a5a4a, pants: 0x3a4a2a, hat: 'kepka', stripes: kind === 'brave' ? 'tel' : 'none' };
  if (outfit === 'village') return { ...base, id: 'npc_village_' + kind, shirt: kind === 'coward' ? 0x8a3b9a : kind === 'brave' ? 0xb05a2a : 0x3a6aa0, pants: 0x4a3a2a, hat: kind === 'coward' ? 'platok' : 'ushanka', stripes: 'none' };
  return { ...base, id: 'npc_civil_' + kind, shirt: kind === 'coward' ? 0x7a8a5a : kind === 'brave' ? 0xb05a2a : 0x3a6aa0, pants: 0x3a3a48, hat: kind === 'coward' ? 'panama' : 'kepka', stripes: 'none' };
}
interface Proj { owner: Npc | null; x: number; z: number; vx: number; vz: number; life: number; dmg: number; pierce: number; w: WeaponDef; hit: Enemy[]; crit: boolean; ang: number }
interface EShot { x: number; z: number; vx: number; vz: number; life: number; dmg: number; kind: EnemyKind }
type Killer = EnemyKind | 'saw';
interface Pickup { kind: 'coin' | 'xp' | 'pie' | 'crate' | 'ammo'; x: number; z: number; t: number; val: number }
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; spin: number; color: THREE.Color; grav: number }
interface Puddle { x: number; z: number; r: number; t: number; tick: number; mesh: THREE.Mesh; dmg: number }

const WAVES_PER_LOC = 5;
const MAX_PROJ = 160, MAX_ESHOT = 40, MAX_PICK = 150, MAX_PART = 700, MAX_SHADOW = 80;
const BOMB_CD = 11;
const tmp = { x: 0, z: 0 };
const dummy = new THREE.Object3D();

function lerpAngle(a: number, b: number, t: number): number {
  const d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, max: number): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false;
  return m;
}

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 150);
  private level: Level;
  private locDef: LocDef = LOCATIONS[0];
  mode: Mode = 'menu';
  events!: GameEvents;

  // свет
  private hemi = new THREE.HemisphereLight(0xffffff, 0x8a7a68, 1.25);
  private sun = new THREE.DirectionalLight(0xffffff, 1.3);
  private lamp = new THREE.PointLight(0xffe0a0, 0, 13, 0);

  // инстансы
  private projMesh: THREE.InstancedMesh;
  private eshotMesh: THREE.InstancedMesh;
  private pickMesh: THREE.InstancedMesh;
  private partMesh: THREE.InstancedMesh;
  private shadowMesh: THREE.InstancedMesh;
  private bombMesh: THREE.Mesh;
  private warnLine: THREE.Mesh;
  private ringMesh: THREE.Mesh;
  private puddleGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private puddleMat = new THREE.MeshBasicMaterial({ color: 0xb01428, transparent: true, opacity: 0.72, depthWrite: false });
  private puddles: Puddle[] = [];
  private col = new THREE.Color();

  // состояние мира
  private enemies: Enemy[] = [];
  private projs: Proj[] = [];
  private eshots: EShot[] = [];
  private picks: Pickup[] = [];
  private parts: Particle[] = [];
  private partIdx = 0;
  private menuProps: Rig[] = [];
  private rig!: Rig;
  private charDef: CharDef = CHARS[0];
  private mods: Mutator | null = null;

  private p = {
    x: 0, z: 8.5, kx: 0, kz: 0, r: 0.45, hp: 100, face: 0, invuln: 0, fireCd: 0, weapon: 'spoon', weaponT: 0, fixedWeapon: false,
    bombCd: 3, xp: 0, xpNext: 8, lvl: 1, kills: 0, runCoins: 0, combo: 0, comboT: 0, score: 0, animT: 0, moving: 0, flash: 0,
    lowHpSaid: false, deathTilt: 0, ammo: 0,
  };
  private stats: Stats = this.baseStats();
  private upCount: Record<string, number> = {};
  private pendingLevels = 0;

  // волны
  private wave = 0;
  private waveState: 'break' | 'fight' | 'exit' = 'break';
  private breakT = 2;
  private queue: EnemyKind[] = [];
  private spawnT = 0;
  private spawnGap = 1;
  private event: keyof typeof EVENTS | null = null;
  private runTime = 0;
  private bossRef: Enemy | null = null;
  private killer: Killer = 'cub';
  private finTarget: Enemy | null = null;
  private fin: { e: Enemy; t: number; type: number; started: boolean; done: boolean } | null = null;
  private finKill = false;
  private npcs: Npc[] = [];
  private npcSeq = 1;
  npcLost = 0;
  private items: Record<ItemKind, number> = { frag: 2, smoke: 1, decoy: 1, net: 1 };
  private itemCd = 0;
  private grenades: Grenade[] = [];
  private gPool: THREE.Mesh[] = [];
  private gMats: Record<ItemKind, THREE.MeshLambertMaterial> = {
    frag: new THREE.MeshLambertMaterial({ color: 0x4a6a2a }), smoke: new THREE.MeshLambertMaterial({ color: 0x9a9aa4 }),
    decoy: new THREE.MeshLambertMaterial({ color: 0xb050d0 }), net: new THREE.MeshLambertMaterial({ color: 0xd8c890 }),
  };
  private smokes: Smoke[] = [];
  private netMeshes: { mesh: THREE.Mesh; e: Enemy | null }[] = [];
  private continuesLeft = 0;
  private finished = false;
  private chooseKind: 'upgrade' | 'weapon' = 'upgrade';
  private supplyT = 45;
  private locIndex = 0;
  private exitMarker: THREE.Group = new THREE.Group();
  private victory = false;
  private exitOpen = false;
  private camZ = 0;
  private sawTitle = '';
  private lockT = 0;
  private deathT = 0;
  private result: RunResult | null = null;

  // эффекты
  private time = 0;
  private hitStop = 0;
  private slowT = 0;
  private slowScale = 1;
  private shake = 0;
  private zoomKick = 0;
  private lastQuip = -9;
  private camDist = 40;
  private camYaw = Math.PI;
  camMode: 'top' | 'chase' = save.camMode;
  private tilt = (58 * Math.PI) / 180;
  private menuT = 0;
  private last = 0;
  private pr = Math.min(window.devicePixelRatio || 1, 1.5);
  private perfAcc = 0;
  private perfN = 0;
  private perfDrops = 0;
  private projV = new THREE.Vector3();

  constructor(private canvas: HTMLCanvasElement, private input: Input, renderer?: THREE.WebGLRenderer) {
    this.renderer = renderer ?? new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x1a1020);
    this.scene.background = new THREE.Color(0x1a1020);
    this.sun.position.set(6, 14, 8);
    this.scene.add(this.hemi, this.sun, this.lamp);
    const startLoc = LOCATIONS.find(l => l.id === save.loc) ?? LOCATIONS[0];
    this.locDef = startLoc;
    this.level = buildLocation(startLoc.id, this.scene);
    this.applyLocLight();

    this.projMesh = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_PROJ);
    this.eshotMesh = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_ESHOT);
    this.pickMesh = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAX_PICK);
    this.partMesh = inst(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial(), MAX_PART);
    this.shadowMesh = inst(new THREE.CircleGeometry(0.5, 14).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }), MAX_SHADOW);
    this.scene.add(this.projMesh, this.eshotMesh, this.pickMesh, this.partMesh, this.shadowMesh);

    this.bombMesh = new THREE.Mesh(merge([box(0.6, 0.45, 0.6, 0, 0, 0, 0xc0392b), box(0.66, 0.1, 0.66, 0, 0.28, 0, 0xcccccc), box(0.5, 0.05, 0.14, 0, 0.36, 0, 0x888888)]), vcMat);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);
    this.warnLine = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 1), new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.35, depthWrite: false }));
    this.warnLine.visible = false;
    this.scene.add(this.warnLine);
    this.ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.8, depthWrite: false }));
    this.ringMesh.visible = false;
    this.scene.add(this.ringMesh);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 3.2, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    beacon.position.y = 1.6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.5, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    ring.position.y = 0.07;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.0, 4), new THREE.MeshBasicMaterial({ color: 0xffd24a }));
    arrow.rotation.x = Math.PI; arrow.position.y = 3.6; arrow.name = 'arrow';
    this.exitMarker.add(beacon, ring, arrow);
    this.exitMarker.position.set(0, 0, ARENA.hz - 1.6);
    this.exitMarker.visible = false;
    this.scene.add(this.exitMarker);
    const gGeo = new THREE.BoxGeometry(0.4, 0.45, 0.4);
    for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(gGeo, this.gMats.frag); m.visible = false; this.scene.add(m); this.gPool.push(m); }
    const netGeo = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3);
    const netMat = new THREE.MeshBasicMaterial({ color: 0xe8e0a0, wireframe: true, transparent: true, opacity: 0.8 });
    for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(netGeo, netMat); m.visible = false; this.scene.add(m); this.netMeshes.push({ mesh: m, e: null }); }

    for (let i = 0; i < MAX_PART; i++) this.parts.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.1, spin: 0, color: new THREE.Color(), grav: 18 });
    for (let i = 0; i < 5; i++) {
      const m = new THREE.Mesh(this.puddleGeo, this.puddleMat);
      m.position.y = 0.03; m.visible = false; this.scene.add(m);
      this.puddles.push({ x: 0, z: 0, r: 1, t: 0, tick: 0, mesh: m, dmg: 0 });
    }

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    this.resize();
    this.buildMenuScene();
    this.last = performance.now();
    requestAnimationFrame(this.frame);
  }

  // ---------------------------------------------------------------- сервис
  private baseStats(): Stats {
    return { maxHp: 100, speed: 5.3, dmgMul: 1, rateMul: 1, multi: 1, pierce: 0, magnet: 2.6, crit: 0.06, regen: 0, bombMul: 1, bombCd: 1 };
  }

  /** Применяет режим камеры: сверху (узкий FOV) или от третьего лица (широкий). */
  applyCam(): void {
    const chase = this.camMode === 'chase' && this.mode !== 'menu';
    this.camera.fov = chase ? 70 : 40;
    this.input.chase = chase;
    this.resize();
  }

  setCamMode(m: 'top' | 'chase'): void {
    this.camMode = m; save.camMode = m; commit();
    this.camYaw = this.p.face;
    this.applyCam();
  }

  toggleCam(): 'top' | 'chase' {
    this.setCamMode(this.camMode === 'top' ? 'chase' : 'top');
    return this.camMode;
  }

  /** Вектор движения с учётом камеры: в режиме от 3-го лица «вверх» на джойстике = вперёд по взгляду. */
  private moveVec(out: { x: number; z: number }): void {
    this.input.vector(out);
    if (this.camMode !== 'chase') return;
    const sx = out.x, sz = out.z, s = Math.sin(this.camYaw), c = Math.cos(this.camYaw);
    out.x = s * -sz - c * sx;
    out.z = c * -sz + s * sx;
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const t = Math.tan((this.camera.fov * Math.PI) / 360);
    const widthFit = 13.9 / (2 * t * this.camera.aspect);
    const depthFit = (33 * Math.sin(this.tilt)) / (2 * t);
    this.camDist = Math.max(widthFit, depthFit);
    this.camera.updateProjectionMatrix();
  }

  private say(text: string, who: 'p' | 'b' | 'sys', force = false): void {
    if (!force && this.time - this.lastQuip < 2.4) return;
    this.lastQuip = this.time;
    this.events.quip(text, who);
  }

  private float(x: number, y: number, z: number, text: string, cls: string): void {
    this.projV.set(x, y, z).project(this.camera);
    this.events.float((this.projV.x + 1) / 2 * window.innerWidth, (1 - this.projV.y) / 2 * window.innerHeight, text, cls);
  }

  // ---------------------------------------------------------------- меню
  private buildMenuScene(): void {
    if (this.menuProps.length) return;
    const kinds: EnemyKind[] = ['cub', 'bear', 'fisher', 'tank'];
    kinds.forEach(k => { const r = buildBear(ENEMIES[k]); this.scene.add(r.root); this.menuProps.push(r); });
    this.rig = buildHuman(this.charDef);
    this.scene.add(this.rig.root);
  }

  showMenu(): void {
    this.clearWorld();
    const sel = LOCATIONS.find(l => l.id === save.loc) ?? LOCATIONS[0];
    this.locDef = sel; this.locIndex = LOCATIONS.indexOf(sel); this.victory = false; this.exitMarker.visible = false;
    this.applyLocLight();
    this.rebuildLevel();
    this.mode = 'menu';
    this.applyCam();
    this.input.setEnabled(false);
    audio.setIntense(false);
    this.setBlackout(false);
    this.events.bossBar(null, '');
    this.setMenuChar(save.selected);
    this.menuProps.forEach(r => (r.root.visible = true));
    this.rig.root.visible = true;
  }

  setMenuChar(id: string): void {
    const def = CHARS.find(c => c.id === id) ?? CHARS[0];
    this.scene.remove(this.rig.root);
    this.charDef = def;
    this.rig = buildHuman(def);
    this.scene.add(this.rig.root);
  }

  private updateMenu(dt: number): void {
    this.menuT += dt;
    const t = this.menuT;
    if (this.level.anim) this.level.anim(t);
    this.rig.root.position.set(0, Math.abs(Math.sin(t * 3)) * 0.12, 8.3);
    this.rig.root.rotation.y = Math.sin(t * 0.7) * 0.6;
    animateRig(this.rig, t, 0, true, true);
    const pos = [[-3.1, 6.0], [3.1, 6.4], [-3.2, 10.4], [0.3, 3.4]];
    this.menuProps.forEach((r, i) => {
      r.root.position.set(pos[i][0], Math.abs(Math.sin(t * 5 + i * 1.7)) * 0.35, pos[i][1]);
      r.root.rotation.y = Math.atan2(-pos[i][0], 8.3 - pos[i][1]) + Math.sin(t * 2 + i) * 0.3;
      r.armL.rotation.x = -2.6 + Math.sin(t * 8 + i) * 0.4;
      r.armR.rotation.x = -2.6 - Math.sin(t * 8 + i) * 0.4;
      r.legL.rotation.x = Math.sin(t * 10 + i) * 0.6;
      r.legR.rotation.x = -Math.sin(t * 10 + i) * 0.6;
    });
    this.camera.position.set(Math.sin(t * 0.3) * 1.2, this.camDist * 0.52 * Math.sin(this.tilt) + 1, 8.3 + this.camDist * 0.52 * Math.cos(this.tilt));
    this.camera.lookAt(0, 1.2, 8.2);
    this.updateShadows();
  }

  // ---------------------------------------------------------------- старт забега
  private clearWorld(): void {
    for (const e of this.enemies) this.scene.remove(e.rig.root);
    this.enemies = []; this.projs = []; this.eshots = []; this.picks = [];
    for (const q of this.parts) q.life = 0;
    this.puddles.forEach(p => { p.t = 0; p.mesh.visible = false; });
    this.bombActive = false; this.bombMesh.visible = false; this.warnLine.visible = false; this.ringMesh.visible = false;
    for (const n of this.npcs) this.scene.remove(n.rig.root);
    this.npcs = []; this.grenades = []; this.smokes = [];
    this.gPool.forEach(m => (m.visible = false));
    this.netMeshes.forEach(s => { s.e = null; s.mesh.visible = false; });
    this.bossRef = null; this.finTarget = null; this.fin = null;
    this.events?.finish(false);
    this.projMesh.count = this.eshotMesh.count = this.pickMesh.count = this.partMesh.count = 0;
    this.menuProps.forEach(r => (r.root.visible = false));
  }

  private rebuildLevel(): void {
    this.level.dispose();
    this.level = buildLocation(this.locDef.id, this.scene);
  }

  start(): void {
    this.clearWorld();
    const si = Math.max(0, LOCATIONS.findIndex(l => l.id === save.loc));
    this.locIndex = si; this.locDef = LOCATIONS[si]; this.victory = false; this.exitOpen = false; this.exitMarker.visible = false;
    this.applyLocLight();
    this.rebuildLevel();
    this.spawnNpcs();
    this.items = { frag: 2, smoke: 1, decoy: 1, net: 1 }; this.itemCd = 0;
    this.supplyT = 45; this.camZ = 0;
    this.continuesLeft = continuesFor(save.bestWave); this.finished = false; this.lockT = 0; this.npcLost = 0;
    audio.init();
    const def = CHARS.find(c => c.id === save.selected) ?? CHARS[0];
    this.charDef = def;
    this.scene.remove(this.rig.root);
    this.rig = buildHuman(def);
    this.rig.root.rotation.order = 'YXZ';
    this.scene.add(this.rig.root);
    this.mods = save.mutator ? todayMutator() : null;

    this.stats = this.baseStats();
    this.stats.maxHp = def.hp; this.stats.speed *= def.speed; this.stats.rateMul *= def.rate; this.stats.dmgMul *= def.dmg;
    if (this.mods?.glass) { this.stats.maxHp = Math.round(this.stats.maxHp * 0.6); this.stats.dmgMul *= 1.5; }
    if (this.mods?.extOnly) this.stats.dmgMul *= 1.4;
    this.upCount = {}; this.pendingLevels = 0;
    const p = this.p;
    Object.assign(p, {
      x: 0, z: 10, kx: 0, kz: 0, r: def.hitR, hp: this.stats.maxHp, face: Math.PI, invuln: 1, fireCd: 0.3,
      weapon: this.mods?.extOnly ? 'extinguisher' : 'spoon', weaponT: 0, ammo: 0, fixedWeapon: !!this.mods?.extOnly, bombCd: 3, xp: 0, xpNext: 8, lvl: 1,
      kills: 0, runCoins: 0, combo: 0, comboT: 0, score: 0, animT: 0, moving: 0, flash: 0, lowHpSaid: false, deathTilt: 0,
    });
    this.rig.root.rotation.x = 0;
    this.rig.root.visible = true;
    this.wave = 0; this.waveState = 'break'; this.breakT = 2.2; this.queue = []; this.event = null; this.runTime = 0;
    this.time = 0; this.hitStop = 0; this.slowT = 0; this.shake = 0; this.zoomKick = 0; this.lastQuip = -9; this.result = null;
    this.setBlackout(false);
    this.mode = 'play';
    this.camYaw = Math.PI;
    this.applyCam();
    this.input.setEnabled(true);
    audio.setIntense(false);
    audio.startMusic();
    if (!save.tutorialSeen) {
      this.events.banner('ХОДИ ПАЛЬЦЕМ', 'Стреляешь сам. Справа — БОРЩ-БОМБА!', 'info');
      save.tutorialSeen = true; commit();
    } else {
      this.events.banner(this.locDef.emoji + ' ' + this.locDef.name.toUpperCase(), 'Цель: 5 волн → дальше «' + (LOCATIONS[this.locIndex + 1]?.name ?? 'победа') + '»', 'info');
    }
  }

  pause(): void { if (this.mode === 'play') { this.mode = 'paused'; this.input.setEnabled(false); } }
  resume(): void { if (this.mode === 'paused') { this.mode = 'play'; this.input.setEnabled(true); } }

  // ---------------------------------------------------------------- цикл
  private frame = (now: number): void => {
    requestAnimationFrame(this.frame);
    const real = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (this.mode === 'menu') this.updateMenu(real);
    else if (this.mode === 'play' || this.mode === 'dying') this.update(real);
    this.autoQuality(real);
    this.renderer.render(this.scene, this.camera);
  };

  private autoQuality(dt: number): void {
    if (this.mode !== 'play') return;
    this.perfAcc += dt; this.perfN++;
    if (this.perfN >= 120) {
      if (this.perfAcc / this.perfN > 0.028 && this.pr > 1 && this.perfDrops < 3) { this.pr = Math.max(1, this.pr - 0.25); this.perfDrops++; this.resize(); }
      this.perfAcc = 0; this.perfN = 0;
    }
  }

  private update(real: number): void {
    if (this.hitStop > 0) { this.hitStop -= real; this.updateCamera(real); return; }
    let dt = real;
    if (this.slowT > 0) { this.slowT -= real; dt *= this.slowScale; }
    this.time += dt;
    if (this.mode === 'play') {
      this.runTime += dt;
      this.updateFin(real);
      this.updatePlayer(dt);
      this.updateSpawning(dt);
    } else {
      this.deathT -= real;
      if (!this.victory) this.p.deathTilt = Math.min(1.5, this.p.deathTilt + real * 2.2);
      this.rig.root.rotation.x = -this.p.deathTilt;
      this.rig.root.position.y = Math.min(0.4, this.p.deathTilt * 0.25);
      if (this.deathT <= 0) this.afterDeath();
    }
    this.updateNpcs(dt);
    this.updateShelters(dt);
    this.updateGrenades(dt);
    this.updateSmokes(dt);
    this.updateNets(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyShots(dt);
    this.updateBomb(dt);
    this.updatePuddles(dt);
    this.updateSaws(dt);
    if (this.level.anim) this.level.anim(this.time);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateShadows();
    this.updateCamera(real);
    this.pushHud();
  }

  // ---------------------------------------------------------------- игрок
  private updatePlayer(dt: number): void {
    const p = this.p, s = this.stats;
    if (this.camMode === 'chase') this.camYaw -= this.input.consumeLook() * 0.006;
    this.moveVec(tmp);
    const mag = Math.min(1, Math.hypot(tmp.x, tmp.z));
    p.x += (tmp.x * s.speed + p.kx) * dt;
    p.z += (tmp.z * s.speed + p.kz) * dt;
    p.kx *= Math.max(0, 1 - 10 * dt); p.kz *= Math.max(0, 1 - 10 * dt);
    resolveCircle(p.x, p.z, p.r, this.level.obstacles, tmp);
    p.x = tmp.x; p.z = tmp.z;
    p.moving = mag;
    p.animT += dt * (0.6 + mag * 0.7);

    // автоприцел
    let target: Enemy | null = null, best = 15 * 15;
    let front: Enemy | null = null, bestFront = 15 * 15;
    const chaseView = this.camMode === 'chase';
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d < best) { best = d; target = e; }
      // от 3-го лица сначала целимся в тех, кого видно перед камерой
      if (chaseView && d < bestFront) {
        const diff = Math.abs(lerpAngle(0, Math.atan2(e.x - p.x, e.z - p.z) - this.camYaw, 1));
        if (diff < 1.2) { bestFront = d; front = e; }
      }
    }
    // кто вплотную — тот опаснее всего: бьём его первым, даже если он за спиной у камеры
    let close: Enemy | null = null, bestClose = 99;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - p.x, e.z - p.z) - e.r;
      if (d < 4.5 && d < bestClose) { bestClose = d; close = e; }
    }
    if (front) target = front;
    if (close) target = close;
    let want = p.face;
    if (target) want = Math.atan2(target.x - p.x, target.z - p.z);
    else if (mag > 0.2) { this.moveVec(tmp); want = Math.atan2(tmp.x, tmp.z); }
    p.face = lerpAngle(p.face, want, Math.min(1, dt * 16));

    p.fireCd -= dt;
    if (target && p.fireCd <= 0) {
      const w = WEAPONS[p.weapon];
      this.fire(w, Math.atan2(target.x - p.x, target.z - p.z));
      p.fireCd = w.rate / s.rateMul;
    }
    if (!p.fixedWeapon && p.weapon !== 'spoon' && !WEAPONS[p.weapon].ammo) {
      p.weaponT -= dt;
      if (p.weaponT <= 0) { p.weapon = 'spoon'; this.say('Опять поварёшка... Классика!', 'p', true); }
    }
    if (s.regen > 0 && p.hp < s.maxHp) p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);
    const psh = this.playerShelter();
    if (psh && !psh.open && !psh.broken && p.hp < s.maxHp) p.hp = Math.min(s.maxHp, p.hp + 4 * dt);
    p.invuln -= dt;
    p.comboT -= dt; if (p.comboT <= 0) p.combo = 0;
    p.bombCd -= dt;
    if (this.input.bombPressed) {
      this.input.bombPressed = false;
      if (p.bombCd <= 0 && !this.bombActive) this.throwBomb();
    }
    if (p.flash > 0) { p.flash -= dt; if (p.flash <= 0) setFlash(this.rig, null); }

    this.rig.root.position.set(p.x, 0, p.z);
    this.rig.root.rotation.y = p.face;
    this.rig.root.visible = p.invuln <= 0 || Math.floor(this.time * 20) % 2 === 0;
    animateRig(this.rig, p.animT, mag, true, !!target);
    if (this.fin) this.rig.armR.rotation.x = this.fin.t < 0.55 ? -2.9 : -0.3;
    // фонарь при отключении света
    this.lamp.position.set(p.x, 3, p.z);
  }

  private fire(w: WeaponDef, ang: number): void {
    const p = this.p, s = this.stats;
    const n = w.pellets + (s.multi - 1);
    const total = w.spread > 0 ? w.spread + (s.multi - 1) * 0.1 : n > 1 ? 0.15 * (n - 1) : 0;
    for (let i = 0; i < n && this.projs.length < MAX_PROJ; i++) {
      const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * total : 0) + (Math.random() - 0.5) * w.jitter * 2;
      const crit = Math.random() < s.crit;
      const sp = w.speed * (0.92 + Math.random() * 0.16);
      this.projs.push({
        x: p.x + Math.sin(a) * 0.7, z: p.z + Math.cos(a) * 0.7, vx: Math.sin(a) * sp, vz: Math.cos(a) * sp, life: w.life,
        dmg: w.dmg * s.dmgMul * (crit ? 2.5 : 1), pierce: w.pierce + s.pierce, w, hit: [], crit, ang: a, owner: null,
      });
    }
    if (w.ammo) { p.ammo--; if (p.ammo <= 0) { p.weapon = 'spoon'; this.say('Патроны кончились... Опять поварёшка!', 'p', true); } }
    audio.play(w.sfx);
    // отдача-анимация и вспышка
    this.burst(p.x + Math.sin(ang) * 0.9, 1.2, p.z + Math.cos(ang) * 0.9, 2, [0xffe58a, 0xffffff], 2.5, 1, 0.1, 0.18, 0);
  }

  private hurtPlayer(d: number, kind: Killer, fromX: number, fromZ: number): void {
    const p = this.p;
    if (p.invuln > 0 || this.mode !== 'play') return;
    p.hp -= d; p.invuln = 0.75; p.flash = 0.1; setFlash(this.rig, warnMat);
    const dx = p.x - fromX, dz = p.z - fromZ, l = Math.hypot(dx, dz) || 1;
    p.kx = (dx / l) * 9; p.kz = (dz / l) * 9;
    this.shake = Math.min(1, this.shake + 0.45);
    this.events.hurt();
    audio.play('hurt');
    try { navigator.vibrate?.(35); } catch { /* ignore */ }
    this.burst(p.x, 1.1, p.z, 8, [0xff5040, 0xffd0a0], 4, 3, 0.14, 0.45);
    if (p.hp > 0 && p.hp < this.stats.maxHp * 0.3 && !p.lowHpSaid) { p.lowHpSaid = true; this.say('Нужен пирожок! СРОЧНО!', 'p', true); }
    else if (Math.random() < 0.3) this.say(pick(HURT_QUIPS), 'p');
    if (p.hp <= 0) this.die(kind);
  }

  private die(kind: Killer): void {
    this.mode = 'dying'; this.killer = kind; this.deathT = 1.7;
    this.slowT = 2; this.slowScale = 0.3; this.zoomKick = 1; this.shake = 1;
    this.input.setEnabled(false);
    this.finTarget = null; this.fin = null; this.events.finish(false);
    this.rig.root.visible = true; setFlash(this.rig, null);
    this.events.bossBar(null, '');
    audio.play('die');
    this.say('Передайте тёте Вале… я не доел…', 'p', true);
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    const p = this.p;
    this.mode = 'over';
    const mult = this.mods ? 1.5 : 1;
    const bonus = Math.floor(p.score / 250);
    const coins = Math.round((p.runCoins + bonus) * mult);
    const prevBest = save.best;
    save.coins += coins; save.kills += p.kills; save.runs += 1;
    if (p.score > save.best) save.best = p.score;
    const wave = this.stage();
    save.bestWave = Math.max(save.bestWave, wave);
    commit();
    let rank = RANKS[0][1];
    for (const [w, name] of RANKS) if (wave >= w) rank = name;
    this.result = {
      score: p.score, wave, kills: p.kills, coins, lvl: p.lvl, title: this.victory ? 'ВСЕ ЛОКАЦИИ ЗАЧИЩЕНЫ' : this.killer === 'saw' ? this.sawTitle || 'Распилен на доски. Сам виноват.' : pick(ENEMIES[this.killer].killedBy), loc: this.locDef.name, victory: this.victory, rank, joke: pick(DEATH_JOKES),
      newBest: p.score > prevBest, time: this.runTime,
    };
    audio.setIntense(false);
    this.events.gameOver(this.result);
  }

  // ---------------------------------------------------------------- волны
  private buildQueue(wave: number): EnemyKind[] {
    const boss = wave === WAVES_PER_LOC;
    const st = this.locIndex * WAVES_PER_LOC + wave;
    const n = Math.min(24, 4 + wave * 2 + this.locIndex * 2);
    const wBear = st >= 2 ? Math.min(0.45, 0.1 + st * 0.03) : 0;
    const wFish = st >= 3 ? Math.min(0.22, 0.04 + st * 0.015) : 0;
    const wTank = st >= 5 ? Math.min(0.2, 0.02 + st * 0.012) : 0;
    const q: EnemyKind[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let k: EnemyKind = 'cub';
      if (r < wTank) k = 'tank'; else if (r < wTank + wFish) k = 'fisher'; else if (r < wTank + wFish + wBear) k = 'bear';
      q.push(k);
    }
    if (this.locDef.dogs) for (let i = 0; i < q.length; i++) if (q[i] === 'cub' && Math.random() < 0.7) q[i] = 'dog'; else if (q[i] === 'bear' && Math.random() < 0.15) q[i] = 'dog';
    if (boss) {
      q.length = Math.min(q.length, 3 + wave);
      q.splice(3, 0, this.bossKind());
    }
    return q;
  }

  /** Припасы лежат в дальней комнате: чтобы их взять, надо пройти по коридору. */
  private spawnLoot(w: number): void {
    const spots = this.level.loot;
    if (!spots.length) return;
    if (w === 1) {
      this.addPickup('crate', spots[0].x, spots[0].z, 1);
      this.say('В дальней комнате лежит ящик с оружием — иди по коридору наверх!', 'sys', true);
    }
    const have = this.picks.filter(q => q.kind === 'ammo').length;
    for (let i = have; i < 2; i++) { const s = pick(spots); this.addPickup('ammo', s.x + (Math.random() - 0.5), s.z + (Math.random() - 0.5), Math.floor(Math.random() * 4)); }
  }

  private startWave(): void {
    this.wave++;
    const w = this.wave;
    this.waveState = 'fight';
    for (const n of this.npcs) if (n.state === 'dead') this.reviveNpc(n);
    this.spawnLoot(w);
    if (w >= 2 && w < WAVES_PER_LOC && Math.random() < 0.15 && !this.picks.some(q => q.kind === 'crate')) this.dropCrate(false);
    this.queue = this.buildQueue(w);
    this.spawnGap = Math.max(0.55, 1.35 - this.stage() * 0.035);
    this.spawnT = 0.6;
    this.event = null;
    audio.play('wave');
    const boss = w === WAVES_PER_LOC;
    audio.setIntense(boss || this.stage() >= 8);
    if (boss) {
      const kind = this.bossKind();
      this.events.banner('БОСС: ' + ENEMIES[kind].name.toUpperCase(), kind === 'potap' ? 'Михаил Потапыч пришёл за добавкой!' : 'Он пил воду из Чернобыля. И компот.', 'boss');
      audio.play('roar');
    } else {
      this.events.banner('ВОЛНА ' + w + '/' + WAVES_PER_LOC, pick(WAVE_SUBS), 'wave');
      if (w >= 2 && Math.random() < 0.5) {
        const evs: (keyof typeof EVENTS)[] = ['blackout', 'pirozhki', 'rush'];
        if (this.npcs.some(n => n.state !== 'dead')) evs.push('ambush');
        if (this.level.shelters.length) evs.push('lock');
        const ev = pick(evs);
        this.event = ev;
        setTimeout(() => this.events.banner(EVENTS[ev].title, EVENTS[ev].sub, 'event'), 1400);
        if (ev === 'blackout') this.setBlackout(true);
        if (ev === 'rush') for (let i = 0; i < 6; i++) this.queue.push('cub');
        if (ev === 'ambush') this.ambush();
        if (ev === 'lock') this.lockShelters();
        if (ev === 'pirozhki') for (let i = 0; i < 7; i++) this.addPickup('pie', (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 24, 1);
      }
    }
  }

  private endWave(): void {
    this.waveState = 'break';
    this.breakT = 3.2;
    const p = this.p;
    p.score += 100 * this.stage();
    p.runCoins += 3 + this.stage();
    p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * 0.25);
    const aliveNpc = this.npcs.filter(n => n.state !== 'dead').length;
    if (aliveNpc > 0) { p.runCoins += aliveNpc * 2; p.score += aliveNpc * 25; this.say('Люди благодарят: +' + aliveNpc * 2 + ' монет', 'sys'); }
    this.unlockShelters();
    this.giveItem(pick(ITEM_KINDS));
    this.setBlackout(false);
    this.events.banner('ВОЛНА ' + this.wave + ' ЗАЧИЩЕНА', '+' + 100 * this.stage() + ' очков', 'info');
    audio.setIntense(false);
    if (this.wave >= WAVES_PER_LOC) this.finishLocation();
  }

  private applyLocLight(): void {
    const d = this.locDef;
    this.hemi.color.set(d.sky); this.hemi.groundColor.set(d.ground);
    this.setBlackout(false);
  }

  /** Меняет локацию: пересобирает декор, свет и фон. */
  setLocation(id: string): void {
    const def = LOCATIONS.find(l => l.id === id) ?? LOCATIONS[0];
    if (def.id === this.locDef.id) return;
    this.level.dispose();
    this.locDef = def; this.locIndex = LOCATIONS.indexOf(def);
    this.level = buildLocation(def.id, this.scene);
    save.loc = def.id; commit();
    this.applyLocLight();
  }

  private setBlackout(on: boolean): void {
    const d = this.locDef;
    this.hemi.intensity = on ? 0.32 : d.hemi;
    this.sun.intensity = on ? 0.2 : d.sun;
    this.lamp.intensity = on ? 2.4 : 0;
    (this.scene.background as THREE.Color).set(on ? 0x05030a : d.bg);
    this.renderer.setClearColor(on ? 0x05030a : d.bg);
  }

  private stage(): number { return this.locIndex * WAVES_PER_LOC + Math.max(1, this.wave); }
  private bossKind(): EnemyKind { return this.locIndex % 2 === 0 ? 'potap' : 'mutant'; }

  private aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  private updateSpawning(dt: number): void {
    if (this.waveState === 'exit') { this.updateExit(dt); return; }
    if (this.waveState === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
      return;
    }
    this.supplyT -= dt;
    if (this.supplyT <= 0 && this.aliveCount() >= 9 && !this.picks.some(q => q.kind === 'crate')) { this.dropCrate(true); this.supplyT = 65; }
    this.spawnT -= dt;
    const cap = this.wave === WAVES_PER_LOC ? 9 + Math.min(this.locIndex, 3) : 8 + Math.min(this.locIndex * 2, 6);
    const alive = this.aliveCount();
    if (this.queue.length && alive < cap && this.spawnT <= 0) {
      this.spawnEnemy(this.queue.shift()!);
      this.spawnT = this.event === 'rush' ? 0.4 : this.spawnGap;
    }
    if (!this.queue.length && alive === 0) this.endWave();
  }

  private spawnEnemy(kind: EnemyKind, at?: { x: number; z: number }): Enemy {
    const def = ENEMIES[kind];
    const rig = buildBear(def);
    const w = this.stage(), big = !!this.mods?.bigBears && !def.boss;
    const hp = def.hp * (def.boss ? 1 + this.locIndex * 0.5 : 1 + (w - 1) * 0.1) * (big ? 1.3 : 1);
    const spd = Math.min(def.speed * (def.boss ? 1 : Math.min(1.35, 1 + (w - 1) * 0.02)) * (this.mods?.fastBears ? 1.25 : 1), def.id === 'dog' ? 5.6 : 4.7);
    let sx = at?.x ?? 0, sz = at?.z ?? 0;
    if (!at) {
      const sp = this.level.spawns;
      for (let i = 0; i < 8; i++) {
        const c = sp[Math.floor(Math.random() * sp.length)];
        sx = c.x; sz = c.z;
        if ((sx - this.p.x) ** 2 + (sz - this.p.z) ** 2 > 64) break;
      }
    }
    if (big) rig.root.scale.multiplyScalar(1.25);
    rig.root.position.set(sx, 0, sz);
    this.scene.add(rig.root);
    const e: Enemy = {
      def, rig, x: sx, z: sz, vx: 0, vz: 0, hp, maxHp: hp, r: def.radius * (big ? 1.25 : 1), spd, dmg: def.dmg * (1 + (w - 1) * 0.04),
      flash: 0, atkCd: 0.6, t: Math.random() * 6, face: 0, stun: 0, slow: 0, shootCd: 1 + Math.random() * 1.5, side: Math.random() < 0.5 ? -1 : 1,
      dead: false, deadT: 0, fvx: 0, fvz: 0, fy: 0, fvy: 0, tkind: 'player', tnpc: null, tx: sx, tz: sz, retarget: 0, lureT: 0, lureX: 0, lureZ: 0, recoilT: 0, aggro: null, aggroT: 0, blockT: 0, detourT: 0, detourSign: 1, wAng: Math.random() * 6, netT: 0,
      fin: 0, finT: 0, sawCd: 0, lunge: 0, lungeCd: 1 + Math.random() * 2, enraged: false, rear: 0, rearT: 0, rearCd: 2 + Math.random() * 4, bState: 'chase', bT: 0, bCd: 3, cx: 0, cz: 1, sum1: false, sum2: false, ring: 3,
    };
    this.enemies.push(e);
    this.burst(sx, 0.6, sz, 8, [0xd8d0c0, 0xaaa090], 3, 2, 0.2, 0.5, 8);
    if (def.boss) { this.bossRef = e; this.shake = 0.8; }
    else if (Math.random() < 0.09) this.say(pick(BEAR_QUIPS), 'b');
    return e;
  }

  // ---------------------------------------------------------------- враги
  private updateEnemies(dt: number): void {
    const p = this.p;
    const alive: Enemy[] = [];
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      if (e.dead) {
        e.deadT -= dt;
        e.fvy -= 26 * dt; e.fy += e.fvy * dt;
        e.x += e.fvx * dt; e.z += e.fvz * dt;
        e.rig.root.position.set(e.x, Math.max(0, e.fy), e.z);
        e.rig.root.rotation.x += dt * 14; e.rig.root.rotation.z += dt * 9;
        if (e.deadT <= 0 || e.fy < -0.5) {
          const sc = e.def.size;
          this.burst(e.x, Math.max(0.5, e.fy + 0.8), e.z, e.def.boss ? 60 : 14 + Math.floor(sc * 6), [e.def.fur, e.def.belly, e.def.fur, 0xffffff, 0xffd24a], 6 + sc * 2, 5, 0.18 + sc * 0.08, 0.9);
          audio.play('die');
          this.scene.remove(e.rig.root);
          this.enemies.splice(i, 1);
        }
        continue;
      }
      alive.push(e);
      e.t += dt; e.atkCd -= dt; e.sawCd -= dt;
      if (e.fin === 1) {
        e.finT -= dt; e.stun = Math.max(e.stun, 0.3); e.atkCd = Math.max(e.atkCd, 0.5);
        if (e.flash <= 0) setFlash(e.rig, Math.floor(e.t * 8) % 2 ? warnMat : null);
        if (e.finT <= 0 && !this.fin) { e.fin = 2; setFlash(e.rig, null); if (this.finTarget === e) { this.finTarget = null; this.events.finish(false); } }
      } e.stun -= dt; e.slow = Math.max(0, e.slow - dt);
      if (e.flash > 0) { e.flash -= dt; if (e.flash <= 0) setFlash(e.rig, null); }
      if (e.rearT > 0 && (e.def.boss || e.def.id === 'dog')) e.rearT -= dt;
      let tx = p.x, tz = p.z;
      if (!e.def.boss && e.def.id !== 'fisher') { this.updateTarget(e, dt); tx = e.tx; tz = e.tz; }
      const dx = tx - e.x, dz = tz - e.z, dist = Math.hypot(dx, dz) || 1e-4;
      const nx = dx / dist, nz = dz / dist;
      let mx = nx, mz = nz, speed = e.spd * (e.slow > 0 ? 0.5 : 1);
      if (e.stun > 0) speed = 0;
      let contactMul = 1;
      // ЯРОСТЬ: при низком здоровье медведь звереет
      if (!e.enraged && !e.def.boss && e.hp < e.maxHp * 0.5) {
        e.enraged = true; e.spd = Math.min(e.spd * 1.25, e.def.id === 'dog' ? 5.8 : 4.9); e.dmg *= 1.2;
        this.burst(e.x, 1.6 * e.def.size, e.z, 6, [0xff3020, 0xffa030], 3, 3, 0.14, 0.5);
        if (Math.random() < 0.4) this.say('РРРЫЫЫ! ТЫ МЕНЯ ЗЛИШЬ!', 'b');
      }
      // ВСТАЁТ НА ЗАДНИЕ ЛАПЫ: пугает, потом бросается
      if (!e.def.boss && e.def.id !== 'fisher' && e.def.id !== 'dog' && this.mode === 'play') {
        e.rearCd -= dt;
        if (e.rearT > 0) {
          e.rearT -= dt; speed *= 0.1;
          if (e.rearT <= 0) { e.lunge = 0.5; e.lungeCd = 2.2; }
        } else if (e.rearCd <= 0 && dist < 7 && dist > 2.4 && e.stun <= 0) {
          e.rearT = 0.9; e.rearCd = 5 + Math.random() * 4;
          audio.play('roar');
          if (Math.random() < 0.15) this.say(pick(BEAR_QUIPS), 'b');
          this.shake = Math.min(1, this.shake + 0.1);
        }
      }
      // БРОСОК: близкие медведи прыгают на игрока
      if (!e.def.boss && e.def.id !== 'fisher' && this.mode === 'play') {
        e.lungeCd -= dt;
        if (e.lunge > 0) { e.lunge -= dt; speed *= 2.4; }
        else if (e.lungeCd <= 0 && e.rearT <= 0 && dist < 4.2 && dist > 1.2 && e.stun <= 0) { e.lunge = 0.35; e.lungeCd = 2.5 + Math.random() * 1.5; if (Math.random() < 0.35) audio.play('roar'); }
      }

      if (e.def.id === 'dog') {
        const zz = Math.sin(e.t * 5 + e.side * 3) * 0.7;
        mx = nx - nz * zz; mz = nz + nx * zz;
        e.shootCd -= dt;
        if (e.shootCd <= 0) {
          e.shootCd = 2 + Math.random() * 3;
          audio.play('bark');
          if (Math.random() < 0.5) this.float(e.x, 1.8, e.z, 'ГАВ!', 'dmg');
        }
      } else if (e.def.id === 'fisher') {
        if (dist < 5.5) { mx = -nx; mz = -nz; } else if (dist > 8.5) { mx = nx; mz = nz; } else { mx = -nz * e.side; mz = nx * e.side; }
        e.shootCd -= dt; if (e.rearT > 0) e.rearT -= dt;
        if (e.shootCd <= 0 && dist < 14 && e.stun <= 0 && this.mode === 'play') {
          e.shootCd = 2.3 + Math.random() * 0.8; e.rearT = 0.7;
          this.fireFish(e, Math.atan2(nx, nz), e.dmg * 0.9);
        }
      } else if (e.def.boss) {
        switch (e.bState) {
          case 'chase':
            e.bCd -= dt;
            if (e.def.id === 'mutant') { e.ring -= dt; if (e.ring <= 0 && this.mode === 'play') { e.ring = 3.4; for (let k = 0; k < 10; k++) this.fireFish(e, (k / 10) * Math.PI * 2, e.dmg * 0.4, 5.5); } }
            if (e.bCd <= 0 && dist < 13 && e.stun <= 0) { e.bState = 'wind'; e.bT = 0.9; e.cx = nx; e.cz = nz; audio.play('roar'); this.say(e.def.id === 'potap' ? 'РРРРРРРЫЫЫ!' : 'ГРРРРААААХ!', 'b', true); }
            break;
          case 'wind':
            speed = 0; e.bT -= dt;
            e.cx += (nx - e.cx) * Math.min(1, dt * 3); e.cz += (nz - e.cz) * Math.min(1, dt * 3);
            { const l = Math.hypot(e.cx, e.cz) || 1; e.cx /= l; e.cz /= l; }
            if (e.bT <= 0) { e.bState = 'charge'; e.bT = 0.75; }
            break;
          case 'charge':
            mx = e.cx; mz = e.cz; speed = 13; e.bT -= dt; contactMul = 1.5;
            if (e.bT <= 0) { e.bState = 'rest'; e.bT = 1.0; this.shake = Math.min(1, this.shake + 0.5); }
            break;
          case 'rest':
            speed = 0; e.bT -= dt;
            if (e.bT <= 0) { e.bState = 'chase'; e.bCd = 3 + Math.random() * 1.5; }
            break;
        }
        const f = e.hp / e.maxHp;
        if (!e.sum1 && f < 0.5) { e.sum1 = true; this.summon(e, 3); }
        if (!e.sum2 && f < 0.25) { e.sum2 = true; this.summon(e, 4); }
        // телеграф рывка
        if (e.bState === 'wind') {
          this.warnLine.visible = true;
          const L = 15;
          this.warnLine.scale.set(e.r * 2, 1, L);
          this.warnLine.position.set(e.x + e.cx * L / 2, 0.05, e.z + e.cz * L / 2);
          this.warnLine.rotation.y = Math.atan2(e.cx, e.cz);
          if (e.flash <= 0) setFlash(e.rig, Math.floor(e.t * 12) % 2 ? warnMat : null);
        } else if (this.bossRef === e) { this.warnLine.visible = false; if (e.flash <= 0 && e.bState === 'charge') setFlash(e.rig, null); }
      }

      if (!e.def.boss) {
        if (e.recoilT > 0) { e.recoilT -= dt; mx = -nx; mz = -nz; speed = e.spd * 0.55; }  // ударил — отскочил, дал вздохнуть
        else if (e.tkind === 'player' || e.tkind === 'npc') {
          const tr = e.tkind === 'npc' && e.tnpc ? e.tnpc.r : p.r;
          if (dist < e.r + tr + 0.1) speed *= 0.08;   // уже вплотную — не лезет в центр
        }
      } else if (e.bState !== 'charge' && dist < e.r + p.r + 0.1) speed *= 0.08;
      if (e.detourT > 0) { e.detourT -= dt; const c = Math.cos(e.detourSign * 1.15), s = Math.sin(e.detourSign * 1.15); const a = mx * c - mz * s; mz = mx * s + mz * c; mx = a; }
      const ox = e.x, oz = e.z;
      e.x += (mx * speed + e.vx) * dt; e.z += (mz * speed + e.vz) * dt;
      const kd = Math.max(0, 1 - 9 * dt); e.vx *= kd; e.vz *= kd;
      const hit = resolveCircle(e.x, e.z, e.r, this.level.obstacles, tmp);
      e.x = tmp.x; e.z = tmp.z;
      const intended = speed * dt;
      if (hit && intended > 0.001 && Math.hypot(e.x - ox, e.z - oz) < intended * 0.45) {
        e.blockT += dt;
        if (hit.hp !== undefined) { if (e.blockT > 0.4) this.damageObstacle(hit, e.dmg * dt * 2.4); } // ломает мебель и двери
        else if (e.blockT > 0.5) { e.detourT = 0.8; e.detourSign = Math.random() < 0.5 ? -1 : 1; e.blockT = 0; } // обходит
      } else e.blockT = Math.max(0, e.blockT - dt * 2);
      // мягкое отталкивание от игрока: никакого «слипания»
      if (this.mode === 'play') {
        const sdx = e.x - p.x, sdz = e.z - p.z, sd = Math.hypot(sdx, sdz), minD = (e.r + p.r) * 0.85;
        if (sd < minD) { const ux = sd > 1e-4 ? sdx / sd : 1, uz = sd > 1e-4 ? sdz / sd : 0; e.x = p.x + ux * minD; e.z = p.z + uz * minD; resolveCircle(e.x, e.z, e.r, this.level.obstacles, tmp); e.x = tmp.x; e.z = tmp.z; }
      }
      // нападение на людей
      if (this.mode === 'play' && e.atkCd <= 0) {
        for (const n of this.npcs) {
          if (n.state === 'dead' || n.invuln > 0) continue;
          if (n.state === 'hidden' && !(n.shelter && n.shelter.broken)) continue;
          if (Math.hypot(n.x - e.x, n.z - e.z) < e.r + n.r + 0.12) {
            e.atkCd = 1.1; if (!e.def.boss) e.rearT = Math.max(e.rearT, 0.5);
            this.hitNpc(n, e.dmg * 0.9, e);
            break;
          }
        }
      }

      // удар по игроку
      const pd = Math.hypot(p.x - e.x, p.z - e.z);
      if (pd < e.r + p.r + 0.12 && e.atkCd <= 0 && this.mode === 'play') {
        e.atkCd = 0.9;
        if (!e.def.boss) { e.recoilT = 0.55; const rl = Math.hypot(e.x - p.x, e.z - p.z) || 1; e.vx += ((e.x - p.x) / rl) * 5; e.vz += ((e.z - p.z) / rl) * 5; }
        this.hurtPlayer(e.dmg * contactMul, e.def.id, e.x, e.z);
      }

      const face = speed > 0.1 || e.bState === 'wind' ? Math.atan2(e.bState === 'wind' ? e.cx : mx, e.bState === 'wind' ? e.cz : mz) : Math.atan2(nx, nz);
      e.face = lerpAngle(e.face, face, Math.min(1, dt * 10));
      e.rig.root.position.set(e.x, 0, e.z);
      e.rig.root.rotation.y = e.face;
      const wantRear = e.rearT > 0 || (e.def.boss && e.bState === 'wind') ? 1 : 0;
      e.rear += (wantRear - e.rear) * Math.min(1, dt * 8);
      animateBear(e.rig, e.t * (0.5 + e.spd / 4), speed > 0.1 ? 1 : 0.15, e.rear);
    }
    // расталкивание
    for (let i = 0; i < alive.length; i++) {
      const a = alive[i];
      for (let j = i + 1; j < alive.length; j++) {
        const b = alive[j];
        const dx = b.x - a.x, dz = b.z - a.z, min = (a.r + b.r) * 0.9;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) * 0.5, ux = dx / d, uz = dz / d;
          const wa = b.r / (a.r + b.r), wb = a.r / (a.r + b.r);
          a.x -= ux * push * 2 * wa; a.z -= uz * push * 2 * wa;
          b.x += ux * push * 2 * wb; b.z += uz * push * 2 * wb;
        }
      }
    }
    if (this.bossRef && this.bossRef.dead) { this.bossRef = null; this.warnLine.visible = false; this.events.bossBar(null, ''); }
    else if (this.bossRef) this.events.bossBar(Math.max(0, this.bossRef.hp / this.bossRef.maxHp), this.bossRef.def.name);
  }

  private startFinish(e: Enemy): void {
    e.fin = 1; e.finT = 4; e.stun = 4;
    this.finTarget = e;
    this.events.finish(true);
    this.events.banner('ДОБЕЙ ЕГО!', 'Жми 💀 внизу', 'fatal');
    audio.play('gong'); audio.voice('Добей его');
  }

  /** Кнопка 💀: игрок подскакивает к медведю и делает случайное добивание. */
  doFinisher(): void {
    const e = this.finTarget, p = this.p;
    if (!e || e.dead || this.fin || this.mode !== 'play') return;
    const dx = p.x - e.x, dz = p.z - e.z, l = Math.hypot(dx, dz) || 1;
    resolveCircle(e.x + (dx / l) * (e.r + 1.0), e.z + (dz / l) * (e.r + 1.0), p.r, this.level.obstacles, tmp);
    p.x = tmp.x; p.z = tmp.z; p.face = Math.atan2(e.x - p.x, e.z - p.z); p.invuln = 3; p.kx = p.kz = 0;
    this.fin = { e, t: 0, type: Math.floor(Math.random() * 5), started: false, done: false };
    this.events.finish(false);
  }

  private updateFin(real: number): void {
    const f = this.fin;
    if (!f) return;
    f.t += real;
    if (!f.started) { f.started = true; this.slowT = 2; this.slowScale = 0.22; this.zoomKick = 1; this.hitStop = 0.12; audio.play('gong'); }
    if (!f.done && f.t >= 0.6) { f.done = true; this.strikeFinisher(f.e, f.type); }
    if (f.t >= 1.7) this.fin = null;
  }

  private strikeFinisher(e: Enemy, type: number): void {
    const p = this.p;
    this.finTarget = null;
    if (e.dead) return;
    e.fin = 2; setFlash(e.rig, null);
    const T = [
      { t: 'ФАТАЛИТИ', s: 'Борщ в лицо!' }, { t: 'БРУТАЛИТИ', s: 'Поварёшка-апперкот!' }, { t: 'ФАТАЛИТИ', s: 'Пельмени из медведя!' },
      { t: 'АНИМАЛИТИ', s: 'Медведь стал котлетой!' }, { t: 'ФАТАЛИТИ', s: 'Компот-шторм!' },
    ][type];
    const dx = e.x - p.x, dz = e.z - p.z, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
    p.score += 500; p.runCoins += 8; p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * 0.12);
    this.hitStop = 0.22; this.shake = 1;
    this.events.banner(T.t, T.s, 'fatal');
    audio.play('boom'); audio.voice(T.t);
    this.finKill = true;
    const y = 1.0 * e.def.size;
    switch (type) {
      case 0: // борщ
        this.explode(e.x, e.z, 2.6, 90 * this.stats.dmgMul, 0xd02030, 1.2, true);
        this.burst(e.x, y, e.z, 60, [0xd02030, 0xff5a3a, 0xffe0a0], 11, 8, 0.22, 1.0);
        break;
      case 1: // апперкот
        this.hurtEnemy(e, 99999, ux, uz, 0, true, true);
        e.fvy = 26; e.fvx *= 0.3; e.fvz *= 0.3; e.deadT = 1.15;
        this.burst(e.x, 1, e.z, 20, [0xffffff, 0xffe58a], 8, 6, 0.2, 0.6);
        break;
      case 2: // пельмени
        this.hurtEnemy(e, 99999, ux, uz, 0, true, true);
        e.deadT = 0.02;
        this.burst(e.x, y, e.z, 90, [0xf4e8d0, 0xe0c898, 0xffffff, 0xcaa070], 12, 9, 0.2, 1.1);
        this.float(e.x, 2.8 * e.def.size, e.z, 'ПЕЛЬМЕНИ!', 'crit');
        break;
      case 3: // котлета
        this.hurtEnemy(e, 99999, ux, uz, 0, true, true);
        this.burst(e.x, y, e.z, 40, [0x9a5a30, 0x7a3a1a, 0xc08050], 9, 7, 0.22, 0.9);
        for (let i = 0; i < 2; i++) this.addPickup('pie', e.x + (Math.random() - 0.5) * 1.5, e.z + (Math.random() - 0.5) * 1.5, 1);
        this.float(e.x, 2.8 * e.def.size, e.z, 'КОТЛЕТЫ!', 'heal');
        break;
      default: // компот
        this.hurtEnemy(e, 99999, ux, uz, 0, true, true);
        this.burst(e.x, y, e.z, 80, [0x6fb7d6, 0x3b7ab0, 0xffffff, 0x9ad8f0], 12, 10, 0.2, 1.2);
        this.float(e.x, 2.8 * e.def.size, e.z, 'КОМПОТ!', 'crit');
    }
    this.finKill = false;
  }

  private summon(boss: Enemy, n: number): void {
    this.say('СЮДА, РЕБЯТА! ОНИ ТУТ ЕДЯТ!', 'b', true);
    this.shake = 0.8; audio.play('roar');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy('cub', { x: Math.max(-5.5, Math.min(5.5, boss.x + Math.sin(a) * 2.4)), z: Math.max(ARENA.zMin + 1, Math.min(ARENA.zMax - 1, boss.z + Math.cos(a) * 2.4)) });
    }
  }

  private fireFish(e: Enemy, ang: number, dmg: number, speed = 7.5): void {
    if (this.eshots.length >= MAX_ESHOT) return;
    this.eshots.push({ x: e.x + Math.sin(ang) * e.r, z: e.z + Math.cos(ang) * e.r, vx: Math.sin(ang) * speed, vz: Math.cos(ang) * speed, life: 3, dmg, kind: e.def.id });
    audio.play('fish');
  }

  private hurtEnemy(e: Enemy, dmg: number, dx: number, dz: number, knock: number, crit: boolean, ignoreArmor: boolean): void {
    if (e.dead) return;
    const d = dmg * (ignoreArmor ? 1 : 1 - e.def.armor);
    e.hp -= d;
    // MORTAL KOMBAT: крупный медведь на последнем издыхании ждёт добивания
    if (e.fin === 1) { if (e.hp < 1) e.hp = 1; }
    else if (e.fin === 0 && this.mode === 'play' && !this.finTarget && !this.fin && e.def.id !== 'dog' && e.def.id !== 'cub' && e.hp < e.maxHp * 0.15) {
      if (e.def.boss || Math.random() < 0.55) { e.hp = Math.max(e.hp, 1); this.startFinish(e); } else e.fin = 2;
    }
    e.flash = 0.09; setFlash(e.rig, flashMat);
    const k = (e.def.boss ? 0.12 : 1) * knock / (e.def.size * 0.9 + 0.1);
    e.vx += dx * k; e.vz += dz * k;
    audio.play('hit');
    this.burst(e.x, 0.9 * e.def.size, e.z, crit ? 7 : 3, [e.def.fur, e.def.belly, 0xffe58a], 3.5, 2, 0.12, 0.4);
    if (crit || d >= 14 || Math.random() < 0.2) this.float(e.x, 2.0 * e.def.size, e.z, String(Math.round(d)) + (crit ? '!' : ''), crit ? 'crit' : 'dmg');
    if (e.hp <= 0) this.killEnemy(e, dx, dz, crit);
  }

  private killEnemy(e: Enemy, dx: number, dz: number, crit: boolean): void {
    e.dead = true; e.deadT = e.def.boss ? 0.9 : 0.5;
    if (this.finTarget === e) { this.finTarget = null; this.events.finish(false); }
    const p = this.p;
    setFlash(e.rig, null);
    // летит «в космос»
    const l = Math.hypot(dx, dz) || 1;
    e.fvx = (dx / l) * 7 + (Math.random() - 0.5) * 3; e.fvz = (dz / l) * 7 + (Math.random() - 0.5) * 3;
    e.fvy = e.def.boss ? 9 : 8 + Math.random() * 3; e.fy = 0;
    e.rig.root.rotation.order = 'YXZ';
    p.kills++; p.combo++; p.comboT = 2.6;
    const mult = Math.min(3, 1 + Math.floor(p.combo / 5) * 0.25);
    p.score += Math.round(e.def.score * mult);
    this.dropLoot(e);
    const streak = KILL_STREAK[p.combo];
    if (streak) { this.events.banner(streak, 'КОМБО x' + p.combo, 'combo'); audio.play('levelup'); }
    if (e.def.boss) {
      this.hitStop = 0.28; this.slowT = 1.6; this.slowScale = 0.28; this.zoomKick = 1; this.shake = 1;
      if (!this.finKill) this.events.banner('ФАТАЛИТИ', e.def.name + ' улетел в тайгу', 'boss');
      this.say('Это тебе за компот!', 'p', true);
      audio.play('boom');
      for (let k = 0; k < 6; k++) this.addPickup('coin', e.x + (Math.random() - 0.5) * 3, e.z + (Math.random() - 0.5) * 3, 5);
    } else if (crit) this.hitStop = Math.max(this.hitStop, 0.03);
    if (!e.def.boss && p.kills % 14 === 0) this.say(pick(PLAYER_QUIPS), 'p');
  }

  private dropLoot(e: Enemy): void {
    const def = e.def;
    if (Math.random() < (def.boss ? 1 : def.id === 'cub' ? 0.6 : 1)) {
      const n = Math.min(4, def.coins);
      for (let i = 0; i < n; i++) this.addPickup('coin', e.x + (Math.random() - 0.5) * 1.4, e.z + (Math.random() - 0.5) * 1.4, Math.ceil(def.coins / n));
    }
    const xpN = def.boss ? 8 : 1;
    for (let i = 0; i < xpN; i++) this.addPickup('xp', e.x + (Math.random() - 0.5) * 1.6, e.z + (Math.random() - 0.5) * 1.6, def.xp / xpN);
    const lowBonus = this.p.hp < this.stats.maxHp * 0.4 ? 0.05 : 0;
    if (Math.random() < 0.05 + lowBonus) this.addPickup('pie', e.x, e.z, 1);
    if (def.id !== 'cub' && Math.random() < 0.05) this.addPickup('ammo', e.x, e.z, Math.floor(Math.random() * 4));
    if (def.boss || (!this.mods?.extOnly && !this.p.fixedWeapon && Math.random() < 0.012)) this.addPickup('crate', e.x, e.z, 1);
  }

  // ---------------------------------------------------------------- снаряды
  private updateProjectiles(dt: number): void {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const q = this.projs[i];
      q.x += q.vx * dt; q.z += q.vz * dt; q.life -= dt;
      let remove = q.life <= 0 || Math.abs(q.x) > ARENA.hx || q.z < ARENA.zMin || q.z > ARENA.zMax;
      if (!remove) {
        const rr = q.w.size * 0.5;
        for (const e of this.enemies) {
          if (e.dead || q.hit.includes(e)) continue;
          const dx = e.x - q.x, dz = e.z - q.z, rad = e.r + rr;
          if (dx * dx + dz * dz < rad * rad) {
            q.hit.push(e);
            const l = Math.hypot(q.vx, q.vz) || 1;
            if (q.w.explode > 0) { this.explode(q.x, q.z, q.w.explode, q.dmg, 0xffb030); remove = true; break; }
            if (q.owner) { e.aggro = q.owner; e.aggroT = 3.5; }
            this.hurtEnemy(e, q.dmg, q.vx / l, q.vz / l, q.w.knock, q.crit, false);
            if (q.pierce <= 0) { remove = true; break; }
            q.pierce--;
          }
        }
      }
      if (remove) {
        if (q.w.explode > 0 && q.life <= 0) this.explode(q.x, q.z, q.w.explode, q.dmg, 0xffb030);
        this.projs[i] = this.projs[this.projs.length - 1]; this.projs.pop();
      }
    }
    const m = this.projMesh;
    m.count = this.projs.length;
    for (let i = 0; i < this.projs.length; i++) {
      const q = this.projs[i];
      dummy.position.set(q.x, 1.1, q.z);
      dummy.rotation.set(0, q.ang, 0);
      const s = q.w.size * (q.crit ? 1.5 : 1);
      dummy.scale.set(s, s, s * (q.w.id === 'extinguisher' ? 1 : 1.8));
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, this.col.set(q.crit ? 0xffd24a : q.w.color));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private explode(x: number, z: number, R: number, dmg: number, color: number, stun = 0, ignoreArmor = false, hurtNpcs = false): void {
    this.noise(x, z, R * 3.2);
    if (hurtNpcs) for (const n of this.npcs) { if (n.state !== 'dead' && n.state !== 'hidden' && Math.hypot(n.x - x, n.z - z) < R + n.r) this.hitNpc(n, dmg * 0.35, null); }
    audio.play('boom');
    this.shake = Math.min(1, this.shake + 0.35);
    this.burst(x, 0.8, z, 26, [color, 0xffe58a, 0xff6a30, 0xffffff], 9, 6, 0.22, 0.6);
    this.ringMesh.visible = true; this.ringMesh.position.set(x, 0.1, z); this.ringMesh.scale.setScalar(0.3); this.ringT = 0.35; this.ringR = R;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - x, dz = e.z - z, d = Math.hypot(dx, dz);
      if (d < R + e.r) {
        if (stun) e.stun = Math.max(e.stun, stun);
        const l = d || 1;
        this.hurtEnemy(e, dmg, dx / l, dz / l, 9, false, ignoreArmor);
      }
    }
  }
  private ringT = 0;
  private ringR = 1;

  private updateEnemyShots(dt: number): void {
    const p = this.p;
    for (let i = this.eshots.length - 1; i >= 0; i--) {
      const s = this.eshots[i];
      s.x += s.vx * dt; s.z += s.vz * dt; s.life -= dt;
      let remove = s.life <= 0 || Math.abs(s.x) > ARENA.hx + 0.5 || s.z < ARENA.zMin - 0.5 || s.z > ARENA.zMax + 0.5;
      if (!remove && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (p.r + 0.3) ** 2) {
        this.hurtPlayer(s.dmg, s.kind, s.x - s.vx, s.z - s.vz);
        remove = true;
      }
      if (remove) { this.eshots[i] = this.eshots[this.eshots.length - 1]; this.eshots.pop(); }
    }
    const m = this.eshotMesh;
    m.count = this.eshots.length;
    for (let i = 0; i < this.eshots.length; i++) {
      const s = this.eshots[i];
      dummy.position.set(s.x, 1.0, s.z);
      dummy.rotation.set(0, Math.atan2(s.vx, s.vz), this.time * 12);
      dummy.scale.set(0.22, 0.16, 0.65);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, this.col.set(0x7fb6d9));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  // ---------------------------------------------------------------- борщ-бомба
  private bombActive = false;
  private bomb = { x0: 0, z0: 0, x1: 0, z1: 0, t: 0, dur: 0.55 };

  private throwBomb(): void {
    const p = this.p;
    let tx = p.x + Math.sin(p.face) * 5, tz = p.z + Math.cos(p.face) * 5;
    let best = Infinity, target: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d < best) { best = d; target = e; }
    }
    if (target) { tx = target.x; tz = target.z; }
    tx = Math.max(-ARENA.hx + 0.5, Math.min(ARENA.hx - 0.5, tx)); tz = Math.max(ARENA.zMin + 0.5, Math.min(ARENA.zMax - 0.5, tz));
    this.bomb = { x0: p.x, z0: p.z, x1: tx, z1: tz, t: 0, dur: 0.55 };
    this.bombActive = true; this.bombMesh.visible = true;
    p.bombCd = BOMB_CD * this.stats.bombCd;
    audio.play('click');
    this.say(pick(['БОРЩ-БОМБА!', 'Горячее подано!', 'Налетай, кипяток!', 'Со сметанкой!']), 'p', true);
  }

  private updateBomb(dt: number): void {
    if (this.ringT > 0) {
      this.ringT -= dt;
      const k = 1 - Math.max(0, this.ringT) / 0.35;
      this.ringMesh.scale.setScalar(0.3 + k * this.ringR);
      (this.ringMesh.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
      if (this.ringT <= 0) this.ringMesh.visible = false;
    }
    if (!this.bombActive) return;
    const b = this.bomb;
    b.t += dt;
    const k = Math.min(1, b.t / b.dur);
    this.bombMesh.position.set(b.x0 + (b.x1 - b.x0) * k, 0.8 + Math.sin(k * Math.PI) * 3.4, b.z0 + (b.z1 - b.z0) * k);
    this.bombMesh.rotation.y += dt * 12; this.bombMesh.rotation.z += dt * 6;
    if (k >= 1) {
      this.bombActive = false; this.bombMesh.visible = false;
      const R = 3.3;
      this.explode(b.x1, b.z1, R, 70 * this.stats.bombMul * this.stats.dmgMul, 0xd02030, 1.6, true);
      this.hitStop = Math.max(this.hitStop, 0.07);
      const pd = this.puddles.find(q => q.t <= 0) ?? this.puddles[0];
      pd.x = b.x1; pd.z = b.z1; pd.r = R * 0.95; pd.t = 5.5; pd.tick = 0.5; pd.dmg = 9 * this.stats.bombMul;
      pd.mesh.position.set(b.x1, 0.03, b.z1); pd.mesh.scale.setScalar(pd.r); pd.mesh.visible = true;
      this.float(b.x1, 2.5, b.z1, 'БОРЩ!', 'crit');
    }
  }

  private updateSaws(dt: number): void {
    const p = this.p;
    for (const s of this.level.saws) {
      s.x += s.dir * s.speed * dt;
      if (Math.abs(s.x) > s.range) { s.x = Math.sign(s.x) * s.range; s.dir *= -1; }
      s.mesh.position.x = s.x;
      if (s.spin) s.mesh.rotation.y += dt * 24; else s.mesh.rotation.y = s.dir > 0 ? 0 : Math.PI;
      if (this.mode === 'play' && (s.x - p.x) ** 2 + (s.z - p.z) ** 2 < (s.r + p.r * 0.8) ** 2) { this.sawTitle = s.title; this.hurtPlayer(s.dmg, 'saw', s.x, s.z); }
      for (const e of this.enemies) {
        if (e.dead || e.sawCd > 0) continue;
        if ((s.x - e.x) ** 2 + (s.z - e.z) ** 2 < (s.r + e.r * 0.7) ** 2) { e.sawCd = 0.45; this.hurtEnemy(e, s.dmgEnemy, s.dir, 0, 3, false, true); }
      }
    }
  }

  private updatePuddles(dt: number): void {
    for (const q of this.puddles) {
      if (q.t <= 0) continue;
      q.t -= dt;
      if (q.t <= 0) { q.mesh.visible = false; continue; }
      q.mesh.scale.setScalar(q.r * (q.t < 1 ? q.t : 1));
      q.tick -= dt;
      const tick = q.tick <= 0;
      if (tick) q.tick = 0.5;
      for (const e of this.enemies) {
        if (e.dead) continue;
        if ((e.x - q.x) ** 2 + (e.z - q.z) ** 2 < (q.r + e.r * 0.5) ** 2) {
          e.slow = 0.3;
          if (tick) this.hurtEnemy(e, q.dmg, 0, 0, 0, false, true);
        }
      }
    }
  }

  // ---------------------------------------------------------------- лут
  private addPickup(kind: Pickup['kind'], x: number, z: number, val: number): void {
    if (this.picks.length >= MAX_PICK) {
      const idx = this.picks.findIndex(q => q.kind === 'coin' || q.kind === 'xp');
      if (idx >= 0) this.picks.splice(idx, 1); else return;
    }
    this.picks.push({ kind, x: Math.max(-5.8, Math.min(5.8, x)), z: Math.max(ARENA.zMin + 0.5, Math.min(ARENA.zMax - 0.5, z)), t: Math.random() * 6, val });
  }

  private updatePickups(dt: number): void {
    const p = this.p, s = this.stats;
    const m = this.pickMesh;
    for (let i = this.picks.length - 1; i >= 0; i--) {
      const q = this.picks[i];
      q.t += dt;
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
      const mag = q.kind === 'coin' || q.kind === 'xp' ? s.magnet : 0.8;
      if (this.mode === 'play' && d < mag + 0.1) {
        const sp = (q.kind === 'coin' || q.kind === 'xp' ? 11 : 4) * dt;
        q.x += (dx / (d || 1)) * Math.min(sp, d); q.z += (dz / (d || 1)) * Math.min(sp, d);
      }
      if (this.mode === 'play' && d < p.r + 0.55) {
        this.collect(q);
        this.picks[i] = this.picks[this.picks.length - 1]; this.picks.pop();
      }
    }
    m.count = this.picks.length;
    for (let i = 0; i < this.picks.length; i++) {
      const q = this.picks[i];
      const bob = Math.sin(q.t * 4) * 0.08;
      let size = 0.26, col = 0xffd24a, y = 0.55;
      if (q.kind === 'xp') { size = 0.2; col = 0x58e07a; y = 0.5; }
      else if (q.kind === 'pie') { size = 0.4; col = 0xd9903a; y = 0.6; }
      else if (q.kind === 'crate') { size = 0.62; col = 0xe04030; y = 0.75; }
      else if (q.kind === 'ammo') { size = 0.4; col = 0x6a9a3a; y = 0.6; }
      dummy.position.set(q.x, y + bob, q.z);
      dummy.rotation.set(q.kind === 'pie' ? 0.3 : 0, q.t * 2.5, 0);
      dummy.scale.set(size, q.kind === 'coin' ? size * 0.35 : size, size);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
      m.setColorAt(i, this.col.set(col));
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private collect(q: Pickup): void {
    const p = this.p;
    switch (q.kind) {
      case 'coin': p.runCoins += q.val; audio.play('coin'); break;
      case 'xp': this.addXp(q.val); break;
      case 'pie': {
        const h = Math.round(this.stats.maxHp * 0.25);
        p.hp = Math.min(this.stats.maxHp, p.hp + h);
        audio.play('pickup'); this.float(p.x, 2.2, p.z, '+' + h + ' ПИРОЖОК', 'heal');
        this.say(pick(['Пирожок с капустой!', 'С картошкой! Моё любимое!', 'Бабушка пекла!']), 'p');
        break;
      }
      case 'ammo': this.giveItem(ITEM_KINDS[Math.max(0, Math.min(3, Math.round(q.val)))]); break;
      case 'crate': {
        if (p.fixedWeapon) { p.runCoins += 15; break; }
        const pool = CRATE_WEAPONS.filter(w => w !== p.weapon);
        const cards: WeaponDef[] = [];
        while (cards.length < 3 && pool.length) cards.push(WEAPONS[pool.splice(Math.floor(Math.random() * pool.length), 1)[0]]);
        this.mode = 'choose'; this.chooseKind = 'weapon';
        this.input.setEnabled(false);
        audio.play('pickup');
        this.events.weaponChoice(cards);
        break;
      }
    }
  }

  private addXp(v: number): void {
    const p = this.p;
    p.xp += v;
    while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.lvl++; p.xpNext = Math.floor(p.xpNext * 1.25 + 3); this.pendingLevels++; audio.play('levelup'); this.say('Новый уровень! Жми ⭐ справа', 'sys', true); this.float(p.x, 2.6, p.z, '⭐ УРОВЕНЬ!', 'heal'); }
  }

  /** Кнопка ⭐: открыть выбор усиления, когда удобно. */
  openUpgrades(): void {
    if (this.mode === 'play' && this.pendingLevels > 0) this.openChoose();
  }

  cancelChoose(): void {
    if (this.mode !== 'choose' || this.chooseKind !== 'upgrade') return;
    this.mode = 'play';
    this.input.setEnabled(true);
  }

  private openChoose(): void {
    const pool = UPGRADES.filter(u => (this.upCount[u.id] || 0) < u.max);
    if (!pool.length) { this.pendingLevels = 0; this.p.hp = this.stats.maxHp; return; }
    const cards: UpgradeDef[] = [];
    while (cards.length < 4 && pool.length) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this.mode = 'choose'; this.chooseKind = 'upgrade';
    this.input.setEnabled(false);
    audio.play('levelup');
    this.events.levelUp(cards);
  }

  /** Выбор оружия из ящика. Ящик — это базуки, пулемёт Максим и прочая тяжёлая артиллерия. */
  pickWeapon(id: string): void {
    if (this.mode !== 'choose' || this.chooseKind !== 'weapon') return;
    const w = WEAPONS[id]; if (!w) return;
    const p = this.p;
    p.weapon = id; p.ammo = w.ammo ?? 0; p.weaponT = w.ammo ? 0 : 18; p.fireCd = 0.15;
    this.mode = 'play'; this.input.setEnabled(true);
    audio.play('levelup');
    this.events.banner(w.icon + ' ' + w.name.toUpperCase(), w.desc ?? '18 секунд мощи!', 'event');
    this.say(w.quip, 'p', true);
  }

  /** Ящик с оружием: сбрасывают в разгар мясорубки или можно нечаянно наткнуться. */
  private dropCrate(near: boolean): void {
    const p = this.p;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, d = 3 + Math.random() * 3;
      const x = near ? p.x + Math.cos(a) * d : (Math.random() - 0.5) * 10, z = near ? p.z + Math.sin(a) * d : ARENA.zMin + 1.5 + Math.random() * (ARENA.zMax - ARENA.zMin - 3);
      resolveCircle(x, z, 0.7, this.level.obstacles, tmp);
      if (Math.hypot(tmp.x - x, tmp.z - z) > 0.05 || Math.abs(x) > ARENA.hx - 0.8 || z < ARENA.zMin + 0.8 || z > ARENA.zMax - 0.8) continue;
      this.addPickup('crate', x, z, 1);
      if (near) { this.events.banner('СБРОСИЛИ ЯЩИК!', 'Хватай оружие: базука, Максим…', 'event'); this.say('Подмога! Ящик с оружием!', 'sys', true); audio.play('wave'); }
      else this.say('Где-то на карте лежит ящик с оружием!', 'sys');
      return;
    }
  }

  pickUpgrade(id: string): void {
    if (this.mode !== 'choose' || this.chooseKind !== 'upgrade') return;
    const u = UPGRADES.find(x => x.id === id);
    if (u) {
      u.apply(this.stats);
      this.upCount[id] = (this.upCount[id] || 0) + 1;
      if (id === 'hp') this.p.hp = Math.min(this.stats.maxHp, this.p.hp + 35);
    }
    this.pendingLevels = Math.max(0, this.pendingLevels - 1);
    this.mode = 'play';
    this.input.setEnabled(true);
  }

  // ================================================================ ЛЮДИ (зэки и прочие NPC)
  private spawnNpcs(): void {
    for (const sp of this.level.npcs) this.npcs.push(this.makeNpc(sp.x, sp.z, sp.kind));
  }

  private makeNpc(x: number, z: number, kind: NpcKind): Npc {
    const def = npcDef(this.level.outfit, kind);
    const rig = buildHuman(def);
    rig.root.rotation.order = 'YXZ';
    rig.root.position.set(x, 0, z);
    this.scene.add(rig.root);
    const hp = kind === 'helper' ? 60 : kind === 'brave' ? 50 : 30;
    return {
      id: this.npcSeq++, rig, kind, color: def.shirt, x, z, hx: x, hz: z, r: 0.4, hp, maxHp: hp, state: kind === 'helper' ? 'follow' : 'work',
      fear: 0, t: Math.random() * 6, face: Math.random() * 6, flash: 0, downT: 0, yellCd: 0, throwCd: 1, warnT: 0, stuckT: 0, detourT: 0, detourSign: 1,
      px: x, pz: z, shelter: null, slot: 0, stage: 0, calmT: 0, coverT: 0, cx: x, cz: z, hasCover: false, leaving: null, invuln: 0, mv: 0, throwAnim: 0,
    };
  }

  private reviveNpc(n: Npc): void {
    n.state = n.kind === 'helper' ? 'follow' : 'work';
    n.hp = n.maxHp; n.x = n.hx; n.z = n.hz; n.px = n.x; n.pz = n.z; n.fear = 0; n.warnT = 0; n.shelter = null; n.leaving = null; n.hasCover = false; n.invuln = 1;
    n.rig.root.rotation.x = 0; setFlash(n.rig, null);
    n.rig.root.position.set(n.x, 0, n.z);
    this.scene.add(n.rig.root);
    this.burst(n.x, 1, n.z, 10, [0xd8d0c0, 0xaaa090], 3, 2, 0.2, 0.5, 8);
  }

  private shout(n: Npc, text: string): void {
    if (n.yellCd > 0) return;
    n.yellCd = 2.6;
    this.float(n.x, 2.3, n.z, text, 'dmg');
  }

  /** Один заметил медведя — предупредил соседей: паника расходится по цепочке. */
  private alertNpcs(from: Npc): void {
    for (const o of this.npcs) {
      if (o === from || o.state === 'dead' || o.state === 'hidden' || o.state === 'down') continue;
      if (Math.hypot(o.x - from.x, o.z - from.z) < 8) { o.warnT = Math.max(o.warnT, 5); o.fear = Math.max(o.fear, 0.6); }
    }
  }

  private updateNpcs(dt: number): void {
    const p = this.p;
    for (const n of this.npcs) {
      if (n.state === 'dead') continue;
      n.t += dt; n.yellCd -= dt; n.throwCd -= dt; n.warnT = Math.max(0, n.warnT - dt); n.invuln -= dt; n.mv = 0;
      n.throwAnim = Math.max(0, n.throwAnim - dt);
      if (n.flash > 0) { n.flash -= dt; if (n.flash <= 0) setFlash(n.rig, null); }
      let thr: Enemy | null = null, td = 99;
      for (const e of this.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.x - n.x, e.z - n.z) - e.r;
        if (d < td) { td = d; thr = e; }
      }
      const seeR = n.kind === 'coward' ? 10 : 8;
      const tf = thr && td < seeR ? Math.min(1, ((seeR - td) / seeR) * 1.2) : 0;
      const want = Math.max(tf, n.warnT > 0 ? 0.6 : 0);
      n.fear += (want - n.fear) * Math.min(1, dt * (want > n.fear ? 6 : 1));

      if (n.state === 'down') {
        n.downT -= dt;
        if (Math.hypot(p.x - n.x, p.z - n.z) < 1.6 && n.downT > 0.05) this.rescueNpc(n);
        else if (n.downT <= 0) { n.state = 'flee'; n.hasCover = false; n.fear = 1; }
      } else if (n.state === 'hidden') this.npcHidden(n, dt);
      else if (n.kind === 'helper') this.npcHelper(n, thr, td, dt);
      else if (n.kind === 'brave' && n.hp > n.maxHp * 0.4) this.npcBrave(n, thr, td, dt);
      else this.npcCoward(n, thr, td, dt);

      // позиция и анимация
      const down = n.state === 'down';
      const tilt = down ? -1.45 : 0;
      n.rig.root.rotation.x += (tilt - n.rig.root.rotation.x) * Math.min(1, dt * 14);
      n.rig.root.position.set(n.x, down ? 0.15 : 0, n.z);
      n.rig.root.rotation.y = n.face;
      animateRig(n.rig, n.t, n.mv, true, false);
      const panic = n.state === 'flee' || n.state === 'toShelter' || n.state === 'hidden' || n.fear > 0.55;
      if (n.throwAnim > 0) n.rig.armR.rotation.x = -2.4 + (0.3 - n.throwAnim) * 6;
      else if (panic && !down) { n.rig.armL.rotation.x = -2.6 + Math.sin(n.t * 16) * 0.35; n.rig.armR.rotation.x = -2.6 - Math.sin(n.t * 16) * 0.35; }
      else if (this.level.outfit === 'convict' && n.state === 'work') {
        n.rig.armR.rotation.x = -1.6 + Math.sin(n.t * 6 + n.id) * 0.9; n.rig.armL.rotation.x = -1.4 + Math.sin(n.t * 6 + n.id + 0.3) * 0.7;
      }
    }
    // толкотня в проходах
    for (let i = 0; i < this.npcs.length; i++) {
      const a = this.npcs[i];
      if (a.state === 'dead' || a.state === 'hidden') continue;
      const pdx = a.x - p.x, pdz = a.z - p.z, pd = Math.hypot(pdx, pdz);
      if (pd < a.r + p.r && pd > 1e-4) { const k = (a.r + p.r - pd); a.x += (pdx / pd) * k; a.z += (pdz / pd) * k; }
      for (let j = i + 1; j < this.npcs.length; j++) {
        const b = this.npcs[j];
        if (b.state === 'dead' || b.state === 'hidden') continue;
        const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
        if (d < min && d > 1e-4) { const k = (min - d) / 2; a.x -= (dx / d) * k; a.z -= (dz / d) * k; b.x += (dx / d) * k; b.z += (dz / d) * k; }
      }
      resolveCircle(a.x, a.z, a.r, this.level.obstacles, tmp); a.x = tmp.x; a.z = tmp.z;
    }
  }

  /** Движение с обходом: если упёрся — берёт обход, а не стоит. */
  private moveNpc(n: Npc, dx: number, dz: number, speed: number, dt: number): void {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    let mx = dx / l, mz = dz / l;
    if (n.detourT > 0) { n.detourT -= dt; const c = Math.cos(n.detourSign * 1.2), s = Math.sin(n.detourSign * 1.2); const a = mx * c - mz * s; mz = mx * s + mz * c; mx = a; }
    if (n.fear > 0.5) { // чем сильнее страх, тем непредсказуемее
      const j = (n.fear - 0.4) * 0.8;
      mx += Math.cos(n.t * 7 + n.id) * j; mz += Math.sin(n.t * 9 + n.id * 2) * j;
      const m = Math.hypot(mx, mz) || 1; mx /= m; mz /= m;
    }
    n.x += mx * speed * dt; n.z += mz * speed * dt;
    resolveCircle(n.x, n.z, n.r, this.level.obstacles, tmp);
    n.x = tmp.x; n.z = tmp.z;
    n.face = lerpAngle(n.face, Math.atan2(mx, mz), Math.min(1, dt * 12));
    n.mv = 1;
    const moved = Math.hypot(n.x - n.px, n.z - n.pz);
    if (moved < speed * dt * 0.25) {
      n.stuckT += dt;
      if (n.stuckT > 0.3) { n.detourT = 0.8; n.detourSign = Math.random() < 0.5 ? -1 : 1; n.stuckT = 0; }
    } else n.stuckT = Math.max(0, n.stuckT - dt);
    n.px = n.x; n.pz = n.z;
  }

  private npcHome(n: Npc, dt: number): void {
    if (n.leaving) {
      const sh = n.leaving, front = (n.z - sh.z) * sh.fz;
      const inside = Math.abs(n.x - sh.x) < 1.5 && front < 1.2 && front > -1.4;
      if (!inside) n.leaving = null;
      else {
        const t = front < 0.7 ? sh.inPt : sh.outPt;
        this.moveNpc(n, t.x - n.x, t.z - n.z, 3.4, dt);
        return;
      }
    }
    const d = Math.hypot(n.hx - n.x, n.hz - n.z);
    if (d > 0.5) { if (n.state !== 'fight' && n.state !== 'follow') n.state = 'return'; this.moveNpc(n, n.hx - n.x, n.hz - n.z, 3.4, dt); }
    else if (n.state === 'return') n.state = 'work';
  }

  private npcCoward(n: Npc, thr: Enemy | null, td: number, dt: number): void {
    const scared = n.fear > 0.12;
    if (n.state === 'fight' || n.state === 'follow') n.state = scared ? 'flee' : 'return';
    if (n.state === 'work' || n.state === 'return') {
      if (scared) this.beginFlee(n);
      else this.npcHome(n, dt);
      return;
    }
    if (n.state === 'flee') {
      if (!scared) { n.calmT += dt; if (n.calmT > 3) { n.state = 'return'; n.calmT = 0; n.hasCover = false; } } else n.calmT = 0;
      this.npcRun(n, thr, td, dt);
    } else if (n.state === 'toShelter') this.npcToShelter(n, thr, dt);
  }

  private beginFlee(n: Npc): void {
    this.shout(n, pick(NPC_SHOUTS));
    this.alertNpcs(n);
    n.calmT = 0; n.hasCover = false;
    const sh = this.pickShelter(n);
    if (sh) n.state = 'toShelter'; else n.state = 'flee';
  }

  private npcRun(n: Npc, thr: Enemy | null, td: number, dt: number): void {
    const speed = (n.kind === 'coward' ? 4.7 : 4.3) * (1 + n.fear * 0.35);
    n.coverT -= dt;
    if (thr && td < 2.6) { // вплотную — только бежать прочь
      this.moveNpc(n, ...this.awayFrom(n, thr), speed, dt);
      n.hasCover = false;
      return;
    }
    if (thr && (!n.hasCover || n.coverT <= 0)) {
      const c = this.findCover(n, thr);
      n.hasCover = !!c; if (c) { n.cx = c.x; n.cz = c.z; }
      n.coverT = 0.8;
    }
    if (n.hasCover) {
      const d = Math.hypot(n.cx - n.x, n.cz - n.z);
      if (d > 0.5) this.moveNpc(n, n.cx - n.x, n.cz - n.z, speed, dt);
    } else if (thr) this.moveNpc(n, ...this.awayFrom(n, thr), speed, dt);
  }

  private awayFrom(n: Npc, thr: Enemy): [number, number] {
    let ax = n.x - thr.x, az = n.z - thr.z;
    const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
    if (Math.abs(n.x) > ARENA.hx - 1.6) ax -= Math.sign(n.x) * 1.2;
    if (n.z < ARENA.zMin + 1.6) az += 1.2; else if (n.z > ARENA.zMax - 1.6) az -= 1.2;
    return [ax, az];
  }

  /** Ищет точку за препятствием, чтобы оно оказалось между человеком и медведем. */
  private findCover(n: Npc, thr: Enemy): { x: number; z: number } | null {
    let best: { x: number; z: number } | null = null, bd = 1e9;
    for (const a of this.level.obstacles) {
      if (a.off) continue;
      const hw = (a.maxX - a.minX) / 2, hd = (a.maxZ - a.minZ) / 2;
      if (hw < 0.45 && hd < 0.45) continue;
      const cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2;
      let dx = cx - thr.x, dz = cz - thr.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      const k = Math.max(hw, hd) + 0.9;
      const x = cx + dx * k, z = cz + dz * k;
      if (Math.abs(x) > ARENA.hx - 0.6 || z < ARENA.zMin + 0.6 || z > ARENA.zMax - 0.6) continue;
      resolveCircle(x, z, n.r, this.level.obstacles, tmp);
      if (Math.hypot(tmp.x - x, tmp.z - z) > 0.05) continue;
      const d = Math.hypot(x - n.x, z - n.z);
      if (d > 12 || Math.hypot(x - thr.x, z - thr.z) < d * 0.6) continue;
      if (d < bd) { bd = d; best = { x, z }; }
    }
    return best;
  }

  private pickShelter(n: Npc): Shelter | null {
    let best: Shelter | null = null, bd = 1e9, bi = 0;
    for (const sh of this.level.shelters) {
      if (sh.locked || sh.broken) continue;
      const i = sh.slots.findIndex(s => s.occ === 0);
      if (i < 0) continue;
      const d = Math.hypot(sh.outPt.x - n.x, sh.outPt.z - n.z);
      if (d > 16) continue;
      let blocked = false;
      for (const e of this.enemies) if (!e.dead && Math.hypot(e.x - sh.outPt.x, e.z - sh.outPt.z) < d * 0.6) { blocked = true; break; }
      if (blocked) continue;
      if (d < bd) { bd = d; best = sh; bi = i; }
    }
    if (!best) return null;
    best.slots[bi].occ = n.id; best.pending++;
    n.shelter = best; n.slot = bi; n.stage = 0;
    return best;
  }

  private releaseNpc(n: Npc): void {
    const sh = n.shelter;
    if (!sh) return;
    if (n.state === 'toShelter') sh.pending = Math.max(0, sh.pending - 1);
    const s = sh.slots[n.slot];
    if (s && s.occ === n.id) s.occ = 0;
    n.shelter = null;
  }

  private npcToShelter(n: Npc, thr: Enemy | null, dt: number): void {
    const sh = n.shelter;
    if (!sh || sh.broken || sh.locked) { this.releaseNpc(n); n.state = 'flee'; n.hasCover = false; return; }
    const speed = 5.0 * (1 + n.fear * 0.3);
    if (n.stage === 0) {
      if (thr && Math.hypot(thr.x - sh.outPt.x, thr.z - sh.outPt.z) < 1.6) { this.releaseNpc(n); n.state = 'flee'; n.hasCover = false; return; } // у двери уже медведь
      if (Math.hypot(sh.outPt.x - n.x, sh.outPt.z - n.z) < 0.6) n.stage = 1;
      else this.moveNpc(n, sh.outPt.x - n.x, sh.outPt.z - n.z, speed, dt);
    } else if (n.stage === 1) {
      if (Math.hypot(sh.inPt.x - n.x, sh.inPt.z - n.z) < 0.55) n.stage = 2;
      else this.moveNpc(n, sh.inPt.x - n.x, sh.inPt.z - n.z, speed, dt);
    } else {
      const s = sh.slots[n.slot];
      if (Math.hypot(s.x - n.x, s.z - n.z) < 0.3) {
        sh.pending = Math.max(0, sh.pending - 1);
        n.state = 'hidden'; n.calmT = 0; n.x = s.x; n.z = s.z;
        this.say('Закрылись! Пусть ломятся!', 'sys');
      } else this.moveNpc(n, s.x - n.x, s.z - n.z, speed, dt);
    }
  }

  private npcHidden(n: Npc, dt: number): void {
    const sh = n.shelter;
    if (!sh || sh.broken) { this.releaseNpc(n); n.state = 'flee'; n.hasCover = false; n.fear = 1; return; }
    const s = sh.slots[n.slot];
    n.x = s.x; n.z = s.z; n.face = Math.atan2(0, -sh.fz);
    let near = 99;
    for (const e of this.enemies) if (!e.dead) near = Math.min(near, Math.hypot(e.x - sh.x, e.z - sh.z));
    if (near < 11) n.calmT = 0; else n.calmT += dt;
    if (n.calmT > 2.5 && !sh.locked) { s.occ = 0; n.leaving = sh; n.shelter = null; n.state = 'return'; n.calmT = 0; }
  }

  private npcBrave(n: Npc, thr: Enemy | null, td: number, dt: number): void {
    if (!thr || td > 9) {
      if (n.state !== 'work') n.state = 'return';
      this.npcHome(n, dt);
      return;
    }
    n.state = 'fight';
    if (n.yellCd <= 0) { this.shout(n, pick(NPC_BRAVE)); this.alertNpcs(n); }
    const dx = thr.x - n.x, dz = thr.z - n.z;
    if (td < 3.6) this.moveNpc(n, -dx, -dz, 4.6, dt);
    else if (td > 7) this.moveNpc(n, dx, dz, 3.6, dt);
    else this.moveNpc(n, -dz, dx, 2.4, dt);
    n.face = lerpAngle(n.face, Math.atan2(dx, dz), Math.min(1, dt * 10));
    if (n.throwCd <= 0) { this.npcThrow(n, thr, 6); n.throwCd = 1.5 + Math.random() * 0.5; }
  }

  private npcHelper(n: Npc, thr: Enemy | null, td: number, dt: number): void {
    const p = this.p;
    n.state = 'follow';
    const pdx = p.x - n.x, pdz = p.z - n.z, pd = Math.hypot(pdx, pdz);
    if (thr && td < 2.8) this.moveNpc(n, ...this.awayFrom(n, thr), 4.8, dt);
    else if (pd > 4.5) this.moveNpc(n, pdx, pdz, 4.6, dt);
    else if (pd < 2.0) this.moveNpc(n, -pdx, -pdz, 2.5, dt);
    if (thr && td < 10 && n.throwCd <= 0) {
      this.npcThrow(n, thr, 8); n.throwCd = 1.3;
      n.face = Math.atan2(thr.x - n.x, thr.z - n.z);
    }
  }

  private npcThrow(n: Npc, e: Enemy, dmg: number): void {
    if (this.projs.length >= MAX_PROJ) return;
    const a = Math.atan2(e.x - n.x, e.z - n.z);
    this.projs.push({
      x: n.x + Math.sin(a) * 0.6, z: n.z + Math.cos(a) * 0.6, vx: Math.sin(a) * NPC_THROW.speed, vz: Math.cos(a) * NPC_THROW.speed,
      life: 1.1, dmg, pierce: 0, w: NPC_THROW, hit: [], crit: false, ang: a, owner: n,
    });
    n.throwAnim = 0.3;
    audio.play('click');
  }

  private hitNpc(n: Npc, dmg: number, by: Enemy | null): void {
    if (n.state === 'dead' || n.invuln > 0) return;
    n.hp -= dmg; n.flash = 0.12; setFlash(n.rig, flashMat);
    audio.play('hit');
    this.burst(n.x, 1.0, n.z, 5, [n.color, 0xf0c8a0, 0xffffff], 4, 3, 0.12, 0.5);
    if (n.hp <= 0) { this.killNpc(n); return; }
    if (by && n.kind === 'brave' && Math.random() < 0.4) { // отбился
      const dx = by.x - n.x, dz = by.z - n.z, l = Math.hypot(dx, dz) || 1;
      this.hurtEnemy(by, 8, dx / l, dz / l, 6, false, false);
      this.pushNpc(n, -dx / l, -dz / l);
      this.float(n.x, 2.3, n.z, 'ПОЛУЧАЙ!', 'crit');
      n.invuln = 0.6;
      return;
    }
    if (n.state === 'hidden' || n.state === 'toShelter') this.releaseNpc(n);
    n.state = 'down'; n.downT = 1.8; n.invuln = 0.4; n.fear = 1;
    if (by) { const dx = n.x - by.x, dz = n.z - by.z, l = Math.hypot(dx, dz) || 1; this.pushNpc(n, dx / l, dz / l); }
    this.shout(n, 'А-А-А!');
  }

  private pushNpc(n: Npc, ux: number, uz: number): void {
    n.x += ux * 0.9; n.z += uz * 0.9;
    resolveCircle(n.x, n.z, n.r, this.level.obstacles, tmp); n.x = tmp.x; n.z = tmp.z;
  }

  private killNpc(n: Npc): void {
    this.releaseNpc(n);
    n.state = 'dead';
    this.scene.remove(n.rig.root);
    this.burst(n.x, 1.0, n.z, 18, [n.color, 0xf0c8a0, 0xffffff, 0x555555], 7, 5, 0.17, 0.9);
    this.float(n.x, 2.2, n.z, '☠', 'dmg');
    this.npcLost++;
    audio.play('die');
    if (Math.random() < 0.5) this.say(pick(['Зэка жалко…', 'Не уберегли!', 'Держитесь, мужики!']), 'sys');
  }

  private rescueNpc(n: Npc): void {
    n.hp = Math.min(n.maxHp, n.hp + 25); n.kind = 'helper'; n.state = 'follow'; n.fear = 0.3; n.invuln = 1.2;
    n.rig.root.rotation.x = 0;
    this.p.score += 50; this.p.runCoins += 3;
    this.float(n.x, 2.4, n.z, 'СПАСЁН!', 'heal');
    audio.play('pickup');
    this.say('Спасибо, друг! Теперь я с тобой!', 'sys', true);
  }

  private updateShelters(dt: number): void {
    if (this.lockT > 0) { this.lockT -= dt; if (this.lockT <= 0) this.unlockShelters(); }
    for (const sh of this.level.shelters) {
      if (sh.broken) { sh.door.off = true; sh.doorMesh.visible = false; continue; }
      if (sh.locked && Math.hypot(this.p.x - sh.outPt.x, this.p.z - sh.outPt.z) < 1.9) {
        sh.locked = false;
        this.events.banner('ДВЕРЬ ОТКРЫТА!', 'Люди бегут в укрытие', 'event');
        audio.play('pickup');
      }
      const dcz = (sh.door.minZ + sh.door.maxZ) / 2;
      const playerNear = Math.hypot(this.p.x - sh.x, this.p.z - dcz) < 1.7 && this.mode === 'play';
      const want = playerNear || this.npcs.some(n => (n.state === 'toShelter' && n.shelter === sh) || n.leaving === sh);
      sh.open = want && !sh.locked;
      sh.door.off = sh.open;
      sh.doorMesh.visible = !sh.open;
    }
  }

  private lockShelters(): void {
    for (const sh of this.level.shelters) { if (!sh.broken) { sh.locked = true; sh.open = false; } }
    this.lockT = 25;
  }
  private unlockShelters(): void { for (const sh of this.level.shelters) sh.locked = false; this.lockT = 0; }

  private ambush(): void {
    const alive = this.npcs.filter(n => n.state !== 'dead');
    if (!alive.length) return;
    const n = pick(alive);
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2;
      const x = Math.max(-5.5, Math.min(5.5, n.x + Math.cos(a) * 4)), z = Math.max(ARENA.zMin + 1, Math.min(ARENA.zMax - 1, n.z + Math.sin(a) * 4));
      this.spawnEnemy(this.stage() >= 3 ? 'bear' : 'cub', { x, z });
    }
    this.say('Медведь из коридора! Спасай людей!', 'sys', true);
  }

  /** Повреждение ломаемых предметов и дверей. */
  private damageObstacle(a: AABB, dmg: number): void {
    if (a.hp === undefined || a.off) return;
    a.hp -= dmg;
    const cx = (a.minX + a.maxX) / 2, cz = (a.minZ + a.maxZ) / 2;
    if (Math.random() < 0.12) { this.burst(cx, 0.8, cz, 2, [a.color ?? 0x8a6a40, 0xd8c8a0], 3, 3, 0.14, 0.5); audio.play('hit'); }
    if (a.hp <= 0) {
      a.off = true;
      if (a.mesh) a.mesh.visible = false;
      this.burst(cx, 0.9, cz, 26, [a.color ?? 0x8a6a40, 0xd8c8a0, 0x5a4020], 8, 6, 0.2, 0.9);
      this.shake = Math.min(1, this.shake + 0.25);
      audio.play('boom');
      if (a.shelter) { a.shelter.broken = true; a.shelter.open = true; this.say('Дверь выломана! Люди в опасности!', 'sys', true); }
    }
  }

  // ================================================================ Цели медведей
  private inSmoke(x: number, z: number): boolean {
    for (const s of this.smokes) if (Math.hypot(s.x - x, s.z - z) < s.r) return true;
    return false;
  }

  /** Медведь сам выбирает цель: игрок, убегающий человек, приманка, дверь укрытия. */
  private updateTarget(e: Enemy, dt: number): void {
    const p = this.p;
    e.retarget -= dt; e.lureT -= dt; e.aggroT -= dt;
    if (e.tkind === 'npc' && (!e.tnpc || e.tnpc.state === 'dead' || e.tnpc.state === 'hidden')) e.retarget = 0;
    if (e.retarget <= 0) {
      e.retarget = 0.35 + Math.random() * 0.15;
      const dP = Math.hypot(p.x - e.x, p.z - e.z);
      let best = dP * (dP < 5 ? 0.7 : 1);
      let kind: Enemy['tkind'] = 'player', tnpc: Npc | null = null, tx = p.x, tz = p.z;
      const psh = this.playerShelter();
      if (psh && !psh.broken && !psh.open) { best = Math.hypot(psh.outPt.x - e.x, psh.outPt.z - e.z); kind = 'door'; tx = psh.outPt.x; tz = psh.outPt.z; }
      if (this.inSmoke(e.x, e.z)) { // в дыму ничего не видит — бродит
        kind = 'wander'; e.wAng += (Math.random() - 0.5) * 2.6; tx = e.x + Math.cos(e.wAng) * 4; tz = e.z + Math.sin(e.wAng) * 4; best = -1;
      } else {
        for (const g of this.grenades) {
          if (g.kind !== 'decoy' || !g.landed) continue;
          const d = Math.hypot(g.x - e.x, g.z - e.z);
          if (d < 22 && dP > 2.4 && d * 0.2 < best) { best = d * 0.2; kind = 'lure'; tx = g.x; tz = g.z; }
        }
        if (e.lureT > 0 && dP > 4) {
          const d = Math.hypot(e.lureX - e.x, e.lureZ - e.z);
          if (d * 0.5 < best) { best = d * 0.5; kind = 'lure'; tx = e.lureX; tz = e.lureZ; }
        }
        for (const n of this.npcs) {
          if (n.state === 'dead') continue;
          let score: number, px = n.x, pz = n.z, k: 'npc' | 'door' = 'npc';
          if (n.state === 'hidden') {
            const sh = n.shelter;
            if (!sh || sh.broken) continue;
            const d = Math.hypot(sh.outPt.x - e.x, sh.outPt.z - e.z);
            if (d > 13) continue;
            score = d * 1.25; px = sh.outPt.x; pz = sh.outPt.z; k = 'door';
          } else {
            const d = Math.hypot(n.x - e.x, n.z - e.z);
            if (d > 9.5) continue;
            score = d * 0.78;
          }
          if (e.aggro === n && e.aggroT > 0) score *= 0.4;
          if (e.tnpc === n) score *= 0.8;
          if (score < best) { best = score; kind = k; tnpc = n; tx = px; tz = pz; }
        }
      }
      e.tkind = kind; e.tnpc = tnpc; e.tx = tx; e.tz = tz;
    }
    if (e.tkind === 'player') { e.tx = p.x; e.tz = p.z; }
    else if (e.tkind === 'npc' && e.tnpc) { e.tx = e.tnpc.x; e.tz = e.tnpc.z; }
  }

  /** Громкий звук: люди пугаются, медведи идут проверить. */
  private noise(x: number, z: number, R: number): void {
    for (const n of this.npcs) {
      if (n.state === 'dead' || n.state === 'hidden') continue;
      if (Math.hypot(n.x - x, n.z - z) < R) { n.warnT = Math.max(n.warnT, 4); n.fear = Math.max(n.fear, 0.5); }
    }
    for (const e of this.enemies) {
      if (e.dead || e.def.boss) continue;
      if (Math.hypot(e.x - x, e.z - z) < R * 0.9) { e.lureT = 3; e.lureX = x; e.lureZ = z; }
    }
  }

  // ================================================================ Гранаты и тактические предметы
  private giveItem(kind: ItemKind): boolean {
    const total = ITEM_KINDS.reduce((s, k) => s + this.items[k], 0);
    if (total >= ITEM_CAP || this.items[kind] >= ITEM_MAX) { this.float(this.p.x, 2.4, this.p.z, 'РЮКЗАК ПОЛОН', 'dmg'); return false; }
    this.items[kind]++;
    this.float(this.p.x, 2.4, this.p.z, ITEM_INFO[kind].icon + ' +1', 'heal');
    audio.play('pickup');
    return true;
  }

  /** Быстрый бросок предмета по кнопке: цель выбирается автоматически. */
  useItem(kind: ItemKind): void {
    if (this.mode !== 'play' || this.itemCd > 0 || this.items[kind] <= 0) return;
    const p = this.p;
    let target: Enemy | null = null, best = 14 * 14;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
      if (d < best) { best = d; target = e; }
    }
    let x1 = p.x + Math.sin(p.face) * 6, z1 = p.z + Math.cos(p.face) * 6;
    if (kind === 'decoy') {
      if (target) { const dx = target.x - p.x, dz = target.z - p.z, l = Math.hypot(dx, dz) || 1; x1 = target.x + (dx / l) * 5; z1 = target.z + (dz / l) * 5; }
    } else if (target) {
      x1 = target.x; z1 = target.z;
      if (kind === 'frag') { // бросаем в самую плотную кучу
        let bn = 0;
        for (const a of this.enemies) {
          if (a.dead || Math.hypot(a.x - p.x, a.z - p.z) > 13) continue;
          let nb = 0;
          for (const b of this.enemies) if (!b.dead && Math.hypot(a.x - b.x, a.z - b.z) < 3.2) nb++;
          if (nb > bn) { bn = nb; x1 = a.x; z1 = a.z; }
        }
      }
    } else if (kind === 'net') { this.say('Некого ловить!', 'sys', true); return; }
    x1 = Math.max(-ARENA.hx + 0.6, Math.min(ARENA.hx - 0.6, x1)); z1 = Math.max(ARENA.zMin + 0.6, Math.min(ARENA.zMax - 0.6, z1));
    const mesh = this.gPool.find(m => !m.visible);
    if (!mesh) return;
    this.items[kind]--; this.itemCd = 0.9;
    mesh.material = this.gMats[kind]; mesh.visible = true;
    mesh.scale.set(kind === 'decoy' ? 1.6 : 1, 1, 1);
    mesh.position.set(p.x, 1.2, p.z);
    this.grenades.push({ kind, x0: p.x, z0: p.z, x1, z1, x: p.x, z: p.z, t: 0, dur: 0.6, landed: false, ttl: 0, mesh, bark: 0 });
    audio.play('click');
    this.say(ITEM_INFO[kind].quip, 'p');
  }

  private updateGrenades(dt: number): void {
    this.itemCd -= dt;
    for (let i = this.grenades.length - 1; i >= 0; i--) {
      const g = this.grenades[i];
      if (!g.landed) {
        g.t += dt;
        const k = Math.min(1, g.t / g.dur);
        g.x = g.x0 + (g.x1 - g.x0) * k; g.z = g.z0 + (g.z1 - g.z0) * k;
        g.mesh.position.set(g.x, 0.9 + Math.sin(k * Math.PI) * 3.2, g.z);
        g.mesh.rotation.x += dt * 10; g.mesh.rotation.y += dt * 6;
        if (k >= 1) this.landGrenade(g);
        continue;
      }
      g.ttl -= dt;
      let done = false;
      if (g.kind === 'frag') {
        g.mesh.visible = g.ttl > 0.4 || Math.floor(g.ttl * 20) % 2 === 0;
        if (g.ttl <= 0) { this.explode(g.x, g.z, 3.8, 85 * this.stats.dmgMul, 0xffa030, 0.6, false, true); done = true; }
      } else if (g.kind === 'decoy') {
        g.bark -= dt;
        if (g.bark <= 0) { g.bark = 0.8; audio.play('decoy'); this.float(g.x, 1.9, g.z, 'ТЫЦ-ТЫЦ!', 'dmg'); this.noise(g.x, g.z, 16); }
        g.mesh.rotation.y += dt * 3; g.mesh.position.y = 0.3 + Math.abs(Math.sin(this.time * 8)) * 0.12;
        if (g.ttl <= 0) { this.explode(g.x, g.z, 2.6, 50, 0xb050d0, 0.5, false, true); done = true; }
      } else if (g.ttl <= 0) done = true;
      if (done) { g.mesh.visible = false; this.grenades.splice(i, 1); }
    }
  }

  private landGrenade(g: Grenade): void {
    g.landed = true; g.x = g.x1; g.z = g.z1; g.mesh.position.set(g.x, 0.25, g.z); g.mesh.rotation.set(0, 0, 0);
    switch (g.kind) {
      case 'frag': g.ttl = 1.0; break;
      case 'decoy': g.ttl = 7; g.bark = 0; break;
      case 'smoke':
        g.ttl = 0.01;
        this.smokes.push({ x: g.x, z: g.z, r: 3.3, t: 7, puff: 0 });
        this.burst(g.x, 0.6, g.z, 16, [0xc8c8cc, 0xa8a8b0], 3, 1.5, 0.5, 1.2, 0);
        audio.play('hit'); this.noise(g.x, g.z, 8);
        this.float(g.x, 1.9, g.z, 'ДЫМ!', 'crit');
        break;
      case 'net': {
        g.ttl = 0.01;
        let t: Enemy | null = null, bd = 2.6;
        for (const e of this.enemies) { if (e.dead) continue; const d = Math.hypot(e.x - g.x, e.z - g.z) - e.r * 0.5; if (d < bd) { bd = d; t = e; } }
        const slot = this.netMeshes.find(s => !s.e);
        if (t && slot) {
          t.netT = t.def.boss ? 2 : 4.5; t.stun = Math.max(t.stun, t.netT);
          slot.e = t; slot.mesh.visible = true;
          this.float(t.x, 2.6 * t.def.size, t.z, 'ПОЙМАН!', 'crit');
          audio.play('pickup');
        } else this.float(g.x, 1.8, g.z, 'МИМО!', 'dmg');
        break;
      }
    }
  }

  private updateSmokes(dt: number): void {
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.t -= dt; s.puff -= dt;
      if (s.puff <= 0) {
        s.puff = 0.12;
        this.burst(s.x + (Math.random() - 0.5) * s.r * 1.6, 0.4 + Math.random() * 1.2, s.z + (Math.random() - 0.5) * s.r * 1.6, 2, [0xc8c8cc, 0xa8a8b0, 0xdadade], 0.6, 0.8, 0.55, 1.8, -0.6);
      }
      if (s.t <= 0) this.smokes.splice(i, 1);
    }
  }

  private updateNets(dt: number): void {
    for (const s of this.netMeshes) {
      const e = s.e;
      if (!e) continue;
      if (e.dead || e.netT <= 0) { s.e = null; s.mesh.visible = false; continue; }
      e.netT -= dt; e.stun = Math.max(e.stun, 0.2);
      const sc = e.def.size * 1.6;
      s.mesh.position.set(e.x, 0.9 * e.def.size, e.z); s.mesh.scale.set(sc, sc * 1.1, sc);
    }
  }

  // ================================================================ Переход между локациями
  /** Пятая волна пройдена: открывается выход в следующую локацию (или победа). */
  private finishLocation(): void {
    if (this.locIndex >= LOCATIONS.length - 1) {
      this.victory = true;
      this.mode = 'dying'; this.deathT = 2.4; this.input.setEnabled(false);
      this.events.banner('ПОБЕДА!', 'Все локации зачищены. Медведи в шоке!', 'boss');
      audio.play('levelup');
      return;
    }
    this.waveState = 'exit';
    this.exitOpen = true;
    this.exitMarker.visible = true;
    const nxt = LOCATIONS[this.locIndex + 1];
    this.events.banner('ПРОХОД ОТКРЫТ', 'Иди к двери внизу: ' + nxt.emoji + ' ' + nxt.name, 'event');
    this.say('Дверь внизу светится. Пора валить дальше!', 'sys', true);
  }

  private updateExit(dt: number): void {
    const t = this.time;
    this.exitMarker.scale.setScalar(1 + Math.sin(t * 5) * 0.06);
    const ar = this.exitMarker.getObjectByName('arrow');
    if (ar) ar.position.y = 3.4 + Math.sin(t * 6) * 0.25;
    void dt;
    if (Math.hypot(this.p.x - this.exitMarker.position.x, this.p.z - this.exitMarker.position.z) < 1.8) this.enterLocation(this.locIndex + 1);
  }

  /** Сносит всё живое и предметы мира, не трогая игрока и его прокачку. */
  private clearEntities(): void {
    for (const e of this.enemies) this.scene.remove(e.rig.root);
    for (const n of this.npcs) this.scene.remove(n.rig.root);
    this.enemies = []; this.npcs = []; this.projs = []; this.eshots = []; this.picks = []; this.grenades = []; this.smokes = [];
    this.gPool.forEach(m => (m.visible = false));
    this.netMeshes.forEach(s => { s.e = null; s.mesh.visible = false; });
    this.puddles.forEach(q => { q.t = 0; q.mesh.visible = false; });
    this.bombActive = false; this.bombMesh.visible = false; this.warnLine.visible = false; this.ringMesh.visible = false;
    this.bossRef = null; this.finTarget = null; this.fin = null; this.events.finish(false); this.events.bossBar(null, '');
    this.projMesh.count = this.eshotMesh.count = this.pickMesh.count = 0;
    for (const q of this.parts) q.life = 0;
  }

  private enterLocation(idx: number): void {
    const def = LOCATIONS[idx];
    this.clearEntities();
    this.level.dispose();
    this.locIndex = idx; this.locDef = def;
    this.level = buildLocation(def.id, this.scene);
    this.applyLocLight();
    this.spawnNpcs();
    this.exitOpen = false; this.exitMarker.visible = false;
    const p = this.p;
    p.x = 0; p.z = ARENA.zMax - 3.2; p.kx = p.kz = 0; p.invuln = 2.5; p.face = Math.PI;
    p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * 0.4);
    this.wave = 0; this.waveState = 'break'; this.breakT = 3.5; this.queue = []; this.event = null; this.lockT = 0;
    this.zoomKick = 0.5;
    audio.play('levelup');
    if (!save.locUnlocked.includes(def.id)) {
      save.locUnlocked.push(def.id); commit();
      this.events.banner('НОВАЯ ЛОКАЦИЯ ОТКРЫТА!', def.emoji + ' ' + def.name, 'boss');
    } else this.events.banner(def.emoji + ' ' + def.name.toUpperCase(), 'Локация ' + (idx + 1) + ' из ' + LOCATIONS.length, 'boss');
  }

  /** Укрытие, в котором сейчас стоит игрок (можно отсидеться, пока медведи ломают дверь). */
  private playerShelter(): Shelter | null {
    const p = this.p;
    for (const sh of this.level.shelters) if (Math.abs(p.x - sh.x) < 1.35 && Math.abs(p.z - sh.z) < 1.05) return sh;
    return null;
  }

  // ================================================================ Продолжение после смерти
  private afterDeath(): void {
    if (this.victory) this.finish();
    else if (this.continuesLeft > 0) { this.mode = 'continue'; this.events.continuePrompt(this.continuesLeft, this.stage()); }
    else this.finish();
  }

  endRun(): void { if (this.mode === 'continue') this.finish(); }

  private findSafeSpot(x: number, z: number): { x: number; z: number } {
    const margin = (px: number, pz: number): number => {
      resolveCircle(px, pz, this.p.r + 0.3, this.level.obstacles, tmp);
      if (Math.hypot(tmp.x - px, tmp.z - pz) > 0.05) return -1;
      let m = 99;
      for (const e of this.enemies) if (!e.dead) m = Math.min(m, Math.hypot(e.x - px, e.z - pz) - e.r);
      return m > 4 ? m : -1;
    };
    if (margin(x, z) > 0) return { x, z };
    let best = { x: 0, z: 10 }, bs = -1e9;
    for (let gx = -5; gx <= 5; gx += 1.25) for (let gz = ARENA.zMin + 1.5; gz <= ARENA.zMax - 1.5; gz += 1.5) {
      const m = margin(gx, gz);
      if (m < 0) continue;
      const s = Math.min(m, 10) - 0.25 * Math.hypot(gx - x, gz - z);
      if (s > bs) { bs = s; best = { x: gx, z: gz }; }
    }
    return best;
  }

  continueRun(): void {
    if (this.mode !== 'continue' || this.continuesLeft <= 0) return;
    this.continuesLeft--;
    const p = this.p;
    const safe = this.findSafeSpot(p.x, p.z);
    p.x = safe.x; p.z = safe.z; p.kx = p.kz = 0;
    p.hp = this.stats.maxHp * 0.6; p.invuln = 4; p.deathTilt = 0; p.lowHpSaid = false;
    this.rig.root.rotation.x = 0; this.rig.root.position.set(p.x, 0, p.z); this.rig.root.visible = true; setFlash(this.rig, null);
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
      if (d < 6) { const l = d || 1; e.vx += (dx / l) * 16; e.vz += (dz / l) * 16; e.stun = Math.max(e.stun, 1.2); }
    }
    this.burst(p.x, 1, p.z, 40, [0xffe58a, 0xffffff, 0x7ad8ff], 9, 7, 0.2, 0.9);
    this.mode = 'play'; this.input.setEnabled(true);
    this.slowT = 0; this.hitStop = 0.1; this.zoomKick = 0.6; this.shake = 0.8;
    audio.play('levelup');
    this.events.banner('ВОСКРЕСЕНИЕ!', this.continuesLeft > 0 ? 'Продолжений осталось: ' + this.continuesLeft : 'Это было последнее продолжение', 'event');
    this.say('Меня так просто не взять!', 'p', true);
  }

  // ---------------------------------------------------------------- частицы / тени / камера
  private burst(x: number, y: number, z: number, n: number, colors: number[], speed: number, up: number, size: number, life: number, grav = 18): void {
    for (let i = 0; i < n; i++) {
      const q = this.parts[this.partIdx]; this.partIdx = (this.partIdx + 1) % MAX_PART;
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      q.x = x; q.y = y; q.z = z;
      q.vx = Math.cos(a) * s; q.vz = Math.sin(a) * s; q.vy = up * (0.4 + Math.random());
      q.max = q.life = life * (0.6 + Math.random() * 0.6);
      q.size = size * (0.6 + Math.random() * 0.8); q.spin = Math.random() * 10; q.grav = grav;
      q.color.set(colors[Math.floor(Math.random() * colors.length)]);
    }
  }

  private updateParticles(dt: number): void {
    const m = this.partMesh;
    let k = 0;
    for (const q of this.parts) {
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) continue;
      q.vy -= q.grav * dt;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.y < 0.05) { q.y = 0.05; q.vy *= -0.35; q.vx *= 0.7; q.vz *= 0.7; }
      const f = Math.min(1, q.life / q.max * 2);
      dummy.position.set(q.x, q.y, q.z);
      dummy.rotation.set(q.spin + q.life * 6, q.life * 4, 0);
      dummy.scale.setScalar(q.size * f);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix); m.setColorAt(k, q.color);
      k++;
    }
    m.count = k;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  private updateShadows(): void {
    const m = this.shadowMesh;
    let k = 0;
    const put = (x: number, z: number, s: number, h = 0) => {
      if (k >= MAX_SHADOW) return;
      dummy.position.set(x, 0.02, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(s * (1 - Math.min(0.5, h * 0.06)));
      dummy.updateMatrix(); m.setMatrixAt(k++, dummy.matrix);
    };
    if (this.mode === 'menu') {
      put(0, 8.3, 1.1);
      this.menuProps.forEach((r, i) => put(r.root.position.x, r.root.position.z, [1.6, 2.6, 2.3, 3.4][i]));
    } else {
      if (this.mode !== 'over') put(this.p.x, this.p.z, this.charDef.hitR * 2.6);
      for (const e of this.enemies) put(e.x, e.z, e.r * 2.5, e.dead ? Math.max(0, e.fy) : 0);
      for (const n of this.npcs) if (n.state !== 'dead') put(n.x, n.z, 1.1);
    }
    m.count = k; m.instanceMatrix.needsUpdate = true;
  }

  private updateCamera(real: number): void {
    this.shake = Math.max(0, this.shake - real * 2.4);
    this.zoomKick = Math.max(0, this.zoomKick - real * 0.7);
    const dist = this.camDist * (1 - this.zoomKick * 0.22);
    const sx = (Math.random() - 0.5) * this.shake * 0.9, sz = (Math.random() - 0.5) * this.shake * 0.9;
    if (this.camMode === 'chase') {
      const p = this.p, fx = Math.sin(this.camYaw), fz = Math.cos(this.camYaw);
      const back = 6.4 - this.zoomKick * 2.2;
      const lim = ARENA.hx - 0.4;
      const cx = Math.max(-lim, Math.min(lim, p.x - fx * back));
      const cz = Math.max(ARENA.zMin + 0.4, Math.min(ARENA.zMax - 0.4, p.z - fz * back));
      this.camera.position.set(cx + sx, 4.6 + this.zoomKick, cz + sz);
      this.camera.lookAt(p.x + fx * 5, 1.2, p.z + fz * 5);
      return;
    }
    const visHalf = (this.camDist * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.sin(this.tilt);
    const lo = ARENA.zMin + visHalf - 2, hi = ARENA.zMax - visHalf + 2;
    const want = lo > hi ? (ARENA.zMin + ARENA.zMax) / 2 : Math.max(lo, Math.min(hi, this.p.z - 2));
    this.camZ += (want - this.camZ) * Math.min(1, real * 4);
    const tz = this.camZ;
    const px = this.zoomKick > 0 ? this.p.x * this.zoomKick * 0.5 : 0;
    this.camera.position.set(sx + px, dist * Math.sin(this.tilt), tz + dist * Math.cos(this.tilt) + sz);
    this.camera.lookAt(px, 0, tz);
  }

  private pushHud(): void {
    const p = this.p, w = WEAPONS[p.weapon];
    const maxCd = BOMB_CD * this.stats.bombCd;
    this.events.hud({
      locName: this.locDef.name, locNo: this.locIndex + 1, locTotal: LOCATIONS.length, wavesPer: WAVES_PER_LOC, continues: this.continuesLeft, items: this.items, itemCd: Math.max(0, this.itemCd), points: this.pendingLevels, hp: Math.max(0, p.hp), maxHp: this.stats.maxHp, xp: p.xp, xpNext: p.xpNext, lvl: p.lvl, wave: Math.max(1, this.wave), score: p.score,
      coins: p.runCoins, bombFrac: Math.max(0, Math.min(1, 1 - p.bombCd / maxCd)), weaponIcon: w.icon, weaponName: w.name,
      weaponFrac: p.weapon === 'spoon' || p.fixedWeapon ? 0 : w.ammo ? Math.max(0.02, p.ammo / w.ammo) : Math.max(0, p.weaponT / 18), combo: p.combo,
      mult: Math.min(3, 1 + Math.floor(p.combo / 5) * 0.25), left: this.queue.length + this.aliveCount(),
    });
  }

  // ---------------------------------------------------------------- «карточка смерти» для соцсетей
  async makeCard(lines: string[]): Promise<Blob | null> {
    try {
      this.renderer.render(this.scene, this.camera);
      const W = 540, H = 960;
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d')!;
      const src = this.renderer.domElement;
      const ar = W / H, sar = src.width / src.height;
      let sw = src.width, sh = src.height, sx = 0, sy = 0;
      if (sar > ar) { sw = src.height * ar; sx = (src.width - sw) / 2; } else { sh = src.width / ar; sy = (src.height - sh) / 2; }
      g.drawImage(src, sx, sy, sw, sh, 0, 0, W, H);
      const grad = g.createLinearGradient(0, H * 0.45, 0, H);
      grad.addColorStop(0, 'rgba(10,0,10,0)'); grad.addColorStop(1, 'rgba(10,0,10,0.92)');
      g.fillStyle = grad; g.fillRect(0, H * 0.45, W, H * 0.55);
      g.textAlign = 'center';
      g.fillStyle = '#ffd24a'; g.font = '900 54px Arial, sans-serif'; g.fillText('СТОЛОВАЯ №7', W / 2, 90);
      g.fillStyle = '#fff';
      let y = H - 60 - lines.length * 46;
      lines.forEach((l, i) => { g.font = (i === 0 ? '900 40px' : '700 30px') + ' Arial, sans-serif'; g.fillText(l, W / 2, y); y += i === 0 ? 56 : 44; });
      return await new Promise(res => c.toBlob(b => res(b), 'image/png'));
    } catch { return null; }
  }
}

import * as THREE from 'three';
import {
  CHARS, CRATE_WEAPONS, DEATH_JOKES, ENEMIES, EVENTS, HURT_QUIPS, KILL_STREAK, BEAR_QUIPS, PLAYER_QUIPS, RANKS,
  UPGRADES, WAVE_SUBS, WEAPONS, pick, todayMutator,
  type CharDef, type EnemyDef, type EnemyKind, type Mutator, type Stats, type UpgradeDef, type WeaponDef,
} from './data';
import { animateRig, box, buildBear, buildHuman, flashMat, merge, setFlash, vcMat, warnMat, type Rig } from './models';
import { ARENA, buildCanteen, resolveCircle, type Level } from './level';
import type { Input } from './input';
import { audio } from './audio';
import { save, commit } from './save';

export interface HudState {
  hp: number; maxHp: number; xp: number; xpNext: number; lvl: number; wave: number; score: number; coins: number;
  bombFrac: number; weaponIcon: string; weaponName: string; weaponFrac: number; combo: number; mult: number; left: number;
}
export interface RunResult {
  score: number; wave: number; kills: number; coins: number; lvl: number; title: string; rank: string; joke: string; newBest: boolean; time: number;
}
export interface GameEvents {
  hud(s: HudState): void;
  quip(text: string, who: 'p' | 'b' | 'sys'): void;
  banner(title: string, sub: string, kind: 'wave' | 'boss' | 'event' | 'combo' | 'info'): void;
  float(sx: number, sy: number, text: string, cls: string): void;
  levelUp(cards: UpgradeDef[]): void;
  gameOver(r: RunResult): void;
  bossBar(frac: number | null, name: string): void;
  hurt(): void;
}

type Mode = 'menu' | 'play' | 'choose' | 'paused' | 'dying' | 'over';

interface Enemy {
  def: EnemyDef; rig: Rig; x: number; z: number; vx: number; vz: number; hp: number; maxHp: number; r: number;
  spd: number; dmg: number; flash: number; atkCd: number; t: number; face: number; stun: number; slow: number;
  shootCd: number; side: number; dead: boolean; deadT: number; fvx: number; fvz: number; fy: number; fvy: number;
  lunge: number; lungeCd: number; enraged: boolean;
  bState: 'chase' | 'wind' | 'charge' | 'rest'; bT: number; bCd: number; cx: number; cz: number; sum1: boolean; sum2: boolean; ring: number;
}
interface Proj { x: number; z: number; vx: number; vz: number; life: number; dmg: number; pierce: number; w: WeaponDef; hit: Enemy[]; crit: boolean; ang: number }
interface EShot { x: number; z: number; vx: number; vz: number; life: number; dmg: number; kind: EnemyKind }
interface Pickup { kind: 'coin' | 'xp' | 'pie' | 'crate'; x: number; z: number; t: number; val: number }
interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; spin: number; color: THREE.Color; grav: number }
interface Puddle { x: number; z: number; r: number; t: number; tick: number; mesh: THREE.Mesh; dmg: number }

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
    lowHpSaid: false, deathTilt: 0,
  };
  private stats: Stats = this.baseStats();
  private upCount: Record<string, number> = {};
  private pendingLevels = 0;

  // волны
  private wave = 0;
  private waveState: 'break' | 'fight' = 'break';
  private breakT = 2;
  private queue: EnemyKind[] = [];
  private spawnT = 0;
  private spawnGap = 1;
  private event: keyof typeof EVENTS | null = null;
  private runTime = 0;
  private bossRef: Enemy | null = null;
  private killer: EnemyKind = 'cub';
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

  constructor(private canvas: HTMLCanvasElement, private input: Input) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x1a1020);
    this.scene.background = new THREE.Color(0x1a1020);
    this.sun.position.set(6, 14, 8);
    this.scene.add(this.hemi, this.sun, this.lamp);
    this.level = buildCanteen(this.scene);

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
    this.rig.root.position.set(0, Math.abs(Math.sin(t * 3)) * 0.12, 8.3);
    this.rig.root.rotation.y = Math.sin(t * 0.7) * 0.6;
    animateRig(this.rig, t, 0, true, true);
    const pos = [[-2.3, 6.4], [2.3, 6.7], [-2.5, 10.0], [0.2, 4.6]];
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
    this.bossRef = null;
    this.projMesh.count = this.eshotMesh.count = this.pickMesh.count = this.partMesh.count = 0;
    this.menuProps.forEach(r => (r.root.visible = false));
  }

  start(): void {
    this.clearWorld();
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
      weapon: this.mods?.extOnly ? 'extinguisher' : 'spoon', weaponT: 0, fixedWeapon: !!this.mods?.extOnly, bombCd: 3, xp: 0, xpNext: 6, lvl: 1,
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
      this.events.banner('КРОВАВЫЙ ОБЕД', 'Столовая №7 открыта. Приятного аппетита!', 'info');
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
      this.updatePlayer(dt);
      this.updateSpawning(dt);
    } else {
      this.deathT -= real;
      this.p.deathTilt = Math.min(1.5, this.p.deathTilt + real * 2.2);
      this.rig.root.rotation.x = -this.p.deathTilt;
      this.rig.root.position.y = Math.min(0.4, this.p.deathTilt * 0.25);
      if (this.deathT <= 0) this.finish();
    }
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updateEnemyShots(dt);
    this.updateBomb(dt);
    this.updatePuddles(dt);
    this.updatePickups(dt);
    this.updateParticles(dt);
    this.updateShadows();
    this.updateCamera(real);
    this.pushHud();
    if (this.mode === 'play' && this.pendingLevels > 0) this.openChoose();
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
    if (front) target = front;
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
    if (!p.fixedWeapon && p.weapon !== 'spoon') {
      p.weaponT -= dt;
      if (p.weaponT <= 0) { p.weapon = 'spoon'; this.say('Опять поварёшка... Классика!', 'p', true); }
    }
    if (s.regen > 0 && p.hp < s.maxHp) p.hp = Math.min(s.maxHp, p.hp + s.regen * dt);
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
        dmg: w.dmg * s.dmgMul * (crit ? 2.5 : 1), pierce: w.pierce + s.pierce, w, hit: [], crit, ang: a,
      });
    }
    audio.play(w.sfx);
    // отдача-анимация и вспышка
    this.burst(p.x + Math.sin(ang) * 0.9, 1.2, p.z + Math.cos(ang) * 0.9, 2, [0xffe58a, 0xffffff], 2.5, 1, 0.1, 0.18, 0);
  }

  private hurtPlayer(d: number, kind: EnemyKind, fromX: number, fromZ: number): void {
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

  private die(kind: EnemyKind): void {
    this.mode = 'dying'; this.killer = kind; this.deathT = 1.7;
    this.slowT = 2; this.slowScale = 0.3; this.zoomKick = 1; this.shake = 1;
    this.input.setEnabled(false);
    this.rig.root.visible = true; setFlash(this.rig, null);
    this.events.bossBar(null, '');
    audio.play('die');
    this.say('Передайте тёте Вале… я не доел…', 'p', true);
  }

  private finish(): void {
    const p = this.p;
    this.mode = 'over';
    const mult = this.mods ? 1.5 : 1;
    const bonus = Math.floor(p.score / 250);
    const coins = Math.round((p.runCoins + bonus) * mult);
    const prevBest = save.best;
    save.coins += coins; save.kills += p.kills; save.runs += 1;
    if (p.score > save.best) save.best = p.score;
    commit();
    const wave = Math.max(1, this.wave);
    let rank = RANKS[0][1];
    for (const [w, name] of RANKS) if (wave >= w) rank = name;
    this.result = {
      score: p.score, wave, kills: p.kills, coins, lvl: p.lvl, title: pick(ENEMIES[this.killer].killedBy), rank, joke: pick(DEATH_JOKES),
      newBest: p.score > prevBest, time: this.runTime,
    };
    audio.setIntense(false);
    this.events.gameOver(this.result);
  }

  // ---------------------------------------------------------------- волны
  private buildQueue(wave: number): EnemyKind[] {
    const boss = wave % 5 === 0;
    const n = Math.min(40, 5 + Math.floor(wave * 2));
    const wBear = wave >= 2 ? Math.min(0.45, 0.12 + wave * 0.04) : 0;
    const wFish = wave >= 3 ? Math.min(0.22, 0.05 + wave * 0.02) : 0;
    const wTank = wave >= 4 ? Math.min(0.2, 0.03 + wave * 0.02) : 0;
    const q: EnemyKind[] = [];
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      let k: EnemyKind = 'cub';
      if (r < wTank) k = 'tank'; else if (r < wTank + wFish) k = 'fisher'; else if (r < wTank + wFish + wBear) k = 'bear';
      q.push(k);
    }
    if (boss) {
      q.length = Math.min(q.length, 4 + wave);
      q.splice(3, 0, Math.floor(wave / 5) % 2 === 1 ? 'potap' : 'mutant');
    }
    return q;
  }

  private startWave(): void {
    this.wave++;
    const w = this.wave;
    this.waveState = 'fight';
    this.queue = this.buildQueue(w);
    this.spawnGap = Math.max(0.5, 1.3 - w * 0.05);
    this.spawnT = 0.6;
    this.event = null;
    audio.play('wave');
    const boss = w % 5 === 0;
    audio.setIntense(boss || w >= 8);
    if (boss) {
      const kind = Math.floor(w / 5) % 2 === 1 ? 'potap' : 'mutant';
      this.events.banner('БОСС: ' + ENEMIES[kind].name.toUpperCase(), kind === 'potap' ? 'Михаил Потапыч пришёл за добавкой!' : 'Он пил воду из Чернобыля. И компот.', 'boss');
      audio.play('roar');
    } else {
      this.events.banner('ВОЛНА ' + w, pick(WAVE_SUBS), 'wave');
      if (w >= 2 && Math.random() < 0.5) {
        const ev = pick(['blackout', 'pirozhki', 'rush'] as const);
        this.event = ev;
        setTimeout(() => this.events.banner(EVENTS[ev].title, EVENTS[ev].sub, 'event'), 1400);
        if (ev === 'blackout') this.setBlackout(true);
        if (ev === 'rush') for (let i = 0; i < 10; i++) this.queue.push('cub');
        if (ev === 'pirozhki') for (let i = 0; i < 7; i++) this.addPickup('pie', (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 24, 1);
      }
    }
  }

  private endWave(): void {
    this.waveState = 'break';
    this.breakT = this.wave % 5 === 0 ? 4 : 2.8;
    const p = this.p;
    p.score += 100 * this.wave;
    p.runCoins += 3 + this.wave;
    p.hp = Math.min(this.stats.maxHp, p.hp + this.stats.maxHp * 0.15);
    this.setBlackout(false);
    this.events.banner('ВОЛНА ' + this.wave + ' ЗАЧИЩЕНА', '+' + 100 * this.wave + ' очков', 'info');
    audio.setIntense(false);
  }

  private setBlackout(on: boolean): void {
    this.hemi.intensity = on ? 0.32 : 1.25;
    this.sun.intensity = on ? 0.2 : 1.3;
    this.lamp.intensity = on ? 2.4 : 0;
    (this.scene.background as THREE.Color).set(on ? 0x05030a : 0x1a1020);
  }

  private aliveCount(): number {
    let n = 0;
    for (const e of this.enemies) if (!e.dead) n++;
    return n;
  }

  private updateSpawning(dt: number): void {
    if (this.waveState === 'break') {
      this.breakT -= dt;
      if (this.breakT <= 0) this.startWave();
      return;
    }
    this.spawnT -= dt;
    const cap = this.wave % 5 === 0 ? 12 : 14;
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
    const w = this.wave, big = !!this.mods?.bigBears && !def.boss;
    const bossIdx = Math.floor(w / 5);
    const hp = def.hp * (def.boss ? 1 + Math.max(0, bossIdx - 1) * 0.6 : 1 + (w - 1) * 0.16) * (big ? 1.3 : 1);
    const spd = def.speed * (def.boss ? 1 : Math.min(1.35, 1 + (w - 1) * 0.02)) * (this.mods?.fastBears ? 1.25 : 1);
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
      dead: false, deadT: 0, fvx: 0, fvz: 0, fy: 0, fvy: 0, lunge: 0, lungeCd: 1 + Math.random() * 2, enraged: false, bState: 'chase', bT: 0, bCd: 3, cx: 0, cz: 1, sum1: false, sum2: false, ring: 3,
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
      e.t += dt; e.atkCd -= dt; e.stun -= dt; e.slow = Math.max(0, e.slow - dt);
      if (e.flash > 0) { e.flash -= dt; if (e.flash <= 0) setFlash(e.rig, null); }
      const dx = p.x - e.x, dz = p.z - e.z, dist = Math.hypot(dx, dz) || 1e-4;
      const nx = dx / dist, nz = dz / dist;
      let mx = nx, mz = nz, speed = e.spd * (e.slow > 0 ? 0.5 : 1);
      if (e.stun > 0) speed = 0;
      let contactMul = 1;
      // ЯРОСТЬ: при низком здоровье медведь звереет
      if (!e.enraged && !e.def.boss && e.hp < e.maxHp * 0.5) {
        e.enraged = true; e.spd *= 1.3; e.dmg *= 1.2;
        this.burst(e.x, 1.6 * e.def.size, e.z, 6, [0xff3020, 0xffa030], 3, 3, 0.14, 0.5);
        if (Math.random() < 0.4) this.say('РРРЫЫЫ! ТЫ МЕНЯ ЗЛИШЬ!', 'b');
      }
      // БРОСОК: близкие медведи прыгают на игрока
      if (!e.def.boss && e.def.id !== 'fisher' && this.mode === 'play') {
        e.lungeCd -= dt;
        if (e.lunge > 0) { e.lunge -= dt; speed *= 2.4; }
        else if (e.lungeCd <= 0 && dist < 4.2 && dist > 1.2 && e.stun <= 0) { e.lunge = 0.35; e.lungeCd = 2.5 + Math.random() * 1.5; if (Math.random() < 0.35) audio.play('roar'); }
      }

      if (e.def.id === 'fisher') {
        if (dist < 5.5) { mx = -nx; mz = -nz; } else if (dist > 8.5) { mx = nx; mz = nz; } else { mx = -nz * e.side; mz = nx * e.side; }
        e.shootCd -= dt;
        if (e.shootCd <= 0 && dist < 14 && e.stun <= 0 && this.mode === 'play') {
          e.shootCd = 2.3 + Math.random() * 0.8;
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

      e.x += (mx * speed + e.vx) * dt; e.z += (mz * speed + e.vz) * dt;
      const kd = Math.max(0, 1 - 9 * dt); e.vx *= kd; e.vz *= kd;
      resolveCircle(e.x, e.z, e.r, this.level.obstacles, tmp);
      e.x = tmp.x; e.z = tmp.z;

      // удар по игроку
      const pd = Math.hypot(p.x - e.x, p.z - e.z);
      if (pd < e.r + p.r + 0.12 && e.atkCd <= 0 && this.mode === 'play') {
        e.atkCd = 0.9;
        this.hurtPlayer(e.dmg * contactMul, e.def.id, e.x, e.z);
      }

      const face = speed > 0.1 || e.bState === 'wind' ? Math.atan2(e.bState === 'wind' ? e.cx : mx, e.bState === 'wind' ? e.cz : mz) : Math.atan2(nx, nz);
      e.face = lerpAngle(e.face, face, Math.min(1, dt * 10));
      e.rig.root.position.set(e.x, 0, e.z);
      e.rig.root.rotation.y = e.face;
      animateRig(e.rig, e.t * (0.5 + e.spd / 4), speed > 0.1 ? 1 : 0.15, false, false);
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

  private summon(boss: Enemy, n: number): void {
    this.say('СЮДА, РЕБЯТА! ОНИ ТУТ ЕДЯТ!', 'b', true);
    this.shake = 0.8; audio.play('roar');
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnEnemy('cub', { x: Math.max(-5.5, Math.min(5.5, boss.x + Math.sin(a) * 2.4)), z: Math.max(-14, Math.min(14, boss.z + Math.cos(a) * 2.4)) });
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
      this.events.banner('ФАТАЛИТИ', e.def.name + ' улетел в тайгу', 'boss');
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
    if (def.boss || (!this.mods?.extOnly && !this.p.fixedWeapon && Math.random() < 0.03)) this.addPickup('crate', e.x, e.z, 1);
  }

  // ---------------------------------------------------------------- снаряды
  private updateProjectiles(dt: number): void {
    for (let i = this.projs.length - 1; i >= 0; i--) {
      const q = this.projs[i];
      q.x += q.vx * dt; q.z += q.vz * dt; q.life -= dt;
      let remove = q.life <= 0 || Math.abs(q.x) > ARENA.hx || Math.abs(q.z) > ARENA.hz;
      if (!remove) {
        const rr = q.w.size * 0.5;
        for (const e of this.enemies) {
          if (e.dead || q.hit.includes(e)) continue;
          const dx = e.x - q.x, dz = e.z - q.z, rad = e.r + rr;
          if (dx * dx + dz * dz < rad * rad) {
            q.hit.push(e);
            const l = Math.hypot(q.vx, q.vz) || 1;
            if (q.w.explode > 0) { this.explode(q.x, q.z, q.w.explode, q.dmg, 0xffb030); remove = true; break; }
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

  private explode(x: number, z: number, R: number, dmg: number, color: number, stun = 0, ignoreArmor = false): void {
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
      let remove = s.life <= 0 || Math.abs(s.x) > ARENA.hx + 0.5 || Math.abs(s.z) > ARENA.hz + 0.5;
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
    tx = Math.max(-ARENA.hx + 0.5, Math.min(ARENA.hx - 0.5, tx)); tz = Math.max(-ARENA.hz + 0.5, Math.min(ARENA.hz - 0.5, tz));
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
    this.picks.push({ kind, x: Math.max(-5.8, Math.min(5.8, x)), z: Math.max(-14.5, Math.min(14.5, z)), t: Math.random() * 6, val });
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
      case 'crate': {
        if (p.fixedWeapon) { p.runCoins += 15; break; }
        const id = pick(CRATE_WEAPONS.filter(w => w !== p.weapon));
        p.weapon = id; p.weaponT = 18;
        audio.play('pickup');
        this.events.banner(WEAPONS[id].icon + ' ' + WEAPONS[id].name.toUpperCase(), '18 секунд мощи!', 'event');
        this.say(WEAPONS[id].quip, 'p', true);
        break;
      }
    }
  }

  private addXp(v: number): void {
    const p = this.p;
    p.xp += v;
    while (p.xp >= p.xpNext) { p.xp -= p.xpNext; p.lvl++; p.xpNext = Math.floor(p.xpNext * 1.22 + 2); this.pendingLevels++; }
  }

  private openChoose(): void {
    const pool = UPGRADES.filter(u => (this.upCount[u.id] || 0) < u.max);
    if (!pool.length) { this.pendingLevels = 0; this.p.hp = this.stats.maxHp; return; }
    const cards: UpgradeDef[] = [];
    while (cards.length < 3 && pool.length) cards.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    this.mode = 'choose';
    this.input.setEnabled(false);
    audio.play('levelup');
    this.events.levelUp(cards);
  }

  pickUpgrade(id: string): void {
    if (this.mode !== 'choose') return;
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
      this.menuProps.forEach((r, i) => put(r.root.position.x, r.root.position.z, [0.9, 1.5, 1.4, 2.1][i]));
    } else {
      if (this.mode !== 'over') put(this.p.x, this.p.z, this.charDef.hitR * 2.6);
      for (const e of this.enemies) put(e.x, e.z, e.r * 2.5, e.dead ? Math.max(0, e.fy) : 0);
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
      const lim = ARENA.hx - 0.4, limZ = ARENA.hz - 0.4;
      const cx = Math.max(-lim, Math.min(lim, p.x - fx * back));
      const cz = Math.max(-limZ, Math.min(limZ, p.z - fz * back));
      this.camera.position.set(cx + sx, 4.6 + this.zoomKick, cz + sz);
      this.camera.lookAt(p.x + fx * 5, 1.2, p.z + fz * 5);
      return;
    }
    const tz = this.p.z * 0.22;
    const px = this.zoomKick > 0 ? this.p.x * this.zoomKick * 0.5 : 0;
    this.camera.position.set(sx + px, dist * Math.sin(this.tilt), tz + dist * Math.cos(this.tilt) + sz);
    this.camera.lookAt(px, 0, tz);
  }

  private pushHud(): void {
    const p = this.p, w = WEAPONS[p.weapon];
    const maxCd = BOMB_CD * this.stats.bombCd;
    this.events.hud({
      hp: Math.max(0, p.hp), maxHp: this.stats.maxHp, xp: p.xp, xpNext: p.xpNext, lvl: p.lvl, wave: Math.max(1, this.wave), score: p.score,
      coins: p.runCoins, bombFrac: Math.max(0, Math.min(1, 1 - p.bombCd / maxCd)), weaponIcon: w.icon, weaponName: w.name,
      weaponFrac: p.weapon === 'spoon' || p.fixedWeapon ? 0 : Math.max(0, p.weaponT / 18), combo: p.combo,
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

// Локации: общий размер арены, разный декор, препятствия, спавны и ловушки.
import * as THREE from 'three';
import { box, merge, vcMat, buildHuman, animateRig, type Rig } from './models';
import type { CharDef } from './data';

export interface AABB {
  minX: number; maxX: number; minZ: number; maxZ: number;
  off?: boolean;            // выключено (дверь открыта / предмет сломан)
  mesh?: THREE.Object3D;    // у ломаемых предметов и дверей — свой меш
  hp?: number;              // есть hp — медведи могут это сломать
  color?: number;
  shelter?: Shelter;
}
export interface Slot { x: number; z: number; occ: number }
export interface Shelter {
  x: number; z: number; fz: number; door: AABB; doorMesh: THREE.Mesh; slots: Slot[];
  outPt: { x: number; z: number }; inPt: { x: number; z: number };
  open: boolean; locked: boolean; broken: boolean; pending: number;
}
export type NpcKind = 'coward' | 'brave' | 'helper';
export interface NpcSpawn { x: number; z: number; kind: NpcKind }
export const ARENA = { hx: 6.2, hz: 15 };
const { hx, hz } = ARENA;

export interface Saw { mesh: THREE.Mesh; x: number; z: number; r: number; dir: number; speed: number; range: number }
export interface Level {
  obstacles: AABB[];
  spawns: { x: number; z: number }[];
  group: THREE.Group;
  saws: Saw[];
  shelters: Shelter[];
  npcs: NpcSpawn[];
  outfit: 'convict' | 'civil' | 'village';
  anim: ((t: number) => void) | null;
  dispose(): void;
}
export interface LocDef {
  id: string; name: string; emoji: string; desc: string; cost: number;
  bg: number; sky: number; ground: number; hemi: number; sun: number; dogs: boolean;
}

export const LOCATIONS: LocDef[] = [
  { id: 'canteen', name: 'Столовая №7', emoji: '🍲', desc: 'Плитка, компот и очередь за добавкой.', cost: 0, bg: 0x1a1020, sky: 0xffffff, ground: 0x8a7a68, hemi: 1.25, sun: 1.3, dogs: false },
  { id: 'barrack', name: 'Барак', emoji: '🛏️', desc: 'Советский барак: двухъярусные койки и буржуйка.', cost: 150, bg: 0x140d08, sky: 0xffe2b0, ground: 0x6a5238, hemi: 1.1, sun: 1.0, dogs: false },
  { id: 'village', name: 'Деревня зимой', emoji: '🏚️', desc: 'Сугробы, сарай, колодец. Медведи и бешеные собаки.', cost: 300, bg: 0x9fb8d6, sky: 0xdce8ff, ground: 0x9aa8b8, hemi: 1.55, sun: 1.2, dogs: true },
  { id: 'sawmill', name: 'Лесопилка', emoji: '🪚', desc: 'Зэки пилят дрова, пилы ездят по рельсам. Осторожно!', cost: 500, bg: 0x1a1812, sky: 0xfff0d0, ground: 0x7a6a48, hemi: 1.2, sun: 1.25, dogs: false },
  { id: 'banya', name: 'Баня', emoji: '🧖', desc: 'Пар, веники и каменка. Мишки пришли париться.', cost: 700, bg: 0x2a1408, sky: 0xffd8a0, ground: 0x6a4a2a, hemi: 1.05, sun: 0.9, dogs: false },
  { id: 'podezd', name: 'Подъезд', emoji: '🏢', desc: 'Почтовые ящики, велосипед и лифт, что не работает с 1997.', cost: 900, bg: 0x10141a, sky: 0xe8f0ff, ground: 0x6a6a68, hemi: 1.15, sun: 1.0, dogs: false },
];

type Geo = THREE.BufferGeometry;
interface Ctx {
  scene: THREE.Scene; group: THREE.Group; parts: Geo[]; obstacles: AABB[]; spawns: { x: number; z: number }[];
  saws: Saw[]; anims: ((t: number) => void)[];
  shelters: Shelter[]; npcs: NpcSpawn[]; cur: Geo[] | null; outfit: 'convict' | 'civil' | 'village';
}

function ctx(scene: THREE.Scene): Ctx {
  const group = new THREE.Group();
  scene.add(group);
  return { scene, group, parts: [], obstacles: [], spawns: [], saws: [], anims: [], shelters: [], npcs: [], cur: null, outfit: 'civil' };
}
const P = (c: Ctx, w: number, h: number, d: number, x: number, y: number, z: number, col: number) => { (c.cur ?? c.parts).push(box(w, h, d, x, y, z, col)); };
/** Ломаемый предмет: собирается в отдельный меш, медведи могут его разнести. */
const startProp = (c: Ctx) => { c.cur = []; };
function endProp(c: Ctx, x: number, z: number, hw: number, hd: number, hp: number, color: number): void {
  const m = new THREE.Mesh(merge(c.cur!), vcMat);
  c.cur = null;
  c.group.add(m);
  c.obstacles.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, mesh: m, hp, color });
}

/** Будка-укрытие: стены, дверь (её можно открыть/закрыть/сломать), полупрозрачная крыша. */
function addHut(c: Ctx, x: number, z: number, fz: number, wall: number, roof: number): void {
  const T = 0.3, hd = 1.3;
  P(c, 3.2, 2.2, T, x, 1.1, z - fz * (hd - T / 2), wall); O(c, x, z - fz * (hd - T / 2), 1.6, T / 2);
  P(c, T, 2.2, 2.6, x - 1.45, 1.1, z, wall); O(c, x - 1.45, z, T / 2, 1.3);
  P(c, T, 2.2, 2.6, x + 1.45, 1.1, z, wall); O(c, x + 1.45, z, T / 2, 1.3);
  const fzp = z + fz * (hd - T / 2);
  P(c, 1.05, 2.2, T, x - 1.075, 1.1, fzp, wall); O(c, x - 1.075, fzp, 0.525, T / 2);
  P(c, 1.05, 2.2, T, x + 1.075, 1.1, fzp, wall); O(c, x + 1.075, fzp, 0.525, T / 2);
  P(c, 1.1, 0.5, T, x, 1.95, fzp, wall);
  const rm = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.2, 3.0), new THREE.MeshLambertMaterial({ color: roof, transparent: true, opacity: 0.5 }));
  rm.position.set(x, 2.3, z); c.group.add(rm);
  const dm = new THREE.Mesh(merge([box(1.1, 1.9, 0.14, 0, 0.95, 0, 0x7a4a2a), box(0.12, 0.12, 0.18, 0.35, 0.95, 0, 0xffd24a)]), vcMat);
  dm.position.set(x, 0, fzp); c.group.add(dm);
  const door: AABB = { minX: x - 0.55, maxX: x + 0.55, minZ: fzp - 0.15, maxZ: fzp + 0.15, mesh: dm, hp: 90, color: 0x7a4a2a };
  c.obstacles.push(door);
  const sh: Shelter = {
    x, z, fz, door, doorMesh: dm,
    slots: [{ x: x - 0.8, z: z - fz * 0.55, occ: 0 }, { x: x + 0.8, z: z - fz * 0.55, occ: 0 }, { x: x - 0.8, z: z + fz * 0.15, occ: 0 }, { x: x + 0.8, z: z + fz * 0.15, occ: 0 }],
    outPt: { x, z: z + fz * (hd + 0.9) }, inPt: { x, z: z + fz * (hd - 0.65) },
    open: false, locked: false, broken: false, pending: 0,
  };
  door.shelter = sh;
  c.shelters.push(sh);
}
const O = (c: Ctx, x: number, z: number, hw: number, hd: number) => { c.obstacles.push({ minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd }); };

function colored(g: Geo, color: number): Geo {
  const col = new THREE.Color(color), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

function signAt(c: Ctx, text: string, w: number, h: number, bg: string, fg: string, x: number, y: number, z: number, rotY: number, fontPx = 34): void {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = Math.round(512 * h / w);
  const g = cv.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, cv.width, cv.height);
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, cv.width - 12, cv.height - 12);
  g.fillStyle = fg; g.font = `900 ${fontPx}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => g.fillText(l, cv.width / 2, cv.height / 2 + (i - (lines.length - 1) / 2) * (fontPx + 6)));
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
  m.position.set(x, y, z); m.rotation.y = rotY;
  c.group.add(m);
}

function floor(c: Ctx, a: string, b: string, grout: string, speckle = false): void {
  const fc = document.createElement('canvas');
  fc.width = fc.height = 128;
  const g = fc.getContext('2d')!;
  g.fillStyle = a; g.fillRect(0, 0, 128, 128);
  g.fillStyle = b; g.fillRect(0, 0, 64, 64); g.fillRect(64, 64, 64, 64);
  g.strokeStyle = grout; g.lineWidth = 2; g.strokeRect(0, 0, 128, 128);
  if (speckle) for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.7)' : 'rgba(150,170,200,.25)'; g.fillRect(Math.random() * 128, Math.random() * 128, 3, 3); }
  const tex = new THREE.CanvasTexture(fc);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(hx, hz);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const f = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 4, hz * 2 + 4), new THREE.MeshLambertMaterial({ map: tex }));
  f.rotation.x = -Math.PI / 2;
  c.group.add(f);
}

function walls(c: Ctx, low: number, up: number, lowH = 1.3, upH = 1.6): void {
  const T = 1;
  const w = (cx: number, cz: number, ww: number, dd: number) => { P(c, ww, lowH, dd, cx, lowH / 2, cz, low); P(c, ww, upH, dd, cx, lowH + upH / 2, cz, up); };
  w(0, -hz - T / 2, hx * 2 + T * 2, T); w(0, hz + T / 2, hx * 2 + T * 2, T);
  w(-hx - T / 2, 0, T, hz * 2); w(hx + T / 2, 0, T, hz * 2);
}

function windows(c: Ctx, zs: number[], glass = 0x8fd0ff, frame = 0xffffff): void {
  for (const z of zs) for (const s of [-1, 1]) {
    const x = s * (hx - 0.01);
    P(c, 0.1, 1.1, 1.8, x, 1.9, z, frame); P(c, 0.12, 0.9, 1.6, x, 1.9, z, glass); P(c, 0.14, 0.9, 0.08, x, 1.9, z, frame);
  }
}
function doors(c: Ctx, col: number): void {
  P(c, 2.0, 2.2, 0.1, 0, 1.1, -hz + 0.05, col); P(c, 2.0, 2.2, 0.1, 0, 1.1, hz - 0.05, col);
  P(c, 0.12, 0.12, 0.12, 0.7, 1.0, -hz + 0.15, 0xffd24a); P(c, 0.12, 0.12, 0.12, 0.7, 1.0, hz - 0.15, 0xffd24a);
}
function sideSpawns(c: Ctx): void {
  for (const z of [-12, -6, 0, 6, 12]) { c.spawns.push({ x: -hx + 0.8, z }, { x: hx - 0.8, z }); }
  c.spawns.push({ x: 0, z: -hz + 2.6 });
}

function finish(c: Ctx): Level {
  const mesh = new THREE.Mesh(merge(c.parts), vcMat);
  c.group.add(mesh);
  const anims = c.anims;
  return {
    obstacles: c.obstacles, spawns: c.spawns, group: c.group, saws: c.saws, shelters: c.shelters, npcs: c.npcs, outfit: c.outfit,
    anim: anims.length ? (t: number) => { for (const f of anims) f(t); } : null,
    dispose() {
      c.scene.remove(c.group);
      c.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as THREE.MeshBasicMaterial | undefined;
        if (mat && (mat as unknown) !== vcMat) { mat.map?.dispose(); mat.dispose(); }
      });
    },
  };
}

// ============================================================ СТОЛОВАЯ
function buildCanteen(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#d9d3bd', '#bdb69c', '#a49d85');
  walls(c, 0x3f7a5a, 0xeee6cc);
  windows(c, [-12, -6, 0, 6, 12]);
  doors(c, 0x7a4a2a);
  const cz = -hz + 1.0;
  P(c, 10.4, 0.9, 1.4, 0, 0.45, cz, 0x9aa0a6); P(c, 10.6, 0.1, 1.6, 0, 0.95, cz, 0xe0e4e8); P(c, 10.4, 0.08, 1.2, 0, 1.6, cz - 0.1, 0xb8d8e8);
  O(c, 0, cz, 5.3, 0.8);
  [-4, -2.2, -0.4, 1.4, 3.2].forEach((x, i) => { P(c, 0.8, 0.5, 0.8, x, 1.25, cz, i % 2 ? 0xc0392b : 0xd68910); P(c, 0.84, 0.08, 0.84, x, 1.54, cz, 0xcccccc); });
  for (let i = 0; i < 4; i++) P(c, 0.26, 0.4, 0.26, 3.9 + i * 0.3, 1.2, cz + 0.2, 0x6fb7d6);
  const trayCols = [0x3b6ea5, 0xb04a3a, 0x3b9a6a];
  for (const z of [-9, -3, 3, 9]) for (const s of [-1, 1]) {
    const x = s * 3.5;
    startProp(c);
    P(c, 3.0, 0.12, 1.4, x, 0.84, z, 0xc8a26a); P(c, 3.1, 0.04, 1.5, x, 0.76, z, 0x8a6a3a);
    for (const lx of [-1.3, 1.3]) for (const lz of [-0.55, 0.55]) P(c, 0.12, 0.8, 0.12, x + lx, 0.4, z + lz, 0x4a3a28);
    for (let k = 0; k < 3; k++) {
      const tx = x - 1.0 + k, tz = z + (k % 2 ? 0.2 : -0.2);
      P(c, 0.55, 0.04, 0.4, tx, 0.92, tz, trayCols[(k + (z > 0 ? 1 : 0)) % 3]); P(c, 0.2, 0.07, 0.2, tx - 0.1, 0.97, tz, 0x8a4b2a); P(c, 0.18, 0.08, 0.18, tx + 0.14, 0.98, tz, 0xc0392b);
    }
    endProp(c, x, z, 1.55, 0.75, 70, 0xc8a26a);
  }
  for (const [x, z] of [[-5.4, -12.2], [5.2, -6.4], [-1.2, 5.8], [1.6, -11], [-5.5, 12.4], [4.9, 11.9], [0.2, 0.4], [-0.8, -6.2]]) { P(c, 0.5, 0.1, 0.5, x, 0.2, z, 0x7a4a2a); P(c, 0.5, 0.5, 0.08, x, 0.45, z - 0.25, 0x7a4a2a); }
  for (const z of [-6, 6]) { P(c, 0.8, 3.0, 0.8, 0, 1.5, z, 0xeee6cc); P(c, 0.84, 0.5, 0.84, 0, 0.25, z, 0x3f7a5a); O(c, 0, z, 0.5, 0.5); }
  c.outfit = 'civil';
  c.npcs.push({ x: -1.1, z: -7.5, kind: 'coward' }, { x: 1.2, z: -1.0, kind: 'brave' }, { x: -1.0, z: 3.8, kind: 'coward' }, { x: 1.0, z: -11.5, kind: 'helper' });
  signAt(c, 'СТОЛОВАЯ №7\nОБЕД 12:00–15:00', 5, 1.3, '#f4efe0', '#8b1d1d', 0, 2.5, -hz + 0.12, 0);
  signAt(c, 'МЕДВЕДЕЙ\nНЕ КОРМИТЬ!', 3.2, 1.2, '#ffe14a', '#222222', -hx + 0.08, 2.4, -3, Math.PI / 2);
  signAt(c, 'КОМПОТ — 15₽\nДОБАВКА — НЕТ', 3.2, 1.2, '#f4efe0', '#1f4f8f', hx - 0.08, 2.4, 3, -Math.PI / 2, 32);
  signAt(c, 'ВЫХОДА НЕТ.\nТОЛЬКО БОРЩ.', 3.4, 1.1, '#2a1a1a', '#ff5a3a', 0, 2.5, hz - 0.12, Math.PI, 32);
  sideSpawns(c);
  return finish(c);
}

// ============================================================ БАРАК
function buildBarrack(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#7b5b3b', '#6c4e31', '#4a3520');
  walls(c, 0x7a5a38, 0x6b4c2e, 1.4, 1.6);
  for (const y of [0.35, 0.85, 1.35, 1.85, 2.35, 2.85]) {
    P(c, hx * 2, 0.07, 0.06, 0, y, -hz + 0.03, 0x4a331c); P(c, hx * 2, 0.07, 0.06, 0, y, hz - 0.03, 0x4a331c);
    P(c, 0.06, 0.07, hz * 2, -hx + 0.03, y, 0, 0x4a331c); P(c, 0.06, 0.07, hz * 2, hx - 0.03, y, 0, 0x4a331c);
  }
  windows(c, [-12, -5, 5, 12], 0xb8d8f0, 0x5a3a20);
  doors(c, 0x4a3018);
  const bunk = (x: number, z: number) => {
    for (const sx of [-0.7, 0.7]) for (const sz of [-1.1, 1.1]) P(c, 0.1, 1.9, 0.1, x + sx, 0.95, z + sz, 0x3a2a1a);
    for (const y of [0.55, 1.35]) {
      P(c, 1.5, 0.14, 2.3, x, y, z, 0x5a4a32); P(c, 1.4, 0.12, 1.5, x, y + 0.13, z + 0.3, 0x7a7a6a);
      P(c, 1.41, 0.125, 0.18, x, y + 0.135, z + 0.3, 0x9a3a2a); P(c, 0.8, 0.12, 0.5, x, y + 0.14, z - 0.85, 0xf0f0e8);
    }
    O(c, x, z, 0.85, 1.2);
  };
  for (const z of [-12.5, -8.5, -4.5, -0.5, 3.5]) bunk(-5.3, z);
  for (const z of [-10.5, -6.5, -2.5, 1.5, 5.5]) bunk(5.3, z);
  startProp(c);
  P(c, 1.2, 0.1, 5, 0, 0.8, -8, 0x8a6a40); P(c, 0.4, 0.08, 5, -1.0, 0.45, -8, 0x6a4a2a); P(c, 0.4, 0.08, 5, 1.0, 0.45, -8, 0x6a4a2a);
  for (const z of [-10, -6]) for (const x of [-0.5, 0.5]) P(c, 0.1, 0.8, 0.1, x, 0.4, z, 0x3a2a1a);
  P(c, 0.3, 0.2, 0.3, 0, 0.95, -9, 0xcccccc); P(c, 0.3, 0.2, 0.3, 0.2, 0.95, -7, 0x3b6ea5);
  endProp(c, 0, -8, 1.3, 2.6, 120, 0x8a6a40);
  P(c, 1.0, 1.2, 1.0, 0, 0.6, 1.5, 0x2a2a2a); P(c, 0.25, 2.2, 0.25, 0, 2.3, 1.5, 0x3a3a3a); P(c, 0.5, 0.35, 0.05, 0, 0.5, 2.02, 0xff7a20);
  O(c, 0, 1.5, 0.75, 0.75);
  addHut(c, 3.0, 10.8, -1, 0x6a4c2e, 0x4a331c);
  c.outfit = 'convict';
  c.npcs.push({ x: -2.2, z: -2, kind: 'coward' }, { x: 2.3, z: -4, kind: 'brave' }, { x: -2.2, z: 6.8, kind: 'coward' }, { x: 1.8, z: 3.2, kind: 'helper' });
  signAt(c, 'ТРУД ОБЛАГОРАЖИВАЕТ\nОТБОЙ В 22:00', 5, 1.3, '#e8dcc0', '#7a1a1a', 0, 2.5, -hz + 0.12, 0, 30);
  signAt(c, 'ПОРЯДОК\nИ ЧИСТОТА', 3.2, 1.2, '#e8dcc0', '#1f3f6f', -hx + 0.08, 2.4, 8, Math.PI / 2);
  signAt(c, 'НЕ КУРИТЬ!\nМЕДВЕДИ НЕ ПРОЙДУТ', 3.6, 1.2, '#ffe14a', '#222', 0, 2.5, hz - 0.12, Math.PI, 28);
  sideSpawns(c);
  return finish(c);
}

// ============================================================ ДЕРЕВНЯ ЗИМОЙ
function pine(c: Ctx, x: number, z: number, s: number): void {
  P(c, 0.3 * s, 0.9 * s, 0.3 * s, x, 0.45 * s, z, 0x5a3a20);
  [[1.9, 1.0], [1.5, 1.55], [1.1, 2.1], [0.7, 2.6]].forEach(([w, y]) => { P(c, w * s, 0.5 * s, w * s, x, y * s, z, 0x2a5a3a); P(c, w * s * 0.9, 0.1 * s, w * s * 0.9, x, (y + 0.28) * s, z, 0xf0f6ff); });
}
function buildVillage(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#eef3f8', '#e2eaf3', '#d3deea', true);
  const fx = hx - 0.05;
  for (let z = -hz; z <= hz; z += 2) for (const s of [-1, 1]) P(c, 0.14, 1.0, 0.14, s * fx, 0.5, z, 0x6a4a2a);
  for (let x = -hx; x <= hx; x += 2) for (const s of [-1, 1]) P(c, 0.14, 1.0, 0.14, x, 0.5, s * (hz - 0.05), 0x6a4a2a);
  for (const y of [0.85, 0.45]) {
    for (const s of [-1, 1]) { P(c, 0.08, 0.12, hz * 2, s * fx, y, 0, 0x7a5a38); P(c, hx * 2, 0.12, 0.08, 0, y, s * (hz - 0.05), 0x7a5a38); }
  }
  for (const s of [-1, 1]) { P(c, 0.2, 0.08, hz * 2, s * fx, 1.08, 0, 0xf4f8ff); P(c, hx * 2, 0.08, 0.2, 0, 1.08, s * (hz - 0.05), 0xf4f8ff); }
  for (let z = -hz; z <= hz; z += 2.6) { pine(c, -(hx + 1.2), z, 1.3); pine(c, hx + 1.2, z + 1.1, 1.2); }
  for (let x = -hx - 1; x <= hx + 1; x += 3) { pine(c, x, -(hz + 1.4), 1.3); pine(c, x + 1, hz + 1.4, 1.2); }
  // изба
  const ix = -2.8, iz = -11.7;
  P(c, 5.6, 2.2, 3.2, ix, 1.1, iz, 0x8c5a2c);
  for (const y of [0.4, 0.9, 1.4, 1.9]) P(c, 5.64, 0.07, 3.24, ix, y, iz, 0x6a3f1c);
  P(c, 6.0, 0.2, 3.6, ix, 2.3, iz, 0x5a3a20); P(c, 6.0, 0.5, 3.6, ix, 2.65, iz, 0xeef4fc);
  P(c, 0.55, 1.0, 0.55, ix + 1.8, 3.3, iz - 0.4, 0x7a3a2a); P(c, 0.65, 0.12, 0.65, ix + 1.8, 3.85, iz - 0.4, 0xeef4fc);
  for (const wx of [-1.9, 0.9]) { P(c, 1.1, 0.95, 0.06, ix + wx, 1.35, iz + 1.62, 0xffffff); P(c, 0.9, 0.75, 0.07, ix + wx, 1.35, iz + 1.63, 0xffe9a0); P(c, 0.3, 0.85, 0.08, ix + wx - 0.7, 1.35, iz + 1.64, 0x3a7ab0); P(c, 0.3, 0.85, 0.08, ix + wx + 0.7, 1.35, iz + 1.64, 0x3a7ab0); }
  P(c, 0.95, 1.7, 0.07, ix - 0.5, 0.85, iz + 1.62, 0x5a3a20);
  O(c, ix, iz, 2.8, 1.6);
  // сарай
  const sx = 3.9, sz = -4.0;
  P(c, 3.0, 2.0, 2.4, sx, 1.0, sz, 0x6e4e2e);
  for (const x of [-1.2, -0.4, 0.4, 1.2]) P(c, 0.06, 2.0, 2.44, sx + x, 1.0, sz, 0x4a321c);
  P(c, 3.4, 0.2, 2.8, sx, 2.1, sz, 0x4a321c); P(c, 3.4, 0.4, 2.8, sx, 2.4, sz, 0xeef4fc);
  P(c, 1.4, 1.6, 0.06, sx, 0.85, sz + 1.22, 0x16100a); P(c, 0.1, 1.7, 0.1, sx - 0.75, 0.85, sz + 1.25, 0x5a3a20); P(c, 0.1, 1.7, 0.1, sx + 0.75, 0.85, sz + 1.25, 0x5a3a20);
  O(c, sx, sz, 1.5, 1.2);
  // дрова, колодец, снеговик
  startProp(c);
  for (let i = 0; i < 3; i++) P(c, 1.6, 0.34, 1.0, -4.6, 0.17 + i * 0.34, 2.5, i % 2 ? 0x9a6a3a : 0x7a4a24);
  P(c, 1.7, 0.08, 1.1, -4.6, 1.06, 2.5, 0xeef4fc);
  endProp(c, -4.6, 2.5, 0.85, 0.55, 45, 0x9a6a3a);
  P(c, 1.0, 0.7, 1.0, 0.2, 0.35, 4.2, 0x7a7a80); P(c, 0.8, 0.12, 0.8, 0.2, 0.72, 4.2, 0x2a4a7a);
  P(c, 0.1, 1.5, 0.1, -0.2, 1.2, 4.2, 0x5a3a20); P(c, 0.1, 1.5, 0.1, 0.6, 1.2, 4.2, 0x5a3a20); P(c, 1.3, 0.12, 1.1, 0.2, 2.0, 4.2, 0x5a3a20); P(c, 1.4, 0.1, 1.2, 0.2, 2.1, 4.2, 0xeef4fc);
  O(c, 0.2, 4.2, 0.6, 0.6);
  startProp(c);
  P(c, 0.9, 0.9, 0.9, 4.4, 0.45, 9.2, 0xffffff); P(c, 0.7, 0.7, 0.7, 4.4, 1.25, 9.2, 0xffffff); P(c, 0.5, 0.5, 0.5, 4.4, 1.85, 9.2, 0xffffff);
  P(c, 0.4, 0.3, 0.4, 4.4, 2.2, 9.2, 0x222222); P(c, 0.1, 0.1, 0.4, 4.4, 1.85, 9.5, 0xff7a20); P(c, 0.08, 0.08, 0.02, 4.3, 1.95, 9.46, 0x111111); P(c, 0.08, 0.08, 0.02, 4.5, 1.95, 9.46, 0x111111);
  endProp(c, 4.4, 9.2, 0.5, 0.5, 30, 0xffffff);
  for (const [x, z, w] of [[5.3, 12.8, 2.2], [-5.2, -5.6, 1.8]]) P(c, w, 0.28, 1.1, x, 0.14, z, 0xf6faff);
  addHut(c, -3.8, 9.4, -1, 0x7a5a38, 0xeef4fc);
  c.outfit = 'village';
  c.npcs.push({ x: -1.6, z: -6.5, kind: 'coward' }, { x: 2.0, z: 0.5, kind: 'brave' }, { x: -2.6, z: 3.0, kind: 'coward' });
  signAt(c, 'д. ПОТАПОВО\nнас. 12 чел. · медведей 400', 4.6, 1.2, '#3a6a9a', '#fff', 2.6, 1.7, -hz + 0.2, 0, 28);
  sideSpawns(c);
  return finish(c);
}

// ============================================================ ЛЕСОПИЛКА
const CONVICT: CharDef = { id: 'convict', name: 'Зэк', emoji: '🧑‍🔧', desc: '', cost: 0, skin: 0xe8c09a, shirt: 0x4a4e54, pants: 0x34383e, hat: 'kepka', stripes: 'tel', hp: 1, speed: 1, rate: 1, dmg: 1, hitR: 0.4 };

function buildSawmill(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#c9a96e', '#bd9c60', '#a8884e');
  walls(c, 0x6d7d8c, 0x58666f, 1.4, 1.6);
  for (const x of [-4, -2, 0, 2, 4]) P(c, 0.05, 3.0, 0.05, x, 1.5, -hz + 0.04, 0x46525c);
  windows(c, [-9, 3], 0xffe9a0, 0x3a3a3a);
  doors(c, 0x3a4a3a);
  const logPile = (x: number, z: number, w: number, d: number) => {
    startProp(c);
    for (let i = 0; i < 3; i++) P(c, w - i * 0.3, 0.45, d, x, 0.22 + i * 0.45, z, [0x8a5a30, 0x7a4a28, 0x9a6a38][i]);
    endProp(c, x, z, w / 2, d / 2, 80, 0x8a5a30);
  };
  logPile(-3.6, -11.2, 3.2, 1.8); logPile(4.0, -10.6, 3.0, 1.8); logPile(-3.8, 10.6, 3.0, 1.8);
  for (const [x, z] of [[-4.5, 1.9], [4.6, -0.8]]) { startProp(c); for (let i = 0; i < 5; i++) P(c, 1.8, 0.16, 1.1, x, 0.1 + i * 0.17, z, i % 2 ? 0xd8b878 : 0xc8a868); endProp(c, x, z, 0.95, 0.6, 40, 0xd8b878); }
  // пильный стол
  P(c, 2.8, 0.9, 1.6, 0, 0.45, -2.5, 0x6a4a2a); P(c, 3.0, 0.1, 1.8, 0, 0.95, -2.5, 0x8a8a90); P(c, 0.1, 1.0, 1.0, 0, 1.45, -2.5, 0xc8d0d8); P(c, 0.5, 0.5, 0.5, 0, 1.15, -2.5, 0xe05a1a);
  O(c, 0, -2.5, 1.5, 0.9);
  // башня
  for (const sx of [-0.6, 0.6]) for (const sz of [-0.6, 0.6]) P(c, 0.15, 3.0, 0.15, 5.0 + sx, 1.5, 12.4 + sz, 0x4a3a28);
  P(c, 1.8, 0.2, 1.8, 5.0, 3.0, 12.4, 0x5a4a30); P(c, 1.6, 0.8, 1.6, 5.0, 3.5, 12.4, 0x6a5a40); P(c, 2.0, 0.15, 2.0, 5.0, 4.0, 12.4, 0x3a2a1a);
  O(c, 5.0, 12.4, 0.9, 0.9);
  // рельсы пил
  for (const z of [-6, 6]) P(c, 12.2, 0.05, 0.6, 0, 0.03, z, 0x3a3a3a);
  for (const z of [-6, 6]) for (const x of [-hx + 0.3, hx - 0.3]) P(c, 0.5, 0.5, 0.5, x, 0.25, z, 0x5a5a60);
  const mkSaw = (z: number, dir: number, speed: number) => {
    const gs: Geo[] = [colored(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 18), 0xc8d0d8), colored(new THREE.CylinderGeometry(0.2, 0.2, 0.16, 8), 0xe05a1a)];
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const t = box(0.22, 0.1, 0.22, Math.cos(a) * 0.9, 0, Math.sin(a) * 0.9, 0xa8b0b8); gs.push(t); }
    const m = new THREE.Mesh(merge(gs), vcMat);
    m.position.set(0, 0.25, z);
    c.group.add(m);
    c.saws.push({ mesh: m, x: dir * 3, z, r: 0.85, dir, speed, range: hx - 1.1 });
  };
  mkSaw(-6, 1, 3.4); mkSaw(6, -1, 2.8);
  addHut(c, -4.3, -3.2, 1, 0x58666f, 0x3a4650);
  addHut(c, 4.4, 3.6, -1, 0x58666f, 0x3a4650);
  c.outfit = 'convict';
  c.npcs.push({ x: -5.4, z: -8.6, kind: 'coward' }, { x: 5.3, z: -8.0, kind: 'brave' }, { x: -1.6, z: 3.5, kind: 'coward' }, { x: 1.6, z: 8.6, kind: 'helper' }, { x: -5.4, z: 8.0, kind: 'coward' });
  signAt(c, 'ЛЕСОЗАГОТОВКА №5\nРЕЖИМНЫЙ ОБЪЕКТ', 5, 1.3, '#f4efe0', '#222', 0, 2.5, -hz + 0.12, 0, 30);
  signAt(c, 'ПРОХОД\nВОСПРЕЩЁН', 3.2, 1.2, '#e03a2a', '#fff', -hx + 0.08, 2.4, -2, Math.PI / 2);
  signAt(c, 'ПИЛЫ ЕДУТ —\nНЕ ЗЕВАЙ!', 3.4, 1.2, '#ffe14a', '#222', hx - 0.08, 2.4, 0, -Math.PI / 2, 32);
  sideSpawns(c);
  return finish(c);
}

// ============================================================ БАНЯ
function buildBanya(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#a8814f', '#9a7545', '#6b4e2a');
  walls(c, 0xb88a52, 0xa8783f, 1.4, 1.6);
  for (let x = -hx + 1; x < hx; x += 1.2) P(c, 0.04, 3.0, 0.05, x, 1.5, -hz + 0.04, 0x7a5430);
  windows(c, [-9, 0, 9], 0xffd8a0, 0x6a4a2a);
  doors(c, 0x5a3a20);
  // полки-парилка у дальней стены
  P(c, 12.0, 0.9, 1.4, 0, 0.45, -hz + 0.9, 0xc89a60); P(c, 12.0, 0.9, 0.9, 0, 1.35, -hz + 0.6, 0xc89a60); P(c, 12.0, 0.8, 0.5, 0, 2.2, -hz + 0.4, 0xc89a60);
  O(c, 0, -hz + 0.9, 6.0, 0.9);
  // каменка
  P(c, 1.6, 0.9, 1.6, 4.2, 0.45, -8, 0x2a2a2a);
  for (let i = 0; i < 6; i++) P(c, 0.4, 0.3, 0.4, 3.7 + (i % 3) * 0.45, 1.0 + (i > 2 ? 0.25 : 0), -8.3 + (i > 2 ? 0.4 : 0), 0x6a6a70);
  P(c, 0.25, 2.6, 0.25, 4.7, 2.2, -8.6, 0x3a3a3a); P(c, 0.5, 0.5, 0.06, 4.2, 0.4, -7.18, 0xff7a20);
  O(c, 4.2, -8, 0.85, 0.85);
  // бочки, лавки, купель
  for (const [x, z] of [[-4.4, -7], [-4.4, -5.6]]) { startProp(c); P(c, 1.0, 1.1, 1.0, x, 0.55, z, 0x8a5a30); P(c, 1.04, 0.1, 1.04, x, 0.3, z, 0x3a3a3a); P(c, 1.04, 0.1, 1.04, x, 0.85, z, 0x3a3a3a); P(c, 0.85, 0.05, 0.85, x, 1.12, z, 0x3b7ab0); endProp(c, x, z, 0.55, 0.55, 35, 0x8a5a30); }
  for (const [x, z] of [[-3.5, -0.5], [3.4, 3.4]]) { P(c, 3.0, 0.14, 0.8, x, 0.55, z, 0xd8aa68); for (const lx of [-1.3, 1.3]) P(c, 0.14, 0.55, 0.7, x + lx, 0.28, z, 0x8a5a30); O(c, x, z, 1.5, 0.45); }
  P(c, 2.6, 0.9, 2.6, -4.2, 0.45, 6.6, 0x9a6a38); P(c, 2.2, 0.06, 2.2, -4.2, 0.92, 6.6, 0x4a9ae0);
  O(c, -4.2, 6.6, 1.3, 1.3);
  for (const [x, z] of [[2.0, -2.5], [-1.2, 11.0], [1.4, 8.2]]) { P(c, 0.5, 0.35, 0.5, x, 0.18, z, 0xc89a60); P(c, 0.4, 0.04, 0.4, x, 0.34, z, 0x4a9ae0); }
  for (let i = 0; i < 6; i++) { P(c, 0.3, 0.7, 0.18, -hx + 0.2, 2.0, -12 + i * 1.0 + 6 * (i > 2 ? 1 : 0), i % 2 ? 0x5a8a3a : 0x7a6a3a); }
  // пар — полупрозрачные слои, плывут
  const steams: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 7).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set((i - 2) * 1.4, 2.3 + i * 0.05, -8 + i * 5);
    c.group.add(m); steams.push(m);
  }
  c.anims.push(t => steams.forEach((m, i) => { m.position.x = Math.sin(t * 0.3 + i * 1.7) * 2.2; (m.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.05 * Math.sin(t * 0.8 + i); }));
  c.outfit = 'civil';
  c.npcs.push({ x: 1.5, z: -3, kind: 'coward' }, { x: -1.6, z: 3, kind: 'brave' }, { x: 1.2, z: 9.8, kind: 'coward' });
  signAt(c, 'ЛЁГКОГО ПАРА!\nСПИРТНОЕ НЕ ПРОНОСИТЬ', 5, 1.3, '#f0e0b8', '#7a1a1a', 0, 2.5, -hz + 0.12, 0, 28);
  signAt(c, 'ВЕНИК — 50₽\nМЕДВЕДЮ — БЕСПЛАТНО', 3.4, 1.2, '#f0e0b8', '#2a5a2a', hx - 0.08, 2.4, 4, -Math.PI / 2, 26);
  sideSpawns(c);
  return finish(c);
}

// ============================================================ ПОДЪЕЗД
function buildPodezd(scene: THREE.Scene): Level {
  const c = ctx(scene);
  floor(c, '#8c8c88', '#767672', '#505050');
  walls(c, 0x4a8a7a, 0xdcd8c8, 1.5, 1.5);
  windows(c, [-10, 2, 11], 0xa8c8e8, 0x8a8a8a);
  doors(c, 0x3a3a42);
  // почтовые ящики
  for (let i = 0; i < 10; i++) { P(c, 0.18, 0.4, 0.34, -hx + 0.1, 1.4 + (i % 2) * 0.45, -13 + (i >> 1) * 0.8, 0x7a8a96); P(c, 0.19, 0.05, 0.1, -hx + 0.11, 1.45 + (i % 2) * 0.45, -13 + (i >> 1) * 0.8, 0x222222); }
  // лестница
  for (let i = 0; i < 5; i++) P(c, 6.4, 0.3 * (i + 1), 0.8, -2.2, 0.15 * (i + 1), -hz + 0.4 + i * 0.8 - 0.4 + 0.0, 0x9a9a96);
  P(c, 0.1, 1.2, 4.2, 1.1, 1.1, -13, 0x3a3a3a); P(c, 0.14, 0.1, 4.2, 1.1, 1.7, -13, 0x7a4a2a);
  O(c, -2.2, -13, 3.2, 2.0);
  // лифт
  P(c, 2.4, 2.4, 0.2, 4.0, 1.2, -hz + 0.1, 0x8a8a90); P(c, 1.0, 2.2, 0.06, 3.5, 1.15, -hz + 0.22, 0xb0b0b8); P(c, 1.0, 2.2, 0.06, 4.5, 1.15, -hz + 0.22, 0xb0b0b8); P(c, 0.12, 0.12, 0.04, 5.4, 1.2, -hz + 0.22, 0xff3a2a);
  // батареи под окнами
  for (const z of [-10, 2, 11]) for (const s of [-1, 1]) P(c, 0.2, 0.6, 1.2, s * (hx - 0.12), 0.5, z, 0xf0f0f0);
  // препятствия: велосипед, коляска, мусорка, колонны, лавочка
  startProp(c);
  P(c, 1.9, 0.08, 0.1, -4.6, 0.5, -7.5, 0x2a2a2a); P(c, 0.1, 0.5, 0.1, -3.7, 0.45, -7.5, 0xc03a2a); P(c, 0.6, 0.6, 0.06, -5.2, 0.4, -7.5, 0x1a1a1a); P(c, 0.6, 0.6, 0.06, -4.0, 0.4, -7.5, 0x1a1a1a); P(c, 0.5, 0.08, 0.1, -5.2, 0.9, -7.5, 0x2a2a2a);
  endProp(c, -4.6, -7.5, 1.0, 0.45, 30, 0xc03a2a);
  startProp(c);
  P(c, 0.9, 0.4, 1.4, 4.5, 0.6, -5.4, 0x3a5a8a); P(c, 0.9, 0.6, 0.1, 4.5, 1.0, -4.7, 0x3a5a8a); P(c, 0.8, 0.1, 0.1, 4.5, 1.35, -4.7, 0x222222);
  for (const lz of [-5.9, -4.9]) for (const lx of [4.1, 4.9]) P(c, 0.28, 0.28, 0.1, lx, 0.15, lz, 0x111111);
  endProp(c, 4.5, -5.4, 0.55, 0.85, 30, 0x3a5a8a);
  startProp(c);
  for (const [x, z] of [[4.8, 6.4], [5.4, 7.2]]) { P(c, 0.9, 1.0, 0.9, x, 0.5, z, 0x3a6a3a); P(c, 0.95, 0.1, 0.95, x, 1.02, z, 0x1a3a1a); }
  endProp(c, 5.1, 6.8, 0.9, 0.9, 40, 0x3a6a3a);
  for (const z of [-3, 4]) for (const x of [-2.4, 2.4]) { P(c, 0.9, 3.0, 0.9, x, 1.5, z, 0xd0ccbc); P(c, 0.94, 0.5, 0.94, x, 0.25, z, 0x4a8a7a); O(c, x, z, 0.55, 0.55); }
  P(c, 1.6, 0.1, 0.5, -4.8, 0.5, 6.0, 0x7a4a2a); P(c, 1.6, 0.4, 0.08, -4.8, 0.8, 5.8, 0x7a4a2a); P(c, 0.1, 0.5, 0.4, -5.5, 0.25, 6.0, 0x3a3a3a); P(c, 0.1, 0.5, 0.4, -4.1, 0.25, 6.0, 0x3a3a3a);
  O(c, -4.8, 6.0, 0.85, 0.3);
  c.outfit = 'village';
  c.npcs.push({ x: -0.2, z: -8.5, kind: 'coward' }, { x: 1.0, z: 1.0, kind: 'brave' }, { x: -1.0, z: 9.0, kind: 'coward' });
  signAt(c, 'ЛИФТ НЕ РАБОТАЕТ\nС 1997 ГОДА', 4, 1.2, '#f4efe0', '#8b1d1d', 3.9, 2.7, -hz + 0.12, 0, 28);
  signAt(c, 'КУРИТЬ В ПОДЪЕЗДЕ\nЗАПРЕЩЕНО! (МЕДВЕДЯМ ТОЖЕ)', 5, 1.2, '#ffe14a', '#222', 0, 2.5, hz - 0.12, Math.PI, 24);
  signAt(c, 'ДОМОФОН\nкод: 1234', 2.8, 1.1, '#2a2a30', '#ffd24a', hx - 0.08, 2.2, 8, -Math.PI / 2, 28);
  sideSpawns(c);
  return finish(c);
}

export function buildLocation(id: string, scene: THREE.Scene): Level {
  switch (id) {
    case 'barrack': return buildBarrack(scene);
    case 'village': return buildVillage(scene);
    case 'sawmill': return buildSawmill(scene);
    case 'banya': return buildBanya(scene);
    case 'podezd': return buildPodezd(scene);
    default: return buildCanteen(scene);
  }
}

/** Выталкивает окружность из прямоугольников и арены. Возвращает скорректированную точку. */
export function resolveCircle(x: number, z: number, r: number, obs: AABB[], out: { x: number; z: number }): AABB | null {
  let hit: AABB | null = null;
  const lx = ARENA.hx - r, lz = ARENA.hz - r;
  if (x < -lx) x = -lx; else if (x > lx) x = lx;
  if (z < -lz) z = -lz; else if (z > lz) z = lz;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    if (o.off) continue;
    const cx = x < o.minX ? o.minX : x > o.maxX ? o.maxX : x;
    const cz = z < o.minZ ? o.minZ : z > o.maxZ ? o.maxZ : z;
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
      hit = o;
      if (d2 > 1e-8) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * r; z = cz + (dz / d) * r;
      } else { // центр внутри бокса — выталкиваем по ближайшей грани
        const l = x - o.minX, rr = o.maxX - x, t = z - o.minZ, b = o.maxZ - z;
        const m = Math.min(l, rr, t, b);
        if (m === l) x = o.minX - r; else if (m === rr) x = o.maxX + r; else if (m === t) z = o.minZ - r; else z = o.maxZ + r;
      }
    }
  }
  if (x < -lx) x = -lx; else if (x > lx) x = lx;
  if (z < -lz) z = -lz; else if (z > lz) z = lz;
  out.x = x; out.z = z;
  return hit;
}

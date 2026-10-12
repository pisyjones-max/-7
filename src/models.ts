// Кубические персонажи. Каждая часть тела — одна склеенная геометрия с цветами вершин:
// 6 draw-calls на героя, никаких текстур.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CharDef, EnemyDef } from './data';

export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const flashMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
export const warnMat = new THREE.MeshBasicMaterial({ color: 0xff3a2a });

type Geo = THREE.BufferGeometry;

export function box(w: number, h: number, d: number, x: number, y: number, z: number, color: number, rotZ = 0): Geo {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}

export function merge(parts: Geo[]): Geo {
  const g = mergeGeometries(parts, false);
  parts.forEach(p => p.dispose());
  if (!g) throw new Error('merge failed');
  return g;
}

export interface Rig {
  root: THREE.Group;
  body: THREE.Mesh;
  head: THREE.Mesh;
  legL: THREE.Mesh;
  legR: THREE.Mesh;
  armL: THREE.Mesh;
  armR: THREE.Mesh;
  meshes: THREE.Mesh[];
  pitch: THREE.Group | null;
}

interface GeoSet { body: Geo; head: Geo; leg: Geo; armL: Geo; armR: Geo }
const cache = new Map<string, GeoSet>();

function mesh(g: Geo, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(g, vcMat);
  m.position.set(x, y, z);
  return m;
}

function assemble(set: GeoSet, pos: { legY: number; legX: number; bodyY: number; headY: number; armY: number; armX: number }): Rig {
  const root = new THREE.Group();
  const legL = mesh(set.leg, -pos.legX, pos.legY, 0);
  const legR = mesh(set.leg, pos.legX, pos.legY, 0);
  const body = mesh(set.body, 0, pos.bodyY, 0);
  const head = mesh(set.head, 0, pos.headY, 0);
  const armL = mesh(set.armL, -pos.armX, pos.armY, 0);
  const armR = mesh(set.armR, pos.armX, pos.armY, 0);
  root.add(legL, legR, body, head, armL, armR);
  return { root, body, head, legL, legR, armL, armR, meshes: [legL, legR, body, head, armL, armR], pitch: null };
}

/** Медведь: туловище на «шарнире» в бёдрах — может идти на четырёх лапах или вставать на задние. */
function assembleBear(set: GeoSet): Rig {
  const root = new THREE.Group();
  const pitch = new THREE.Group();
  pitch.position.set(0, 0.78, 0);
  const legL = mesh(set.leg, -0.24, 0.45, 0);
  const legR = mesh(set.leg, 0.24, 0.45, 0);
  const body = mesh(set.body, 0, 0.1, 0);
  const head = mesh(set.head, 0, 0.87, 0);
  const armL = mesh(set.armL, -0.6, 0.42, 0);
  const armR = mesh(set.armR, 0.6, 0.42, 0);
  pitch.add(body, head, armL, armR);
  root.add(legL, legR, pitch);
  return { root, body, head, legL, legR, armL, armR, meshes: [legL, legR, body, head, armL, armR], pitch };
}

/** rear: 0 = на четырёх лапах, 1 = встал во весь рост и пугает. */
export function animateBear(rig: Rig, t: number, moving: number, rear: number): void {
  const quad = 1 - rear;
  const pitch = quad * Math.PI * 0.46;
  const p = rig.pitch!;
  p.rotation.x = pitch;
  p.position.y = 0.78 + Math.abs(Math.sin(t * 11)) * 0.07 * moving * quad;
  rig.body.scale.y = 1 + quad * 0.5;
  rig.body.position.y = 0.1 + quad * 0.1;
  const swing = Math.sin(t * 11) * 0.75 * moving;
  rig.legL.rotation.x = -swing * quad + rear * Math.sin(t * 6) * 0.1;
  rig.legR.rotation.x = swing * quad - rear * Math.sin(t * 6) * 0.1;
  rig.legL.position.z = rig.legR.position.z = -0.12 * quad;
  const wave = Math.sin(t * 10) * 0.35;
  rig.armL.rotation.x = -pitch + swing * quad + rear * (-2.3 + wave);
  rig.armR.rotation.x = -pitch - swing * quad + rear * (-2.3 - wave);
  rig.armL.rotation.z = -0.35 * rear; rig.armR.rotation.z = 0.35 * rear;
  rig.head.position.y = 0.87 - quad * 0.12;
  rig.head.rotation.x = -pitch * 0.82 - rear * (0.2 + 0.18 * Math.sin(t * 22));
}

// ---------------- ЛЮДИ ----------------
export function buildHuman(def: CharDef): Rig {
  let set = cache.get('h' + def.id);
  if (!set) {
    const skin = def.skin;
    const headP: Geo[] = [
      box(0.5, 0.5, 0.5, 0, 0, 0, skin),
      box(0.08, 0.1, 0.02, -0.12, 0.04, 0.255, 0x111111),
      box(0.08, 0.1, 0.02, 0.12, 0.04, 0.255, 0x111111),
      box(0.15, 0.04, 0.02, 0, -0.12, 0.255, 0x7a2a2a),
    ];
    switch (def.hat) {
      case 'ushanka':
        headP.push(box(0.58, 0.18, 0.58, 0, 0.32, 0, 0x7b5230), box(0.1, 0.3, 0.3, -0.3, 0.1, 0, 0x7b5230), box(0.1, 0.3, 0.3, 0.3, 0.1, 0, 0x7b5230), box(0.1, 0.1, 0.02, 0, 0.34, 0.3, 0xdd2222));
        break;
      case 'platok':
        headP.push(box(0.58, 0.2, 0.58, 0, 0.3, 0, 0xd23a4a), box(0.58, 0.36, 0.12, 0, 0.1, -0.24, 0xd23a4a), box(0.14, 0.14, 0.14, 0, 0.2, 0.3, 0xb02030));
        break;
      case 'kepka':
        headP.push(box(0.56, 0.12, 0.56, 0, 0.3, 0, 0x2a2a2a), box(0.5, 0.05, 0.28, 0, 0.25, 0.4, 0x2a2a2a), box(0.28, 0.06, 0.02, 0, -0.02, 0.26, 0x222222));
        break;
      case 'panama':
        headP.push(box(0.5, 0.14, 0.5, 0, 0.32, 0, 0xe8dca0), box(0.82, 0.04, 0.82, 0, 0.26, 0, 0xe8dca0), box(0.4, 0.22, 0.1, 0, -0.22, 0.22, 0xdddddd));
        break;
      case 'cat':
        headP.push(box(0.14, 0.18, 0.1, -0.17, 0.34, 0, skin), box(0.14, 0.18, 0.1, 0.17, 0.34, 0, skin), box(0.08, 0.05, 0.02, 0, -0.03, 0.26, 0xff9aa8));
        break;
    }
    const bodyP: Geo[] = [box(0.6, 0.62, 0.36, 0, 0, 0, def.shirt)];
    if (def.stripes === 'tel') for (let i = 0; i < 4; i++) bodyP.push(box(0.61, 0.07, 0.37, 0, -0.24 + i * 0.16, 0, 0xf0f0f0));
    if (def.stripes === 'adidas') bodyP.push(box(0.06, 0.62, 0.37, -0.2, 0, 0, 0xffffff), box(0.06, 0.62, 0.37, 0.2, 0, 0, 0xffffff));
    if (def.hat === 'cat') bodyP.push(box(0.1, 0.1, 0.45, 0, -0.15, -0.35, skin), box(0.1, 0.25, 0.1, 0, 0.0, -0.55, skin));
    const legP: Geo[] = [box(0.22, 0.5, 0.24, 0, -0.25, 0, def.pants), box(0.24, 0.1, 0.3, 0, -0.45, 0.03, 0x222222)];
    const armBase = (): Geo[] => [box(0.16, 0.3, 0.16, 0, -0.15, 0, def.shirt), box(0.14, 0.26, 0.14, 0, -0.42, 0, skin)];
    const armLP = armBase();
    const armRP = armBase();
    // поварёшка в правой руке
    armRP.push(box(0.05, 0.5, 0.05, 0, -0.75, 0, 0xbbbbbb), box(0.2, 0.2, 0.08, 0, -1.07, 0, 0xd8d8d8));
    set = { body: merge(bodyP), head: merge(headP), leg: merge(legP), armL: merge(armLP), armR: merge(armRP) };
    cache.set('h' + def.id, set);
  }
  const rig = assemble(set, { legY: 0.5, legX: 0.15, bodyY: 0.81, headY: 1.38, armY: 1.05, armX: 0.4 });
  rig.root.scale.setScalar(def.hat === 'cat' ? 0.78 : 1);
  return rig;
}

// ---------------- МЕДВЕДИ ----------------
export function buildBear(def: EnemyDef): Rig {
  let set = cache.get('b' + def.id);
  const fur = def.fur;
  const belly = def.belly;
  if (!set) {
    const boss = def.boss;
    const eyeCol = def.id === 'mutant' ? 0xffee00 : def.id === 'dog' ? 0xffc010 : 0xff1a1a;
    const headP: Geo[] = [
      box(0.75, 0.65, 0.65, 0, 0, 0, fur),
      box(0.36, 0.26, 0.25, 0, -0.1, 0.4, belly),
      box(0.12, 0.08, 0.06, 0, -0.02, 0.54, 0x111111),
      box(0.22, 0.22, 0.12, -0.3, 0.38, 0, fur), box(0.22, 0.22, 0.12, 0.3, 0.38, 0, fur),
      box(0.12, 0.12, 0.02, -0.3, 0.38, 0.07, 0x5a3a2a), box(0.12, 0.12, 0.02, 0.3, 0.38, 0.07, 0x5a3a2a),
      box(0.15, 0.1, 0.02, -0.17, 0.1, 0.33, 0xffffff), box(0.15, 0.1, 0.02, 0.17, 0.1, 0.33, 0xffffff),
      box(0.07, 0.08, 0.02, -0.15, 0.1, 0.34, eyeCol), box(0.07, 0.08, 0.02, 0.15, 0.1, 0.34, eyeCol),
      box(0.26, 0.07, 0.03, -0.16, 0.2, 0.35, 0x111111, -0.5), box(0.26, 0.07, 0.03, 0.16, 0.2, 0.35, 0x111111, 0.5),
      box(0.3, 0.1, 0.02, 0, -0.2, 0.52, 0x5a0a0a),
      box(0.06, 0.09, 0.03, -0.11, -0.17, 0.53, 0xffffff), box(0.06, 0.09, 0.03, 0.11, -0.17, 0.53, 0xffffff), box(0.05, 0.07, 0.03, -0.03, -0.18, 0.53, 0xffffff), box(0.05, 0.07, 0.03, 0.03, -0.18, 0.53, 0xffffff),
    ];
    const bodyP: Geo[] = [box(0.95, 0.85, 0.7, 0, 0, 0, fur), box(0.66, 0.6, 0.02, 0, -0.04, 0.36, belly)];
    const legP: Geo[] = [box(0.3, 0.45, 0.32, 0, -0.225, 0, fur), box(0.32, 0.08, 0.36, 0, -0.4, 0.03, 0x2a1a10)];
    const armP = (): Geo[] => [box(0.28, 0.7, 0.3, 0, -0.35, 0, fur), box(0.05, 0.07, 0.08, -0.08, -0.72, 0.12, 0xf0f0f0), box(0.05, 0.07, 0.08, 0.08, -0.72, 0.12, 0xf0f0f0)];
    const armLP = armP(); const armRP = armP();

    switch (def.id) {
      case 'cub':
        headP.push(box(0.2, 0.08, 0.04, 0, -0.27, 0.34, 0xdd3333)); // язык наглеца
        break;
      case 'dog':
        headP.push(box(0.13, 0.34, 0.1, -0.2, 0.52, 0, fur), box(0.13, 0.34, 0.1, 0.2, 0.52, 0, fur), box(0.3, 0.2, 0.3, 0, -0.1, 0.62, belly), box(0.14, 0.2, 0.04, 0, -0.3, 0.5, 0xdd3355));
        bodyP.push(box(0.14, 0.55, 0.14, 0, -0.62, -0.1, fur));
        break;
      case 'tank': // кастрюля-шлем и нагрудник из крышек
        headP.push(box(0.92, 0.42, 0.92, 0, 0.5, 0, 0x9aa0a8), box(0.22, 0.12, 0.14, -0.57, 0.5, 0, 0x6a7078), box(0.22, 0.12, 0.14, 0.57, 0.5, 0, 0x6a7078), box(0.6, 0.06, 0.04, 0, 0.3, 0.46, 0x666c74));
        bodyP.push(box(1.0, 0.7, 0.12, 0, 0, 0.38, 0x8c929a), box(0.1, 0.1, 0.04, -0.3, 0.2, 0.46, 0xdddddd), box(0.1, 0.1, 0.04, 0.3, 0.2, 0.46, 0xdddddd), box(0.1, 0.1, 0.04, 0, -0.2, 0.46, 0xdddddd));
        armLP.push(box(0.34, 0.2, 0.34, 0, -0.08, 0, 0x8c929a)); armRP.push(box(0.34, 0.2, 0.34, 0, -0.08, 0, 0x8c929a));
        break;
      case 'fisher':
        headP.push(box(0.85, 0.2, 0.85, 0, 0.42, 0, 0xf2c230), box(0.6, 0.05, 0.3, 0, 0.33, 0.5, 0xf2c230));
        bodyP.push(box(1.0, 0.62, 0.74, 0, 0.12, 0, 0xf2c230));
        armRP.push(box(0.12, 0.2, 0.55, 0, -0.78, 0.1, 0x6aa0c8), box(0.04, 0.12, 0.1, 0, -0.78, 0.4, 0x6aa0c8));
        break;
      case 'potap': // в ушанке и с золотой цепью
        headP.push(box(0.84, 0.2, 0.84, 0, 0.42, 0, 0x7b5230), box(0.12, 0.34, 0.4, -0.45, 0.2, 0, 0x7b5230), box(0.12, 0.34, 0.4, 0.45, 0.2, 0, 0x7b5230), box(0.16, 0.16, 0.03, 0, 0.45, 0.43, 0xdd2222));
        bodyP.push(box(0.8, 0.07, 0.03, 0, 0.3, 0.37, 0xffd24a), box(0.18, 0.18, 0.04, 0, 0.14, 0.38, 0xffd24a));
        break;
      case 'mutant':
        headP.push(box(0.12, 0.34, 0.12, -0.2, 0.55, 0, 0x7b3fe4), box(0.12, 0.44, 0.12, 0, 0.6, -0.1, 0x7b3fe4), box(0.12, 0.34, 0.12, 0.2, 0.55, 0, 0x7b3fe4));
        bodyP.push(box(0.3, 0.3, 0.3, -0.55, 0.42, 0, 0x7b3fe4), box(0.3, 0.3, 0.3, 0.55, 0.42, 0, 0x7b3fe4), box(0.2, 0.4, 0.2, 0, 0.1, -0.42, 0x7b3fe4));
        break;
      default: break;
    }
    set = { body: merge(bodyP), head: merge(headP), leg: merge(legP), armL: merge(armLP), armR: merge(armRP) };
    cache.set('b' + def.id, set);
  }
  const rig = assembleBear(set);
  rig.head.scale.setScalar(def.id === 'cub' ? 1.28 : 1.15);
  rig.root.scale.setScalar(def.size);
  return rig;
}

export function animateRig(rig: Rig, t: number, moving: number, human: boolean, aiming: boolean): void {
  const sw = Math.sin(t * 11) * 0.8 * moving;
  rig.legL.rotation.x = sw;
  rig.legR.rotation.x = -sw;
  const bob = Math.abs(Math.sin(t * 11)) * 0.05 * moving;
  rig.body.position.y = (human ? 0.81 : 0.88) + bob;
  rig.head.position.y = (human ? 1.38 : 1.65) + bob;
  if (human) {
    rig.armL.rotation.x = -sw * 0.9;
    rig.armR.rotation.x = aiming ? -1.45 : sw * 0.9;
  } else {
    rig.armL.rotation.x = -1.2 + Math.sin(t * 7) * 0.25 * moving;
    rig.armR.rotation.x = -1.2 - Math.sin(t * 7) * 0.25 * moving;
  }
}

export function setFlash(rig: Rig, mat: THREE.Material | null): void {
  for (const m of rig.meshes) m.material = mat ?? vcMat;
}

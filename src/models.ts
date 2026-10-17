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

function paint(g: Geo, color: number): Geo {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return g;
}
function shape(g: Geo, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0): Geo {
  g.scale(sx, sy, sz);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return paint(g, color);
}
/** Округлые формы для медведей: эллипсоиды, капсулы, конусы. */
const ball = (r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => shape(new THREE.SphereGeometry(r, 9, 7), color, x, y, z, sx, sy, sz, rx, rz);
const caps = (r: number, len: number, color: number, x: number, y: number, z: number, rx = 0, rz = 0) => shape(new THREE.CapsuleGeometry(r, len, 3, 8), color, x, y, z, 1, 1, 1, rx, rz);
const cone = (r: number, h: number, color: number, x: number, y: number, z: number, rx = 0, rz = 0) => shape(new THREE.ConeGeometry(r, h, 6), color, x, y, z, 1, 1, 1, rx, rz);
const cyl = (rt: number, rb: number, h: number, color: number, x: number, y: number, z: number) => shape(new THREE.CylinderGeometry(rt, rb, h, 12), color, x, y, z);

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
  let set = cache.get('bs' + def.id);
  const fur = def.fur;
  const belly = def.belly;
  if (!set) {
    const shade = (c: number, k: number) => new THREE.Color(c).multiplyScalar(k).getHex();
    const eyeCol = def.id === 'mutant' ? 0xffee00 : def.id === 'dog' ? 0xffc010 : 0xff2a00;
    const fur = def.id === 'mutant' ? def.fur : shade(def.fur, 0.75);
    const belly = shade(def.belly, 0.8);
    const dark = shade(fur, 0.55);
    const bone = 0xf4efe0;
    const headP: Geo[] = [
      ball(1, fur, 0, 0, 0, 0.42, 0.35, 0.38),                                                     // череп
      ball(1, fur, -0.3, -0.06, 0.1, 0.18, 0.22, 0.22), ball(1, fur, 0.3, -0.06, 0.1, 0.18, 0.22, 0.22), // тяжёлые щёки
      ball(1, dark, 0, 0.17, 0.27, 0.4, 0.07, 0.1),                                                // нависшая бровь
      ball(1, belly, 0, -0.1, 0.38, 0.2, 0.15, 0.3),                                               // морда
      ball(0.075, 0x0a0a0a, 0, -0.01, 0.65),                                                       // нос
      ball(0.09, fur, -0.27, 0.27, -0.06), ball(0.09, fur, 0.27, 0.27, -0.06),                     // маленькие злые уши
      ball(1, 0x070707, -0.16, 0.08, 0.31, 0.11, 0.075, 0.06), ball(1, 0x070707, 0.16, 0.08, 0.31, 0.11, 0.075, 0.06), // тёмные глазницы
      ball(1, eyeCol, -0.155, 0.08, 0.35, 0.075, 0.04, 0.04, 0, -0.35), ball(1, eyeCol, 0.155, 0.08, 0.35, 0.075, 0.04, 0.04, 0, 0.35), // красные щёлки
      ball(1, 0x4a0808, 0, -0.2, 0.38, 0.16, 0.07, 0.24),                                          // раскрытая пасть
      ball(1, fur, 0, -0.3, 0.33, 0.16, 0.06, 0.2),                                                // нижняя челюсть
      cone(0.035, 0.17, bone, -0.08, -0.2, 0.55, Math.PI), cone(0.035, 0.17, bone, 0.08, -0.2, 0.55, Math.PI), // клыки сверху
      cone(0.028, 0.1, bone, -0.15, -0.19, 0.45, Math.PI), cone(0.028, 0.1, bone, 0.15, -0.19, 0.45, Math.PI),
      cone(0.03, 0.13, bone, -0.07, -0.29, 0.5), cone(0.03, 0.13, bone, 0.07, -0.29, 0.5),         // клыки снизу
      ball(1, 0x9a1a1a, -0.14, 0.02, 0.35, 0.12, 0.012, 0.012, 0, 0.7),                            // шрам
    ];
    const bodyP: Geo[] = [
      ball(1, fur, 0, 0, 0, 0.54, 0.5, 0.42),
      ball(1, fur, 0, 0.3, -0.1, 0.5, 0.36, 0.36),                                                 // мощный горб
      ball(1, fur, -0.42, 0.28, 0.02, 0.24, 0.26, 0.26), ball(1, fur, 0.42, 0.28, 0.02, 0.24, 0.26, 0.26), // плечи
      ball(1, belly, 0, -0.05, 0.28, 0.34, 0.36, 0.18),
      cone(0.08, 0.26, dark, 0, 0.58, -0.12, -0.4), cone(0.07, 0.22, dark, 0, 0.5, -0.3, -0.9),    // шерсть дыбом
      cone(0.07, 0.2, dark, -0.22, 0.52, -0.1, -0.5, -0.3), cone(0.07, 0.2, dark, 0.22, 0.52, -0.1, -0.5, 0.3),
    ];
    const legP: Geo[] = [
      caps(0.18, 0.26, fur, 0, -0.17, 0), ball(1, dark, 0, -0.38, 0.08, 0.2, 0.09, 0.28),
      cone(0.03, 0.12, bone, -0.08, -0.4, 0.3, Math.PI / 2), cone(0.03, 0.12, bone, 0, -0.4, 0.32, Math.PI / 2), cone(0.03, 0.12, bone, 0.08, -0.4, 0.3, Math.PI / 2),
    ];
    const armP = (): Geo[] => [
      caps(0.18, 0.4, fur, 0, -0.3, 0),
      cone(0.045, 0.2, bone, -0.09, -0.82, 0.08, Math.PI), cone(0.045, 0.22, bone, 0, -0.84, 0.1, Math.PI), cone(0.045, 0.2, bone, 0.09, -0.82, 0.08, Math.PI),
    ];
    const armLP = armP(); const armRP = armP();

    switch (def.id) {
      case 'cub':
        headP.push(ball(1, 0xdd3333, 0, -0.27, 0.34, 0.09, 0.03, 0.06));
        break;
      case 'dog':
        headP.push(cone(0.1, 0.34, fur, -0.2, 0.5, 0), cone(0.1, 0.34, fur, 0.2, 0.5, 0), ball(1, belly, 0, -0.1, 0.45, 0.17, 0.13, 0.3));
        bodyP.push(caps(0.06, 0.45, fur, 0, -0.64, -0.12));
        break;
      case 'tank': // кастрюля-шлем и нагрудник из крышек
        headP.push(cyl(0.46, 0.5, 0.38, 0x9aa0a8, 0, 0.46, 0), cyl(0.54, 0.54, 0.06, 0x666c74, 0, 0.28, 0), ball(0.1, 0x6a7078, -0.52, 0.46, 0), ball(0.1, 0x6a7078, 0.52, 0.46, 0));
        bodyP.push(ball(1, 0x8c929a, 0, 0, 0.3, 0.46, 0.34, 0.16), ball(0.06, 0xdddddd, -0.2, 0.15, 0.44), ball(0.06, 0xdddddd, 0.2, 0.15, 0.44), ball(0.06, 0xdddddd, 0, -0.15, 0.44));
        armLP.push(ball(0.19, 0x8c929a, 0, -0.06, 0)); armRP.push(ball(0.19, 0x8c929a, 0, -0.06, 0));
        break;
      case 'fisher':
        headP.push(cyl(0.38, 0.42, 0.18, 0xf2c230, 0, 0.4, 0), cyl(0.55, 0.55, 0.04, 0xf2c230, 0, 0.31, 0.08));
        bodyP.push(ball(1, 0xf2c230, 0, 0.1, 0.02, 0.56, 0.36, 0.44));
        armRP.push(ball(1, 0x6aa0c8, 0, -0.7, 0.14, 0.08, 0.22, 0.08, 0.5), cone(0.07, 0.14, 0x6aa0c8, 0, -0.9, 0.2, 2.2));
        break;
      case 'potap': // в ушанке и с золотой цепью
        headP.push(ball(1, 0x7b5230, 0, 0.36, 0, 0.46, 0.22, 0.45), ball(1, 0x7b5230, -0.42, 0.1, 0, 0.12, 0.3, 0.28), ball(1, 0x7b5230, 0.42, 0.1, 0, 0.12, 0.3, 0.28), ball(0.08, 0xdd2222, 0, 0.42, 0.38, 1, 1, 0.3));
        bodyP.push(ball(1, 0xffd24a, 0, 0.2, 0.34, 0.32, 0.05, 0.06), ball(0.09, 0xffd24a, 0, 0.08, 0.4, 1, 1, 0.5));
        break;
      case 'mutant':
        headP.push(cone(0.07, 0.34, 0x7b3fe4, -0.2, 0.52, 0), cone(0.08, 0.46, 0x7b3fe4, 0, 0.6, -0.1), cone(0.07, 0.34, 0x7b3fe4, 0.2, 0.52, 0));
        bodyP.push(ball(0.21, 0x7b3fe4, -0.55, 0.4, 0), ball(0.21, 0x7b3fe4, 0.55, 0.4, 0), cone(0.09, 0.42, 0x7b3fe4, 0, 0.42, -0.5, -1.3), cone(0.08, 0.36, 0x7b3fe4, -0.2, 0.2, -0.45, -1.3), cone(0.08, 0.36, 0x7b3fe4, 0.2, 0.2, -0.45, -1.3));
        break;
      default: break;
    }
    set = { body: merge(bodyP), head: merge(headP), leg: merge(legP), armL: merge(armLP), armR: merge(armRP) };
    cache.set('bs' + def.id, set);
  }
  const rig = assembleBear(set);
  rig.head.scale.setScalar(def.id === 'cub' ? 1.25 : 1.3);
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

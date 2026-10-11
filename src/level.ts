// Уровень «Столовая №7»: весь статический декор склеен в 2 меша.
import * as THREE from 'three';
import { box, merge, vcMat } from './models';

export interface AABB { minX: number; maxX: number; minZ: number; maxZ: number }

export const ARENA = { hx: 6.2, hz: 15 };

export interface Level {
  obstacles: AABB[];
  spawns: { x: number; z: number }[];
  group: THREE.Group;
}

function sign(text: string, w: number, h: number, bg: string, fg: string, fontPx = 34): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512; c.height = Math.round(512 * h / w);
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = fg; g.lineWidth = 8; g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = fg; g.font = `900 ${fontPx}px Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * (fontPx + 6)));
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
}

export function buildCanteen(scene: THREE.Scene): Level {
  const group = new THREE.Group();
  scene.add(group);
  const { hx, hz } = ARENA;
  const obstacles: AABB[] = [];

  // ---- пол (плитка) ----
  const fc = document.createElement('canvas');
  fc.width = fc.height = 128;
  const fg = fc.getContext('2d')!;
  fg.fillStyle = '#d9d3bd'; fg.fillRect(0, 0, 128, 128);
  fg.fillStyle = '#bdb69c'; fg.fillRect(0, 0, 64, 64); fg.fillRect(64, 64, 64, 64);
  fg.strokeStyle = '#a49d85'; fg.lineWidth = 2; fg.strokeRect(0, 0, 128, 128);
  const ftex = new THREE.CanvasTexture(fc);
  ftex.wrapS = ftex.wrapT = THREE.RepeatWrapping;
  ftex.repeat.set(hx * 2 / 2, hz * 2 / 2);
  ftex.magFilter = THREE.NearestFilter;
  ftex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(hx * 2 + 4, hz * 2 + 4), new THREE.MeshLambertMaterial({ map: ftex }));
  floor.rotation.x = -Math.PI / 2;
  group.add(floor);

  // ---- статический декор ----
  const parts: THREE.BufferGeometry[] = [];
  const T = 1; // толщина стен
  // стены: низ зелёный, верх кремовый
  const wallPart = (cx: number, cz: number, w: number, d: number) => {
    parts.push(box(w, 1.3, d, cx, 0.65, cz, 0x3f7a5a), box(w, 1.6, d, cx, 2.1, cz, 0xeee6cc));
  };
  wallPart(0, -hz - T / 2, hx * 2 + T * 2, T);
  wallPart(0, hz + T / 2, hx * 2 + T * 2, T);
  wallPart(-hx - T / 2, 0, T, hz * 2);
  wallPart(hx + T / 2, 0, T, hz * 2);

  // окна на боковых стенах (через них лезут медведи)
  const windowsZ = [-12, -6, 0, 6, 12];
  for (const z of windowsZ) {
    for (const s of [-1, 1]) {
      const x = s * (hx - 0.01);
      parts.push(box(0.1, 1.1, 1.8, x, 1.9, z, 0xffffff), box(0.12, 0.9, 1.6, x, 1.9, z, 0x8fd0ff), box(0.14, 0.9, 0.08, x, 1.9, z, 0xffffff));
    }
  }
  // двери
  parts.push(box(2.0, 2.2, 0.1, 0, 1.1, -hz + 0.05, 0x7a4a2a), box(2.0, 2.2, 0.1, 0, 1.1, hz - 0.05, 0x7a4a2a), box(0.12, 0.12, 0.12, 0.7, 1.0, -hz + 0.15, 0xffd24a), box(0.12, 0.12, 0.12, 0.7, 1.0, hz - 0.15, 0xffd24a));

  // линия раздачи у дальней стены
  const cz = -hz + 1.0;
  parts.push(box(10.4, 0.9, 1.4, 0, 0.45, cz, 0x9aa0a6), box(10.6, 0.1, 1.6, 0, 0.95, cz, 0xe0e4e8), box(10.4, 0.08, 1.2, 0, 1.6, cz - 0.1, 0xb8d8e8));
  obstacles.push({ minX: -5.3, maxX: 5.3, minZ: cz - 0.8, maxZ: cz + 0.8 });
  const pots = [-4, -2.2, -0.4, 1.4, 3.2];
  pots.forEach((x, i) => {
    parts.push(box(0.8, 0.5, 0.8, x, 1.25, cz, i % 2 ? 0xc0392b : 0xd68910), box(0.84, 0.08, 0.84, x, 1.54, cz, 0xcccccc));
  });
  for (let i = 0; i < 4; i++) parts.push(box(0.26, 0.4, 0.26, 4.4 + i * 0.3 - 0.5, 1.2, cz + 0.2, 0x6fb7d6)); // компот
  parts.push(box(0.5, 0.12, 0.5, -5.0, 1.06, cz, 0xffffff), box(0.5, 0.12, 0.5, -5.0, 1.18, cz, 0xffffff));

  // столы
  const rows = [-9, -3, 3, 9];
  const trayCols = [0x3b6ea5, 0xb04a3a, 0x3b9a6a];
  for (const z of rows) {
    for (const s of [-1, 1]) {
      const x = s * 3.5;
      parts.push(box(3.0, 0.12, 1.4, x, 0.84, z, 0xc8a26a), box(3.1, 0.04, 1.5, x, 0.76, z, 0x8a6a3a));
      for (const lx of [-1.3, 1.3]) for (const lz of [-0.55, 0.55]) parts.push(box(0.12, 0.8, 0.12, x + lx, 0.4, z + lz, 0x4a3a28));
      // подносы с едой
      for (let k = 0; k < 3; k++) {
        const tx = x - 1.0 + k * 1.0;
        const tz = z + (k % 2 ? 0.2 : -0.2);
        parts.push(box(0.55, 0.04, 0.4, tx, 0.92, tz, trayCols[(k + (z > 0 ? 1 : 0)) % 3]), box(0.2, 0.07, 0.2, tx - 0.1, 0.97, tz, 0x8a4b2a), box(0.18, 0.08, 0.18, tx + 0.14, 0.98, tz, 0xc0392b));
      }
      obstacles.push({ minX: x - 1.55, maxX: x + 1.55, minZ: z - 0.75, maxZ: z + 0.75 });
    }
  }
  // перевёрнутые стулья для хаоса
  const chairs = [[-5.4, -12.2], [5.2, -6.4], [-1.2, 5.8], [1.6, -11], [-5.5, 12.4], [4.9, 11.9], [0.2, 0.4], [-0.8, -6.2]];
  for (const [x, z] of chairs) parts.push(box(0.5, 0.1, 0.5, x, 0.2, z, 0x7a4a2a), box(0.5, 0.5, 0.08, x, 0.45, z - 0.25, 0x7a4a2a));

  // колонны
  for (const z of [-6, 6]) {
    parts.push(box(0.8, 3.0, 0.8, 0, 1.5, z, 0xeee6cc), box(0.84, 0.5, 0.84, 0, 0.25, z, 0x3f7a5a));
    obstacles.push({ minX: -0.5, maxX: 0.5, minZ: z - 0.5, maxZ: z + 0.5 });
  }
  const deco = new THREE.Mesh(merge(parts), vcMat);
  group.add(deco);

  // ---- вывески ----
  const s1 = sign('СТОЛОВАЯ №7\nОБЕД 12:00–15:00', 5, 1.3, '#f4efe0', '#8b1d1d', 34);
  s1.position.set(0, 2.5, -hz + 0.12);
  group.add(s1);
  const s2 = sign('МЕДВЕДЕЙ\nНЕ КОРМИТЬ!', 3.2, 1.2, '#ffe14a', '#222222', 34);
  s2.position.set(-hx + 0.08, 2.4, -3);
  s2.rotation.y = Math.PI / 2;
  group.add(s2);
  const s3 = sign('КОМПОТ — 15₽\nДОБАВКА — НЕТ', 3.2, 1.2, '#f4efe0', '#1f4f8f', 32);
  s3.position.set(hx - 0.08, 2.4, 3);
  s3.rotation.y = -Math.PI / 2;
  group.add(s3);
  const s4 = sign('ВЫХОДА НЕТ.\nТОЛЬКО БОРЩ.', 3.4, 1.1, '#2a1a1a', '#ff5a3a', 32);
  s4.position.set(0, 2.5, hz - 0.12);
  s4.rotation.y = Math.PI;
  group.add(s4);

  const spawns = [
    ...windowsZ.flatMap(z => [{ x: -hx + 0.8, z }, { x: hx - 0.8, z }]),
    { x: 0, z: -hz + 2.6 },
  ];
  return { obstacles, spawns, group };
}

/** Выталкивает окружность из прямоугольников и арены. Возвращает скорректированную точку. */
export function resolveCircle(x: number, z: number, r: number, obs: AABB[], out: { x: number; z: number }): void {
  const lx = ARENA.hx - r, lz = ARENA.hz - r;
  if (x < -lx) x = -lx; else if (x > lx) x = lx;
  if (z < -lz) z = -lz; else if (z > lz) z = lz;
  for (let i = 0; i < obs.length; i++) {
    const o = obs[i];
    const cx = x < o.minX ? o.minX : x > o.maxX ? o.maxX : x;
    const cz = z < o.minZ ? o.minZ : z > o.maxZ ? o.maxZ : z;
    const dx = x - cx, dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 < r * r) {
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
  out.x = x; out.z = z;
}

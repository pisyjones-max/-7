// Плавающий джойстик слева + клавиатура для тестов на ПК.
export class Input {
  x = 0;
  z = 0;
  bombPressed = false;
  enabled = false;
  private keys = new Set<string>();
  private stickId = -1;
  private sx = 0;
  private sy = 0;
  private readonly R = 56;

  constructor(private zone: HTMLElement, private base: HTMLElement, private knob: HTMLElement) {
    zone.addEventListener('pointerdown', e => {
      if (!this.enabled || this.stickId >= 0) return;
      this.stickId = e.pointerId;
      this.sx = e.clientX; this.sy = e.clientY;
      zone.setPointerCapture(e.pointerId);
      base.style.display = 'block';
      base.style.left = this.sx + 'px'; base.style.top = this.sy + 'px';
      knob.style.left = this.sx + 'px'; knob.style.top = this.sy + 'px';
      knob.style.display = 'block';
      e.preventDefault();
    });
    zone.addEventListener('pointermove', e => {
      if (e.pointerId !== this.stickId) return;
      let dx = e.clientX - this.sx, dy = e.clientY - this.sy;
      const len = Math.hypot(dx, dy);
      if (len > this.R) { dx = dx / len * this.R; dy = dy / len * this.R; }
      knob.style.left = this.sx + dx + 'px'; knob.style.top = this.sy + dy + 'px';
      let nx = dx / this.R, nz = dy / this.R;
      const m = Math.hypot(nx, nz);
      if (m < 0.12) { nx = 0; nz = 0; }
      this.x = nx; this.z = nz;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.release();
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    window.addEventListener('keydown', e => {
      this.keys.add(e.code);
      if (e.code === 'Space' && this.enabled) this.bombPressed = true;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  release(): void {
    this.stickId = -1; this.x = 0; this.z = 0;
    this.base.style.display = 'none'; this.knob.style.display = 'none';
  }

  setEnabled(v: boolean): void {
    this.enabled = v;
    if (!v) { this.release(); this.keys.clear(); }
  }

  /** Итоговый вектор движения (джойстик или клавиши). */
  vector(out: { x: number; z: number }): void {
    let kx = 0, kz = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) kx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) kx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) kz -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) kz += 1;
    if (kx || kz) { const l = Math.hypot(kx, kz); out.x = kx / l; out.z = kz / l; }
    else { out.x = this.x; out.z = this.z; }
  }
}

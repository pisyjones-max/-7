// Весь звук синтезируется на лету (WebAudio) — никаких файлов, быстрый запуск.

type Sfx = 'shoot' | 'shoot2' | 'boomShot' | 'hit' | 'die' | 'hurt' | 'coin' | 'pickup' | 'levelup' | 'boom' | 'roar' | 'click' | 'wave' | 'fish' | 'bark' | 'gong' | 'decoy';

// Народная «Коробейники» (общественное достояние), A-minor, MIDI + длительность в долях
const MELODY: [number, number][] = [
  [76, 1], [71, .5], [72, .5], [74, 1], [72, .5], [71, .5], [69, 1], [69, .5], [72, .5], [76, 1], [74, .5], [72, .5],
  [71, 1.5], [72, .5], [74, 1], [76, 1], [72, 1], [69, 1], [69, 1], [0, 1],
  [74, 1.5], [77, .5], [81, 1], [79, .5], [77, .5], [76, 1.5], [72, .5], [76, 1], [74, .5], [72, .5],
  [71, 1], [71, .5], [72, .5], [74, 1], [76, 1], [72, 1], [69, 1], [69, 1], [0, 1],
];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

class AudioSys {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noiseBuf!: AudioBuffer;
  muted = false;
  private musicOn = false;
  private timer = 0;
  private noteIdx = 0;
  private nextTime = 0;
  private intense = false;

  init(): void {
    if (this.ctx) { if (this.ctx.state === 'suspended') void this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.7;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      if (this.musicOn) this.startMusic();
    } catch { this.ctx = null; }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  setIntense(v: boolean): void { this.intense = v; }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0, delay = 0): void {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }

  private noise(dur: number, vol: number, freq = 1200, delay = 0): void {
    const c = this.ctx; if (!c || this.muted) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + dur + 0.02);
  }

  private last: Record<string, number> = {};

  play(name: Sfx): void {
    if (!this.ctx || this.muted) return;
    const now = performance.now();
    const gap: Partial<Record<Sfx, number>> = { shoot: 55, shoot2: 80, hit: 45, coin: 40, die: 60, bark: 140 };
    const g = gap[name];
    if (g && now - (this.last[name] || 0) < g) return;
    this.last[name] = now;
    const r = 0.9 + Math.random() * 0.25;
    switch (name) {
      case 'shoot': this.tone(520 * r, 0.07, 'square', 0.05, -250); break;
      case 'shoot2': this.noise(0.12, 0.16, 2500); this.tone(180, 0.1, 'sawtooth', 0.06, -90); break;
      case 'boomShot': this.tone(220, 0.2, 'sawtooth', 0.08, -150); break;
      case 'hit': this.noise(0.06, 0.12, 1800); this.tone(300 * r, 0.05, 'square', 0.04, -150); break;
      case 'die': this.tone(420 * r, 0.32, 'square', 0.07, -330); this.noise(0.18, 0.1, 900); break;
      case 'hurt': this.tone(160, 0.25, 'sawtooth', 0.12, -90); this.noise(0.12, 0.12, 700); break;
      case 'coin': this.tone(880, 0.07, 'square', 0.04); this.tone(1320, 0.1, 'square', 0.04, 0, 0.06); break;
      case 'pickup': this.tone(520, 0.08, 'triangle', 0.1); this.tone(780, 0.12, 'triangle', 0.1, 0, 0.07); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.15, 'square', 0.06, 0, i * 0.08)); break;
      case 'boom': this.noise(0.5, 0.35, 600); this.tone(90, 0.4, 'sawtooth', 0.14, -50); break;
      case 'roar': this.tone(110, 0.7, 'sawtooth', 0.14, -40); this.tone(95, 0.7, 'square', 0.08, -30); this.noise(0.5, 0.12, 500); break;
      case 'click': this.tone(660, 0.05, 'square', 0.05); break;
      case 'wave': this.tone(330, 0.12, 'square', 0.07); this.tone(440, 0.12, 'square', 0.07, 0, 0.12); this.tone(660, 0.2, 'square', 0.07, 0, 0.24); break;
      case 'bark': this.tone(420 * r, 0.09, 'square', 0.07, -200); this.noise(0.05, 0.08, 1600); this.tone(330 * r, 0.09, 'square', 0.06, -150, 0.12); break;
      case 'decoy': [392, 494, 587, 494].forEach((f, i) => this.tone(f, 0.12, 'square', 0.06, 0, i * 0.1)); break;
      case 'gong': this.tone(110, 1.4, 'sine', 0.22, -30); this.tone(165, 1.1, 'triangle', 0.1); this.noise(0.35, 0.12, 400); break;
      case 'fish': this.tone(700, 0.1, 'triangle', 0.05, -400); break;
    }
  }

  /** Низкий «мортал-комбатовский» голос через синтез речи телефона (если доступен). */
  voice(text: string): void {
    try {
      if (this.muted || !('speechSynthesis' in window)) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU'; u.pitch = 0.1; u.rate = 0.7; u.volume = 1;
      speechSynthesis.cancel(); speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }

  startMusic(): void {
    this.musicOn = true;
    const c = this.ctx; if (!c || this.timer) return;
    this.nextTime = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 90);
  }

  stopMusic(): void {
    this.musicOn = false;
    if (this.timer) { clearInterval(this.timer); this.timer = 0; }
  }

  private schedule(): void {
    const c = this.ctx; if (!c) return;
    const bpm = this.intense ? 176 : 150;
    const beat = 60 / bpm;
    while (this.nextTime < c.currentTime + 0.3) {
      const [m, len] = MELODY[this.noteIdx];
      const dur = len * beat;
      if (!this.muted) {
        if (m) this.note(mtof(m), dur * 0.9, 'square', 0.035, this.nextTime);
        // бас: ум-па
        const bass = this.noteIdx % 2 === 0 ? 45 : 52;
        this.note(mtof(bass), dur * 0.8, 'triangle', 0.09, this.nextTime);
      }
      this.nextTime += dur;
      this.noteIdx = (this.noteIdx + 1) % MELODY.length;
    }
  }

  private note(freq: number, dur: number, type: OscillatorType, vol: number, t: number): void {
    const c = this.ctx!; const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  }
}

export const audio = new AudioSys();

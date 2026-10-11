export interface ScoreRow {
  id: number;
  name: string;
  score: number;
  wave: number;
  kills: number;
  date: string;
}

export interface SaveData {
  coins: number;
  best: number;
  unlocked: string[];
  selected: string;
  scores: ScoreRow[];
  streak: number;
  lastDaily: string;
  kills: number;
  runs: number;
  muted: boolean;
  nick: string;
  mutator: boolean;
  tutorialSeen: boolean;
  camMode: 'top' | 'chase';
}

const KEY = 'medvedokalipsis_save_v1';

const DEFAULT: SaveData = {
  coins: 0, best: 0, unlocked: ['vasya'], selected: 'vasya', scores: [], streak: 0, lastDaily: '',
  kills: 0, runs: 0, muted: false, nick: 'Аноним', mutator: false, tutorialSeen: false, camMode: 'top',
};

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULT, unlocked: ['vasya'], scores: [] };
}

export const save: SaveData = load();

export function commit(): void {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ }
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addScore(name: string, score: number, wave: number, kills: number): number {
  const id = Date.now() + Math.floor(Math.random() * 1000);
  save.scores.push({ id, name, score, wave, kills, date: today() });
  save.scores.sort((a, b) => b.score - a.score);
  save.scores = save.scores.slice(0, 10);
  commit();
  return id;
}

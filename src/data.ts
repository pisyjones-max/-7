// Все игровые данные: персонажи, оружие, медведи, прокачка, шутки.

export type HatKind = 'ushanka' | 'platok' | 'kepka' | 'panama' | 'cat';

export interface CharDef {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  cost: number;
  skin: number;
  shirt: number;
  pants: number;
  hat: HatKind;
  stripes: 'tel' | 'adidas' | 'none';
  hp: number;
  speed: number;
  rate: number;
  dmg: number;
  hitR: number;
}

export const CHARS: CharDef[] = [
  { id: 'vasya', name: 'Вася', emoji: '🧔', desc: 'Мужик в ушанке и тельняшке. Классика.', cost: 0, skin: 0xf0c8a0, shirt: 0x2f5fb0, pants: 0x2b3a55, hat: 'ushanka', stripes: 'tel', hp: 100, speed: 1, rate: 1, dmg: 1, hitR: 0.45 },
  { id: 'lyuba', name: 'Баба Люба', emoji: '👵', desc: 'Быстрая. Платок, характер и сковорода.', cost: 150, skin: 0xf2cfae, shirt: 0x8a3b9a, pants: 0x4a2c55, hat: 'platok', stripes: 'none', hp: 90, speed: 1.17, rate: 1, dmg: 1, hitR: 0.45 },
  { id: 'ded', name: 'Дед Михалыч', emoji: '👴', desc: 'Дачник. Здоровья много, бегает не очень.', cost: 300, skin: 0xe8b890, shirt: 0x5a7a3a, pants: 0x6a5a40, hat: 'panama', stripes: 'none', hp: 170, speed: 0.9, rate: 1, dmg: 1.05, hitR: 0.5 },
  { id: 'serega', name: 'Серёга', emoji: '🕶️', desc: 'Гопник в Adidas. Стреляет чаще всех.', cost: 450, skin: 0xf0c8a0, shirt: 0x1d1d1d, pants: 0x1d1d1d, hat: 'kepka', stripes: 'adidas', hp: 100, speed: 1.05, rate: 1.28, dmg: 1, hitR: 0.45 },
  { id: 'barsik', name: 'Кот Барсик', emoji: '🐱', desc: 'Маленький, юркий, бьёт больно. Хрупкий.', cost: 700, skin: 0xe8913a, shirt: 0xe8913a, pants: 0xe8913a, hat: 'cat', stripes: 'none', hp: 70, speed: 1.28, rate: 1.1, dmg: 1.25, hitR: 0.38 },
];

export interface WeaponDef {
  id: string;
  name: string;
  icon: string;
  rate: number;
  dmg: number;
  speed: number;
  life: number;
  pellets: number;
  spread: number;
  jitter: number;
  pierce: number;
  knock: number;
  size: number;
  color: number;
  explode: number;
  sfx: 'shoot' | 'shoot2' | 'boomShot';
  quip: string;
}

export const WEAPONS: Record<string, WeaponDef> = {
  spoon: { id: 'spoon', name: 'Поварёшка', icon: '🥄', rate: 0.38, dmg: 12, speed: 17, life: 0.85, pellets: 1, spread: 0, jitter: 0.02, pierce: 0, knock: 3, size: 0.3, color: 0xdddddd, explode: 0, sfx: 'shoot', quip: '' },
  cutlet: { id: 'cutlet', name: 'Котлета-дробовик', icon: '🍖', rate: 0.8, dmg: 9, speed: 15, life: 0.55, pellets: 5, spread: 0.6, jitter: 0.06, pierce: 0, knock: 4, size: 0.3, color: 0x9a5a30, explode: 0, sfx: 'shoot2', quip: 'Котлета по-киевски! Прямо в лоб!' },
  extinguisher: { id: 'extinguisher', name: 'Огнетушитель', icon: '🧯', rate: 0.09, dmg: 3.4, speed: 12, life: 0.5, pellets: 1, spread: 0, jitter: 0.28, pierce: 3, knock: 3.2, size: 0.34, color: 0xf4f4ff, explode: 0, sfx: 'shoot', quip: 'ПШШШШ! Пожарная безопасность!' },
  samovar: { id: 'samovar', name: 'Самовар-пушка', icon: '🫖', rate: 1.15, dmg: 34, speed: 10, life: 1.1, pellets: 1, spread: 0, jitter: 0.02, pierce: 0, knock: 5, size: 0.5, color: 0xd9a030, explode: 2.6, sfx: 'boomShot', quip: 'Чай подан! Кипяток прилагается!' },
};
export const CRATE_WEAPONS = ['cutlet', 'extinguisher', 'samovar'];

export type EnemyKind = 'cub' | 'bear' | 'tank' | 'fisher' | 'potap' | 'mutant' | 'dog';

export interface EnemyDef {
  id: EnemyKind;
  name: string;
  hp: number;
  speed: number;
  dmg: number;
  size: number;
  radius: number;
  xp: number;
  coins: number;
  armor: number;
  score: number;
  boss: boolean;
  fur: number;
  belly: number;
  killedBy: string[];
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  cub: { id: 'cub', name: 'Мишка-наглец', hp: 30, speed: 4.0, dmg: 8, size: 0.95, radius: 0.55, xp: 1, coins: 1, armor: 0, score: 10, boss: false, fur: 0xc98b4a, belly: 0xf0d0a0, killedBy: ['Задавлен мишкой ростом с табуретку', 'Побеждён наглым медвежонком', 'Обокраден и добит малышнёй'] },
  bear: { id: 'bear', name: 'Медведь', hp: 85, speed: 2.7, dmg: 15, size: 1.6, radius: 0.95, xp: 3, coins: 2, armor: 0, score: 30, boss: false, fur: 0x7a4a26, belly: 0xc29a6a, killedBy: ['Обнят медведем. Навсегда.', 'Съеден вместе с компотом', 'Не договорился с медведем'] },
  tank: { id: 'tank', name: 'Бронемишка', hp: 300, speed: 1.75, dmg: 24, size: 2.0, radius: 1.15, xp: 8, coins: 6, armor: 0.45, score: 100, boss: false, fur: 0x4a3020, belly: 0x8a6a4a, killedBy: ['Раздавлен бронемишкой в кастрюле', 'Не пробил кастрюлю', 'Проиграл кастрюле в лоб'] },
  dog: { id: 'dog', name: 'Бешеная собака', hp: 26, speed: 6.0, dmg: 9, size: 0.95, radius: 0.5, xp: 2, coins: 1, armor: 0, score: 20, boss: false, fur: 0x9a8a78, belly: 0xe0d4c0, killedBy: ['Загрызен собаками (а медведи ржут)', 'Порван шавкой на глазах у медведей', 'Собака оказалась злее медведя'] },
  fisher: { id: 'fisher', name: 'Медведь-рыбак', hp: 58, speed: 2.4, dmg: 10, size: 1.45, radius: 0.85, xp: 3, coins: 3, armor: 0, score: 40, boss: false, fur: 0x6e5a3a, belly: 0xc2a77a, killedBy: ['Убит рыбой. Просто рыбой.', 'Закидан сёмгой', 'Получил щукой по лицу'] },
  potap: { id: 'potap', name: 'Михаил Потапыч', hp: 1500, speed: 2.3, dmg: 28, size: 3.0, radius: 1.5, xp: 40, coins: 60, armor: 0.15, score: 1000, boss: true, fur: 0x6b4423, belly: 0xd9b080, killedBy: ['Лично разобран Михаилом Потапычем', 'Потапыч пришёл за добавкой'] },
  mutant: { id: 'mutant', name: 'Мутант Топтыгин', hp: 2600, speed: 2.5, dmg: 32, size: 3.3, radius: 1.65, xp: 70, coins: 120, armor: 0.2, score: 2500, boss: true, fur: 0x4fd16a, belly: 0xb6ffb0, killedBy: ['Растворён мутантом Топтыгиным', 'Радиоактивный медведь был сильнее'] },
};

export interface Stats {
  maxHp: number;
  speed: number;
  dmgMul: number;
  rateMul: number;
  multi: number;
  pierce: number;
  magnet: number;
  crit: number;
  regen: number;
  bombMul: number;
  bombCd: number;
}

export interface UpgradeDef {
  id: string;
  icon: string;
  name: string;
  desc: string;
  max: number;
  apply: (s: Stats) => void;
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'dmg', icon: '🥟', name: 'Бабушкины пирожки', desc: '+25% урона', max: 8, apply: s => { s.dmgMul *= 1.25; } },
  { id: 'rate', icon: '⚡', name: 'Энергетик «Мазут»', desc: '+20% скорострельность', max: 8, apply: s => { s.rateMul *= 1.2; } },
  { id: 'speed', icon: '👟', name: 'Кроссовки «Abibas»', desc: '+10% скорость бега', max: 5, apply: s => { s.speed *= 1.1; } },
  { id: 'hp', icon: '🥓', name: 'Сало', desc: '+35 макс. здоровья и лечит', max: 6, apply: s => { s.maxHp += 35; } },
  { id: 'multi', icon: '🍽️', name: 'Двойная порция', desc: '+1 снаряд за выстрел', max: 3, apply: s => { s.multi += 1; } },
  { id: 'pierce', icon: '🌶️', name: 'Острая горчица', desc: 'Снаряды пробивают +1 медведя', max: 3, apply: s => { s.pierce += 1; } },
  { id: 'magnet', icon: '🧲', name: 'Магнит с холодильника', desc: 'Лут летит к вам издалека', max: 3, apply: s => { s.magnet += 2.2; } },
  { id: 'crit', icon: '🎯', name: 'Меткий глаз', desc: '+12% шанс крита (x2.5)', max: 5, apply: s => { s.crit += 0.12; } },
  { id: 'regen', icon: '🍵', name: 'Чай с лимоном', desc: 'Восстановление здоровья', max: 4, apply: s => { s.regen += 0.9; } },
  { id: 'bomb', icon: '🍲', name: 'Борщ потяжелее', desc: 'Борщ-бомба: +40% урона, перезарядка -15%', max: 4, apply: s => { s.bombMul *= 1.4; s.bombCd *= 0.85; } },
];

// ---------- шутки ----------
export const PLAYER_QUIPS = [
  'Это вам не тайга!', 'Компот не тронь!', 'Я за пельменями пришёл!', 'Тётя Валя, дайте добавки!',
  'Где мой талон на обед?!', 'Раз-два-три, медведь — умри!', 'Только не по скатерти!', 'Ну всё, попал на комплексный обед!',
  'Я просто хотел поесть...', 'Медведи, у нас тут очередь!',
];
export const BEAR_QUIPS = [
  'РРРРЫ!', 'Отдай пирожок!', 'Я просто спросить...', 'Здесь раздают борщ?', 'Мёд есть?',
  'Кто сказал «обед»?', 'Я не медведь, я консультант!', 'Мы по записи!', 'РВУ ВСЁ!', 'Сейчас будет больно!', 'Тут МОЯ столовая!', 'А можно без очереди?', 'Хочу салат «Оливье»!',
];
export const HURT_QUIPS = ['Ай! Это же мой бок!', 'Больно, медведь!', 'За что?!', 'Мама!', 'Меня тут обидели!'];
export const KILL_STREAK: Record<number, string> = {
  5: 'ТАЙГА ПЛАЧЕТ', 10: 'ШАШЛЫК ИЗ ТОПТЫГИНА', 20: 'МЕДВЕДЬ-ФЕСТ!', 35: 'БЕЛКА В ШОКЕ', 50: 'ЗАПОВЕДНИК ПУСТЕЕТ', 80: 'МЕДВЕДЬ ГОРИТ ПЕРЕД ВСЕМИ',
};
export const WAVE_SUBS = [
  'Очередь за медведями', 'Они почуяли борщ', 'Кто-то оставил окно открытым', 'Компот закончился — они злые',
  'Зарплата у медведей через три дня', 'Новые заходят с чёрного хода',
];
export const EVENTS = {
  blackout: { title: 'СВЕТ ВЫРУБИЛИ!', sub: 'Опять эти коммунальные службы...' },
  pirozhki: { title: 'ПИРОЖКИ С НЕБА!', sub: 'Тётя Валя расщедрилась. Подбирайте!' },
  rush: { title: 'ОБЕДЕННЫЙ ПЕРЕРЫВ!', sub: 'Очередь мишек до самого подъезда!' },
} as const;
export const DEATH_JOKES = [
  'Не повезло. Хотя медведи довольны.', 'Компот остался нетронутым.', 'Тётя Валя всё видела.',
  'Следующий раз — берите сухпаёк.', 'Это был не последний обед.', 'Медведь в шоке от вашей стойкости.',
];
export const RANKS: [number, string][] = [
  [0, 'Мишки даже не вспотели'], [3, 'Подкормил медведей'], [6, 'Уважаемый посетитель'], [10, 'Грозный повар'], [15, 'Легенда столовой №7'], [25, 'Заповедник на тебя молится'],
];

// ---------- мутатор дня ----------
export interface Mutator {
  id: string;
  name: string;
  desc: string;
  fastBears?: boolean;
  glass?: boolean;
  bigBears?: boolean;
  extOnly?: boolean;
}
export const MUTATORS: Mutator[] = [
  { id: 'fast', name: 'Спешащие мишки', desc: 'Медведи бегают на 25% быстрее', fastBears: true },
  { id: 'glass', name: 'Стеклянная пушка', desc: 'У вас на 40% меньше HP, но урон x1.5', glass: true },
  { id: 'big', name: 'Медведи-гиганты', desc: 'Медведи крупнее и жирнее', bigBears: true },
  { id: 'ext', name: 'Пожарная тревога', desc: 'Только огнетушитель! Урон x1.4', extOnly: true },
];
export function todayMutator(): Mutator {
  const day = Math.floor(Date.now() / 86400000);
  return MUTATORS[day % MUTATORS.length];
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

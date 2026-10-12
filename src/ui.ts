import { CHARS, todayMutator, type UpgradeDef } from './data';
import { LOCATIONS } from './level';
import type { Game, GameEvents, HudState, RunResult } from './game';
import type { Input } from './input';
import { audio } from './audio';
import { addScore, commit, save, today } from './save';

const $ = <T extends HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export class UI implements GameEvents {
  zone: HTMLElement;
  stickBase: HTMLElement;
  stickKnob: HTMLElement;
  private hudEl: HTMLElement;
  private screens: HTMLElement;
  private floats: HTMLElement;
  private game!: Game;
  private input!: Input;
  private cache: Record<string, string> = {};
  private quipT = 0;
  private bannerT = 0;
  private lastResult: RunResult | null = null;
  private lastRowId = 0;
  private points = 0;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div id="zone"></div>
      <div id="stickBase"></div><div id="stickKnob"></div>
      <div id="hud" class="hidden">
        <div class="top">
          <div class="bars">
            <div class="bar hp"><i id="hpFill"></i><b id="hpText"></b></div>
            <div class="bar xp"><i id="xpFill"></i><b id="lvlText"></b></div>
          </div>
          <div class="info"><div id="waveText"></div><div id="scoreText"></div><div id="coinText"></div></div>
          <button id="camBtn" class="icon">🎥</button>
          <button id="pauseBtn" class="icon">⏸</button>
        </div>
        <div id="bossBar" class="boss hidden"><span id="bossName"></span><div class="bar"><i id="bossFill"></i></div></div>
        <div id="quip" class="quip hidden"></div>
        <div id="banner" class="banner hidden"><h1></h1><p></p></div>
        <div id="combo" class="combo hidden"></div>
        <div id="weapon" class="weapon hidden"><span id="wIcon"></span><div class="bar"><i id="wFill"></i></div></div>
        <div id="floats"></div>
        <button id="finBtn" class="hidden">💀 ДОБЕЙ ЕГО!</button>
        <button id="upBtn"><span>⭐</span><b id="upCount">0</b><small>ПРОКАЧКА</small></button>
        <button id="bombBtn"><span>🍲</span><small>БОРЩ</small><div id="bombCd"></div></button>
        <div id="hurtFlash"></div>
      </div>
      <div id="screens"></div>`;
    this.zone = $(root, '#zone');
    this.stickBase = $(root, '#stickBase');
    this.stickKnob = $(root, '#stickKnob');
    this.hudEl = $(root, '#hud');
    this.screens = $(root, '#screens');
    this.floats = $(root, '#floats');
  }

  bind(game: Game, input: Input): void {
    this.game = game; this.input = input;
    game.events = this;
    const bomb = $(this.root, '#bombBtn');
    bomb.addEventListener('pointerdown', e => { e.preventDefault(); input.bombPressed = true; });
    $(this.root, '#finBtn').addEventListener('pointerdown', e => { e.preventDefault(); game.doFinisher(); });
    $(this.root, '#upBtn').addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this.points > 0) game.openUpgrades();
      else this.banner('ОЧКОВ НЕТ', 'Убивай медведей — набирай уровни', 'info');
    });
    $(this.root, '#camBtn').addEventListener('click', () => {
      const m = game.toggleCam();
      this.banner(m === 'chase' ? 'ВИД ОТ 3-ГО ЛИЦА' : 'ВИД СВЕРХУ', m === 'chase' ? 'Слева — ходить, справа свайп — крутить камеру' : 'Классика', 'info');
    });
    $(this.root, '#pauseBtn').addEventListener('click', () => { game.pause(); this.onPause(); });
    this.screens.addEventListener('click', e => {
      const t = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (!t) return;
      audio.init(); audio.play('click');
      this.act(t.dataset.act!, t.dataset.arg ?? '');
    });
    this.screens.addEventListener('change', e => {
      const t = e.target as HTMLInputElement;
      if (t.id === 'nick') {
        save.nick = t.value.trim().slice(0, 14) || 'Аноним';
        const row = save.scores.find(s => s.id === this.lastRowId);
        if (row) row.name = save.nick;
        commit();
      }
    });
    ['contextmenu', 'dragstart', 'selectstart'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
  }

  // ------------------------------------------------------------ действия
  private act(a: string, arg: string): void {
    const g = this.game;
    switch (a) {
      case 'play': this.screens.innerHTML = ''; this.hudEl.classList.remove('hidden'); g.start(); break;
      case 'menu': this.hudEl.classList.add('hidden'); this.clearHud(); g.showMenu(); this.menu(); break;
      case 'chars': this.chars(); break;
      case 'scores': this.scoresScreen(); break;
      case 'sound': save.muted = !save.muted; audio.setMuted(save.muted); commit(); this.menu(); break;
      case 'locs': this.locsScreen(); break;
      case 'loc': {
        const l = LOCATIONS.find(x => x.id === arg)!;
        if (save.locUnlocked.includes(l.id)) { g.setLocation(l.id); save.loc = l.id; }
        else if (save.coins >= l.cost) { save.coins -= l.cost; save.locUnlocked.push(l.id); g.setLocation(l.id); save.loc = l.id; audio.play('levelup'); }
        commit(); this.locsScreen(); break;
      }
      case 'skipUp': this.screens.innerHTML = ''; g.cancelChoose(); break;
      case 'cam': g.setCamMode(save.camMode === 'top' ? 'chase' : 'top'); this.menu(); break;
      case 'mut': save.mutator = !save.mutator; commit(); this.menu(); break;
      case 'daily': this.claimDaily(); break;
      case 'pick': {
        const c = CHARS.find(x => x.id === arg)!;
        if (save.unlocked.includes(c.id)) { save.selected = c.id; g.setMenuChar(c.id); }
        else if (save.coins >= c.cost) { save.coins -= c.cost; save.unlocked.push(c.id); save.selected = c.id; g.setMenuChar(c.id); audio.play('levelup'); }
        commit(); this.chars(); break;
      }
      case 'upgrade': this.screens.innerHTML = ''; g.pickUpgrade(arg); break;
      case 'resume': this.screens.innerHTML = ''; g.resume(); break;
      case 'share': void this.share(); break;
    }
  }

  private claimDaily(): void {
    const t = today();
    const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    save.streak = save.lastDaily === y ? save.streak + 1 : 1;
    save.lastDaily = t;
    const reward = 50 + Math.min(save.streak, 7) * 25;
    save.coins += reward;
    commit();
    audio.play('levelup');
    this.menu(`+${reward} 🪙 за заход! Серия: ${save.streak} дн.`);
  }

  // ------------------------------------------------------------ экраны
  menu(toast = ''): void {
    const c = CHARS.find(x => x.id === save.selected) ?? CHARS[0];
    const m = todayMutator();
    const canDaily = save.lastDaily !== today();
    const reward = 50 + Math.min(save.streak + 1, 7) * 25;
    this.screens.innerHTML = `
      <div class="screen menu">
        <div class="logo poster"><div class="star">★</div><span class="l1">СТОЛОВАЯ</span><span class="l2">№7</span><i class="band">КРОВАВАЯ</i><small>ТОВАРИЩ! ОБЕД НАЧАЛСЯ. ДЕРЖИ ПОВАРЁШКУ!</small></div>
        <div class="stats"><b>🪙 ${save.coins}</b><b>🏆 ${save.best}</b></div>
        ${toast ? `<div class="toast">${toast}</div>` : ''}
        <div class="spacer"></div>
        ${canDaily ? `<button class="btn gold" data-act="daily">🎁 ЕЖЕДНЕВНЫЙ ПОДАРОК +${reward}🪙</button>` : ''}
        <button class="btn mut ${save.mutator ? 'on' : ''}" data-act="mut"><b>${save.mutator ? '✅' : '⬜'} Мутатор дня: ${m.name}</b><small>${m.desc} · монеты x1.5</small></button>
        <div class="row">
          <button class="btn" data-act="locs">🗺 ${LOCATIONS.find(l => l.id === save.loc)?.name ?? ''}<small>сменить локацию</small></button>
          <button class="btn" data-act="cam">🎥 ${save.camMode === 'chase' ? 'ОТ 3-ГО ЛИЦА' : 'СВЕРХУ'}<small>камера</small></button>
        </div>
        <button class="btn big" data-act="play">▶ ИГРАТЬ <small>за ${c.emoji} ${c.name}</small></button>
        <div class="row">
          <button class="btn" data-act="chars">🧍 ГЕРОИ</button>
          <button class="btn" data-act="scores">🏆 РЕКОРДЫ</button>
          <button class="btn sq" data-act="sound">${save.muted ? '🔇' : '🔊'}</button>
        </div>
      </div>`;
  }

  private locsScreen(): void {
    const cards = LOCATIONS.map(l => {
      const own = save.locUnlocked.includes(l.id);
      const sel = save.loc === l.id;
      const action = own ? (sel ? 'ВЫБРАНА' : 'ВЫБРАТЬ') : (save.coins >= l.cost ? `КУПИТЬ ${l.cost}🪙` : `🔒 ${l.cost}🪙`);
      return `<div class="card ${sel ? 'sel' : ''}">
        <div class="em">${l.emoji}</div>
        <div class="ct"><b>${l.name}</b><p>${l.desc}</p></div>
        <button class="btn sm ${own || save.coins >= l.cost ? '' : 'dis'}" data-act="loc" data-arg="${l.id}">${action}</button>
      </div>`;
    }).join('');
    this.screens.innerHTML = `<div class="screen list"><h2>ЛОКАЦИИ</h2><div class="stats"><b>🪙 ${save.coins}</b></div><div class="scroll">${cards}</div>
      <button class="btn" data-act="menu">← НАЗАД</button></div>`;
  }

  private chars(): void {
    const cards = CHARS.map(c => {
      const own = save.unlocked.includes(c.id);
      const sel = save.selected === c.id;
      const action = own ? (sel ? 'ВЫБРАН' : 'ВЫБРАТЬ') : (save.coins >= c.cost ? `КУПИТЬ ${c.cost}🪙` : `🔒 ${c.cost}🪙`);
      return `<div class="card ${sel ? 'sel' : ''}">
        <div class="em">${c.emoji}</div>
        <div class="ct"><b>${c.name}</b><p>${c.desc}</p>
          <small>❤️${c.hp} · 👟${Math.round(c.speed * 100)}% · 🔫${Math.round(c.rate * 100)}% · 💥${Math.round(c.dmg * 100)}%</small></div>
        <button class="btn sm ${own || save.coins >= c.cost ? '' : 'dis'}" data-act="pick" data-arg="${c.id}">${action}</button>
      </div>`;
    }).join('');
    this.screens.innerHTML = `<div class="screen list"><h2>ГЕРОИ</h2><div class="stats"><b>🪙 ${save.coins}</b></div><div class="scroll">${cards}</div>
      <button class="btn" data-act="menu">← НАЗАД</button></div>`;
  }

  private scoresScreen(): void {
    const rows = save.scores.length
      ? save.scores.map((s, i) => `<div class="srow"><b>${i + 1}</b><span>${this.esc(s.name)}</span><em>${s.score}</em><small>${s.loc ? s.loc + ' · ' : ''}волна ${s.wave} · ${s.kills}🐻</small></div>`).join('')
      : '<p class="empty">Пока пусто. Медведи ждут вас.</p>';
    this.screens.innerHTML = `<div class="screen list"><h2>ТАБЛИЦА РЕКОРДОВ</h2><div class="scroll">${rows}</div>
      <p class="hint">Всего убито медведей: ${save.kills} · забегов: ${save.runs}</p><button class="btn" data-act="menu">← НАЗАД</button></div>`;
  }

  private esc(s: string): string { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }

  onPause(): void {
    if (this.game.mode !== 'paused') return;
    this.screens.innerHTML = `<div class="screen center"><h2>ПАУЗА</h2><p class="hint">Медведи тоже перекусывают</p>
      <button class="btn big" data-act="resume">▶ ПРОДОЛЖИТЬ</button><button class="btn" data-act="menu">В МЕНЮ</button></div>`;
  }

  // ------------------------------------------------------------ события игры
  levelUp(cards: UpgradeDef[]): void {
    this.screens.innerHTML = `<div class="screen center"><h2>НОВЫЙ УРОВЕНЬ!</h2><p class="hint">Выбери усиление</p>
      ${cards.map(u => `<button class="btn card2" data-act="upgrade" data-arg="${u.id}"><span class="ic">${u.icon}</span><span><b>${u.name}</b><small>${u.desc}</small></span></button>`).join('')}
      <button class="btn sm" data-act="skipUp">ПОТОМ</button></div>`;
    this.input.release();
  }

  gameOver(r: RunResult): void {
    this.lastResult = r;
    this.lastRowId = r.score > 0 ? addScore(save.nick, r.score, r.wave, r.kills, r.loc) : 0;
    this.hudEl.classList.add('hidden');
    this.screens.innerHTML = `<div class="screen center over">
      <h2>ВЫ ПОГИБЛИ</h2><p class="title">${r.title}</p>
      <div class="big-score">${r.score}${r.newBest ? '<span> НОВЫЙ РЕКОРД!</span>' : ''}</div>
      <div class="grid"><div>🌊<b>${r.wave}</b>волна</div><div>🐻<b>${r.kills}</b>медведей</div><div>⭐<b>${r.lvl}</b>уровень</div><div>🪙<b>+${r.coins}</b>монет</div></div>
      <p class="hint">${r.rank}. ${r.joke}</p>
      <input id="nick" maxlength="14" value="${this.esc(save.nick)}" placeholder="Ваше имя в рекордах" />
      <button class="btn big" data-act="play">↻ ЕЩЁ РАЗ</button>
      <div class="row"><button class="btn gold" data-act="share">📣 ПОДЕЛИТЬСЯ</button><button class="btn" data-act="menu">МЕНЮ</button></div></div>`;
  }

  private async share(): Promise<void> {
    const r = this.lastResult; if (!r) return;
    const text = `Я продержался ${r.wave} волн в игре «Столовая №7» (${r.loc})! «${r.title}». Счёт: ${r.score} 🐻 #столовая7`;
    const blob = await this.game.makeCard([r.title, `Волна ${r.wave} · ${r.kills} медведей`, `Счёт: ${r.score}`, r.rank]);
    try {
      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
      if (blob) {
        const file = new File([blob], 'medvedokalipsis.png', { type: 'image/png' });
        if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text }); return; }
      }
      if (nav.share) { await nav.share({ text }); return; }
      await navigator.clipboard.writeText(text);
      this.banner('СКОПИРОВАНО', 'Вставьте текст в TikTok / Shorts / Reels', 'info');
    } catch { /* пользователь закрыл окно */ }
  }

  setCached(k: string, v: string, el: HTMLElement, prop: 'text' | 'width'): void {
    if (this.cache[k] === v) return;
    this.cache[k] = v;
    if (prop === 'text') el.textContent = v; else el.style.width = v;
  }

  private els: Record<string, HTMLElement> = {};
  private e(id: string): HTMLElement { return this.els[id] ??= $(this.root, '#' + id); }

  hud(s: HudState): void {
    this.points = s.points;
    this.setCached('up', String(s.points), this.e('upCount'), 'text');
    const ub = this.e('upBtn');
    if (this.cache.upHas !== String(s.points > 0)) { this.cache.upHas = String(s.points > 0); ub.classList.toggle('has', s.points > 0); }
    this.setCached('hpw', (s.hp / s.maxHp * 100).toFixed(0) + '%', this.e('hpFill'), 'width');
    this.setCached('hpt', `❤️ ${Math.ceil(s.hp)}/${s.maxHp}`, this.e('hpText'), 'text');
    this.setCached('xpw', (s.xp / s.xpNext * 100).toFixed(0) + '%', this.e('xpFill'), 'width');
    this.setCached('lvl', 'УР. ' + s.lvl, this.e('lvlText'), 'text');
    this.setCached('wave', 'ВОЛНА ' + s.wave + ' · 🐻' + s.left, this.e('waveText'), 'text');
    this.setCached('score', '' + s.score, this.e('scoreText'), 'text');
    this.setCached('coin', '🪙 ' + s.coins, this.e('coinText'), 'text');
    const bomb = this.e('bombBtn');
    const ready = s.bombFrac >= 1;
    if (this.cache.bombReady !== String(ready)) { this.cache.bombReady = String(ready); bomb.classList.toggle('ready', ready); }
    this.setCached('bomb', Math.round(s.bombFrac * 100) + '', this.e('bombCd'), 'width');
    this.e('bombCd').style.height = (100 - s.bombFrac * 100).toFixed(0) + '%';
    const w = this.e('weapon');
    const showW = s.weaponFrac > 0;
    if (this.cache.wShow !== String(showW)) { this.cache.wShow = String(showW); w.classList.toggle('hidden', !showW); }
    if (showW) { this.setCached('wi', s.weaponIcon, this.e('wIcon'), 'text'); this.setCached('wf', (s.weaponFrac * 100).toFixed(0) + '%', this.e('wFill'), 'width'); }
    const cb = this.e('combo');
    const showC = s.combo >= 3;
    if (showC) this.setCached('cb', `КОМБО x${s.combo}${s.mult > 1 ? ' · очки x' + s.mult : ''}`, cb, 'text');
    if (this.cache.cShow !== String(showC)) { this.cache.cShow = String(showC); cb.classList.toggle('hidden', !showC); }
  }

  quip(text: string, who: 'p' | 'b' | 'sys'): void {
    const q = this.e('quip');
    q.className = 'quip ' + who;
    q.textContent = (who === 'p' ? '🧔 ' : who === 'b' ? '🐻 ' : '') + text;
    clearTimeout(this.quipT);
    this.quipT = window.setTimeout(() => q.classList.add('hidden'), 2300);
  }

  banner(title: string, sub: string, kind: string): void {
    const b = this.e('banner');
    b.className = 'banner ' + kind;
    $(b, 'h1').textContent = title; $(b, 'p').textContent = sub;
    void b.offsetWidth; // перезапуск анимации
    b.classList.add('show');
    clearTimeout(this.bannerT);
    this.bannerT = window.setTimeout(() => b.classList.add('hidden'), kind === 'boss' ? 2600 : 1900);
  }

  float(sx: number, sy: number, text: string, cls: string): void {
    if (this.floats.childElementCount > 22) return;
    const d = document.createElement('div');
    d.className = 'fl ' + cls;
    d.textContent = text;
    d.style.left = sx + 'px'; d.style.top = sy + 'px';
    d.addEventListener('animationend', () => d.remove());
    this.floats.appendChild(d);
  }

  finish(on: boolean): void {
    this.e('finBtn').classList.toggle('hidden', !on);
  }

  bossBar(frac: number | null, name: string): void {
    const b = this.e('bossBar');
    if (frac === null) { b.classList.add('hidden'); return; }
    b.classList.remove('hidden');
    this.setCached('bn', name.toUpperCase(), this.e('bossName'), 'text');
    this.setCached('bf', (frac * 100).toFixed(1) + '%', this.e('bossFill'), 'width');
  }

  hurt(): void {
    const f = this.e('hurtFlash');
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  private clearHud(): void {
    this.cache = {};
    this.floats.innerHTML = '';
    ['quip', 'banner', 'bossBar', 'finBtn'].forEach(id => this.e(id).classList.add('hidden'));
  }
}

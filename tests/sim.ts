// Безголовая симуляция игры (без браузера): проверяет ИИ людей, медведей, гранаты, сеть, продолжения.
const store = new Map<string, string>();
const noopCtx = new Proxy({}, { get: () => () => undefined, set: () => true });
const fakeCanvas = () => ({ width: 512, height: 512, style: {}, getContext: () => noopCtx, toBlob: (cb: (b: null) => void) => cb(null), addEventListener() {} });
const g = globalThis as any;
g.window = g; g.innerWidth = 390; g.innerHeight = 844; g.devicePixelRatio = 1;
g.addEventListener = () => undefined;
g.document = { createElement: () => fakeCanvas(), addEventListener() {}, hidden: false };
g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
g.requestAnimationFrame = () => 0;
Object.defineProperty(g, 'navigator', { value: { vibrate: () => true }, configurable: true });

let fails = 0;
const ok = (cond: boolean, msg: string) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fails++; };

async function boot(loc: string, bestWave = 0) {
  store.clear();
  store.set('medvedokalipsis_save_v1', JSON.stringify({ loc, locUnlocked: ['canteen', 'barrack', 'village', 'sawmill', 'banya', 'podezd'], bestWave, tutorialSeen: true, coins: 0 }));
  const { Game } = await import('../src/game');
  const { save } = await import('../src/save');
  Object.assign(save, { loc, bestWave, coins: 0, runs: 0, kills: 0, best: 0, tutorialSeen: true, locUnlocked: ['canteen', 'barrack', 'village', 'sawmill', 'banya', 'podezd'] });
  const log: string[] = [];
  const input: any = { x: 0, z: 0, bombPressed: false, chase: false, enabled: false, vector(o: any) { o.x = 0; o.z = 0; }, consumeLook: () => 0, setEnabled(v: boolean) { this.enabled = v; }, release() {} };
  const fakeRenderer: any = { setClearColor() {}, setPixelRatio() {}, setSize() {}, render() {}, domElement: fakeCanvas() };
  const game: any = new Game(fakeCanvas() as any, input, fakeRenderer);
  game.events = {
    hud() {}, quip(t: string) { log.push('quip:' + t); }, banner(t: string) { log.push('banner:' + t); }, float() {}, levelUp() {}, gameOver(r: any) { log.push('over:' + r.score); },
    bossBar() {}, hurt() {}, finish() {}, continuePrompt(l: number) { log.push('continue:' + l); },
  };
  return { game, log, input };
}
const step = (game: any, sec: number, dt = 1 / 30) => { for (let t = 0; t < sec; t += dt) game.update(dt); };
const bad = (game: any) => game.npcs.some((n: any) => !isFinite(n.x) || !isFinite(n.z)) || game.enemies.some((e: any) => !isFinite(e.x) || !isFinite(e.z)) || !isFinite(game.p.x);

(async () => {
  // ---------- 1. Лесопилка: паника, укрытие, преследование
  {
    const { game } = await boot('sawmill');
    game.start();
    ok(game.npcs.length === 5, 'на лесопилке 5 заключённых');
    ok(game.level.shelters.length === 2, 'на лесопилке 2 укрытия');
    game.waveState = 'break'; game.breakT = 999; // без обычных волн, только наш медведь
    step(game, 1);
    const start = game.npcs.map((n: any) => [n.x, n.z]);
    step(game, 2);
    const idle = game.npcs.every((n: any, i: number) => Math.hypot(n.x - start[i][0], n.z - start[i][1]) < 0.6);
    ok(idle, 'пока медведей нет, зэки работают на месте');
    game.spawnEnemy('bear', { x: -3.0, z: -9.5 });
    const seen = new Set<string>(); let targetedNpc = false, maxMove = 0, nan = false;
    const prev = game.npcs.map((n: any) => [n.x, n.z]);
    for (let i = 0; i < 30 * 12; i++) {
      game.update(1 / 30);
      for (const n of game.npcs) seen.add(n.state);
      for (const e of game.enemies) if (!e.dead && (e.tkind === 'npc' || e.tkind === 'door')) targetedNpc = true;
      if (bad(game)) nan = true;
      game.npcs.forEach((n: any, k: number) => { maxMove = Math.max(maxMove, Math.hypot(n.x - prev[k][0], n.z - prev[k][1])); });
    }
    console.log('  состояния людей:', [...seen].join(','), '| npc потеряно:', game.npcLost);
    ok(!nan, 'нет NaN в координатах');
    ok(seen.has('flee') || seen.has('toShelter'), 'зэки испугались и побежали');
    ok(seen.has('toShelter') || seen.has('hidden'), 'зэки пошли в укрытие');
    ok(targetedNpc, 'медведь выбрал целью человека/дверь, а не только игрока');
    ok(maxMove > 3, 'люди реально перемещались (' + maxMove.toFixed(1) + ' ед.)');
    ok(game.npcs.some((n: any) => n.state === 'hidden') || game.npcLost > 0 || seen.has('down'), 'кто-то спрятался либо был пойман медведем');
  }
  // ---------- 2. Дверь укрытия ломается
  {
    const { game } = await boot('sawmill');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    const sh = game.level.shelters[0];
    const n = game.npcs[0];
    n.x = sh.outPt.x - 0.3; n.z = sh.outPt.z + 0.3; n.px = n.x; n.pz = n.z;
    n.state = 'toShelter'; game.pickShelterForTest = 0;
    const picked = game['pickShelter'](n);
    ok(!!picked, 'укрытие выбрано');
    n.state = 'toShelter';
    for (let i = 0; i < 30 * 6 && n.state !== 'hidden'; i++) game.update(1 / 30);
    ok(n.state === 'hidden', 'человек зашёл в укрытие');
    for (let i = 0; i < 30 * 2; i++) game.update(1 / 30);
    ok(!sh.door.off && sh.doorMesh.visible, 'дверь закрыта за ним');
    const e = game.spawnEnemy('tank', { x: sh.outPt.x, z: sh.outPt.z + sh.fz * 2.5 });
    game.p.x = 0; game.p.z = 14; game.p.invuln = 99;
    for (let i = 0; i < 30 * 25 && !sh.broken; i++) game.update(1 / 30);
    ok(sh.broken, 'медведь выломал дверь укрытия (hp двери ' + Math.round(sh.door.hp ?? 0) + ')');
    step(game, 0.2);
    ok(n.state !== 'hidden', 'после взлома человек выбежал из укрытия');
    void e;
  }
  // ---------- 3. Мебель ломается медведем на пути
  {
    const { game } = await boot('canteen');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    game.p.x = 5.4; game.p.z = -2.0; game.p.invuln = 99;
    const before = game.level.obstacles.filter((a: any) => a.hp !== undefined && !a.off).length;
    game.spawnEnemy('bear', { x: 5.4, z: -10.5 });
    step(game, 25);
    const after = game.level.obstacles.filter((a: any) => a.hp !== undefined && !a.off).length;
    ok(after < before, 'медведь ломает мебель на пути (' + before + ' -> ' + after + ')');
  }
  // ---------- 4. Гранаты, дым, приманка, сеть
  {
    const { game } = await boot('canteen');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    game.p.x = 0; game.p.z = 10; game.p.invuln = 99;
    const a = game.spawnEnemy('bear', { x: 1, z: 4 }); const b = game.spawnEnemy('bear', { x: 1.6, z: 4.4 });
    const hp0 = a.hp + b.hp;
    game.useItem('frag');
    ok(game.items.frag === 1, 'осколочная списалась из рюкзака');
    step(game, 3);
    ok(a.hp + b.hp < hp0 || a.dead || b.dead, 'осколочная нанесла урон по куче');
    ok(game.itemCd <= 0, 'таймер между бросками отработал');
    game.useItem('net'); step(game, 1.0);
    const netted = game.enemies.filter((e: any) => !e.dead && e.netT > 0).length;
    ok(netted >= 1 || game.enemies.filter((e: any) => !e.dead).length === 0, 'сеть поймала медведя');
    // дым
    const c = game.spawnEnemy('bear', { x: -2, z: 3 });
    game.p.x = 0; game.p.z = 10; game.itemCd = 0;
    game.useItem('smoke');
    let wandering = false;
    for (let i = 0; i < 30 * 3; i++) { game.update(1 / 30); if (game.enemies.some((e: any) => !e.dead && e.tkind === 'wander')) wandering = true; }
    ok(game.smokes.length >= 1 || wandering, 'дымовая брошена');
    ok(wandering, 'медведи в дыму теряют цель (бродят)');
    // приманка
    game.smokes.length = 0;
    const d = game.spawnEnemy('bear', { x: 3, z: 0 }); d.tkind = 'player';
    game.itemCd = 0; game.useItem('decoy');
    let lured = false;
    for (let i = 0; i < 30 * 3; i++) { game.update(1 / 30); if (game.enemies.some((e: any) => !e.dead && e.tkind === 'lure')) lured = true; }
    ok(lured, 'медведи пошли на приманку');
    void c;
    // вместимость
    game.items = { frag: 4, smoke: 2, decoy: 2, net: 0 };
    ok(game['giveItem']('net') === false, 'рюкзак ограничен (макс. 8 предметов)');
  }
  // ---------- 5. Продолжение после смерти
  {
    const { save } = await import('../src/save');
  const { game, log } = await boot('canteen', 6);
    game.start(); game.waveState = 'break'; game.breakT = 999;
    ok(game.continuesLeft === 2, 'за волну 6 открыто 2 продолжения');
    game.p.score = 1234; game.p.runCoins = 10;
    game.p.invuln = 0; game.hurtPlayer(9999, 'cub', 0, 0);
    for (let i = 0; i < 30 * 8 && game.mode !== 'continue'; i++) game.update(1 / 30);
    ok(game.mode === 'continue', 'после смерти предложено продолжение');
    const coins0 = save.coins;
    ok(coins0 === 0, 'награды не начислены до конца забега');
    game.continueRun();
    ok(game.mode === 'play' && game.p.hp > 0 && game.p.invuln > 3, 'воскрес с защитой на несколько секунд');
    ok(game.p.score === 1234 && game.continuesLeft === 1, 'счёт сохранён, продолжение потрачено');
    game.hurtPlayer(1, 'cub', 0, 0);
    ok(game.p.hp > game.stats.maxHp * 0.5, 'защита от повторной смерти сработала');
    game.p.invuln = 0; game.hurtPlayer(9999, 'cub', 0, 0);
    for (let i = 0; i < 30 * 8 && game.mode !== 'continue'; i++) game.update(1 / 30);
    game.continueRun();
    game.p.invuln = 0; game.hurtPlayer(9999, 'cub', 0, 0);
    for (let i = 0; i < 30 * 8 && game.mode !== 'over'; i++) game.update(1 / 30);
    ok(game.mode === 'over', 'когда продолжения кончились — конец забега (без бесконечных)');
    const s1 = JSON.parse(store.get('medvedokalipsis_save_v1')!);
    game.finish(); game.finish();
    const s2 = JSON.parse(store.get('medvedokalipsis_save_v1')!);
    ok(s2.coins === s1.coins && s1.coins > 0, 'награда начислена один раз (' + s1.coins + ')');
    ok(s2.runs === 1, 'забег засчитан один раз');
    void log;
  }
  // ---------- 5b. Живое поведение: не стоят столбом, храбрый бросает, спасение, преследование
  {
    const { game } = await boot('barrack');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.p.x = 0; game.p.z = 13; game.p.invuln = 1e9;
    const e = game.spawnEnemy('bear', { x: 0, z: -2 });
    let frozen = 0, scaredFrames = 0, thrown = 0, closest = 99, chased = false, rescued = false;
    const last = game.npcs.map((n: any) => [n.x, n.z]);
    const origThrow = game['npcThrow'].bind(game);
    game['npcThrow'] = (...a: any[]) => { thrown++; return origThrow(...a); };
    for (let i = 0; i < 30 * 20; i++) {
      game.update(1 / 30);
      game.npcs.forEach((n: any, k: number) => {
        if (n.state === 'flee' && !e.dead) {
          const d = Math.hypot(n.x - e.x, n.z - e.z);
          if (d < 4) { scaredFrames++; if (Math.hypot(n.x - last[k][0], n.z - last[k][1]) < 0.01) frozen++; }
        }
        if (n.state === 'down' && !rescued) { game.p.x = n.x; game.p.z = n.z + 0.5; rescued = true; }
        last[k] = [n.x, n.z];
        if (n.state !== 'dead' && n.state !== 'hidden') closest = Math.min(closest, Math.hypot(n.x - e.x, n.z - e.z));
      });
      if (e.tkind === 'npc') chased = true;
    }
    ok(chased, 'медведь преследует людей');
    ok(frozen < Math.max(3, scaredFrames * 0.1), 'испуганные не стоят столбом перед медведем (замерло ' + frozen + ' из ' + scaredFrames + ' кадров)');
    ok(thrown > 0, 'храбрые/помощники бросают предметы в медведя (' + thrown + ')');
    ok(closest < 3, 'медведь догоняет людей (ближе всего ' + closest.toFixed(1) + ')');
    ok(game.npcs.some((n: any) => n.state === 'dead' || n.state === 'down' || n.kind === 'helper') || e.dead, 'нападение/спасение отработало');
  }
  // ---------- 5c. Вид от 3-го лица: медведь вплотную за спиной тоже получает пули
  {
    const { game, input } = await boot('canteen');
    const { save } = await import('../src/save');
    save.camMode = 'chase'; game.camMode = 'chase';
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    game.p.x = 0; game.p.z = 5; game.p.invuln = 1e9; game.camYaw = Math.PI;
    input.vector = (o: any) => { o.x = 0; o.z = 0; };
    const behind = game.spawnEnemy('bear', { x: 0, z: 7.0 });
    const far = game.spawnEnemy('bear', { x: 0, z: -4 }); far.spd = 0; far.hp = far.maxHp = 1e6;
    behind.spd = 0;
    for (let i = 0; i < 30 * 12 && !behind.dead; i++) game.update(1 / 30);
    ok(behind.dead || behind.hp < behind.maxHp * 0.3 || behind.fin === 1, 'медведь вплотную за спиной убит/добивается (hp ' + Math.round(behind.hp) + '/' + Math.round(behind.maxHp) + ')');
    save.camMode = 'top'; game.camMode = 'top';
  }
  // ---------- 5d. Медведь не «приклеивается» к игроку на бегу
  {
    const { game, input } = await boot('canteen');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    game.locIndex = 5; game.wave = 5; game.p.invuln = 1e9; game.p.x = 0; game.p.z = 9;
    const e = game.spawnEnemy('cub', { x: 0, z: 6.5 });
    let glued = 0, frames = 0, minD = 99, hits = 0;
    const baseHurt = game.hurtPlayer.bind(game);
    game.hurtPlayer = (...a: any[]) => { hits++; return baseHurt(...a); };
    let i = 0;
    input.vector = (o: any) => { o.x = Math.sin(i / 50) * 0.9; o.z = Math.cos(i / 37) * 0.9; };
    for (i = 0; i < 30 * 30; i++) {
      game.update(1 / 30);
      if (i < 30) continue;
      const d = Math.hypot(e.x - game.p.x, e.z - game.p.z);
      frames++; minD = Math.min(minD, d);
      if (d < (e.r + game.p.r) * 0.6) glued++;
    }
    console.log('  быстрый медведь на позднем этапе: скорость', e.spd.toFixed(2), 'против', game.stats.speed.toFixed(2), '| минимальная дистанция', minD.toFixed(2), '| «внутри» игрока кадров:', glued, 'из', frames);
    ok(glued < frames * 0.03, 'медведь не сидит «внутри» игрока и не приклеивается');
  }
  // ---------- 5e. Прогрессия: 5 волн, выход, следующая локация, открытие
  {
    const { game } = await boot('canteen');
    const { save } = await import('../src/save');
    save.locUnlocked = ['canteen'];
    game.start(); game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    ok(save.locUnlocked.length === 1, 'в начале открыта только столовая');
    // длины волн и лимиты
    const sizes = [1, 2, 3, 4, 5].map(w => { game.wave = w; game.locIndex = 0; return game['buildQueue'](w).length; });
    console.log('  размер волн в столовой:', sizes.join(', '), '(раньше было 11/14/17/20/..)');
    ok(sizes[0] <= 8 && Math.max(...sizes) <= 14, 'волны заметно меньше прежних');
    game.wave = 5; game.locIndex = 0; game.waveState = 'fight'; game.queue = []; game.enemies.forEach((e: any) => game.scene.remove(e.rig.root)); game.enemies = [];
    game.update(1 / 30);
    ok(game.waveState === 'exit' && game.exitMarker.visible, 'после 5-й волны (босса) открылся выход');
    game.p.x = 0; game.p.z = 14.2; game.p.invuln = 1e9;
    game.update(1 / 30);
    ok(game.locIndex === 1 && game.locDef.id === 'barrack', 'игрок прошёл в дверь — следующая локация (Барак)');
    ok(save.locUnlocked.includes('barrack'), 'Барак открыт навсегда');
    ok(game.wave === 0 && game.waveState === 'break' && game.npcs.length === 4, 'на новой локации новые люди и отсчёт волн с начала');
    // последняя локация → победа
    game.locIndex = 5; game.locDef = game.locDef; game.wave = 5; game.waveState = 'fight'; game.queue = []; game.enemies = [];
    for (let i = 0; i < 30 * 4 && game.mode !== 'over'; i++) game.update(1 / 30);
    ok(game.mode === 'over' && game.result.victory, 'после последней локации — победа');
  }
  // ---------- 5f. Игрок заходит в будку: дверь открывается, внутри можно отсидеться, медведь ломает дверь
  {
    const { game } = await boot('sawmill');
    game.start(); game.waveState = 'break'; game.breakT = 999;
    game.npcs.forEach((n: any) => { n.state = 'dead'; game.scene.remove(n.rig.root); });
    const sh = game.level.shelters[0];
    const input = game.input;
    game.p.x = sh.outPt.x; game.p.z = sh.outPt.z; game.p.invuln = 0.1; game.p.hp = 30;
    input.vector = (o: any) => { o.x = 0; o.z = -sh.fz * 1; };      // идём к двери и внутрь
    let opened = false, inside = false;
    for (let i = 0; i < 30 * 5; i++) { game.update(1 / 30); if (sh.open) opened = true; if (game['playerShelter']() === sh) inside = true; }
    ok(opened, 'дверь будки открылась перед игроком');
    ok(inside, 'игрок зашёл внутрь будки');
    input.vector = (o: any) => { o.x = 0; o.z = 0; };
    const hp0 = game.p.hp;
    step(game, 2);
    ok(!sh.open && game.p.hp > hp0, 'дверь закрылась за ним, внутри здоровье восстанавливается (' + Math.round(hp0) + ' → ' + Math.round(game.p.hp) + ')');
    const e = game.spawnEnemy('tank', { x: sh.outPt.x, z: sh.outPt.z + sh.fz * 3 }); void e;
    game.p.invuln = 1e9;
    for (let i = 0; i < 30 * 25 && !sh.broken; i++) game.update(1 / 30);
    ok(sh.broken, 'медведь выломал дверь, пока игрок отсиживался');
  }
  // ---------- 6. Длинный прогон со всеми локациями: нет исключений и NaN
  for (const loc of ['canteen', 'barrack', 'village', 'sawmill', 'banya', 'podezd']) {
    const { game, input } = await boot(loc);
    game.start();
    let nan = false;
    game.p.invuln = 1e9;
    for (let i = 0; i < 30 * 70; i++) {
      input.x = Math.sin(i / 40); input.z = Math.cos(i / 55);
      input.vector = (o: any) => { o.x = Math.sin(i / 40) * 0.8; o.z = Math.cos(i / 55) * 0.8; };
      game.update(1 / 30);
      if (game.mode === 'choose') game.pickUpgrade('dmg');
      if (bad(game)) nan = true;
      if (i % 200 === 0) game.useItem(['frag', 'smoke', 'decoy', 'net'][(i / 200) % 4 | 0]);
    }
    ok(!nan && game.mode === 'play', loc + ': 70 с геймплея без ошибок (волна ' + game.wave + ', врагов ' + game.enemies.length + ', людей жив ' + game.npcs.filter((n: any) => n.state !== 'dead').length + ')');
  }
  console.log(fails ? '\nПРОВАЛЕНО: ' + fails : '\nВСЕ ПРОВЕРКИ ПРОЙДЕНЫ');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('ОШИБКА', e); process.exit(2); });

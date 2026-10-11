import { Game } from './game';
import { Input } from './input';
import { UI } from './ui';
import { audio } from './audio';
import { save } from './save';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = new UI(document.getElementById('ui') as HTMLElement);
const input = new Input(ui.zone, ui.stickBase, ui.stickKnob);
const game = new Game(canvas, input);
ui.bind(game, input);
audio.muted = save.muted;
game.showMenu();
ui.menu();

// звук можно запускать только после жеста пользователя
const unlock = () => { audio.init(); audio.startMusic(); };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { game.pause(); ui.onPause(); }
});

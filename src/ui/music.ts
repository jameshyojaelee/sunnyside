import { ICONS, roundButton } from './icons.ts';

// Background music: "Bossa Nova do Build" by james_leee (made with Suno). Browsers block sound
// until the visitor interacts, so it starts on the first click, tap or key press, and the
// on/off choice is remembered.
const SRC = `${import.meta.env.BASE_URL}audio/bossa-nova-do-build.mp3`;
const KEY = 'sunnyside:music';
const VOLUME = 0.35;

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Private mode or blocked storage: the choice just won't be remembered.
  }
};

export function setupMusic(host: HTMLElement): void {
  const audio = new Audio();
  audio.src = SRC;
  audio.loop = true;
  audio.preload = 'none';
  audio.volume = 0;
  let wanted = read() !== 'off';
  let fade = 0;

  const fadeTo = (target: number, done?: () => void) => {
    cancelAnimationFrame(fade);
    const start = audio.volume;
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 800);
      audio.volume = start + (target - start) * k;
      if (k < 1) fade = requestAnimationFrame(step);
      else done?.();
    };
    fade = requestAnimationFrame(step);
  };
  const play = () => {
    audio
      .play()
      .then(() => fadeTo(VOLUME))
      .catch(() => {
        // Still blocked (no user gesture yet); the next interaction will try again.
      });
  };
  const stop = () => fadeTo(0, () => audio.pause());

  const button = roundButton(ICONS.music, '', () => {
    wanted = !wanted;
    write(wanted ? 'on' : 'off');
    if (wanted) play();
    else stop();
    render();
  });
  const render = () => {
    button.innerHTML = wanted ? ICONS.music : ICONS.musicOff;
    const label = wanted ? 'Turn music off' : 'Turn music on';
    button.title = label;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-pressed', String(wanted));
  };
  render();
  host.append(button);
  if (import.meta.env.DEV) Object.assign(window, { __music: audio });

  // Start on the first interaction anywhere (except the music button itself, which decides on its own).
  const first = (e: Event) => {
    if (button.contains(e.target as Node)) return;
    window.removeEventListener('pointerdown', first, true);
    window.removeEventListener('keydown', first, true);
    if (wanted && audio.paused) play();
  };
  window.addEventListener('pointerdown', first, true);
  window.addEventListener('keydown', first, true);

  // Be quiet in background tabs.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.pause();
    else if (wanted && audio.currentTime > 0) play();
  });
}

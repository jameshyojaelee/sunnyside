// Simple white pictograms for the round buttons (original drawings, 24x24 viewBox).
const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  minus: svg('<path d="M5 12h14"/>'),
  rotate: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'),
  home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6.5 10v9h11v-9"/><path d="M10.5 19v-5h3v5"/>'),
  places: svg(
    '<path d="M12 2.8 16.2 9 12 15.2 7.8 9Z" fill="currentColor" stroke="none"/><path d="M5 19.5h14"/><path d="M8 22h8"/>',
  ),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.2v.1"/>'),
  build: svg('<path d="M14.5 4.5 19.5 9.5"/><path d="M13 6 5 14l5 5 8-8"/><path d="M3.5 20.5 7 17"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
};

export function roundButton(icon: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'round-btn';
  b.type = 'button';
  b.innerHTML = icon;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

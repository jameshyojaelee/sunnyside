import { ICONS } from './icons.ts';

/** Everything the card shows; built from a place or a landmark. */
export interface CardInfo {
  name: string;
  label: string;
  color: string;
  description: string;
  address?: string;
  visited?: string;
  link?: string;
  photos?: string[];
  /** Other places in the same building, offered as quick links. */
  neighbors?: Array<{ name: string; open: () => void }>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** Sims-style info panel for one place. All user text goes through textContent. */
export class PlaceCard {
  readonly root: HTMLElement;
  private onClose: () => void;

  constructor(parent: HTMLElement, onClose: () => void) {
    this.onClose = onClose;
    this.root = el('section', 'panel card');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-labelledby', 'card-title');
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  open(place: CardInfo) {
    const r = this.root;
    r.replaceChildren();
    const close = el('button', 'round-btn small card-close');
    close.type = 'button';
    close.innerHTML = ICONS.close;
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());

    const chip = el('div', 'card-cat', place.label);
    chip.style.setProperty('--cat', place.color);
    const title = el('h2', 'card-title', place.name);
    title.id = 'card-title';

    const body = el('div', 'card-body');
    for (const para of place.description.split(/\n\s*\n/)) if (para.trim()) body.append(el('p', undefined, para.trim()));

    r.append(close, chip, title, body);

    if (place.photos?.length) {
      const photos = el('div', 'card-photos');
      for (const src of place.photos) {
        const a = el('a');
        a.href = `${import.meta.env.BASE_URL}${src}`;
        a.target = '_blank';
        a.rel = 'noopener';
        const img = el('img');
        img.src = a.href;
        img.alt = `Photo of ${place.name}`;
        img.loading = 'lazy';
        a.append(img);
        photos.append(a);
      }
      r.append(photos);
    }

    const meta = el('dl', 'card-meta');
    const row = (k: string, v: Node | string) => {
      meta.append(el('dt', undefined, k));
      const dd = el('dd');
      dd.append(v);
      meta.append(dd);
    };
    if (place.address) row('Address', place.address);
    if (place.visited) row('First visited', formatDate(place.visited));
    if (place.link) {
      const a = el('a', undefined, new URL(place.link).hostname.replace(/^www\./, ''));
      a.href = place.link;
      a.target = '_blank';
      a.rel = 'noopener';
      row('Link', a);
    }
    if (meta.childElementCount) r.append(meta);

    if (place.neighbors?.length) {
      const also = el('div', 'card-also');
      also.append(el('span', undefined, 'Also in this building: '));
      place.neighbors.forEach((n, i) => {
        const b = el('button', 'link-btn', n.name);
        b.type = 'button';
        b.addEventListener('click', n.open);
        if (i) also.append(', ');
        also.append(b);
      });
      r.append(also);
    }

    r.hidden = false;
    r.scrollTop = 0;
    close.focus({ preventScroll: true });
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose();
  }

  /** Screen area the card covers, so the camera can keep the building visible beside it. */
  coverage(): { right: number; bottom: number } {
    if (this.root.hidden) return { right: 0, bottom: 0 };
    const rect = this.root.getBoundingClientRect();
    const sheet = rect.width >= window.innerWidth - 40;
    return sheet ? { right: 0, bottom: window.innerHeight - rect.top } : { right: window.innerWidth - rect.left, bottom: 0 };
  }
}

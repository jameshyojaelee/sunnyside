import { CATEGORIES, CATEGORY_IDS } from '../data/categories.ts';
import { ABOUT_INTRO } from '../data/site.ts';
import type { Place } from '../places.ts';
import { ICONS } from './icons.ts';

/** A left-side panel that can be toggled; only one is open at a time. */
class SidePanel {
  readonly root: HTMLElement;
  private static open: SidePanel | null = null;

  constructor(parent: HTMLElement, label: string) {
    this.root = document.createElement('section');
    this.root.className = 'panel side-panel';
    this.root.setAttribute('aria-label', label);
    this.root.hidden = true;
    parent.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.show();
  }

  show() {
    SidePanel.open?.close();
    SidePanel.open = this;
    this.render();
    this.root.hidden = false;
    this.root.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }

  close() {
    this.root.hidden = true;
    if (SidePanel.open === this) SidePanel.open = null;
  }

  static closeAll() {
    SidePanel.open?.close();
  }

  protected header(title: string) {
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'round-btn small panel-close';
    close.innerHTML = ICONS.close;
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => this.close());
    const h = document.createElement('h2');
    h.textContent = title;
    return [close, h];
  }

  protected render() {}
}

export const closeSidePanels = () => SidePanel.closeAll();

/** Every place, grouped by category; clicking one flies there and opens its card. */
export class PlacesList extends SidePanel {
  private places: Place[] = [];
  private onPick: (id: string) => void;

  constructor(parent: HTMLElement, onPick: (id: string) => void) {
    super(parent, 'Our places');
    this.onPick = onPick;
  }

  setPlaces(places: Place[]) {
    this.places = places;
    if (this.isOpen) this.render();
  }

  protected render() {
    this.root.replaceChildren(...this.header('Our places'));
    if (!this.places.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'No places yet. They show up here as we visit them.';
      this.root.append(p);
      return;
    }
    for (const cat of CATEGORY_IDS) {
      const inCat = this.places.filter((p) => p.category === cat).sort((a, b) => a.name.localeCompare(b.name));
      if (!inCat.length) continue;
      const h = document.createElement('h3');
      h.textContent = CATEGORIES[cat].label;
      h.style.setProperty('--cat', CATEGORIES[cat].color);
      const ul = document.createElement('ul');
      ul.className = 'place-list';
      for (const p of inCat) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = p.name;
        if (p.address) {
          const small = document.createElement('small');
          small.textContent = p.address;
          b.append(small);
        }
        b.addEventListener('click', () => {
          if (window.matchMedia('(max-width: 640px)').matches) this.close();
          this.onPick(p.id);
        });
        li.append(b);
        ul.append(li);
      }
      this.root.append(h, ul);
    }
  }
}

/** Who we are, how to use the map, and data credits. */
export class AboutPanel extends SidePanel {
  constructor(parent: HTMLElement) {
    super(parent, 'About this map');
  }

  protected render() {
    const body = document.createElement('div');
    body.className = 'about';
    body.innerHTML = `
      <p class="intro"></p>
      <h3>Getting around</h3>
      <ul>
        <li>Drag to move around; scroll or pinch to zoom.</li>
        <li>Turn the view with the two rotate buttons (or Q and E).</li>
        <li>Click a building with a heart to read about it.</li>
      </ul>
      <h3>Credits</h3>
      <p>Streets, parks, rail and buildings: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>, under the Open Database License.
      Street trees: NYC Parks, via NYC Open Data. Neighborhood boundary: NYC Department of City Planning.
      Music: “Bossa Nova do Build” by james_leee, made with Suno.</p>
      <p class="small">Inspired by the look of The Sims (1999/2000). Not affiliated with or endorsed by Electronic Arts or Maxis. Business names identify places we like; we aren't affiliated with them.</p>`;
    body.querySelector('.intro')!.textContent = ABOUT_INTRO;
    this.root.replaceChildren(...this.header('About this map'), body);
  }
}

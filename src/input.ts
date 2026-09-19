import type { MapApp } from './app.ts';

export interface InputHandlers {
  /** Click or tap without dragging. */
  onTap?(sx: number, sy: number, pointerType: string): void;
  /** Mouse moved with no button held (null when the pointer leaves). */
  onHover?(sx: number, sy: number): void;
  onLeave?(): void;
  onEscape?(): void;
}

const TAP_SLOP = 6; // px
const TAP_MS = 600;

/** Pointer Events controller: drag to pan, wheel/pinch to zoom, tap to pick, keys for pan/zoom/rotate. */
export function attachInput(app: MapApp, el: HTMLElement, h: InputHandlers): void {
  el.style.touchAction = 'none';
  const pts = new Map<number, { x: number; y: number }>();
  let pan: { gx: number; gy: number } | null = null;
  let pinch: { dist: number; gx: number; gy: number; scale: number } | null = null;
  let down: { x: number; y: number; t: number; moved: boolean } | null = null;
  let hoverFrame = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const startPan = (p: { x: number; y: number }) => {
    const [gx, gy] = app.screenToGround(p.x, p.y);
    pan = { gx, gy };
  };

  const startPinch = () => {
    const [a, b] = [...pts.values()];
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const [gx, gy] = app.screenToGround(mx, my);
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, gx, gy, scale: app.view.scale };
    pan = null;
  };

  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      startPan(p);
      down = { ...p, t: performance.now(), moved: false };
    } else if (pts.size === 2) {
      startPinch();
      if (down) down.moved = true;
    }
  });

  el.addEventListener('pointermove', (e) => {
    const p = local(e);
    if (!pts.has(e.pointerId)) {
      if (e.pointerType === 'mouse' && h.onHover) {
        cancelAnimationFrame(hoverFrame);
        hoverFrame = requestAnimationFrame(() => h.onHover!(p.x, p.y));
      }
      return;
    }
    pts.set(e.pointerId, p);
    if (down && Math.hypot(p.x - down.x, p.y - down.y) > TAP_SLOP) down.moved = true;
    if (pts.size === 1 && pan) {
      const [gx, gy] = app.screenToGround(p.x, p.y);
      app.setView({ tx: app.view.tx + pan.gx - gx, ty: app.view.ty + pan.gy - gy });
    } else if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const scale = (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.dist;
      app.setView({ scale });
      const [gx, gy] = app.screenToGround(mx, my);
      app.setView({ tx: app.view.tx + pinch.gx - gx, ty: app.view.ty + pinch.gy - gy });
    }
  });

  const end = (e: PointerEvent) => {
    if (!pts.has(e.pointerId)) return;
    const p = local(e);
    pts.delete(e.pointerId);
    if (pts.size === 1) {
      pinch = null;
      startPan([...pts.values()][0]);
    } else if (pts.size === 0) {
      pan = null;
      pinch = null;
      if (e.type === 'pointerup' && down && !down.moved && performance.now() - down.t < TAP_MS) h.onTap?.(p.x, p.y, e.pointerType);
      down = null;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !pts.size) h.onLeave?.();
  });

  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const p = local(e);
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1;
      // Trackpad pinch arrives as ctrl+wheel with small deltas; treat it more strongly.
      const k = e.ctrlKey ? 0.01 : 0.0018;
      app.zoomAt(Math.exp(-e.deltaY * unit * k), p.x, p.y);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const step = 120; // px
    const panPx = (dx: number, dy: number) => {
      const [ax, ay] = app.screenToGround(app.vp.width / 2, app.vp.height / 2);
      const [bx, by] = app.screenToGround(app.vp.width / 2 + dx, app.vp.height / 2 + dy);
      app.animateTo({ tx: app.view.tx + bx - ax, ty: app.view.ty + by - ay }, 200);
    };
    switch (e.key) {
      case 'ArrowLeft':
        panPx(-step, 0);
        break;
      case 'ArrowRight':
        panPx(step, 0);
        break;
      case 'ArrowUp':
        panPx(0, -step);
        break;
      case 'ArrowDown':
        panPx(0, step);
        break;
      case '+':
      case '=':
        app.zoomAnimated(1.5);
        break;
      case '-':
      case '_':
        app.zoomAnimated(1 / 1.5);
        break;
      case 'q':
      case 'Q':
        app.rotate(-1);
        break;
      case 'e':
      case 'E':
        app.rotate(1);
        break;
      case 'Escape':
        h.onEscape?.();
        break;
      default:
        return;
    }
    e.preventDefault();
  });
}

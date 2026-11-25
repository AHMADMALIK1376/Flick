// Where arrows start and end on the whiteboard: at the edge of each shape, not its centre.
import type { DrawingElement } from '../../api/types';

export interface Point {
  x: number;
  y: number;
}

type Shape = Exclude<DrawingElement, { type: 'arrow' }>;

export function centre(el: Shape): Point {
  return el.type === 'box' ? { x: el.x + el.w / 2, y: el.y + el.h / 2 } : { x: el.x, y: el.y };
}

/** The point where a line from the shape's centre towards `toward` leaves the shape (plus a gap). */
export function edgePoint(el: Shape, toward: Point, gap = 10): Point {
  const c = centre(el);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  let distance: number;
  if (el.type === 'box') {
    // Scale the direction until it hits the rectangle.
    const tx = ux !== 0 ? el.w / 2 / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? el.h / 2 / Math.abs(uy) : Infinity;
    distance = Math.min(tx, ty);
  } else if (el.type === 'circle') {
    distance = el.r;
  } else if (el.type === 'emoji') {
    distance = el.size * 0.55;
  } else {
    // text: roughly half its width / height
    const halfW = (el.text.length * el.size * 0.45) / 2;
    const halfH = el.size * 0.6;
    const tx = ux !== 0 ? halfW / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? halfH / Math.abs(uy) : Infinity;
    distance = Math.min(tx, ty);
  }
  return { x: c.x + ux * (distance + gap), y: c.y + uy * (distance + gap) };
}

/** A gently curved arrow path from `a` to `b` (hand-drawn look), and where its label goes. */
export function arrowPath(a: Shape, b: Shape): { d: string; label: Point } {
  const start = edgePoint(a, centre(b));
  const end = edgePoint(b, centre(a));
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = 0.12; // curve sideways by 12% of the length
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return {
    d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    // Point on the curve at t = 0.5
    label: { x: 0.25 * start.x + 0.5 * cx + 0.25 * end.x, y: 0.25 * start.y + 0.5 * cy + 0.25 * end.y - 12 },
  };
}

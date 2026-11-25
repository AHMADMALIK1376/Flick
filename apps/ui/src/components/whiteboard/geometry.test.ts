import { describe, expect, it } from 'vitest';
import { arrowPath, edgePoint } from './geometry';

const box = { id: 'a', type: 'box' as const, step: 1, x: 100, y: 100, w: 200, h: 100, label: '', emoji: '', color: 'plum' as const };
const circle = { id: 'b', type: 'circle' as const, step: 1, x: 700, y: 150, r: 50, label: '', emoji: '', color: 'aqua' as const };

describe('edgePoint', () => {
  it('leaves a box on its right side when heading right', () => {
    const p = edgePoint(box, { x: 700, y: 150 }, 0);
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(150);
  });
  it('leaves a circle at its radius (+ gap)', () => {
    const p = edgePoint(circle, { x: 200, y: 150 }, 10);
    expect(p.x).toBeCloseTo(640);
  });
});

describe('arrowPath', () => {
  it('runs from edge to edge with a label in the middle', () => {
    const { d, label } = arrowPath(box, circle);
    expect(d.startsWith('M 310.0 150.0')).toBe(true);
    expect(d.endsWith('640.0 150.0')).toBe(true);
    expect(label.x).toBeGreaterThan(310);
    expect(label.x).toBeLessThan(640);
  });
});

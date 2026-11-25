// The whiteboard: draws a Drawing up to `step`, with a hand-drawn look.
// New parts animate in (lines draw themselves, text fades in, emoji pop), old parts stay.
import type { CSSProperties } from 'react';
import type { Drawing, DrawingElement, InkColor } from '../../api/types';
import { arrowPath } from './geometry';
import './whiteboard.css';

const INK: Record<InkColor, { stroke: string; fill: string }> = {
  plum: { stroke: '#4b3f72', fill: '#ece8f6' },
  aqua: { stroke: '#2f9e95', fill: '#e3f6f4' },
  amber: { stroke: '#c07a12', fill: '#fdf1dc' },
  rose: { stroke: '#c0475a', fill: '#fbe6ea' },
  green: { stroke: '#2f7d4f', fill: '#e2f3e8' },
  gray: { stroke: '#5d5675', fill: '#f1eff6' },
};
const HAND = '"Caveat", "Segoe Print", "Comic Sans MS", cursive';

type Shape = Exclude<DrawingElement, { type: 'arrow' }>;

interface Props {
  drawing: Drawing;
  /** Show everything up to this step (1-based). 0 = only the title. */
  step: number;
  /** Delay animations for parts of the current step so they appear one after another. */
  animate?: boolean;
  style?: CSSProperties;
}

export function Whiteboard({ drawing, step, animate = true, style }: Props) {
  const shapes = drawing.elements.filter((e): e is Shape => e.type !== 'arrow');
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const visible = drawing.elements.filter((e) => e.step <= step);
  // Order within the current step: shapes first, then arrows, a beat apart.
  let order = 0;
  const delay = (el: DrawingElement) => (animate && el.step === step ? `${(order++ * 0.35).toFixed(2)}s` : '0s');
  const fresh = (el: DrawingElement) => (animate && el.step === step ? ' wb-new' : '');

  const visibleShapes = visible.filter((e): e is Shape => e.type !== 'arrow');
  const visibleArrows = visible.filter((e): e is Extract<DrawingElement, { type: 'arrow' }> => e.type === 'arrow');

  return (
    <svg
      viewBox="0 0 1000 600"
      role="img"
      aria-label={`Whiteboard: ${drawing.title}`}
      style={{ width: '100%', height: 'auto', display: 'block', background: '#fffdf8', borderRadius: 14, ...style }}
    >
      <defs>
        <pattern id="wb-dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.3" fill="#e6e1d6" />
        </pattern>
        {/* Slight wobble so lines look drawn by hand */}
        <filter id="wb-rough" x="-5%" y="-5%" width="110%" height="110%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" />
          <feDisplacementMap in="SourceGraphic" scale="3.2" />
        </filter>
        {(Object.keys(INK) as InkColor[]).map((c) => (
          <marker key={c} id={`wb-head-${c}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={INK[c].stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </marker>
        ))}
      </defs>
      <rect width="1000" height="600" fill="url(#wb-dots)" />
      <text x="28" y="44" fontFamily={HAND} fontSize="34" fontWeight="700" fill="#4b3f72">
        {drawing.title}
      </text>

      {visibleShapes.map((el, i) => (
        <ShapeView key={el.id || i} el={el} className={fresh(el)} delay={delay(el)} />
      ))}
      {visibleArrows.map((el, i) => {
        const a = byId.get(el.from);
        const b = byId.get(el.to);
        if (!a || !b) return null;
        const { d, label } = arrowPath(a, b);
        const ink = INK[(a.type === 'box' || a.type === 'circle' || a.type === 'text' ? a.color : 'gray') as InkColor] ?? INK.gray;
        const color = (a.type === 'box' || a.type === 'circle' || a.type === 'text' ? a.color : 'gray') as InkColor;
        const wait = delay(el);
        return (
          <g key={`arrow-${i}`} className={fresh(el)} style={{ animationDelay: wait }}>
            <path
              d={d}
              pathLength={1}
              className="wb-stroke"
              style={{ animationDelay: wait }}
              fill="none"
              stroke={ink.stroke}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray={el.dashed ? '0.03 0.025' : undefined}
              markerEnd={`url(#wb-head-${color})`}
              filter="url(#wb-rough)"
            />
            {el.label && (
              <text
                x={label.x}
                y={label.y}
                textAnchor="middle"
                fontFamily={HAND}
                fontSize={24}
                fontWeight={700}
                fill={ink.stroke}
                stroke="#fffdf8"
                strokeWidth={6}
                paintOrder="stroke"
                className="wb-fade"
                style={{ animationDelay: wait }}
              >
                {el.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ShapeView({ el, className, delay }: { el: Shape; className: string; delay: string }) {
  const style = { animationDelay: delay };
  if (el.type === 'emoji') {
    return (
      <g className={className}>
        <text x={el.x} y={el.y} textAnchor="middle" dominantBaseline="central" fontSize={el.size} className="wb-pop" style={{ ...style, transformOrigin: `${el.x}px ${el.y}px` }}>
          {el.char}
        </text>
        {el.label && (
          <Label x={el.x} y={el.y + el.size * 0.62 + 20} text={el.label} color={INK.plum.stroke} delay={delay} />
        )}
      </g>
    );
  }
  if (el.type === 'text') {
    return (
      <text
        x={el.x}
        y={el.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily={HAND}
        fontSize={el.size * 1.15}
        fontWeight={700}
        fill={INK[el.color].stroke}
        className={`wb-fade${className}`}
        style={style}
      >
        {el.text}
      </text>
    );
  }
  const ink = INK[el.color];
  const cx = el.type === 'box' ? el.x + el.w / 2 : el.x;
  const cy = el.type === 'box' ? el.y + el.h / 2 : el.y;
  const hasEmoji = !!el.emoji;
  const labelY = hasEmoji ? cy + (el.type === 'box' ? el.h * 0.22 : el.r * 0.38) : cy;
  const emojiY = el.type === 'box' ? cy - el.h * 0.18 : cy - el.r * 0.25;
  const emojiSize = el.type === 'box' ? Math.min(el.h * 0.42, 40) : Math.min(el.r * 0.75, 44);
  return (
    <g className={className}>
      {el.type === 'box' ? (
        <rect
          x={el.x}
          y={el.y}
          width={el.w}
          height={el.h}
          rx={14}
          pathLength={1}
          fill={ink.fill}
          stroke={ink.stroke}
          strokeWidth={3.2}
          filter="url(#wb-rough)"
          className="wb-stroke wb-fill"
          style={style}
        />
      ) : (
        <circle
          cx={el.x}
          cy={el.y}
          r={el.r}
          pathLength={1}
          fill={ink.fill}
          stroke={ink.stroke}
          strokeWidth={3.2}
          filter="url(#wb-rough)"
          className="wb-stroke wb-fill"
          style={style}
        />
      )}
      {hasEmoji && (
        <text x={cx} y={emojiY} textAnchor="middle" dominantBaseline="central" fontSize={emojiSize} className="wb-pop" style={{ ...style, transformOrigin: `${cx}px ${emojiY}px` }}>
          {el.emoji}
        </text>
      )}
      {el.label && (
        <text
          x={cx}
          y={labelY}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily={HAND}
          fontSize={fitSize(el.label, el.type === 'box' ? el.w : el.r * 2)}
          fontWeight={700}
          fill={ink.stroke}
          className="wb-fade"
          style={style}
        >
          {el.label}
        </text>
      )}
    </g>
  );
}

function Label({ x, y, text, color, delay }: { x: number; y: number; text: string; color: string; delay: string }) {
  return (
    <text x={x} y={y} textAnchor="middle" fontFamily={HAND} fontSize={26} fontWeight={700} fill={color} className="wb-fade" style={{ animationDelay: delay }}>
      {text}
    </text>
  );
}

/** Font size that keeps a label inside its shape. */
function fitSize(text: string, width: number): number {
  const ideal = 30;
  const maxByWidth = (width * 0.9) / Math.max(1, text.length * 0.46);
  return Math.max(16, Math.min(ideal, maxByWidth));
}

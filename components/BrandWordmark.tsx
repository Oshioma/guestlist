// The GUESTLIST wordmark, hand-traced as vectors in the brand letterform
// style (heavy squared letters, rounded corners, the G's flush crossbar).
// Draws in currentColor so themes tint it; swap for the original artwork
// by replacing the letter paths if the real vector file is ever added.

const LETTERS: { d: string; w: number }[] = [
  // G — same construction as the roundel mark: slit notch + flush crossbar
  // (outer contour, reversed counter hole, crossbar wound with the outer)
  { w: 86, d: 'M43 0 C13 0 0 12 0 50 C0 88 13 100 43 100 C73 100 86 88 86 50 V46 H63 V38 H86 C86 12 73 0 43 0 Z M43 25 C53 25 61 31 61 50 C61 69 53 75 43 75 C33 75 25 69 25 50 C25 31 33 25 43 25 Z M48 46 V58 C48 63 51 66 57 66 H86 V46 Z' },
  { w: 86, d: 'M0 0 H26 V58 C26 70 32 76 43 76 C54 76 60 70 60 58 V0 H86 V58 C86 88 71 100 43 100 C15 100 0 88 0 58 Z' }, // U
  { w: 78, d: 'M0 0 H78 V25 H26 V38 H72 V62 H26 V75 H78 V100 H0 Z' }, // E
  { w: 80, d: 'M76 0 H22 C8 0 0 8 0 21 V42 C0 55 8 63 22 63 H52 C53.5 63 54 63.5 54 65 V73 C54 74.5 53.5 75 52 75 H2 V100 H58 C72 100 80 92 80 79 V58 C80 45 72 37 58 37 H28 C26.5 37 26 36.5 26 35 V27 C26 25.5 26.5 25 28 25 H76 Z' }, // S
  { w: 84, d: 'M0 0 H84 V26 H55 V100 H29 V26 H0 Z' }, // T
  { w: 74, d: 'M0 0 H26 V75 H74 V100 H0 Z' }, // L
  { w: 26, d: 'M0 0 H26 V100 H0 Z' }, // I
  { w: 80, d: 'M76 0 H22 C8 0 0 8 0 21 V42 C0 55 8 63 22 63 H52 C53.5 63 54 63.5 54 65 V73 C54 74.5 53.5 75 52 75 H2 V100 H58 C72 100 80 92 80 79 V58 C80 45 72 37 58 37 H28 C26.5 37 26 36.5 26 35 V27 C26 25.5 26.5 25 28 25 H76 Z' }, // S
  { w: 84, d: 'M0 0 H84 V26 H55 V100 H29 V26 H0 Z' }, // T
];

const GAP = 16;
const TOTAL = LETTERS.reduce((s, l) => s + l.w, 0) + GAP * (LETTERS.length - 1);

export function BrandWordmark({ className }: { className?: string }) {
  let x = 0;
  return (
    <svg
      className={className}
      viewBox={`-5 -5 ${TOTAL + 10} 110`}
      role="img"
      aria-label="GUESTLIST"
    >
      <g fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round">
        {LETTERS.map((l, i) => {
          const g = <path key={i} d={l.d} transform={`translate(${x} 0)`} />;
          x += l.w + GAP;
          return g;
        })}
      </g>
    </svg>
  );
}

// exercise-guides.js — visual guide for each movement: a two-frame side-view diagram
// (start → finish) drawn as inline SVG, plus short numbered steps that restate the
// paperwork's description in plain language. Nothing here adds reps, sets, holds or
// ranges — parameters stay whatever the PT assigns on the order.
//
// The figure is a side view of the patient lying on their back; the drawn leg is the
// operated leg. All colours come from CSS classes so light/dark themes just work and
// no inline styles are needed (strict CSP).

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, ...children) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c == null) continue;
    n.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

// Each frame is 180 wide; the bed line sits at y=118 (floor/bed).
const FRAME_W = 180;
const BED_Y = 118;

/** Torso + head of someone lying on their back, hip at (ox + 96, 110). */
function body(ox, { torsoClass = 'ex-body' } = {}) {
  const g = svg('g');
  g.append(svg('circle', { class: 'ex-head', cx: ox + 24, cy: 104, r: 10 }));
  g.append(svg('path', { class: torsoClass, d: `M${ox + 36} 108 L${ox + 96} 110` }));
  return g;
}

/** A leg from the hip: knee and ankle points given in absolute coordinates. */
function leg(hip, knee, ankle, { thighClass = 'ex-body', shankClass = 'ex-body' } = {}) {
  const g = svg('g');
  g.append(svg('path', { class: thighClass, d: `M${hip[0]} ${hip[1]} L${knee[0]} ${knee[1]}` }));
  g.append(svg('path', { class: shankClass, d: `M${knee[0]} ${knee[1]} L${ankle[0]} ${ankle[1]}` }));
  // foot: short segment perpendicular-ish to the shank, pointing up (toes to the ceiling)
  const dx = ankle[0] - knee[0];
  const dy = ankle[1] - knee[1];
  const len = Math.hypot(dx, dy) || 1;
  const fx = ankle[0] + (-dy / len) * 14;
  const fy = ankle[1] + (dx / len) * 14;
  g.append(svg('path', { class: 'ex-body', d: `M${ankle[0]} ${ankle[1]} L${fx} ${fy}` }));
  g.append(svg('circle', { class: 'ex-joint', cx: knee[0], cy: knee[1], r: 4 }));
  return g;
}

function bed(ox) {
  return svg('path', { class: 'ex-bed', d: `M${ox + 8} ${BED_Y} L${ox + FRAME_W - 8} ${BED_Y}` });
}

function label(x, y, text, cls = 'ex-label') {
  return svg('text', { class: cls, x, y }, text);
}

function arrow(d) {
  return svg('path', { class: 'ex-arrow', d, 'marker-end': 'url(#ex-arrowhead)' });
}

function frameTitle(ox, text) {
  return label(ox + 8, 16, text, 'ex-frame-title');
}

/** Knee brace: two bands around the thigh and shank near the knee. */
function brace(knee, hip, ankle) {
  const g = svg('g', { class: 'ex-brace' });
  const along = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const band = (p, q) => {
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * 9;
    const ny = (dx / len) * 9;
    return svg('path', { class: 'ex-brace-band', d: `M${p[0] + nx} ${p[1] + ny} L${p[0] - nx} ${p[1] - ny}` });
  };
  g.append(band(along(knee, hip, 0.3), hip), band(along(knee, hip, 0.6), hip), band(along(knee, ankle, 0.3), ankle), band(along(knee, ankle, 0.6), ankle));
  const a = along(knee, hip, 0.65);
  const b = along(knee, ankle, 0.65);
  g.append(svg('path', { class: 'ex-brace-bar', d: `M${a[0]} ${a[1] - 9} L${knee[0]} ${knee[1] - 9} L${b[0]} ${b[1] - 9}` }));
  return g;
}

function base(id) {
  const root = svg('svg', { class: 'ex-art', viewBox: `0 0 ${FRAME_W * 2 + 20} 150`, role: 'img', 'aria-labelledby': `${id}-title` });
  root.append(svg('title', { id: `${id}-title` }, ''));
  const defs = svg('defs');
  const marker = svg('marker', { id: 'ex-arrowhead', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.append(svg('path', { class: 'ex-arrowhead', d: 'M0 0 L10 5 L0 10 z' }));
  defs.append(marker);
  root.append(defs);
  root.append(svg('path', { class: 'ex-divider', d: `M${FRAME_W + 10} 8 L${FRAME_W + 10} 142` }));
  return root;
}

const GUIDES = {
  'ex-heel-slides': {
    title: 'Assisted heel slides — start with the leg straight, slide the heel toward you, then slowly back out',
    steps: [
      'Lie on your back, leg straight, heel resting on the bed.',
      'Hold a strap or towel around the foot (or use your hands behind the thigh).',
      'Slide the heel toward you so the knee bends — only as far as is comfortable, never past the 90° limit.',
      'Pause, then slide the heel slowly back out until the leg is straight.',
    ],
    draw(root) {
      const L = 0;
      const R = FRAME_W + 20;
      root.append(frameTitle(L, '1 · Start: leg straight'), frameTitle(R, '2 · Slide heel in · ≤ 90°'));
      root.append(bed(L), body(L));
      root.append(leg([L + 96, 110], [L + 132, 110], [L + 168, 110]));
      root.append(svg('path', { class: 'ex-strap', d: `M${L + 70} 100 Q${L + 120} 80 ${L + 170} 104` }));
      root.append(bed(R), body(R));
      root.append(leg([R + 96, 110], [R + 128, 70], [R + 156, 110], { thighClass: 'ex-body ex-active', shankClass: 'ex-body ex-active' }));
      root.append(svg('path', { class: 'ex-strap', d: `M${R + 70} 100 Q${R + 120} 90 ${R + 158} 104` }));
      root.append(arrow(`M${R + 176} 104 L${R + 150} 104`));
      root.append(svg('path', { class: 'ex-angle', d: `M${R + 128} 70 m-14 18 a 23 23 0 0 1 28 0` }));
      root.append(label(R + 110, 56, '≤ 90°', 'ex-label ex-label-strong'));
    },
  },
  'ex-quad-sets': {
    title: 'Quadriceps isometric sets — leg straight, tighten the thigh so the back of the knee presses gently down, hold, relax',
    steps: [
      'Lie on your back with the leg straight and relaxed.',
      'Tighten the thigh muscle: think “push the back of the knee down into the bed” and pull the kneecap toward you.',
      'Hold the squeeze for the count your PT assigns, keeping your breathing normal.',
      'Relax completely before the next one. Stop for concerning symptoms.',
    ],
    draw(root) {
      const L = 0;
      const R = FRAME_W + 20;
      root.append(frameTitle(L, '1 · Relaxed, leg straight'), frameTitle(R, '2 · Tighten thigh · press down'));
      root.append(bed(L), body(L));
      root.append(leg([L + 96, 110], [L + 132, 110], [L + 168, 110]));
      root.append(bed(R), body(R));
      root.append(leg([R + 96, 110], [R + 132, 110], [R + 168, 110], { thighClass: 'ex-body ex-active ex-thick' }));
      root.append(arrow(`M${R + 132} 84 L${R + 132} 102`));
      root.append(label(R + 100, 76, 'hold · breathe', 'ex-label ex-label-strong'));
      root.append(svg('path', { class: 'ex-pulse', d: `M${R + 104} 98 l4 -8 l4 8` }), svg('path', { class: 'ex-pulse', d: `M${R + 118} 98 l4 -8 l4 8` }));
    },
  },
  'ex-straight-leg-raise': {
    title: 'Straight-leg raises — brace locked, thigh tight, lift the straight leg a short distance, lower slowly',
    steps: [
      'Brace on and locked straight, as instructed. Lie on your back.',
      'Tighten the thigh first (a quad set) so the knee stays straight.',
      'Lift the whole leg a short distance — about the height of the other knee — with the knee locked.',
      'Lower it slowly and with control. If the knee sags or bends, rest and keep the lift smaller.',
    ],
    draw(root) {
      const L = 0;
      const R = FRAME_W + 20;
      root.append(frameTitle(L, '1 · Brace locked · thigh tight'), frameTitle(R, '2 · Short lift · lower slowly'));
      root.append(bed(L), body(L));
      root.append(leg([L + 96, 110], [L + 132, 110], [L + 168, 110], { thighClass: 'ex-body ex-active' }));
      root.append(brace([L + 132, 110], [L + 96, 110], [L + 168, 110]));
      root.append(bed(R), body(R));
      root.append(leg([R + 96, 110], [R + 131, 94], [R + 166, 78], { thighClass: 'ex-body ex-active', shankClass: 'ex-body ex-active' }));
      root.append(brace([R + 131, 94], [R + 96, 110], [R + 166, 78]));
      root.append(arrow(`M${R + 172} 110 L${R + 172} 84`));
      root.append(label(R + 66, 56, 'knee locked straight', 'ex-label ex-label-strong'));
    },
  },
  'ex-gravity-extension': {
    title: 'Heel-supported gravity extension — heel on a support, nothing under the knee, let the knee straighten',
    steps: [
      'Lie on your back. Put a rolled towel, cushion or block under the heel/ankle only.',
      'Make sure nothing is under the knee — the gap is the point.',
      'Relax the leg and let gravity straighten the knee. No pushing.',
      'Stay for the time your paperwork/PT sets; use the timer in the app.',
    ],
    draw(root) {
      const L = 0;
      const R = FRAME_W + 20;
      root.append(frameTitle(L, '1 · Heel on a support'), frameTitle(R, '2 · Relax · let it straighten'));
      root.append(bed(L), body(L));
      root.append(svg('rect', { class: 'ex-support', x: L + 156, y: 94, width: 20, height: 24, rx: 4 }));
      root.append(leg([L + 96, 110], [L + 128, 90], [L + 166, 94]));
      root.append(bed(R), body(R));
      root.append(svg('rect', { class: 'ex-support', x: R + 156, y: 94, width: 20, height: 24, rx: 4 }));
      root.append(leg([R + 96, 110], [R + 131, 102], [R + 166, 94], { thighClass: 'ex-body ex-active', shankClass: 'ex-body ex-active' }));
      root.append(arrow(`M${R + 131} 74 L${R + 131} 94`));
      root.append(svg('path', { class: 'ex-cross', d: `M${R + 124} 108 l12 8 M${R + 136} 108 l-12 8` }));
      root.append(label(R + 56, 136, 'nothing under the knee', 'ex-label ex-label-strong'));
      root.append(label(L + 86, 136, 'support under heel', 'ex-label'));
    },
  },
};

/** Guide text (steps + caption) for an exercise id, or null if there is none. */
export function exerciseGuide(id) {
  return GUIDES[id] || null;
}

/** The start → finish diagram as an inline <svg>, or null if there is none for this id. */
export function exerciseDiagram(id) {
  const g = GUIDES[id];
  if (!g || typeof document === 'undefined') return null;
  const root = base(id);
  root.querySelector('title').textContent = g.title;
  g.draw(root);
  return root;
}

/** Which exercise ids have a guide (for tests). */
export const GUIDED_EXERCISE_IDS = Object.keys(GUIDES);

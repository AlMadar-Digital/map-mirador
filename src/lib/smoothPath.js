/**
 * The vertices of a straight-segment SVG shape: a `polyline`/`polygon`'s points, or a `path`
 * made of absolute M/L commands only (how the maps plugin draws a journey). Null for any other
 * shape, which is then drawn as authored.
 * @param {Element} element
 * @returns {{x: number, y: number}[] | null}
 */
export function straightSegmentPoints(element) {
  const tag = element.tagName.toLowerCase();
  let raw;
  if (tag === 'polyline' || tag === 'polygon') {
    raw = element.getAttribute('points');
  } else if (tag === 'path') {
    const d = element.getAttribute('d') ?? '';
    if (!/^\s*M[\d\s.,eE+-]+(L[\d\s.,eE+-]+)*$/.test(d)) return null;
    raw = d.replace(/[ML]/g, ' ');
  } else {
    return null;
  }
  const numbers = (raw ?? '')
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length < 4 || numbers.length % 2 || numbers.some(Number.isNaN)) return null;
  const points = [];
  for (let i = 0; i < numbers.length; i += 2) points.push({ x: numbers[i], y: numbers[i + 1] });
  return points;
}

/**
 * A smooth curve through every point (a Catmull-Rom spline as cubic Béziers), so a journey's
 * line flows through its stops rather than turning sharply at each.
 * @param {{x: number, y: number}[]} points
 * @returns {Path2D}
 */
export function smoothPath(points) {
  const path = new Path2D();
  path.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    path.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 6,
      p1.y + (p2.y - p0.y) / 6,
      p2.x - (p3.x - p1.x) / 6,
      p2.y - (p3.y - p1.y) / 6,
      p2.x,
      p2.y,
    );
  }
  return path;
}

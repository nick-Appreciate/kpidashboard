/**
 * Given a native click event on a Recharts SVG, read the axis tick labels
 * from the DOM to build pixel→value mappings, find the nearest data index
 * from the click x position, then find which meter's value at that index
 * is closest to the click's y-value in data space.
 *
 * Recharts v3 renders tick labels as <text> elements with x/y attributes
 * (not transforms on parent <g> elements like v2).
 */
export function findClosestMeterFromEvent(
  e: React.MouseEvent,
  data: Record<string, any>[],
): string | null {
  const svg = (e.target as Element)?.closest?.('svg');
  if (!svg || data.length === 0) return null;
  const svgRect = svg.getBoundingClientRect();
  const clickX = e.clientX - svgRect.left;
  const clickY = e.clientY - svgRect.top;

  // Collect all text elements with their positions and content
  const textEls: { content: string; x: number; y: number }[] = [];
  svg.querySelectorAll('text').forEach(t => {
    const x = parseFloat(t.getAttribute('x') || '');
    const y = parseFloat(t.getAttribute('y') || '');
    const content = t.textContent?.trim() || '';
    if (!isNaN(x) && !isNaN(y) && content) {
      textEls.push({ content, x, y });
    }
  });

  if (textEls.length < 3) return null;

  // --- Y-axis labels: group by x coordinate, pick the leftmost group ---
  const xGroups = new Map<number, typeof textEls>();
  textEls.forEach(t => {
    const rx = Math.round(t.x);
    if (!xGroups.has(rx)) xGroups.set(rx, []);
    xGroups.get(rx)!.push(t);
  });

  let yAxisTexts: typeof textEls = [];
  let minX = Infinity;
  xGroups.forEach((group, x) => {
    if (group.length >= 2 && x < minX) {
      minX = x;
      yAxisTexts = group;
    }
  });

  if (yAxisTexts.length < 2) {
    // Fallback: pick highest value at clicked index
    return fallbackHighest(data, clickX, svg);
  }

  // Parse y-axis tick values (strip $, x, %, commas)
  const yPoints: { py: number; val: number }[] = [];
  yAxisTexts.forEach(t => {
    const raw = t.content.replace(/[$x%,]/g, '').trim();
    const val = parseFloat(raw);
    if (!isNaN(val)) yPoints.push({ py: t.y, val });
  });

  if (yPoints.length < 2) return fallbackHighest(data, clickX, svg);
  yPoints.sort((a, b) => a.py - b.py);

  // Map click Y → data value
  const topTick = yPoints[0];
  const bottomTick = yPoints[yPoints.length - 1];
  const pixelRange = bottomTick.py - topTick.py;
  const valueRange = bottomTick.val - topTick.val;
  if (pixelRange === 0) return null;
  const clickValue = topTick.val + (clickY - topTick.py) / pixelRange * valueRange;

  // --- X-axis labels: group by y coordinate, pick the bottommost group ---
  const yGroups = new Map<number, typeof textEls>();
  textEls.forEach(t => {
    const ry = Math.round(t.y);
    if (!yGroups.has(ry)) yGroups.set(ry, []);
    yGroups.get(ry)!.push(t);
  });

  let xAxisTexts: typeof textEls = [];
  let maxY = -Infinity;
  yGroups.forEach((group, y) => {
    if (group.length >= 2 && y > maxY) {
      maxY = y;
      xAxisTexts = group;
    }
  });

  if (xAxisTexts.length < 2) return null;

  // Map click X → data index using x-axis label positions
  xAxisTexts.sort((a, b) => a.x - b.x);
  const xMin = xAxisTexts[0].x;
  const xMax = xAxisTexts[xAxisTexts.length - 1].x;
  const xFraction = (clickX - xMin) / (xMax - xMin);
  const idx = Math.round(xFraction * (data.length - 1));
  if (idx < 0 || idx >= data.length) return null;

  const row = data[idx];
  if (!row) return null;

  // Find the meter closest to the clicked value
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const k of Object.keys(row)) {
    if (k === 'date') continue;
    const v = Number(row[k]) || 0;
    const dist = Math.abs(v - clickValue);
    if (dist < bestDist) { bestDist = dist; bestKey = k; }
  }

  return bestKey;
}

/** Fallback: pick the meter with the highest value at the approximate data index */
function fallbackHighest(
  data: Record<string, any>[],
  clickX: number,
  svg: Element,
): string | null {
  // Use middle of data if we can't determine x position
  const idx = Math.round(data.length / 2);
  const row = data[idx];
  if (!row) return null;
  let bestKey: string | null = null;
  let bestVal = 0;
  for (const k of Object.keys(row)) {
    if (k === 'date') continue;
    const v = Number(row[k]) || 0;
    if (v > bestVal) { bestVal = v; bestKey = k; }
  }
  return bestKey;
}

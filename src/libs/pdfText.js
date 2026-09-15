// PDF.js text items only: no DOM, HTML parsing, network, or PDF execution.
// Geometry is in the unscaled PDF coordinate system (baseline Y grows upward).
const CJK = /[\u2e80-\u9fff\uac00-\ud7af\uf900-\ufaff\uff01-\uff60]/u;
const CLOSING = /^[,.;:!?，。；：！？、）】》」』]/u;
const OPENING = /[(（【《「『]$/u;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] || 0;
};

function utf8Size(char) {
  const code = char.codePointAt(0);
  return code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
}

function separator(left, right) {
  if (!left || !right || /\s$/u.test(left) || /^\s/u.test(right)) return "";
  if (CJK.test(left.slice(-1)) && CJK.test(right[0])) return "";
  if (CLOSING.test(right) || OPENING.test(left)) return "";
  if (/[A-Za-z]-$/u.test(left) && /^[a-z]/u.test(right)) return "";
  return " ";
}

function makeLine(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x || a.index - b.index);
  let text = "";
  let previous;
  for (const item of sorted) {
    // PDF.js often splits a single word into adjacent font runs. Insert a
    // missing space only when the geometry contains a visible word gap.
    const gap = previous ? item.x - previous.right : 0;
    if (previous && gap > Math.min(previous.height, item.height) * 0.18) {
      text += separator(text, item.str);
    }
    text += item.str;
    previous = item;
  }
  return {
    text: text.replace(/[\t\r\n ]+/gu, " ").trim(),
    x: Math.min(...sorted.map((item) => item.x)),
    right: Math.max(...sorted.map((item) => item.right)),
    y: median(sorted.map((item) => item.y)),
    height: median(sorted.map((item) => item.height)),
  };
}

function makeRows(items) {
  const rows = [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  for (const item of sorted) {
    const last = rows[rows.length - 1];
    const tolerance = last
      ? Math.max(2, Math.min(last.height, item.height) * 0.3)
      : 0;
    const overlap = last
      ? Math.min(last.y + last.height, item.y + item.height) -
        Math.max(last.y, item.y)
      : 0;
    const scriptOverlap =
      last &&
      overlap >= Math.min(last.height, item.height) * 0.5 &&
      Math.abs(last.y - item.y) <= Math.max(last.height, item.height) * 0.6;
    if (last && (Math.abs(last.y - item.y) <= tolerance || scriptOverlap)) {
      last.items.push(item);
      if (item.height > last.height) {
        last.y = item.y;
        last.height = item.height;
      }
    } else {
      rows.push({ y: item.y, height: item.height, items: [item] });
    }
  }
  return rows.filter((row) => row.items.some((item) => item.str.trim()));
}

function findColumnSplit(rows, pageWidth) {
  if (rows.length < 3) return null;
  rows = rows.map((row) => ({
    ...row,
    items: row.items.filter((item) => item.str.trim()),
  }));
  const all = rows.flatMap((row) => row.items);
  const leftEdge = Math.min(...all.map((item) => item.x));
  const rightEdge = Math.max(...all.map((item) => item.right));
  const center =
    Number.isFinite(pageWidth) && pageWidth > 0
      ? pageWidth / 2
      : (leftEdge + rightEdge) / 2;
  const band = (rightEdge - leftEdge) * 0.15;
  const minGap = Math.max(18, median(all.map((item) => item.height)) * 1.6);
  let best;
  // Require at least three lines on each side, with a stable empty gutter.
  // A small number of crossing rows is allowed for titles/abstracts. Tables,
  // three-column layouts, and irregular floating figures remain ambiguous.
  for (let step = -12; step <= 12; step += 1) {
    const x = center + (band * step) / 12;
    let leftCount = 0;
    let rightCount = 0;
    let crossings = 0;
    const leftEnds = [];
    const rightStarts = [];
    for (const row of rows) {
      if (row.items.some((item) => item.x < x && item.right > x)) {
        crossings += 1;
        continue;
      }
      const left = row.items.filter((item) => item.right <= x);
      const right = row.items.filter((item) => item.x >= x);
      const end = left.length
        ? Math.max(...left.map((item) => item.right))
        : null;
      const start = right.length
        ? Math.min(...right.map((item) => item.x))
        : null;
      if (end !== null && start !== null && start - end < minGap) {
        crossings += 1;
        continue;
      }
      if (end !== null) {
        leftCount += 1;
        leftEnds.push(end);
      }
      if (start !== null) {
        rightCount += 1;
        rightStarts.push(start);
      }
    }
    const gutter = median(rightStarts) - median(leftEnds);
    if (leftCount < 3 || rightCount < 3 || gutter < minGap) continue;
    if (crossings > Math.max(2, Math.floor(rows.length * 0.2))) continue;
    const score =
      leftCount + rightCount - crossings * 2 - Math.abs(x - center) / 1000;
    if (!best || score > best.score) best = { x, score };
  }
  return best?.x ?? null;
}

function readingGroups(rows, split) {
  if (split === null) return [rows.map((row) => makeLine(row.items))];
  const groups = [];
  let left = [];
  let right = [];
  let spanning = [];
  const flushColumns = () => {
    if (left.length) groups.push(left);
    if (right.length) groups.push(right);
    left = [];
    right = [];
  };
  const flushSpanning = () => {
    if (spanning.length) groups.push(spanning);
    spanning = [];
  };
  for (const row of rows) {
    if (
      row.items.some(
        (item) => item.str.trim() && item.x < split && item.right > split
      )
    ) {
      flushColumns();
      spanning.push(makeLine(row.items));
    } else {
      flushSpanning();
      const leftItems = row.items.filter((item) => item.right <= split);
      const rightItems = row.items.filter((item) => item.x >= split);
      if (leftItems.length) left.push(makeLine(leftItems));
      if (rightItems.length) right.push(makeLine(rightItems));
    }
  }
  flushColumns();
  flushSpanning();
  return groups;
}

function mergeLines(lines) {
  if (!lines.length) return [];
  const gaps = lines
    .slice(1)
    .map((line, i) => lines[i].y - line.y)
    .filter((gap) => gap > 0);
  const height = median(lines.map((line) => line.height));
  // Lower half resists paragraph spacing dominating short-page statistics.
  const normalGap = Math.min(
    median(gaps.sort((a, b) => a - b).slice(0, Math.ceil(gaps.length / 2))) ||
      height * 1.2,
    height * 1.6
  );
  const leftEdge = Math.min(...lines.map((line) => line.x));
  const rightEdge = Math.max(...lines.map((line) => line.right));
  const width = rightEdge - leftEdge;
  const paragraphs = [];
  let text = "";
  let previous;
  for (const line of lines) {
    if (!line.text) continue;
    const gap = previous ? previous.y - line.y : 0;
    const fontChange =
      previous &&
      Math.max(previous.height, line.height) /
        Math.min(previous.height, line.height) >
        1.25;
    const indented =
      previous &&
      line.x - leftEdge > height * 0.9 &&
      Math.abs(line.x - previous.x) > height * 0.7;
    const shortEnding =
      previous &&
      /[.!?。！？:：]$/u.test(text) &&
      rightEdge - previous.right > width * 0.2;
    const paragraphBreak =
      previous &&
      (gap > Math.max(normalGap * 1.45, height * 1.8) ||
        fontChange ||
        indented ||
        shortEnding);
    if (paragraphBreak) {
      if (text) paragraphs.push(text);
      text = "";
    }
    if (text) {
      if (/\u00ad$/u.test(text)) {
        text = text.slice(0, -1) + line.text;
      } else if (
        /[A-Za-z]{2}-$/u.test(text) &&
        /^[a-z]{2}/u.test(line.text) &&
        !/^[a-z]+-/u.test(line.text) &&
        rightEdge - previous.right < Math.max(height, width * 0.12)
      ) {
        // ASCII end-of-line hyphens are ambiguous without a dictionary. Only
        // unwrap at the column edge; explicit compound continuations stay put.
        text = text.slice(0, -1) + line.text;
      } else {
        text += separator(text, line.text) + line.text;
      }
    } else {
      text = line.text;
    }
    previous = line;
  }
  if (text) paragraphs.push(text);
  return paragraphs;
}

function splitToLimits(text, maxChars, maxBytes) {
  const chars = Array.from(text);
  const chunks = [];
  let offset = 0;
  while (offset < chars.length) {
    let end = offset;
    let bytes = 0;
    let wordBoundary = 0;
    let sentenceBoundary = 0;
    while (end < chars.length && end - offset < maxChars) {
      const next = utf8Size(chars[end]);
      if (bytes + next > maxBytes) break;
      bytes += next;
      end += 1;
      if (/\s/u.test(chars[end - 1])) wordBoundary = end;
      if (/[.!?。！？；;]/u.test(chars[end - 1])) sentenceBoundary = end;
    }
    if (end < chars.length) {
      const minimum = offset + (end - offset) * 0.5;
      if (sentenceBoundary >= minimum) end = sentenceBoundary;
      else if (wordBoundary >= minimum) end = wordBoundary;
    }
    const chunk = chars.slice(offset, end).join("").trim();
    if (chunk) chunks.push(chunk);
    offset = end;
  }
  return chunks;
}

/**
 * Extract page-local plain-text paragraphs from PDF.js getTextContent().items.
 * IDs are deterministic within a page; the reader should prefix its page ID.
 * maxChars counts Unicode code points, maxBytes counts UTF-8 bytes. Whitespace
 * and inferred line wraps are normalized; no semantic text/formula is filtered.
 * This is a conservative horizontal one/two-column heuristic, not OCR or a
 * tagged-PDF structure reader. Rotated/vertical text and complex tables require
 * manual review. Items without usable coordinates are retained in input order
 * after positioned text rather than silently discarded.
 */
export function extractPdfParagraphs(
  items,
  { pageWidth, maxBytes = 450, maxChars = 400 } = {}
) {
  if (!Number.isInteger(maxBytes) || maxBytes < 4)
    throw new RangeError("maxBytes must be an integer of at least 4");
  if (!Number.isInteger(maxChars) || maxChars < 1)
    throw new RangeError("maxChars must be a positive integer");
  if (!Array.isArray(items)) return [];
  const positioned = [];
  const fallback = [];
  let unpositioned = "";
  items.forEach((item, index) => {
    if (!item || typeof item.str !== "string") return;
    const [x, y] = item.transform?.slice?.(4, 6) || [];
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      unpositioned += item.str;
      if (item.hasEOL) {
        if (unpositioned.trim()) fallback.push(unpositioned.trim());
        unpositioned = "";
      }
      return;
    }
    if (!item.str) return;
    const rawHeight =
      Math.abs(item.height) ||
      Math.hypot(item.transform[2] || 0, item.transform[3] || 0);
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 12;
    const width =
      Number.isFinite(item.width) && item.width > 0
        ? item.width
        : Array.from(item.str).length * height * 0.5;
    positioned.push({ str: item.str, x, y, right: x + width, height, index });
  });
  if (unpositioned.trim()) fallback.push(unpositioned.trim());
  const rows = makeRows(positioned);
  const texts = readingGroups(rows, findColumnSplit(rows, pageWidth)).flatMap(
    mergeLines
  );
  return [...texts, ...fallback]
    .flatMap((text) => splitToLimits(text, maxChars, maxBytes))
    .map((text, index) => ({ id: `p${index + 1}`, text }));
}

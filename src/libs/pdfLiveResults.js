export const PDF_LIVE_RESULT_LIMITS = Object.freeze({
  maxPages: 80,
  maxBytes: 8 * 1024 * 1024,
  maxTranslationChars: 16000,
});

// Metadata is scoped to each immutable React state object, never persisted or
// added to a translation. Garbage collection releases it with the old state.
const recency = new WeakMap();

export function isPdfTranslationTextAllowed(text) {
  return (
    typeof text === "string" &&
    text.length <= PDF_LIVE_RESULT_LIMITS.maxTranslationChars &&
    !!text.trim()
  );
}

function pageOf(key) {
  const page = Number(key.match(/^([1-9]\d{0,2})-/)?.[1]);
  return page > 0 && page <= 200 ? page : null;
}

function entrySize(key, value) {
  if (
    !value ||
    typeof value !== "object" ||
    !isPdfTranslationTextAllowed(value.text)
  )
    return null;
  try {
    const serialized = `${JSON.stringify(key)}:${JSON.stringify(value)}`;
    const utf8 = new TextEncoder().encode(serialized).byteLength;
    const utf16 = 2 * serialized.length;
    if (Math.max(utf8 + 2, utf16 + 4) > PDF_LIVE_RESULT_LIMITS.maxBytes)
      return null;
    return { utf8, utf16 };
  } catch {
    return null;
  }
}

const ownObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

// Merge result objects without altering their display metadata. Invalid or
// oversized new results leave an existing translation intact. The caller must
// also reject an oversized API response before writing it to the session cache.
// Touch a page on navigation with mergePdfLiveResults(previous, {}, pageNumber).
export function mergePdfLiveResults(previous, updates, currentPage = 1) {
  previous = ownObject(previous);
  updates = ownObject(updates);
  const result = {};
  const sizes = new Map();
  const groups = new Map();
  let utf8 = 0;
  let utf16 = 0;

  function assign(key, value) {
    const page = pageOf(key);
    const size = page && entrySize(key, value);
    if (!size) return false;
    const oldSize = sizes.get(key);
    utf8 += size.utf8 - (oldSize?.utf8 || 0);
    utf16 += size.utf16 - (oldSize?.utf16 || 0);
    result[key] = value;
    sizes.set(key, size);
    if (!groups.has(page)) groups.set(page, new Set());
    groups.get(page).add(key);
    return true;
  }

  Object.entries(previous).forEach(([key, value]) => assign(key, value));
  const changed = Object.entries(updates)
    .filter(([key, value]) => assign(key, value))
    .map(([key]) => key);
  const oldOrder = recency.get(previous);
  let pageOrder = oldOrder?.pages.filter((page) => groups.has(page)) || [];
  for (const page of groups.keys())
    if (!pageOrder.includes(page)) pageOrder.push(page);
  for (const page of [...changed.map(pageOf), currentPage]) {
    if (!groups.has(page)) continue;
    pageOrder = pageOrder.filter((item) => item !== page);
    pageOrder.push(page);
  }
  const changedKeys = new Set(changed);
  let entryOrder =
    oldOrder?.entries.filter(
      (key) => sizes.has(key) && !changedKeys.has(key)
    ) || [];
  const orderedKeys = new Set(entryOrder);
  for (const key of sizes.keys()) {
    if (!orderedKeys.has(key) && !changedKeys.has(key)) entryOrder.push(key);
  }
  entryOrder.push(...changed);

  function remove(key) {
    const size = sizes.get(key);
    if (!size) return;
    utf8 -= size.utf8;
    utf16 -= size.utf16;
    sizes.delete(key);
    delete result[key];
    const page = pageOf(key);
    groups.get(page).delete(key);
    if (!groups.get(page).size) {
      groups.delete(page);
      pageOrder = pageOrder.filter((item) => item !== page);
    }
  }

  function removePage(page) {
    for (const key of Array.from(groups.get(page) || [])) remove(key);
  }

  // Braces, separators and keys are included in the conservative serialized
  // payload bound; JavaScript engine object/DOM overhead is additional.
  const bytes = () =>
    Math.max(
      2 + utf8 + Math.max(0, sizes.size - 1),
      4 + utf16 + 2 * Math.max(0, sizes.size - 1)
    );
  while (groups.size > PDF_LIVE_RESULT_LIMITS.maxPages) {
    removePage(pageOrder.find((page) => page !== currentPage) ?? pageOrder[0]);
  }
  while (bytes() > PDF_LIVE_RESULT_LIMITS.maxBytes && groups.size > 1) {
    removePage(pageOrder.find((page) => page !== currentPage) ?? pageOrder[0]);
  }
  // A single very dense current page can exceed the budget. Keep its newest
  // paragraph results instead of dropping that entire visible page.
  let oldest = 0;
  while (
    bytes() > PDF_LIVE_RESULT_LIMITS.maxBytes &&
    oldest < entryOrder.length
  )
    remove(entryOrder[oldest++]);
  entryOrder = entryOrder.filter((key) => sizes.has(key));
  recency.set(result, { pages: pageOrder, entries: entryOrder });
  return result;
}

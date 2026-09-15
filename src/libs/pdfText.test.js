/** @jest-environment node */
import { extractPdfParagraphs } from "./pdfText";

// Artificial PDF.js fixtures: these test geometry/text handling, not PDF files
// or browser integration. Coordinates use the PDF page's unscaled units.
const item = (str, x, y, width, height = 12, hasEOL = true) => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width,
  height,
  hasEOL,
});
const text = (items, options) =>
  extractPdfParagraphs(items, options).map((p) => p.text);

test("empty pages, marked-content items, and whitespace have no paragraphs", () => {
  expect(text([])).toEqual([]);
  expect(text(null)).toEqual([]);
  expect(
    text([{ type: "beginMarkedContent", id: "p1" }, item(" ", 0, 0, 5), null])
  ).toEqual([]);
});

test("single-column lines retain word runs, spaces, and paragraph gaps", () => {
  const items = [
    item("A trans", 40, 720, 36, 12, false),
    item("lation", 76, 720, 24, 12, false),
    item("study continues", 104, 720, 150),
    item("on the next line.", 40, 705, 210),
    item("A second paragraph.", 40, 671, 220),
  ];
  expect(text(items)).toEqual([
    "A translation study continues on the next line.",
    "A second paragraph.",
  ]);
});

test("a long single column with ordinary word gaps is not mistaken for two columns", () => {
  const items = [];
  for (let row = 0; row < 5; row += 1) {
    items.push(item(`Row${row} left `, 40, 700 - row * 15, 254, 12, false));
    items.push(item(`right${row}`, 300, 700 - row * 15, 240));
  }
  expect(text(items, { pageWidth: 600, maxBytes: 1000 })).toEqual([
    "Row0 left right0 Row1 left right1 Row2 left right2 Row3 left right3 Row4 left right4",
  ]);
});

test("a stable gutter orders the spanning title, entire left column, then right", () => {
  const items = [item("A full width paper title", 40, 760, 510, 20)];
  for (let row = 0; row < 3; row += 1) {
    // Interleaved stream order is deliberate: row order is not reading order.
    items.push(item(`Left${row + 1}`, 40, 710 - row * 15, 220));
    items.push(item(`Right${row + 1}`, 330, 710 - row * 15, 220));
  }
  expect(text(items, { pageWidth: 600 })).toEqual([
    "A full width paper title",
    "Left1 Left2 Left3",
    "Right1 Right2 Right3",
  ]);
});

test("staggered two-column baselines also provide stable gutter evidence", () => {
  const items = [];
  for (let row = 0; row < 3; row += 1) {
    items.push(item(`Left${row}`, 40, 700 - row * 20, 220));
    items.push(item(`Right${row}`, 330, 691 - row * 20, 220));
  }
  expect(text(items, { pageWidth: 600 })).toEqual([
    "Left0 Left1 Left2",
    "Right0 Right1 Right2",
  ]);
});

test("only two ambiguous rows use conservative row order", () => {
  expect(
    text(
      [
        item("Left1", 40, 700, 220),
        item("Right1", 330, 700, 220),
        item("Left2", 40, 685, 220),
        item("Right2", 330, 685, 220),
      ],
      { pageWidth: 600 }
    )
  ).toEqual(["Left1 Right1 Left2 Right2"]);
});

test("Chinese line and glyph boundaries do not introduce spaces", () => {
  expect(
    text([
      item("中文", 40, 700, 24, 12, false),
      item("论文", 66, 700, 24),
      item("正文继续。", 40, 685, 60),
    ])
  ).toEqual(["中文论文正文继续。"]);
});

test("unwraps soft and column-edge ASCII hyphens but retains compounds and math", () => {
  expect(
    text([
      item("A trans\u00ad", 40, 700, 200),
      item("lation with an equa-", 40, 685, 200),
      item("tion E = mc² + α / β.", 40, 670, 200),
    ])
  ).toEqual(["A translation with an equation E = mc² + α / β."]);
  expect(
    text([
      item("A state-", 40, 700, 200),
      item("of-the-art method.", 40, 685, 200),
    ])
  ).toEqual(["A state-of-the-art method."]);
  expect(text([item("x − y = -2", 40, 700, 200)])).toEqual(["x − y = -2"]);
});

test("paragraph indentation and title font changes separate paragraphs", () => {
  expect(
    text([
      item("Section title", 40, 750, 200, 18),
      item("First paragraph begins", 40, 730, 300),
      item("and ends here.", 40, 715, 300),
      item("Second paragraph begins", 56, 700, 280),
      item("and continues.", 40, 685, 300),
    ])
  ).toEqual([
    "Section title",
    "First paragraph begins and ends here.",
    "Second paragraph begins and continues.",
  ]);
});

test("small raised formula runs remain in the same line without filtering symbols", () => {
  expect(
    text([
      item("E = mc", 40, 700, 50, 12, false),
      item("2", 90, 704, 5, 7, false),
      item(" + α / β", 96, 700, 40),
    ])
  ).toEqual(["E = mc2 + α / β"]);
});

test("HTML-like source and placeholder/formula characters remain plain strings", () => {
  const source = '<img src=x onerror="evil()"> &amp; {{text}} {0} ∑ᵢ xᵢ² = 42';
  expect(extractPdfParagraphs([item(source, 40, 700, 500)])).toEqual([
    { id: "p1", text: source },
  ]);
});

test("UTF-8 and code-point bounds preserve all non-whitespace characters", () => {
  const source = "中文😀e\u0301".repeat(120);
  const result = text([item(source, 40, 700, 500)]);
  expect(result.length).toBeGreaterThanOrEqual(4);
  expect(result.join("")).toBe(source);
  result.forEach((part) => {
    expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(450);
    expect(Array.from(part).length).toBeLessThanOrEqual(400);
    expect(part).not.toMatch(/[\ud800-\udbff]$|^[\udc00-\udfff]/u);
  });
});

test("prefers word boundaries, preserves punctuation, and assigns stable IDs", () => {
  const source =
    "one two three four five six seven eight nine ten eleven twelve";
  const items = [item(source, 40, 700, 500)];
  const result = extractPdfParagraphs(items, { maxBytes: 24, maxChars: 24 });
  expect(result.map((p) => p.text).join(" ")).toBe(source);
  expect(result.every((p) => p.text.length <= 24)).toBe(true);
  expect(result.map((p) => p.id)).toEqual(result.map((_, i) => `p${i + 1}`));
  expect(extractPdfParagraphs(items, { maxBytes: 24, maxChars: 24 })).toEqual(
    result
  );
});

test("custom character limits and oversized unbroken tokens never drop text", () => {
  const source = "😀abcdef".repeat(12);
  const chunks = text([item(source, 40, 700, 500)], {
    maxBytes: 20,
    maxChars: 5,
  });
  expect(chunks.join("")).toBe(source);
  expect(chunks.every((chunk) => Array.from(chunk).length <= 5)).toBe(true);
});

test("unpositioned text and explicit EOL are retained instead of discarded", () => {
  expect(
    text([{ str: "One " }, { str: "line", hasEOL: true }, { str: "Next line" }])
  ).toEqual(["One line", "Next line"]);
});

test("explicit PDF.js space items survive even when font metrics give no gap", () => {
  expect(
    text([
      item("Two", 40, 700, 20, 12, false),
      item(" ", 60, 700, 0, 12, false),
      item("words", 60, 700, 30),
    ])
  ).toEqual(["Two words"]);
});

test("a short page can still distinguish a large paragraph gap", () => {
  expect(
    text([
      item("First paragraph.", 40, 700, 200),
      item("Second paragraph.", 40, 600, 200),
    ])
  ).toEqual(["First paragraph.", "Second paragraph."]);
});

test.each([
  { maxBytes: 0 },
  { maxBytes: 3 },
  { maxBytes: NaN },
  { maxChars: 0 },
  { maxChars: 1.5 },
])("rejects unusable limits %j", (options) => {
  expect(() => extractPdfParagraphs([], options)).toThrow(RangeError);
});

test("does not mutate the supplied PDF.js items", () => {
  const items = [item("First", 40, 700, 50), item("Second", 40, 685, 50)];
  const snapshot = JSON.stringify(items);
  items.forEach((entry) => {
    Object.freeze(entry.transform);
    Object.freeze(entry);
  });
  Object.freeze(items);
  expect(() => text(items)).not.toThrow();
  expect(JSON.stringify(items)).toBe(snapshot);
});

/** @jest-environment node */
// Synthetic ZIPs only. Native Node web streams exercise the same raw DEFLATE
// format as Chrome; no network, files, browser profile, or extension is changed.
import { deflateRawSync } from "node:zlib";
import {
  DecompressionStream,
  ReadableStream,
  WritableStream,
} from "node:stream/web";
import { TextDecoder } from "node:util";
import {
  BROWSER_UPDATE_ZIP_LIMITS as LIMITS,
  unpackChromeRelease,
} from "./browserUpdateZip";

const originals = Object.fromEntries(
  ["DecompressionStream", "ReadableStream", "TextDecoder"].map((key) => [
    key,
    global[key],
  ])
);
beforeEach(() => {
  global.DecompressionStream = DecompressionStream;
  global.ReadableStream = ReadableStream;
  global.TextDecoder = TextDecoder;
});
afterEach(() => {
  Object.assign(global, originals);
  jest.useRealTimers();
});

function referenceCrc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function zip(records) {
  const locals = [];
  const central = [];
  const localOffsets = [];
  const centralOffsets = [];
  let offset = 0;
  for (const {
    name,
    data = "",
    method = 0,
    mode = 0x81a4,
    extra = Buffer.alloc(0),
    flags = 0x800,
  } of records) {
    const filename = Buffer.from(name);
    const plain = Buffer.from(data);
    const compressed = method === 8 ? deflateRawSync(plain) : plain;
    const crc = referenceCrc(plain);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(plain.length, 22);
    header.writeUInt16LE(filename.length, 26);
    header.writeUInt16LE(extra.length, 28);
    localOffsets.push(offset);
    locals.push(header, filename, extra, compressed);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x314, 4);
    header.copy(directory, 6, 4, 28);
    directory.writeUInt16LE(extra.length, 30);
    directory.writeUInt32LE((mode << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([directory, filename, extra]));
    offset +=
      header.length + filename.length + extra.length + compressed.length;
  }
  const centralStart = offset;
  for (const record of central) {
    centralOffsets.push(offset);
    offset += record.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(records.length, 8);
  end.writeUInt16LE(records.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  return {
    bytes: Buffer.concat([...locals, ...central, end]),
    localOffsets,
    centralOffsets,
    endOffset: offset,
  };
}

const one = (changes = {}) =>
  zip([{ name: "chrome/example.txt", data: "123456789", ...changes }]);
const both32 = (fixture, localField, centralField, value, index = 0) => {
  fixture.bytes.writeUInt32LE(value, fixture.localOffsets[index] + localField);
  fixture.bytes.writeUInt32LE(
    value,
    fixture.centralOffsets[index] + centralField
  );
};
const decode = (bytes) => Buffer.from(bytes).toString("utf8");

test("limits match the small browser release contract", () => {
  expect(LIMITS).toEqual({
    archiveBytes: 33554432,
    expandedBytes: 67108864,
    fileBytes: 16777216,
    entries: 2000,
    centralBytes: 2097152,
    milliseconds: 180000,
  });
});

test("reads real STORE/DEFLATE bytes, Unicode paths and offset views; returns Chrome files only", async () => {
  expect(referenceCrc(Buffer.from("123456789"))).toBe(0xcbf43926);
  const fixture = zip([
    { name: "chrome/", mode: 0x41ed },
    { name: "chrome/example.txt", data: "123456789" },
    {
      name: "chrome/目录/内容.txt",
      data: "你好，translation! ".repeat(120),
      method: 8,
    },
    { name: "updater/update.py", data: "not executed", method: 8 },
  ]);
  const padded = Buffer.concat([
    Buffer.from("before"),
    fixture.bytes,
    Buffer.from("after"),
  ]);
  const progress = jest.fn();
  const output = await unpackChromeRelease(
    padded.subarray(6, 6 + fixture.bytes.length),
    { onProgress: progress }
  );
  expect([...output.keys()]).toEqual(["example.txt", "目录/内容.txt"]);
  expect(decode(output.get("example.txt"))).toBe("123456789");
  expect(decode(output.get("目录/内容.txt"))).toBe(
    "你好，translation! ".repeat(120)
  );
  expect(progress).toHaveBeenLastCalledWith({
    phase: "unpack",
    completed: 4,
    total: 4,
    path: "updater/update.py",
  });
});

test("returns JavaScript as inert bytes", async () => {
  const source = "globalThis.__zipMustNotExecute = true;";
  const output = await unpackChromeRelease(
    one({ name: "chrome/content.js", data: source, method: 8 }).bytes
  );
  expect(decode(output.get("content.js"))).toBe(source);
  expect(global.__zipMustNotExecute).toBeUndefined();
});

test.each([
  null,
  {},
  new Uint8Array(0),
  new Uint8Array(21),
  new Uint8Array(LIMITS.archiveBytes + 1),
])(
  "rejects invalid or oversized archive input before parsing",
  async (input) => {
    await expect(unpackChromeRelease(input)).rejects.toThrow(/32 MiB/);
  }
);

test.each([
  "../outside",
  "/absolute",
  "chrome/../outside",
  "chrome\\outside",
  "C:/outside",
  "chrome/file:stream",
  "chrome/NUL.txt",
  "chrome/COM¹",
  "chrome/file.",
  "chrome/file ",
  "chrome//file",
  "chrome/evil\x00name",
  "chrome/evil?name",
  "chrome/" + "a/".repeat(33) + "x",
  "\ufeffchrome/example.txt",
])("rejects unsafe paths anywhere in the archive: %s", async (name) => {
  await expect(
    unpackChromeRelease(
      zip([
        { name, data: "x" },
        { name: "chrome/good", data: "y" },
      ]).bytes
    )
  ).rejects.toThrow();
});

test.each([
  ["chrome/a", "chrome/a"],
  ["chrome/a", "chrome/A"],
  ["chrome/é", "chrome/e\u0301"],
  ["chrome/ß", "chrome/SS"],
  ["chrome/A/a", "chrome/a/b"],
  ["chrome/file", "chrome/file/child"],
])("rejects duplicate and conflicting paths: %j", async (first, second) => {
  await expect(
    unpackChromeRelease(zip([{ name: first }, { name: second }]).bytes)
  ).rejects.toThrow(/冲突|重复/);
});

test.each([0xa1ff, 0x21a4, 0x11a4, 0xc1a4, 0x41ed])(
  "rejects symlink or special file mode %i",
  async (mode) => {
    await expect(unpackChromeRelease(one({ mode }).bytes)).rejects.toThrow(
      /类型|特殊/
    );
  }
);

test("rejects a DOS directory attribute on a file entry", async () => {
  const fixture = one();
  const offset = fixture.centralOffsets[0] + 38;
  fixture.bytes.writeUInt32LE(
    (fixture.bytes.readUInt32LE(offset) | 0x10) >>> 0,
    offset
  );
  await expect(unpackChromeRelease(fixture.bytes)).rejects.toThrow(/目录类型/);
});

test.each([1, 8, 0x40, 0x2000])(
  "rejects encryption, descriptors and unsupported flag %i",
  async (flags) => {
    await expect(unpackChromeRelease(one({ flags }).bytes)).rejects.toThrow(
      /格式/
    );
  }
);

test("rejects unsupported compression and ZIP64 extra records", async () => {
  await expect(unpackChromeRelease(one({ method: 12 }).bytes)).rejects.toThrow(
    /格式/
  );
  await expect(
    unpackChromeRelease(one({ extra: Buffer.from([1, 0, 0, 0]) }).bytes)
  ).rejects.toThrow(/ZIP64/);
});

test("checks every metadata record before creating any decoder", async () => {
  const decoder = jest.fn();
  global.DecompressionStream = decoder;
  await expect(
    unpackChromeRelease(
      zip([
        { name: "chrome/good", data: "hello", method: 8 },
        { name: "../late", data: "bad" },
      ]).bytes
    )
  ).rejects.toThrow();
  expect(decoder).not.toHaveBeenCalled();
});

test.each([4, 6, 8, 10, 12, 14, 18, 22, 26])(
  "rejects local/central header disagreement at local byte %i",
  async (field) => {
    const fixture = one();
    fixture.bytes[field] ^= 1;
    await expect(unpackChromeRelease(fixture.bytes)).rejects.toThrow(
      /不一致|越界/
    );
  }
);

test("rejects different local filenames, invalid UTF-8 and non-UTF8 legacy names", async () => {
  const differing = one();
  differing.bytes[30] ^= 1;
  await expect(unpackChromeRelease(differing.bytes)).rejects.toThrow(/文件名/);
  const invalid = one();
  invalid.bytes[30] = 0xff;
  invalid.bytes[invalid.centralOffsets[0] + 46] = 0xff;
  await expect(unpackChromeRelease(invalid.bytes)).rejects.toThrow(/UTF-8/);
  await expect(
    unpackChromeRelease(one({ name: "chrome/你好", flags: 0 }).bytes)
  ).rejects.toThrow(/UTF-8/);
});

test("checks CRC for both returned and ignored files", async () => {
  for (const name of ["chrome/example.txt", "docs/ignored.txt"]) {
    const fixture = zip([
      { name, data: "123456789", method: 8 },
      { name: "chrome/good" },
    ]);
    both32(fixture, 14, 16, 0);
    await expect(unpackChromeRelease(fixture.bytes)).rejects.toThrow(/CRC32/);
  }
});

test("rejects truncated DEFLATE and output larger than the declared size", async () => {
  const broken = one({ method: 8 });
  const dataStart = 30 + Buffer.byteLength("chrome/example.txt");
  broken.bytes.fill(0xff, dataStart, broken.centralOffsets[0]);
  await expect(unpackChromeRelease(broken.bytes)).rejects.toThrow();
  const bomb = one({ method: 8, data: "x".repeat(200000) });
  both32(bomb, 22, 24, 1);
  await expect(unpackChromeRelease(bomb.bytes)).rejects.toThrow(/实际解压大小/);
});

test("rejects claimed file and total expansion limits before allocating output", async () => {
  const file = one({ method: 8 });
  both32(file, 22, 24, LIMITS.fileBytes + 1);
  await expect(unpackChromeRelease(file.bytes)).rejects.toThrow(/大小/);
  const total = zip(
    Array.from({ length: 5 }, (_, i) => ({ name: `chrome/${i}`, method: 8 }))
  );
  for (let i = 0; i < 5; i++) both32(total, 22, 24, LIMITS.fileBytes, i);
  await expect(unpackChromeRelease(total.bytes)).rejects.toThrow(/总大小/);
});

test("bounds central directory size, count and claimed offsets before parsing records", async () => {
  for (const [field, value, width] of [
    [10, 2001, 2],
    [12, LIMITS.centralBytes + 1, 4],
    [16, 0xffffffff, 4],
    [4, 1, 2],
  ]) {
    const fixture = one();
    fixture.bytes[width === 2 ? "writeUInt16LE" : "writeUInt32LE"](
      value,
      fixture.endOffset + field
    );
    await expect(unpackChromeRelease(fixture.bytes)).rejects.toThrow(/目录/);
  }
  const countLie = zip([{ name: "chrome/a" }, { name: "chrome/b" }]);
  countLie.bytes.writeUInt16LE(1, countLie.endOffset + 8);
  countLie.bytes.writeUInt16LE(1, countLie.endOffset + 10);
  await expect(unpackChromeRelease(countLie.bytes)).rejects.toThrow(/数量/);
});

test("rejects overlapping local offsets and trailing junk", async () => {
  const overlap = zip([{ name: "chrome/a" }, { name: "chrome/a", data: "x" }]);
  overlap.bytes.writeUInt32LE(0, overlap.centralOffsets[1] + 42);
  await expect(unpackChromeRelease(overlap.bytes)).rejects.toThrow();
  await expect(
    unpackChromeRelease(Buffer.concat([one().bytes, Buffer.from("junk")]))
  ).rejects.toThrow(/目录/);
  await expect(
    unpackChromeRelease(one().bytes.subarray(0, -1))
  ).rejects.toThrow();
});

test("supports ArrayBuffer and snapshots input before yielding", async () => {
  const fixture = zip([
    { name: "chrome/first", data: "one" },
    { name: "chrome/second", data: "two" },
  ]);
  const buffer = Uint8Array.from(fixture.bytes).buffer;
  const result = await unpackChromeRelease(buffer, {
    onProgress() {
      new Uint8Array(buffer).fill(0);
    },
  });
  expect(decode(result.get("second"))).toBe("two");
});

test("already aborted and progress-triggered abort return no partial map", async () => {
  const aborted = new AbortController();
  aborted.abort();
  await expect(
    unpackChromeRelease(one().bytes, { signal: aborted.signal })
  ).rejects.toMatchObject({ name: "AbortError" });
  const controller = new AbortController();
  const progress = jest.fn(() => controller.abort());
  await expect(
    unpackChromeRelease(
      zip([{ name: "chrome/a" }, { name: "chrome/b" }]).bytes,
      { signal: controller.signal, onProgress: progress }
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).toHaveBeenCalledTimes(1);
});

function neverFinishingDecoder() {
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const cancel = jest.fn(() => new Promise(() => {}));
  global.DecompressionStream = class {
    constructor() {
      this.writable = new WritableStream();
      this.readable = new ReadableStream({
        pull() {
          started();
          return new Promise(() => {});
        },
        cancel,
      });
    }
  };
  return { ready, cancel };
}

test("abort rejects a stalled read without awaiting stalled reader.cancel", async () => {
  const { ready, cancel } = neverFinishingDecoder();
  const controller = new AbortController();
  const pending = unpackChromeRelease(one({ method: 8 }).bytes, {
    signal: controller.signal,
  });
  await ready;
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  expect(cancel).toHaveBeenCalled();
});

test("180-second deadline also rejects a stalled decoder", async () => {
  jest.useFakeTimers();
  const { ready, cancel } = neverFinishingDecoder();
  const pending = unpackChromeRelease(one({ method: 8 }).bytes);
  await ready;
  jest.advanceTimersByTime(180000);
  await expect(pending).rejects.toThrow(/180 秒/);
  expect(cancel).toHaveBeenCalled();
});

test("yields to the UI while inspecting larger entry sets", async () => {
  let ran = false;
  setTimeout(() => {
    ran = true;
  }, 0);
  const result = await unpackChromeRelease(
    zip(Array.from({ length: 40 }, (_, i) => ({ name: `chrome/${i}` }))).bytes
  );
  expect(result.size).toBe(40);
  expect(ran).toBe(true);
});

test("missing native decoder is a friendly failure, STORE remains usable", async () => {
  global.DecompressionStream = undefined;
  await expect(unpackChromeRelease(one({ method: 8 }).bytes)).rejects.toThrow(
    /浏览器不支持/
  );
  expect((await unpackChromeRelease(one().bytes)).size).toBe(1);
});

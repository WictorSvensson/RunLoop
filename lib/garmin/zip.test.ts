import { describe, it, expect } from "vitest";
import { deflateRawSync } from "node:zlib";
import { extractZip } from "./zip";

// ---------------------------------------------------------------------------
// The reader is tested with ZIPs built by hand (stored) and by stdlib
// (deflated) — no fixture files, no new dependencies.
// ---------------------------------------------------------------------------

/** Builds a minimal single-entry ZIP with one stored (uncompressed) file. */
function storedZip(name: string, content: Uint8Array): Uint8Array {
  const nameBytes = Buffer.from(name, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // local file header signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // method: stored
  header.writeUInt16LE(0, 10); // mtime
  header.writeUInt16LE(0, 12); // mdate
  header.writeUInt32LE(0, 14); // crc (unchecked by reader)
  header.writeUInt32LE(content.length, 18); // compressed size
  header.writeUInt32LE(content.length, 22); // uncompressed size
  header.writeUInt16LE(nameBytes.length, 26);
  header.writeUInt16LE(0, 28); // extra length
  return new Uint8Array(Buffer.concat([header, nameBytes, Buffer.from(content)]));
}

describe("extractZip", () => {
  it("extracts a stored entry", () => {
    const payload = new TextEncoder().encode("fake-fit-bytes");
    const entries = extractZip(storedZip("activity.fit", payload));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("activity.fit");
    // Buffer-wrap: inflateRawSync returns a Buffer, which vitest toEqual
    // distinguishes from Uint8Array even with identical bytes.
    expect(Buffer.from(entries[0].data)).toEqual(Buffer.from(payload));
  });

  it("inflates a deflated entry", () => {
    const payload = new TextEncoder().encode("fake-fit-bytes ".repeat(100));
    const deflated = deflateRawSync(payload);
    // Rewrite the stored zip with method 8 + deflated body.
    const raw = Buffer.from(storedZip("activity.fit", new Uint8Array(deflated)));
    raw.writeUInt16LE(8, 8);
    const entries = extractZip(new Uint8Array(raw));
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("activity.fit");
    expect(Buffer.from(entries[0].data)).toEqual(Buffer.from(payload));
  });

  it("skips directory entries and extracts the file", () => {
    const dir = storedZip("nested/", new Uint8Array(0));
    const file = storedZip("nested/activity.fit", new TextEncoder().encode("x"));
    // Concatenate: reader parses local headers sequentially.
    const combined = new Uint8Array(dir.length + file.length);
    combined.set(dir, 0);
    combined.set(file, dir.length);
    const entries = extractZip(combined);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("nested/activity.fit");
  });

  it("throws on garbage and on empty archives", () => {
    expect(() => extractZip(new Uint8Array([1, 2, 3, 4]))).toThrow();
    expect(() => extractZip(new Uint8Array(0))).toThrow();
  });

  it("throws on unsupported compression methods", () => {
    const raw = Buffer.from(storedZip("a.fit", new TextEncoder().encode("x")));
    raw.writeUInt16LE(99, 8);
    expect(() => extractZip(new Uint8Array(raw))).toThrow(/method 99/);
  });
});

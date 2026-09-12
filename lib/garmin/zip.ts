// Minimal ZIP reader for Garmin's original-activity downloads
// (downloadOriginalActivityData returns a .zip containing the .fit).
// Supports stored (method 0) and deflate (method 8) entries via Node's
// stdlib zlib — no new dependency for a ~60-line job. Parses local file
// headers sequentially, so no central directory is required.
//
// Deliberately narrow: zip64 and encrypted entries are NOT supported and
// surface as "unreadable download" (fail closed — the importer keeps a
// summary-only row). Streaming data-descriptor entries (bit 3, which Garmin's
// downloads use) ARE supported when the descriptor carries its optional
// signature. CRCs are unchecked by design; zip contents are never written to
// disk (no zip-slip surface: only in-memory extraction of the .fit).

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// Inflation cap: a corrupt size field must fail loudly, not OOM.
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

// Descriptor signature bytes (little-endian 0x08074b50).
const DESCRIPTOR_SIG = [0x50, 0x4b, 0x07, 0x08];

/**
 * Locates a data-descriptor signature at or after `from`, bounded so a
 * missing signature fails fast instead of scanning megabytes. The signature
 * bytes can also occur inside deflated data, so a candidate only counts when
 * the 16 bytes after it land on EOF or another known record (local header,
 * central directory, end-of-central-directory). Returns the offset of the
 * signature, or null.
 */
function findDescriptorSignature(buffer: Uint8Array, from: number): number | null {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const end = Math.min(buffer.length - 16, from + MAX_ENTRY_BYTES);
  for (let i = from; i <= end; i++) {
    if (
      buffer[i] === DESCRIPTOR_SIG[0] &&
      buffer[i + 1] === DESCRIPTOR_SIG[1] &&
      buffer[i + 2] === DESCRIPTOR_SIG[2] &&
      buffer[i + 3] === DESCRIPTOR_SIG[3]
    ) {
      const after = i + 16;
      if (after >= buffer.length) return i;
      const next = view.getUint32(after, true);
      if (next === 0x04034b50 || next === 0x02014b50 || next === 0x06054b50) {
        return i;
      }
    }
  }
  return null;
}

/**
 * Extracts all files from a ZIP archive buffer.
 * Throws on malformed input (callers treat as "unreadable download").
 */
export function extractZip(buffer: Uint8Array): ZipEntry[] {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const entries: ZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x04034b50) break; // not a local file header: done
    const method = view.getUint16(offset + 8, true);
    const flags = view.getUint16(offset + 6, true);
    const hasDescriptor = (flags & 0x08) !== 0;
    let compressedSize = view.getUint32(offset + 18, true);
    let dataEnd: number | null = null; // descriptor end, when bit 3 is set
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    if (dataStart > buffer.length) {
      throw new Error("ZIP entry overruns buffer");
    }
    const nameBytes = buffer.subarray(nameStart, nameStart + fileNameLength);
    const name = Buffer.from(nameBytes).toString("utf8");

    if (hasDescriptor) {
      // Streaming entry: header sizes are zero and trail the data. The
      // descriptor signature (0x08074b50) is optional per spec — without it
      // the data end is unknowable, so fail closed rather than guess.
      const descriptorAt = findDescriptorSignature(buffer, dataStart);
      if (descriptorAt === null) {
        throw new Error(`ZIP data descriptor without signature for ${name} (unsupported)`);
      }
      compressedSize = view.getUint32(descriptorAt + 8, true);
      dataEnd = descriptorAt + 16; // signature + crc32 + 2×u32
    }
    if (dataStart + compressedSize > buffer.length) {
      throw new Error("ZIP entry overruns buffer");
    }
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      if (compressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`ZIP entry ${name} exceeds size cap`);
      }
      data = inflateRawSync(compressed);
      if (data.byteLength > MAX_ENTRY_BYTES) {
        throw new Error(`ZIP entry ${name} inflates past size cap`);
      }
    } else {
      throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);
    }
    // Skip directory entries (trailing slash, empty).
    if (!name.endsWith("/") && data.length > 0) {
      entries.push({ name, data });
    }
    offset = dataEnd ?? dataStart + compressedSize;
  }

  if (entries.length === 0) {
    throw new Error("ZIP archive contains no files");
  }
  return entries;
}

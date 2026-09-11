// Minimal ZIP reader for Garmin's original-activity downloads
// (downloadOriginalActivityData returns a .zip containing the .fit).
// Supports stored (method 0) and deflate (method 8) entries via Node's
// stdlib zlib — no new dependency for a ~60-line job. Parses local file
// headers sequentially, so no central directory is required.
//
// Deliberately narrow: data-descriptor entries (bit 3), zip64 and encrypted
// entries are NOT supported and surface as "unreadable download" (fail
// closed — the importer keeps a summary-only row). CRCs and filenames are
// unchecked by design; zip contents are never written to disk (no zip-slip
// surface: only in-memory extraction of the first .fit).

import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

// Inflation cap: a corrupt size field must fail loudly, not OOM.
const MAX_ENTRY_BYTES = 64 * 1024 * 1024;

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
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    if (dataStart + compressedSize > buffer.length) {
      throw new Error("ZIP entry overruns buffer");
    }
    const nameBytes = buffer.subarray(nameStart, nameStart + fileNameLength);
    const name = Buffer.from(nameBytes).toString("utf8");
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
    offset = dataStart + compressedSize;
  }

  if (entries.length === 0) {
    throw new Error("ZIP archive contains no files");
  }
  return entries;
}

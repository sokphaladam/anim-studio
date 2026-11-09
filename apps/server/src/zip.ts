// A minimal ZIP writer and reader for packages: entries are stored, not compressed (MP4 and PNG are compressed already),
// so no dependency is needed. The reader accepts only what the writer makes (stored entries, no ZIP64) and checks
// every entry's CRC; anything else is refused with a reason, never half-read.

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// a fixed timestamp (1 Jan 2020): the same package contents always make the same bytes
const DOS_TIME = 0, DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

/** A ZIP of `entries` (in order), stored. */
export function zip(entries: { name: string; data: Uint8Array }[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const n = Buffer.from(name, "utf8"), crc = crc32(data);
    if (data.length >= 0xffffffff || offset >= 0xffffffff) throw new Error("The package is too large (over 4 GB)");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(DOS_TIME, 12);
    head.writeUInt16LE(DOS_DATE, 14);
    head.writeUInt32LE(crc, 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(data.length, 24);
    head.writeUInt16LE(n.length, 28);
    head.writeUInt32LE(offset, 42);
    parts.push(local, n, Buffer.from(data.buffer, data.byteOffset, data.length));
    central.push(head, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

/** The entries of a stored ZIP, by name, in order. Throws with a reason for anything it can't read safely. */
export function unzip(buf: Buffer): Map<string, Buffer> {
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) throw new Error("This is not a ZIP file");
  const count = buf.readUInt16LE(end + 10), size = buf.readUInt32LE(end + 12), start = buf.readUInt32LE(end + 16);
  if (start + size > end) throw new Error("The ZIP's directory is damaged");
  const out = new Map<string, Buffer>();
  for (let i = 0, p = start; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The ZIP's directory is damaged");
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    if (method !== 0) throw new Error(`"${name}" is compressed; packages are stored without compression`);
    if (csize !== usize || off + 30 > buf.length || buf.readUInt32LE(off) !== 0x04034b50) throw new Error(`"${name}" is damaged`);
    const at = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    if (at + csize > buf.length) throw new Error(`"${name}" is cut short`);
    const data = buf.subarray(at, at + csize);
    if (crc32(data) !== crc) throw new Error(`"${name}" is damaged (CRC mismatch)`);
    if (out.has(name)) throw new Error(`"${name}" appears twice`);
    out.set(name, data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

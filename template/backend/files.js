import { inflateRawSync } from 'node:zlib';

export function detectDocument(bytes, name) {
  const extension = name.split('.').pop().toLowerCase();
  if (extension === 'pdf') {
    if (bytes.length < 15 || !bytes.subarray(0, 8).toString('ascii').match(/^%PDF-(?:1\.[0-9]|2\.0)/) || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))) return null;
    return 'application/pdf';
  }
  if (!['docx', 'pptx'].includes(extension)) return null;
  // Inspect ZIP's central directory, then bounded XML entries. Nothing is extracted.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (bytes.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0 || bytes.readUInt16LE(end + 4) !== 0 || bytes.readUInt16LE(end + 6) !== 0) return null;
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  if (count > 4096 || offset >= end) return null;
  const entries = new Map();
  let expanded = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || bytes.readUInt32LE(offset) !== 0x02014b50) return null;
    const flags = bytes.readUInt16LE(offset + 8), method = bytes.readUInt16LE(offset + 10), compressed = bytes.readUInt32LE(offset + 20), size = bytes.readUInt32LE(offset + 24), length = bytes.readUInt16LE(offset + 28), extra = bytes.readUInt16LE(offset + 30), comment = bytes.readUInt16LE(offset + 32), local = bytes.readUInt32LE(offset + 42);
    if (offset + 46 + length + extra + comment > end || flags & 1 || ![0, 8].includes(method)) return null;
    const path = bytes.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (path.startsWith('/') || path.split('/').includes('..') || path.includes('\\') || path.endsWith('.bin') || path.endsWith('vbaProject.bin')) return null;
    expanded += size;
    if (expanded > 100 * 1024 * 1024 || local + 30 > bytes.length || bytes.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > offset) return null;
    entries.set(path, { start, compressed, size, method });
    offset += 46 + length + extra + comment;
  }
  const readXml = (path) => {
    const entry = entries.get(path);
    if (!entry || entry.size > 4 * 1024 * 1024) return '';
    try {
      const raw = bytes.subarray(entry.start, entry.start + entry.compressed);
      const xml = (entry.method === 8 ? inflateRawSync(raw, { maxOutputLength: 4 * 1024 * 1024 }) : raw);
      if (xml.length !== entry.size) return '';
      return xml.toString('utf8');
    } catch { return ''; }
  };
  const types = readXml('[Content_Types].xml');
  if (extension === 'docx' && types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') && readXml('word/document.xml').includes('wordprocessingml')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (extension === 'pptx' && types.includes('application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml') && readXml('ppt/presentation.xml').includes('presentationml')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  return null;
}

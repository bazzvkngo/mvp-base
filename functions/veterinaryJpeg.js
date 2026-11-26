"use strict";

// Revisa la estructura de segmentos y la trama JPEG sin descomprimir píxeles.
function isVeterinaryJpeg(bytes) {
  if (bytes.length < 4 || bytes.readUInt16BE(0) !== 0xffd8) return false;
  let pos = 2;
  let frame = false;
  let scan = false;
  let quantization = false;
  let huffman = false;
  while (pos < bytes.length) {
    if (bytes[pos++] !== 0xff) return false;
    while (bytes[pos] === 0xff) pos++;
    const marker = bytes[pos++];
    if (marker === 0xd9) return frame && scan && pos === bytes.length;
    if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    if (pos + 2 > bytes.length) return false;
    const length = bytes.readUInt16BE(pos);
    if (length < 2 || pos + length > bytes.length) return false;
    if (marker === 0xdb && length >= 67) quantization = true;
    if (marker === 0xc4 && length >= 20) huffman = true;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      if (frame || length < 11 || length !== 8 + 3 * bytes[pos + 7]) return false;
      const height = bytes.readUInt16BE(pos + 3);
      const width = bytes.readUInt16BE(pos + 5);
      if (!height || !width || height > 4096 || width > 4096) return false;
      frame = true;
    }
    if (marker === 0xda) {
      if (!frame || !quantization || !huffman || length < 8 || length !== 6 + 2 * bytes[pos + 2]) return false;
      scan = true;
      pos += length;
      const start = pos;
      while (pos + 1 < bytes.length) {
        if (bytes[pos] === 0xff) {
          const next = bytes[pos + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { pos += 2; continue; }
          break;
        }
        pos++;
      }
      if (pos === start) return false;
    } else {
      pos += length;
    }
  }
  return false;
}

module.exports = {isVeterinaryJpeg};

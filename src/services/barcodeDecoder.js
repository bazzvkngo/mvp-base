const ZXING_FORMAT_KEYS = Object.freeze({
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  upc_a: "UPC_A",
  upc_e: "UPC_E",
  code_128: "CODE_128",
});

export async function createBarcodeFrameDecoder({decoder, formats}) {
  if (decoder === "native") {
    const detector = new globalThis.BarcodeDetector({formats});
    return {
      kind: "native",
      async detect(video) {
        const codes = await detector.detect(video);
        return String(codes?.[0]?.rawValue || "");
      },
      stop() {},
    };
  }

  const {
    BarcodeFormat,
    BrowserMultiFormatReader,
    ChecksumException,
    DecodeHintType,
    FormatException,
    NotFoundException,
  } = await import("@zxing/library");
  const possibleFormats = formats
    .map((format) => BarcodeFormat[ZXING_FORMAT_KEYS[format]])
    .filter((format) => Number.isInteger(format));
  const hints = new Map([
    [DecodeHintType.POSSIBLE_FORMATS, possibleFormats],
    [DecodeHintType.TRY_HARDER, true],
  ]);
  const reader = new BrowserMultiFormatReader(hints, 250);
  return {
    kind: "zxing",
    async detect(video) {
      try {
        return String(reader.decode(video)?.getText?.() || "");
      } catch (error) {
        if (
          error instanceof NotFoundException ||
          error instanceof ChecksumException ||
          error instanceof FormatException
        ) {
          return "";
        }
        throw error;
      }
    },
    stop() {
      reader.reset();
    },
  };
}

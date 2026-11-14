import QRCode from "qrcode";

// A QR code as an SVG string (server only). Medium error correction survives a little smudging on printed sheets.
export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
}

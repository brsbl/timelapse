import type { TimelapseEdit } from "./contract";

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[char] ?? char);
}

function wrap(text: string) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    if ((line + " " + word).trim().length > 36 && line) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export function captionSvg(width: number, height: number, edit: TimelapseEdit) {
  const lines = wrap(edit.text);
  if (!lines.length) return "";
  const font = Math.round(width * 0.042);
  const lineHeight = Math.round(font * 1.22);
  const pad = Math.round(width * 0.028);
  const boxWidth = Math.round(width * 0.84);
  const boxHeight = lines.length * lineHeight + pad * 2;
  const boxX = Math.round((width - boxWidth) / 2);
  const boxY = Math.round(height * ({ top: 0.28, middle: 0.5, bottom: 0.73 }[edit.position]) - boxHeight / 2);
  const textX = Math.round(width / 2);
  const textY = boxY + pad + font;
  const text = lines.map((line, index) => `<text x="${textX}" y="${textY + index * lineHeight}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${font}" fill="#ffffff">${escapeXml(line)}</text>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect x="${boxX}" y="${boxY}" width="${boxWidth}" height="${boxHeight}" rx="${Math.round(width * 0.016)}" fill="#070b18" fill-opacity="0.82"/>${text}</svg>`;
}

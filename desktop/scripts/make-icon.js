/* FastCAPA — сборка иконки приложения из логотипа сайта.
 *
 * Запускается через Electron, потому что нужен встроенный декодер изображений:
 *   npm run icon
 * На выходе: desktop/build/icon.png (512×512) и desktop/build/icon.ico (256×256).
 */
"use strict";

const { app, nativeImage } = require("electron");
const fs = require("fs");
const path = require("path");

const SOURCE = path.resolve(__dirname, "..", "..", "img", "logo.jpeg");
const OUT_DIR = path.resolve(__dirname, "..", "build");
const PNG_SIZE = 512;
const ICO_SIZE = 256;

// Логотип вписывается в квадрат с белым фоном, чтобы иконка не искажалась
function squareLogo(size) {
  const image = nativeImage.createFromPath(SOURCE);
  if (image.isEmpty()) throw new Error("не удалось прочитать " + SOURCE);

  const { width, height } = image.getSize();
  const scale = Math.min(size / width, size / height);
  const innerWidth = Math.max(1, Math.round(width * scale));
  const innerHeight = Math.max(1, Math.round(height * scale));
  const inner = image.resize({ width: innerWidth, height: innerHeight, quality: "best" });

  const pixels = inner.toBitmap();                 // BGRA
  const canvas = Buffer.alloc(size * size * 4, 0xff); // белая подложка
  const offsetX = Math.floor((size - innerWidth) / 2);
  const offsetY = Math.floor((size - innerHeight) / 2);
  for (let row = 0; row < innerHeight; row += 1) {
    const from = row * innerWidth * 4;
    pixels.copy(canvas, ((offsetY + row) * size + offsetX) * 4, from, from + innerWidth * 4);
  }
  return nativeImage.createFromBitmap(canvas, { width: size, height: size });
}

// Контейнер ICO с одной PNG-записью 256×256 (поддерживается Windows Vista и новее)
function buildIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);  // reserved
  header.writeUInt16LE(1, 2);  // type: иконка
  header.writeUInt16LE(1, 4);  // количество изображений

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);        // ширина: 0 означает 256 px
  entry.writeUInt8(0, 1);        // высота: 0 означает 256 px
  entry.writeUInt8(0, 2);        // палитры нет
  entry.writeUInt8(0, 3);        // reserved
  entry.writeUInt16LE(1, 4);     // planes
  entry.writeUInt16LE(32, 6);    // бит на пиксель
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(header.length + entry.length, 12);

  return Buffer.concat([header, entry, png]);
}

app.whenReady().then(() => {
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, "icon.png"), squareLogo(PNG_SIZE).toPNG());
    fs.writeFileSync(path.join(OUT_DIR, "icon.ico"), buildIco(squareLogo(ICO_SIZE).toPNG()));
    console.log("FastCAPA: иконка собрана из img/logo.jpeg → " + OUT_DIR);
  } catch (error) {
    console.error("FastCAPA: не удалось собрать иконку", error);
    process.exitCode = 1;
  }
  app.quit();
});

/* FastCAPA — подготовка статики сайта для настольного приложения.
 *
 * Копирует страницы, скрипты, стили и изображения из корня репозитория
 * в desktop/site, чтобы собранный .exe был самодостаточным и не зависел
 * от расположения репозитория на диске.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SITE_DIR = path.resolve(__dirname, "..", "site");

// Что входит в приложение: файлы сайта в корне репозитория и каталог изображений
const SITE_FILE_EXTENSIONS = [".html", ".js", ".css"];
const SITE_DIRECTORIES = ["img"];

async function copyDirectory(from, to) {
  await fs.promises.mkdir(to, { recursive: true });
  const entries = await fs.promises.readdir(from, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) {
      count += await copyDirectory(source, destination);
    } else {
      await fs.promises.copyFile(source, destination);
      count += 1;
    }
  }
  return count;
}

async function main() {
  await fs.promises.rm(SITE_DIR, { recursive: true, force: true });
  await fs.promises.mkdir(SITE_DIR, { recursive: true });

  let copied = 0;
  const entries = await fs.promises.readdir(REPO_ROOT, { withFileTypes: true });
  for (const entry of entries) {
    const extension = path.extname(entry.name).toLowerCase();
    if (!entry.isFile() || !SITE_FILE_EXTENSIONS.includes(extension)) continue;
    await fs.promises.copyFile(path.join(REPO_ROOT, entry.name), path.join(SITE_DIR, entry.name));
    copied += 1;
  }

  for (const directory of SITE_DIRECTORIES) {
    const from = path.join(REPO_ROOT, directory);
    if (!fs.existsSync(from)) continue;
    copied += await copyDirectory(from, path.join(SITE_DIR, directory));
  }

  console.log("FastCAPA: статика сайта скопирована в " + SITE_DIR + " (файлов: " + copied + ")");
}

main().catch((error) => {
  console.error("FastCAPA: не удалось подготовить статику сайта", error);
  process.exit(1);
});

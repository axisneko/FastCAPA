/* FastCAPA — настольное приложение для Windows (Electron)
 *
 * Приложение поднимает локальный статический сервер на 127.0.0.1 и открывает
 * в окне те же страницы, что и сайт. Благодаря http-происхождению (а не file://)
 * localStorage, относительные ссылки и fetch работают точно так же, как в браузере,
 * поэтому весь функционал сайта доступен без изменений в его коде.
 */
"use strict";

const { app, BrowserWindow, Menu, shell } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");

const SITE_DIR = path.join(__dirname, "site");
const START_PAGE = "index.html";
const WINDOW_ICON = path.join(__dirname, "build", "icon.png");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

let siteServer = null;

// Путь запроса → файл внутри каталога сайта (null, если запрос выходит за его пределы)
function resolveRequestPath(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, "http://127.0.0.1").pathname);
  } catch (e) {
    return null;
  }
  const relative = pathname === "/" ? START_PAGE : pathname.replace(/^\/+/, "");
  const target = path.resolve(SITE_DIR, relative);
  // Защита от path traversal: отдаём только файлы внутри site/
  if (target !== SITE_DIR && !target.startsWith(SITE_DIR + path.sep)) return null;
  return target;
}

function startSiteServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const filePath = resolveRequestPath(req.url || "/");
      if (!filePath) {
        res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Forbidden");
        return;
      }
      fs.stat(filePath, (statError, stats) => {
        if (statError || !stats.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }
        res.writeHead(200, {
          "Content-Type": MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
          "Cache-Control": "no-store"
        });
        fs.createReadStream(filePath).pipe(res);
      });
    });
    server.on("error", reject);
    // Порт 0 — свободный порт, выданный системой; слушаем только loopback
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function createWindow(origin) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: "FastCAPA",
    backgroundColor: "#ffffff",
    // Иконка окна в режиме разработки; в собранном .exe берётся из файла приложения
    ...(fs.existsSync(WINDOW_ICON) ? { icon: WINDOW_ICON } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Микрофон нужен для функции голосового ввода NCR; остальные права запрещены
  win.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    const fromApp = (webContents.getURL() || "").startsWith(origin);
    callback(fromApp && permission === "media");
  });
  win.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return permission === "media" && requestingOrigin === origin;
  });

  // Внешние ссылки открываем в системном браузере, внутри приложения — только свои страницы
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  win.loadURL(origin + "/" + START_PAGE);
  return win;
}

app.whenReady().then(async () => {
  // Убираем системное меню (File, Edit, Window и т. д.): интерфейс приложения самодостаточен
  Menu.setApplicationMenu(null);
  siteServer = await startSiteServer();
  const origin = "http://127.0.0.1:" + siteServer.address().port;
  createWindow(origin);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(origin);
  });
}).catch((error) => {
  console.error("FastCAPA: не удалось запустить приложение", error);
  app.quit();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  if (siteServer) siteServer.close();
});

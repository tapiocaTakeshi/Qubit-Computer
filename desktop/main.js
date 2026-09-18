/**
 * QubitOS desktop shell (Windows, and anywhere else Electron runs).
 *
 * The window hosts exactly the same build as the web app: `npm run sync` copies app/dist here, and
 * a privileged `qubitos://` scheme serves it. A custom scheme rather than file:// because the Expo
 * bundle is referenced by absolute paths, and because QubitFS persists through AsyncStorage, which
 * on the web is localStorage and needs a real, stable origin.
 */
const { app, BrowserWindow, Menu, net, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SCHEME = 'qubitos';
const ORIGIN = `${SCHEME}://app`;
const WEB_ROOT = path.join(__dirname, 'web');
const INDEX = path.join(WEB_ROOT, 'index.html');

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, allowServiceWorkers: true } },
]);

/** Map a request path onto a file inside web/, refusing anything that climbs out of it. */
function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = path.normalize(path.join(WEB_ROOT, decoded));
  if (target !== WEB_ROOT && !target.startsWith(WEB_ROOT + path.sep)) return null;
  return target;
}

function serveWebRoot() {
  protocol.handle(SCHEME, async (request) => {
    const { pathname } = new URL(request.url);
    const file = resolveFile(pathname === '' || pathname === '/' ? '/index.html' : pathname);
    if (!file) return new Response('Forbidden', { status: 403, headers: { 'content-type': 'text/plain' } });
    // The desktop app is a single page: anything that is not a real file falls back to the shell.
    const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : INDEX;
    return net.fetch(pathToFileURL(target).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 420,
    minHeight: 420,
    title: 'QubitOS',
    backgroundColor: '#0d0f1f', // the boot screen's ink, so launching never flashes white
    autoHideMenuBar: true, // QubitOS draws its own menu bar
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });

  win.once('ready-to-show', () => win.show());
  win.loadURL(`${ORIGIN}/index.html`);

  // Links out of QubitOS (the Browser app's "open in browser", the registry) go to the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin === ORIGIN) return;
    event.preventDefault();
    if (/^https?:$/.test(new URL(url).protocol)) shell.openExternal(url);
  });

  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    serveWebRoot();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

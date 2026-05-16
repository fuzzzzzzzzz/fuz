const { app, BrowserWindow, Tray, Menu, ipcMain, clipboard, nativeImage, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { exec } = require('child_process');
const database = require('./src/database');
const monitor = require('./src/clipboard-monitor');

const dataDir = path.join(app.getPath('appData'), 'clipboard-history');
const imagesDir = path.join(dataDir, 'images');

let mainWindow = null;
let tray = null;
let windowVisible = true;
let isQuitting = false;

// --- Tray Icon Generation ---

function crc32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const c = crc32(typeAndData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(c, 0);
  return Buffer.concat([length, typeAndData, crcBuf]);
}

function createSolidPNG(width, height, r, g, b) {
  const rowLen = 1 + width * 4;
  const raw = Buffer.alloc(height * rowLen);
  for (let y = 0; y < height; y++) {
    const off = y * rowLen;
    raw[off] = 0;
    for (let x = 0; x < width; x++) {
      const p = off + 1 + x * 4;
      raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255;
    }
  }
  const compressed = zlib.deflateSync(raw);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function ensureTrayIcon() {
  const iconPath = path.join(dataDir, 'tray-icon.png');
  if (!fs.existsSync(iconPath)) {
    const png = createSolidPNG(32, 32, 0xE5, 0x73, 0x73);
    fs.writeFileSync(iconPath, png);
  }
  return nativeImage.createFromPath(iconPath);
}

// --- Window ---

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 520,
    minWidth: 320,
    minHeight: 400,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      windowVisible = false;
    }
  });
}

function toggleWindow() {
  if (windowVisible) {
    mainWindow.hide();
    windowVisible = false;
  } else {
    mainWindow.show();
    mainWindow.focus();
    windowVisible = true;
  }
}

// --- Tray ---

function createTray() {
  const icon = ensureTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('历史粘贴板');

  tray.on('click', () => {
    toggleWindow();
  });

  const contextMenu = Menu.buildFromTemplate([
    { label: '显示主窗口', click: () => { mainWindow.show(); mainWindow.focus(); windowVisible = true; } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
}

// --- Auto Start ---

function setAutoStart(enable) {
  const exePath = process.execPath;
  const appPath = path.join(path.dirname(exePath), '..', '..');
  const keyName = 'ClipboardHistory';

  // In development, use electron . as the command
  const command = app.isPackaged
    ? `"${exePath}"`
    : `"${exePath}" "${path.join(__dirname)}"`;

  if (enable) {
    exec(`reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /t REG_SZ /d "${command}" /f`,
      (err) => { if (err) console.error('Auto-start set failed:', err); });
  } else {
    exec(`reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /f`,
      (err) => { /* ok if not found */ });
  }
}

// --- IPC ---

function fixImagePaths(items) {
  for (const item of items) {
    if (item.type === 'image') {
      item.content = 'file:///' + item.content.replace(/\\/g, '/');
    }
  }
  return items;
}

function setupIPC() {
  ipcMain.handle('clipboard:get-all', () => {
    return fixImagePaths(database.getAllItems());
  });

  ipcMain.handle('clipboard:search', (_, keyword) => {
    return fixImagePaths(database.searchItems(keyword));
  });

  ipcMain.handle('clipboard:pin', (_, id) => {
    return database.togglePin(id);
  });

  ipcMain.handle('clipboard:delete', (_, id) => {
    database.deleteItem(id);
  });

  ipcMain.handle('clipboard:paste', (_, id) => {
    const item = database.getItemById(id);
    if (!item) return;

    if (item.type === 'text') {
      clipboard.writeText(item.content);
    } else {
      const img = nativeImage.createFromPath(item.content);
      clipboard.writeImage(img);
    }

    setTimeout(() => {
      const psCmd = 'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait(\'^v\')';
      const encoded = Buffer.from(psCmd, 'utf16le').toString('base64');
      exec(`powershell -NoProfile -EncodedCommand ${encoded}`);
    }, 100);
  });

  ipcMain.handle('settings:get', () => {
    return database.getAllSettings();
  });

  ipcMain.handle('settings:set', (_, settings) => {
    if (settings.retention_days !== undefined) {
      database.setSetting('retention_days', settings.retention_days);
    }
    if (settings.max_items !== undefined) {
      database.setSetting('max_items', settings.max_items);
      database.save();
    }
    if (settings.auto_start !== undefined) {
      database.setSetting('auto_start', settings.auto_start);
      setAutoStart(settings.auto_start === 'true');
    }
    database.save();
  });
}

// --- App Lifecycle ---

app.whenReady().then(async () => {
  await database.init(dataDir);
  setupIPC();
  createWindow();
  createTray();

  globalShortcut.register('Ctrl+1', () => {
    toggleWindow();
  });

  monitor.start(database, imagesDir, (item) => {
    if (mainWindow) {
      mainWindow.webContents.send('clipboard:new-item', fixImagePaths([item])[0]);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  globalShortcut.unregisterAll();
  monitor.stop();
  database.save();
});

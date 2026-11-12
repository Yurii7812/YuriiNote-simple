'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

app.setName('YuriiNote Simple');
let windowInstance;
let writeChain = Promise.resolve();
let allowedToClose = false;

function storePaths() {
  const dir = app.getPath('userData');
  return { dir, target: path.join(dir, 'data.json'), backup: path.join(dir, 'data.backup.json') };
}
function loadData() {
  const { target, backup } = storePaths();
  let unreadable = false;
  for (const filename of [target, backup]) {
    if (!fs.existsSync(filename)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!data || typeof data !== 'object' || !Array.isArray(data.notes)) throw Error('invalid file');
      return data;
    } catch (error) {
      // Never treat an unreadable existing store as a new, empty installation.
      unreadable = true;
    }
  }
  if (unreadable) throw Error('保存データとバックアップを読み取れません。');
  return { version: 1, notes: [], topics: [] };
}
function saveData(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.notes) || !Array.isArray(value.topics)) {
    throw Error('保存データが正しくありません');
  }
  const { dir, target, backup } = storePaths();
  fs.mkdirSync(dir, { recursive: true });
  const temp = target + '.tmp';
  try {
    fs.writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
    if (fs.existsSync(target)) fs.copyFileSync(target, backup);
    fs.renameSync(temp, target);
  } finally {
    if (fs.existsSync(temp)) fs.rmSync(temp);
  }
  return true;
}
function createWindow() {
  allowedToClose = false;
  windowInstance = new BrowserWindow({
    width: 1180, height: 780, minWidth: 760, minHeight: 560,
    backgroundColor: '#fafaf8',
    title: 'YuriiNote Simple',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  });
  windowInstance.setMenuBarVisibility(false);
  windowInstance.loadFile(path.join(__dirname, 'index.html'));
  windowInstance.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowInstance.on('close', event => {
    if (allowedToClose) return;
    event.preventDefault();
    windowInstance.webContents.send('save-before-close');
  });
  windowInstance.on('closed', () => { windowInstance = null; });
}
app.whenReady().then(() => {
  ipcMain.handle('data:load', () => loadData());
  ipcMain.handle('data:save', (_event, value) => {
    const snapshot = JSON.parse(JSON.stringify(value));
    writeChain = writeChain.catch(() => {}).then(() => saveData(snapshot));
    return writeChain;
  });
  ipcMain.handle('data:open-folder', async () => {
    const { dir } = storePaths();
    fs.mkdirSync(dir, { recursive: true });
    return shell.openPath(dir);
  });
  ipcMain.on('data:close-ready', (_event, success) => {
    if (!windowInstance) return;
    if (!success) {
      dialog.showErrorBox('保存できませんでした', '保存エラーを解決してからアプリを終了してください。');
      return;
    }
    allowedToClose = true;
    windowInstance.close();
  });
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

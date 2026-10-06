const { app, BrowserWindow } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

let splash = null;
let win = null;

function createWindow() {
  // Empêche la création de plusieurs fenêtres
  if (win && !win.isDestroyed()) {
    win.focus();
    return;
  }

  // Fenêtre de chargement
  splash = new BrowserWindow({
    width: 700,
    height: 500,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#090909',
    show: true,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false
    }
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));

  // Après 3 secondes, ouvrir l'application
  setTimeout(() => {
    if (win && !win.isDestroyed()) {
      return;
    }

    win = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1100,
      minHeight: 700,
      show: false,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false
      }
    });

    win.loadFile(path.join(__dirname, '48H_FILM_DESK.html'));

    if (app.isPackaged) {
  autoUpdater.checkForUpdatesAndNotify();
}

    // On utilise did-finish-load plutôt que ready-to-show
    win.webContents.once('did-finish-load', () => {
      if (splash && !splash.isDestroyed()) {
        splash.close();
        splash = null;
      }

      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
  }, 3000);
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
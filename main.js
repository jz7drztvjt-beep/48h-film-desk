const { app, BrowserWindow } = require('electron');
const path = require('path');

let splash;
let win;

function createWindow() {
  splash = new BrowserWindow({
    width: 700,
    height: 500,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    backgroundColor: '#090909',
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: false
    }
  });

  splash.loadFile(path.join(__dirname, 'splash.html'));

  setTimeout(() => {
    win = new BrowserWindow({
      width: 1600,
      height: 1000,
      minWidth: 1100,
      minHeight: 700,
      webPreferences: {
        contextIsolation: false,
        nodeIntegration: false
      }
    });

    win.loadFile(path.join(__dirname, '48H_FILM_DESK.html'));

    win.once('ready-to-show', () => {
      if (splash && !splash.isDestroyed()) {
        splash.close();
      }

      win.show();
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
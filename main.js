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
  autoUpdater.on('update-available', (info) => {
    if (!win || win.isDestroyed()) return;

    win.webContents.executeJavaScript(`
      (() => {
        let box = document.getElementById('updateBox');
        if (!box) {
          box = document.createElement('div');
          box.id = 'updateBox';
          box.style.cssText = 'position:fixed;top:20px;right:20px;z-index:999999;background:#111;color:#fff;border:1px solid #444;border-radius:12px;padding:18px 20px;width:320px;font-family:Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5);';
          document.body.appendChild(box);
        }

        box.innerHTML = \`
          <div style="font-size:16px;font-weight:800;margin-bottom:8px;">
            🔄 MISE À JOUR DISPONIBLE
          </div>
          <div style="color:#aaa;font-size:13px;margin-bottom:14px;">
            Une nouvelle version de 48H FILM DESK est disponible.
          </div>
          <div style="font-size:13px;margin-bottom:14px;">
            Nouvelle version : <b>${info.version}</b>
          </div>
          <div style="color:#888;font-size:12px;">
            Téléchargement en cours...
          </div>
        \`;
      })();
    `);
  });

  autoUpdater.on('download-progress', (progress) => {
    if (!win || win.isDestroyed()) return;

    const percent = Math.round(progress.percent);

    win.webContents.executeJavaScript(`
      (() => {
        const box = document.getElementById('updateBox');
        if (!box) return;

        const p = ${percent};

        box.innerHTML = \`
          <div style="font-size:16px;font-weight:800;margin-bottom:8px;">
            ⬇️ MISE À JOUR
          </div>
          <div style="color:#aaa;font-size:13px;margin-bottom:12px;">
            Téléchargement de la nouvelle version...
          </div>
          <div style="height:6px;background:#333;border-radius:5px;overflow:hidden;">
            <div style="height:100%;width:\${p}%;background:#fff;"></div>
          </div>
          <div style="text-align:right;color:#aaa;font-size:12px;margin-top:7px;">
            \${p} %
          </div>
        \`;
      })();
    `);
  });

  autoUpdater.on('update-downloaded', () => {
    if (!win || win.isDestroyed()) return;

    win.webContents.executeJavaScript(`
      (() => {
        const box = document.getElementById('updateBox');
        if (!box) return;

        box.innerHTML = \`
          <div style="font-size:16px;font-weight:800;margin-bottom:8px;">
            ✅ MISE À JOUR PRÊTE
          </div>
          <div style="color:#aaa;font-size:13px;margin-bottom:15px;">
            La nouvelle version est prête.
          </div>
          <button onclick="window.electronUpdateRestart=true"
            style="width:100%;padding:10px;background:#fff;color:#000;border:0;border-radius:7px;font-weight:800;cursor:pointer;">
            REDÉMARRER ET METTRE À JOUR
          </button>
        \`;

        window.electronUpdateRestart = false;
      })();
    `);

    const checkRestart = setInterval(() => {
      if (!win || win.isDestroyed()) {
        clearInterval(checkRestart);
        return;
      }

      win.webContents.executeJavaScript('window.electronUpdateRestart === true')
        .then((result) => {
          if (result) {
            clearInterval(checkRestart);
            autoUpdater.quitAndInstall();
          }
        })
        .catch(() => {});
    }, 500);
  });

  autoUpdater.on('error', (err) => {
    console.log('❌ Erreur mise à jour :', err);
  });

  autoUpdater.checkForUpdates();
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
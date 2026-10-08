const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell } = require('electron');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

let splash = null;
let win = null;

const GOOGLE_CLIENT_ID = "982097535513-90gbv2dei2jsj3ki63glk8ul85angj6l.apps.googleusercontent.com";


const GOOGLE_SCOPE =
  'https://www.googleapis.com/auth/drive.file';

let googleAccessToken = null;
let googleRefreshToken = null;
let googleLoginPromise = null;

function googleTokenFile() {
  return path.join(app.getPath('userData'), 'google-token.dat');
}

function saveGoogleRefreshToken(token) {
  try {
    if (!token) return false;

    const fs = require('fs');

    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(String(token));
      fs.writeFileSync(
        googleTokenFile(),
        encrypted.toString('base64'),
        'utf8'
      );
    } else {
      fs.writeFileSync(
        googleTokenFile(),
        String(token),
        'utf8'
      );
    }

    return true;
  } catch (e) {
    console.error('Erreur sauvegarde token Google:', e);
    return false;
  }
}

function loadGoogleRefreshToken() {
  try {
    const fs = require('fs');

    if (!fs.existsSync(googleTokenFile())) {
      return null;
    }

    const data = fs.readFileSync(
      googleTokenFile(),
      'utf8'
    ).trim();

    if (!data) return null;

    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(
        Buffer.from(data, 'base64')
      );
    }

    return data;
  } catch (e) {
    console.error('Erreur lecture token Google:', e);
    return null;
  }
}

function deleteGoogleRefreshToken() {
  try {
    const fs = require('fs');

    if (fs.existsSync(googleTokenFile())) {
      fs.unlinkSync(googleTokenFile());
    }
  } catch (e) {
    console.error('Erreur suppression token Google:', e);
  }

  googleAccessToken = null;
  googleRefreshToken = null;
}

function randomString(length = 64) {
  return crypto
    .randomBytes(length)
    .toString('base64url')
    .slice(0, length);
}

function sha256Base64Url(value) {
  return crypto
    .createHash('sha256')
    .update(value)
    .digest('base64url');
}

async function googleTokenRequest(params) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {
    const body =
      new URLSearchParams(params).toString();

    const response = await fetch(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded'
        },
        body,
        signal: controller.signal
      }
    );

    const data = await response.json()
      .catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error_description ||
        data.error ||
        `Erreur OAuth Google (${response.status})`
      );
    }

    if (!data.access_token) {
      throw new Error(
        'Google n’a pas fourni de jeton d’accès.'
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

async function startGoogleLogin() {
  console.log('[GOOGLE CLEANUP] ancien startGoogleLogin ignoré');
  return await googleLogin();
}

async function googleLogin() {
  console.log('[GOOGLE LOGIN CLEAN] 1 - démarrage');

  if (googleAccessToken) {
    console.log('[GOOGLE LOGIN CLEAN] 2 - token déjà présent');

    return {
      success: true,
      connected: true
    };
  }

  console.log('[GOOGLE LOGIN CLEAN] 3 - OAuth');

  googleLoginPromise = new Promise(async (resolve, reject) => {

    let server = null;

    try {
      console.log('[GOOGLE LOGIN V2] 3 - création serveur local');

      const crypto = require('crypto');
      const http = require('http');

      const state =
        crypto.randomBytes(32).toString('hex');

      const verifier =
        crypto.randomBytes(64).toString('base64url');

      const challenge =
        crypto
          .createHash('sha256')
          .update(verifier)
          .digest('base64url');

      server = http.createServer();

      server.listen(
        0,
        '127.0.0.1',
        async () => {

          const address =
            server.address();

          const port =
            typeof address === 'object'
              ? address.port
              : null;

          if (!port) {
            throw new Error(
              'Impossible de récupérer le port OAuth.'
            );
          }

          console.log(
            '[GOOGLE LOGIN V2] 4 - serveur OAuth sur port',
            port
          );

          const redirectUri =
            'http://127.0.0.1:' +
            port +
            '/oauth2callback';

          const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope:
              'https://www.googleapis.com/auth/drive.file',
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256',
            access_type: 'offline',
            prompt: 'consent'
          });

          const authUrl =
            'https://accounts.google.com/o/oauth2/v2/auth?' +
            params.toString();

          console.log(
            '[GOOGLE LOGIN V2] 5 - ouverture Google'
          );

          console.log(
            '[GOOGLE LOGIN V2] URL:',
            authUrl
          );

          const { shell } = require('electron');

          await shell.openExternal(authUrl);

          console.log(
            '[GOOGLE LOGIN V2] 6 - navigateur ouvert'
          );

          const timeout =
            setTimeout(() => {

              try {
                server.close();
              } catch(e) {}

              reject(
                new Error(
                  'Connexion Google annulée ou expirée après 2 minutes.'
                )
              );

            }, 120000);

          server.on(
            'request',
            async (req, res) => {

              try {

                const requestUrl =
                  new URL(
                    req.url,
                    'http://127.0.0.1:' + port
                  );

                if (
                  requestUrl.pathname !==
                  '/oauth2callback'
                ) {
                  res.writeHead(404);
                  res.end();
                  return;
                }

                const returnedState =
                  requestUrl.searchParams.get('state');

                const code =
                  requestUrl.searchParams.get('code');

                const error =
                  requestUrl.searchParams.get('error');

                console.log(
                  '[GOOGLE LOGIN V2] 7 - callback reçu'
                );

                if (error) {
                  res.writeHead(
                    200,
                    {
                      'Content-Type':
                        'text/html; charset=utf-8'
                    }
                  );

                  res.end(
                    '<h2>Connexion Google annulée.</h2>' +
                    '<p>Tu peux fermer cette fenêtre.</p>'
                  );

                  clearTimeout(timeout);

                  server.close();

                  reject(
                    new Error(
                      'Google OAuth: ' + error
                    )
                  );

                  return;
                }

                if (returnedState !== state) {

                  res.writeHead(
                    400,
                    {
                      'Content-Type':
                        'text/html; charset=utf-8'
                    }
                  );

                  res.end(
                    '<h2>Erreur de sécurité OAuth.</h2>'
                  );

                  clearTimeout(timeout);

                  server.close();

                  reject(
                    new Error(
                      'État OAuth invalide.'
                    )
                  );

                  return;
                }

                if (!code) {

                  res.writeHead(
                    400,
                    {
                      'Content-Type':
                        'text/html; charset=utf-8'
                    }
                  );

                  res.end(
                    '<h2>Code Google manquant.</h2>'
                  );

                  clearTimeout(timeout);

                  server.close();

                  reject(
                    new Error(
                      'Code OAuth manquant.'
                    )
                  );

                  return;
                }

                console.log(
                  '[GOOGLE LOGIN V2] 8 - échange du code'
                );

                const body =
                  new URLSearchParams({
                    code,
                    client_id:
                      GOOGLE_CLIENT_ID,
                    redirect_uri:
                      redirectUri,
                    grant_type:
                      'authorization_code',
                    code_verifier:
                      verifier
                  }).toString();

                const controller =
                  new AbortController();

                const exchangeTimeout =
                  setTimeout(
                    () => controller.abort(),
                    15000
                  );

                let response;

                try {

                  response =
                    await fetch(
                      'https://oauth2.googleapis.com/token',
                      {
                        method: 'POST',
                        headers: {
                          'Content-Type':
                            'application/x-www-form-urlencoded'
                        },
                        body,
                        signal:
                          controller.signal
                      }
                    );

                } finally {
                  clearTimeout(
                    exchangeTimeout
                  );
                }

                const tokenData =
                  await response.json()
                    .catch(() => ({}));

                if (!response.ok) {

                  throw new Error(
                    tokenData.error_description ||
                    tokenData.error ||
                    'Échec de l’échange OAuth.'
                  );
                }

                if (!tokenData.access_token) {

                  throw new Error(
                    'Google n’a fourni aucun access token.'
                  );
                }

                googleAccessToken =
                  tokenData.access_token;

                if (
                  tokenData.refresh_token
                ) {
                  googleRefreshToken =
                    tokenData.refresh_token;

                  saveGoogleRefreshToken();
                }

                console.log(
                  '[GOOGLE LOGIN V2] 9 - connexion réussie'
                );

                res.writeHead(
                  200,
                  {
                    'Content-Type':
                      'text/html; charset=utf-8'
                  }
                );

                res.end(
                  '<!doctype html>' +
                  '<html><body style="font-family:Arial;text-align:center;padding:50px">' +
                  '<h2>✓ Google connecté</h2>' +
                  '<p>Tu peux fermer cette fenêtre.</p>' +
                  '<script>setTimeout(()=>window.close(),1200)</script>' +
                  '</body></html>'
                );

                clearTimeout(timeout);

                server.close();

                resolve({
                  success: true,
                  connected: true
                });

              } catch(e) {

                console.error(
                  '[GOOGLE LOGIN V2] CALLBACK ERREUR:',
                  e?.message
                );

                try {
                  res.writeHead(
                    500,
                    {
                      'Content-Type':
                        'text/html; charset=utf-8'
                    }
                  );

                  res.end(
                    '<h2>Erreur de connexion Google</h2>' +
                    '<p>' +
                    String(
                      e?.message || e
                    ) +
                    '</p>'
                  );
                } catch(ignore) {}

                try {
                  server.close();
                } catch(ignore) {}

                reject(e);
              }
            }
          );
        }
      );

      server.on(
        'error',
        (err) => {

          console.error(
            '[GOOGLE LOGIN V2] SERVEUR ERREUR:',
            err?.message
          );

          reject(err);
        }
      );

    } catch(e) {

      console.error(
        '[GOOGLE LOGIN V2] ERREUR:',
        e?.message
      );

      try {
        if (server) {
          server.close();
        }
      } catch(ignore) {}

      reject(e);
    }

  }).finally(() => {
    googleLoginPromise = null;
  });

  return googleLoginPromise;
}

async function getGoogleAccessToken() {
  console.log('[GOOGLE TOKEN DEBUG] 1 - recherche du token');

  if (googleAccessToken) {
    console.log('[GOOGLE TOKEN DEBUG] 2 - token déjà présent en mémoire');
    return googleAccessToken;
  }

  console.log('[GOOGLE TOKEN DEBUG] 3 - aucun token en mémoire');

  if (!googleRefreshToken) {
    console.log('[GOOGLE TOKEN DEBUG] 4 - lecture du refresh token');

    googleRefreshToken = loadGoogleRefreshToken();

    console.log(
      '[GOOGLE TOKEN DEBUG] 5 - refresh token trouvé:',
      !!googleRefreshToken
    );
  }

  if (googleRefreshToken) {
    console.log('[GOOGLE TOKEN DEBUG] 6 - tentative de refresh Google');

    try {
      const refreshPromise = googleTokenRequest({
        client_id: GOOGLE_CLIENT_ID,
        refresh_token: googleRefreshToken,
        grant_type: 'refresh_token'
      });

      const refreshTimeout = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('Refresh Google bloqué après 15 secondes'));
        }, 15000);
      });

      const tokenData = await Promise.race([
        refreshPromise,
        refreshTimeout
      ]);

      googleAccessToken = tokenData.access_token;

      console.log(
        '[GOOGLE TOKEN DEBUG] 7 - refresh réussi:',
        !!googleAccessToken
      );

      return googleAccessToken;

    } catch(e) {
      console.error(
        '[GOOGLE TOKEN DEBUG] 8 - refresh échoué:',
        e?.message
      );

      googleAccessToken = null;
      deleteGoogleRefreshToken();
    }
  }

  console.log('[GOOGLE TOKEN DEBUG] 9 - lancement de googleLogin()');

  const loginPromise = googleLogin();

  const loginTimeout = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error('Connexion Google bloquée après 15 secondes'));
    }, 15000);
  });

  const loginResult = await Promise.race([
    loginPromise,
    loginTimeout
  ]);

  console.log(
    '[GOOGLE TOKEN DEBUG] 10 - résultat login:',
    loginResult
  );

  console.log(
    '[GOOGLE TOKEN DEBUG] 11 - token après login:',
    !!googleAccessToken
  );

  if (!loginResult?.success || !googleAccessToken) {
    throw new Error('Compte Google non connecté.');
  }

  return googleAccessToken;
}

async function googleApi(
  url,
  options = {}
) {
  const token =
    await getGoogleAccessToken();

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 30000);

  try {
    const response =
      await fetch(url, {
        ...options,

        headers: {
          ...(options.headers || {}),

          Authorization:
            `Bearer ${token}`,

          'Content-Type':
            'application/json'
        },

        signal:
          controller.signal
      });

    const data =
      await response.json()
        .catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401) {
        googleAccessToken = null;
      }

      throw new Error(
        data.error?.message ||
        data.error_description ||
        `Erreur Google API (${response.status})`
      );
    }

    return data;

  } finally {
    clearTimeout(timeout);
  }
}

async function createGoogleDoc(
  title,
  content
) {
  title =
    String(
      title ||
      'Note 48H FILM DESK'
    ).trim();

  if (!title) {
    title = 'Note 48H FILM DESK';
  }

  content =
    String(content || '');

  const created =
    await googleApi(
      'https://docs.googleapis.com/v1/documents',
      {
        method: 'POST',

        body: JSON.stringify({
          title
        })
      }
    );

  if (!created.documentId) {
    throw new Error(
      'Google Docs n’a pas retourné de documentId.'
    );
  }

  const documentId =
    created.documentId;

  if (content.length > 0) {
    await googleApi(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`,
      {
        method: 'POST',

        body: JSON.stringify({
          requests: [
            {
              insertText: {
                location: {
                  index: 1
                },

                text:
                  content
              }
            }
          ]
        })
      }
    );
  }

  return {
    success: true,

    documentId,

    url:
      `https://docs.google.com/document/d/${documentId}/edit`
  };
}

ipcMain.handle(
  'F48_GOOGLE_STATUS',
  async () => {
    try {
      const saved =
        !!loadGoogleRefreshToken();

      return {
        connected:
          !!googleAccessToken ||
          saved
      };

    } catch (e) {
      return {
        connected: false
      };
    }
  }
);

ipcMain.handle(
  'F48_GOOGLE_LOGIN',
  async () => {
    console.log('[GOOGLE LOGIN DEBUG] IPC reçu');

    try {
      console.log('[GOOGLE LOGIN DEBUG] lancement googleLogin()');

      const resultPromise = googleLogin();

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(
            new Error(
              'googleLogin() est bloqué depuis plus de 20 secondes.'
            )
          );
        }, 20000);
      });

      const result = await Promise.race([
        resultPromise,
        timeoutPromise
      ]);

      console.log(
        '[GOOGLE LOGIN DEBUG] googleLogin terminé'
      );

      console.log(
        '[GOOGLE LOGIN DEBUG] résultat:',
        result
      );

      console.log(
        '[GOOGLE LOGIN DEBUG] access token:',
        !!googleAccessToken
      );

      return {
        success: true,
        connected: !!googleAccessToken,
        message: 'Compte Google connecté.'
      };

    } catch (e) {
      console.error(
        '[GOOGLE LOGIN DEBUG] ERREUR:',
        e?.message
      );

      console.error(
        '[GOOGLE LOGIN DEBUG] STACK:',
        e?.stack
      );

      return {
        success: false,
        connected: false,
        error: e?.message || String(e)
      };
    }
  }
);

ipcMain.handle(
  'F48_GOOGLE_LOGOUT',
  async () => {
    deleteGoogleRefreshToken();

    return {
      success: true,
      connected: false
    };
  }
);

ipcMain.handle(
  'F48_GOOGLE_CREATE_DOC',
  async (_event, data) => {
    console.log('[GOOGLE DEBUG] 1 - handler appelé');

    try {
      console.log('[GOOGLE DEBUG] 2 - données reçues');
      console.log('[GOOGLE DEBUG] titre:', data?.title);
      console.log('[GOOGLE DEBUG] contenu:', typeof data?.content === 'string' ? data.content.length + ' caractères' : 'absent');

      const title = data?.title || 'Note 48H FILM DESK';
      const content = data?.content || '';

      console.log('[GOOGLE DEBUG] 3 - appel createGoogleDoc()');

      const docPromise = createGoogleDoc(title, content);

      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
          reject(new Error('TIMEOUT : createGoogleDoc ne répond pas après 30 secondes'));
        }, 30000);
      });

      const result = await Promise.race([
        docPromise,
        timeoutPromise
      ]);

      console.log('[GOOGLE DEBUG] 4 - createGoogleDoc terminé');
      console.log('[GOOGLE DEBUG] résultat:', result);

      return result;

    } catch (e) {
      console.error('[GOOGLE DEBUG] ERREUR');
      console.error('[GOOGLE DEBUG] message:', e?.message);
      console.error('[GOOGLE DEBUG] stack:', e?.stack);

      return {
        success: false,
        error: e?.message || 'Impossible de créer le Google Doc.'
      };
    }
  }
);

ipcMain.handle(
  'F48_EXPORT_TXT',
  async (_event, data) => {
    try {
      const title =
        String(
          data?.title ||
          'note'
        )
        .replace(
          /[<>:"/\\|?*\x00-\x1F]/g,
          '_'
        )
        .trim() ||
        'note';

      const content =
        String(
          data?.content ||
          ''
        );

      const result =
        await dialog.showSaveDialog({
          title:
            'Exporter la note en TXT',

          defaultPath:
            `${title}.txt`,

          filters: [
            {
              name:
                'Fichier texte',

              extensions:
                ['txt']
            }
          ]
        });

      if (
        result.canceled ||
        !result.filePath
      ) {
        return {
          success: false,
          canceled: true
        };
      }

      require('fs').writeFileSync(
        result.filePath,
        content,
        'utf8'
      );

      return {
        success: true,

        path:
          result.filePath
      };

    } catch (e) {
      console.error(
        'Export TXT:',
        e
      );

      return {
        success: false,

        error:
          e.message ||
          'Impossible d’exporter la note.'
      };
    }
  }
);

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
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'preload-google.js')
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









/* ============================================================
   48H FILM DESK — EXPORT GLOBAL PDF / GOOGLE DRIVE
   ============================================================ */

ipcMain.handle("F48_EXPORT_PDF", async (event, data) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) {
      return { success: false, error: "Fenêtre introuvable." };
    }

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "default"
      }
    });

    const safeName = String(data?.fileName || "48H FILM DESK")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim();

    const result = await dialog.showSaveDialog(win, {
      title: "Exporter en PDF",
      defaultPath: `${safeName}.pdf`,
      filters: [
        { name: "PDF", extensions: ["pdf"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    fs.writeFileSync(result.filePath, pdf);

    return {
      success: true,
      path: result.filePath
    };

  } catch (e) {
    console.error("[F48 PDF] erreur:", e);
    return {
      success: false,
      error: String(e?.message || e)
    };
  }
});


ipcMain.handle("F48_EXPORT_PDF_TO_DRIVE", async (event, data) => {
  try {
    console.log("[F48 DRIVE PDF] 1 - début");

    if (!googleAccessToken) {
      return {
        success: false,
        connected: false,
        error: "Google n'est pas connecté."
      };
    }

    const win = BrowserWindow.fromWebContents(event.sender);

    if (!win) {
      return {
        success: false,
        error: "Fenêtre introuvable."
      };
    }

    console.log("[F48 DRIVE PDF] 2 - génération du PDF");

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "default"
      }
    });

    const fileName = String(data?.fileName || "48H FILM DESK")
      .replace(/[<>:"/\\|?*]/g, "_")
      .trim() + ".pdf";

    console.log("[F48 DRIVE PDF] 3 - upload:", fileName);

    const metadata = {
      name: fileName,
      mimeType: "application/pdf"
    };

    const boundary = "-------48HFILMDESK" + Date.now();

    const metadataPart =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n`;

    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`;

    const ending = `\r\n--${boundary}--`;

    const body = Buffer.concat([
      Buffer.from(metadataPart, "utf8"),
      Buffer.from(fileHeader, "utf8"),
      pdf,
      Buffer.from(ending, "utf8")
    ]);

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(body.length)
        },
        body
      }
    );

    const raw = await response.text();

    console.log("[F48 DRIVE PDF] 4 - réponse Google:", response.status);

    if (!response.ok) {
      console.error("[F48 DRIVE PDF] erreur Google:", raw);

      return {
        success: false,
        error: `Google Drive (${response.status}): ${raw}`
      };
    }

    const file = JSON.parse(raw);

    const url = `https://drive.google.com/file/d/${file.id}/view`;

    console.log("[F48 DRIVE PDF] 5 - succès:", url);

    return {
      success: true,
      fileId: file.id,
      url,
      fileName
    };

  } catch (e) {
    console.error("[F48 DRIVE PDF] erreur:", e);

    return {
      success: false,
      error: String(e?.message || e)
    };
  }
});



/* ============================================================
   F48 CLEAN EXPORT V2
   Export texte propre / A4 / Google Drive
   ============================================================ */

const F48CleanEscapeHtml = (s) => String(s ?? "")
  .replace(/&/g,"&amp;")
  .replace(/</g,"&lt;")
  .replace(/>/g,"&gt;")
  .replace(/"/g,"&quot;");

const F48CleanMakeHtml = (data) => {
  const title = String(data?.title || "48H FILM DESK");
  const project = String(data?.project || "");
  const content = String(data?.content || "");

  const lines = content
    .replace(/\r/g,"")
    .split("\n")
    .map(x => x.trim())
    .filter(x => x.length);

  let body = "";

  for (const line of lines) {
    const clean = line.replace(/^[•●▪◦]\s*/,"").trim();

    if (!clean) continue;

    if (/^#{1,3}\s+/.test(clean)) {
      const level = Math.min(3,(clean.match(/^#+/) || ["#"])[0].length);
      const txt = clean.replace(/^#+\s*/,"");
      body += `<h${level}>${F48CleanEscapeHtml(txt)}</h${level}>`;
      continue;
    }

    if (/^(PERSONNAGES|PERSONNAGE|SCÈNES|SCENES|DÉCOUPAGE|DECOUPAGE|PLANS|PLANNING|CASTING|COSTUMES|DÉCORS|DECORS|MATÉRIEL|MATERIEL|NOTES|TOURNAGE|SON|MUSIQUE)$/i.test(clean)) {
      body += `<h2>${F48CleanEscapeHtml(clean)}</h2>`;
      continue;
    }

    if (/^(?:[-*•]|\d+[.)])\s+/.test(clean)) {
      body += `<p class="list">${F48CleanEscapeHtml(clean)}</p>`;
      continue;
    }

    body += `<p>${F48CleanEscapeHtml(clean)}</p>`;
  }

  if (!body) {
    body = `<p class="empty">Aucun contenu à exporter.</p>`;
  }

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page {
  size: A4;
  margin: 18mm 17mm 18mm 17mm;
}

* {
  box-sizing: border-box;
}

body {
  font-family: Arial, Helvetica, sans-serif;
  font-size: 11pt;
  line-height: 1.55;
  color: #171717;
  margin: 0;
}

.header {
  border-bottom: 2px solid #111;
  padding-bottom: 12px;
  margin-bottom: 22px;
}

h1 {
  font-size: 23pt;
  margin: 0 0 5px 0;
  line-height: 1.15;
}

.project {
  font-size: 10pt;
  color: #666;
}

h2 {
  font-size: 15pt;
  margin: 22px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #ccc;
  page-break-after: avoid;
}

h3 {
  font-size: 12pt;
  margin: 16px 0 6px;
  page-break-after: avoid;
}

p {
  margin: 0 0 8px;
  white-space: pre-wrap;
  overflow-wrap: break-word;
}

p.list {
  margin-left: 14px;
  margin-bottom: 5px;
}

.empty {
  color: #777;
  font-style: italic;
}

.footer {
  margin-top: 28px;
  padding-top: 7px;
  border-top: 1px solid #ddd;
  font-size: 8pt;
  color: #888;
}
</style>
</head>
<body>

<div class="header">
  <h1>${F48CleanEscapeHtml(title)}</h1>
  ${project ? `<div class="project">${F48CleanEscapeHtml(project)}</div>` : ""}
</div>

${body}

<div class="footer">
48H FILM DESK
</div>

</body>
</html>`;
};


/* ------------------------------------------------------------
   PDF LOCAL — vrai document texte, pas capture de l'interface
   ------------------------------------------------------------ */

ipcMain.handle("F48_EXPORT_CLEAN_PDF", async (event, data) => {
  try {
    const html = F48CleanMakeHtml(data);

    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    await win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html)
    );

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      marginsType: "default"
    });

    const result = await dialog.showSaveDialog({
      title: "Exporter en PDF",
      defaultPath: `${String(data?.filename || data?.title || "48H FILM DESK").replace(/[<>:"/\\|?*]/g,"-")}.pdf`,
      filters: [
        { name: "PDF", extensions: ["pdf"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      win.destroy();
      return { success: false, canceled: true };
    }

    fs.writeFileSync(result.filePath, pdf);
    win.destroy();

    return {
      success: true,
      path: result.filePath
    };

  } catch (e) {
    console.error("[F48 CLEAN PDF]", e);
    return {
      success: false,
      error: String(e?.message || e)
    };
  }
});


/* ------------------------------------------------------------
   PDF → GOOGLE DRIVE
   Même PDF propre, directement uploadé
   ------------------------------------------------------------ */

ipcMain.handle("F48_EXPORT_CLEAN_PDF_TO_DRIVE", async (event, data) => {
  try {

    if (!googleAccessToken) {
      return {
        success: false,
        needLogin: true,
        error: "Google n'est pas connecté."
      };
    }

    const html = F48CleanMakeHtml(data);

    const win = new BrowserWindow({
      show: false,
      width: 794,
      height: 1123,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    await win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(html)
    );

    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      marginsType: "default"
    });

    win.destroy();

    const filename =
      `${String(data?.filename || data?.title || "48H FILM DESK").replace(/[<>:"/\\|?*]/g,"-")}.pdf`;

    const metadata = {
      name: filename,
      mimeType: "application/pdf"
    };

    const boundary = "F48CleanBoundary" + Date.now();

    const header =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify(metadata) +
      `\r\n--${boundary}\r\n` +
      `Content-Type: application/pdf\r\n\r\n`;

    const footer = `\r\n--${boundary}--`;

    const body = Buffer.concat([
      Buffer.from(header, "utf8"),
      pdf,
      Buffer.from(footer, "utf8")
    ]);

    const response = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${googleAccessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`
        },
        body
      }
    );

    const text = await response.text();

    if (!response.ok) {
      console.error("[F48 CLEAN DRIVE]", response.status, text);
      return {
        success: false,
        error: `Google Drive (${response.status}): ${text}`
      };
    }

    const file = JSON.parse(text);

    return {
      success: true,
      documentId: file.id,
      url: `https://drive.google.com/file/d/${file.id}/view`,
      filename
    };

  } catch (e) {
    console.error("[F48 CLEAN DRIVE]", e);
    return {
      success: false,
      error: String(e?.message || e)
    };
  }
});



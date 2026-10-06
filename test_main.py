p="main.js"

s=open(p,"r",encoding="utf-8-sig").read()

marker="function createWindow() {"

insert='''function openDetachedWindow(moduleName) {
  const child = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 700,
    minHeight: 500,
    title: moduleName + " — 48H FILM DESK",
    backgroundColor: "#111111",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  child.loadFile(path.join(__dirname, "48H_FILM_DESK.html"));

  child.webContents.once("did-finish-load", () => {
    child.webContents.executeJavaScript(
      "go(" + JSON.stringify(moduleName) + ");"
    );
  });

  return child;
}

ipcMain.handle("open-detached-window", (event, moduleName) => {
  openDetachedWindow(moduleName);
  return true;
});

'''

if "function openDetachedWindow(moduleName)" in s:
    print("ERREUR : openDetachedWindow existe déjà")
elif marker not in s:
    print("ERREUR : createWindow introuvable")
else:
    s=s.replace(marker,insert+marker,1)
    open(p,"w",encoding="utf-8").write(s)
    print("OK — fenêtre détachable ajoutée")
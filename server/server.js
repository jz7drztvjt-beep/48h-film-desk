// Serveur de synchronisation 48H FILM DESK
// Lancement : npm install && npm run server

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 8787;
const PROJECT_CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function makeProjectCode() {
  let code = "";

  for (let i = 0; i < 6; i++) {
    code += PROJECT_CODES[
      Math.floor(Math.random() * PROJECT_CODES.length)
    ];
  }

  return code.slice(0, 3) + "-" + code.slice(3);
}

function hashCode(code) {
  return crypto
    .createHash("sha256")
    .update(String(code).trim().toUpperCase())
    .digest("hex");
}

const FILE = path.join(__dirname, "data.json");

let store = {};

try {
  store = JSON.parse(fs.readFileSync(FILE, "utf8"));
} catch (e) {
  store = {};
}

let saveT = null;

const persist = () => {
  clearTimeout(saveT);

  saveT = setTimeout(() => {
    fs.writeFile(
      FILE,
      JSON.stringify(store),
      () => {}
    );
  }, 300);
};

const http_ = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });

  res.end("48H FILM DESK sync OK");
});

const wss = new WebSocketServer({
  server: http_
});

const subs = new Set();

const colDocs = (col) =>
  Object.keys(store)
    .filter(
      (k) =>
        k.startsWith(col + "/") &&
        !k.slice(col.length + 1).includes("/")
    )
    .map((k) => ({
      id: k.slice(col.length + 1),
      data: store[k]
    }));

const send = (ws, m) => {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(m));
  }
};

function createProject() {
  let code;
  let hash;

  do {
    code = makeProjectCode();
    hash = hashCode(code);
  } while (store["__project_codes/" + hash]);

  const id =
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 8);

  store["__project_codes/" + hash] = {
    id,
    createdAt: Date.now()
  };

  persist();

  return {
    id,
    code
  };
}

function findProjectByCode(code) {
  const hash = hashCode(code);

  const project =
    store["__project_codes/" + hash];

  if (!project) {
    return null;
  }

  return project;
}

/*
 * Il n'y a plus de secret global côté utilisateur.
 *
 * La sécurité repose maintenant sur le projet :
 * - création => accès automatique au projet créé
 * - code projet => accès au projet correspondant
 */
function checkSecret(ws, m) {
  return true;
}

/*
 * Vérifie qu'une connexion a bien rejoint/créé un projet
 * et que le chemin demandé appartient à ce projet.
 */
function canAccessProject(ws, requestedPath) {
  if (!ws.projectId) {
    return false;
  }

  const prefix =
    "projects/" + ws.projectId + "/";

  return String(requestedPath || "").startsWith(prefix);
}

function snapFor(s) {
  if (s.kind === "doc") {
    return {
      t: "snap",
      sid: s.sid,
      exists: s.path in store,
      data: store[s.path] ?? null
    };
  }

  return {
    t: "snap",
    sid: s.sid,
    docs: colDocs(s.path)
  };
}

function notify(key) {
  for (const s of subs) {
    const hit =
      s.kind === "doc"
        ? s.path === key
        : key.startsWith(s.path + "/") &&
          !key
            .slice(s.path.length + 1)
            .includes("/");

    if (hit) {
      send(s.ws, snapFor(s));
    }
  }
}

wss.on("connection", (ws) => {
  let authenticated = false;

  const mine = new Set();

  ws.projectId = null;

  ws.on("message", (raw) => {
    let m;

    try {
      m = JSON.parse(raw);
    } catch (e) {
      return;
    }

    /*
     * Connexion initiale.
     * Aucun secret global n'est demandé.
     */
    if (m.op === "auth") {
      authenticated = checkSecret(ws, m);

      send(ws, {
        t: "auth",
        ok: authenticated
      });

      return;
    }

    if (!authenticated) {
      send(ws, {
        t: "auth",
        ok: false,
        error: "Accès refusé"
      });

      return;
    }

    switch (m.op) {

      /*
       * Création d'un projet
       */
      case "createProject": {
        const project = createProject();

        // Le créateur devient automatiquement membre de ce projet
        ws.projectId = project.id;

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true,
          id: project.id,
          code: project.code
        });

        break;
      }

      /*
       * Rejoindre un projet avec son code
       */
      case "joinProject": {
        const project = findProjectByCode(m.code);

        if (!project) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Code de projet invalide"
          });

          break;
        }

        // Cette connexion est maintenant liée à ce projet
        ws.projectId = project.id;

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true,
          id: project.id
        });

        break;
      }

      /*
       * Modifier un document
       */
      case "set": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Accès au projet refusé"
          });

          break;
        }

        store[m.path] = m.data;

        persist();
        notify(m.path);

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true
        });

        break;
      }

      /*
       * Ajouter un document
       */
      case "add": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Accès au projet refusé"
          });

          break;
        }

        const id =
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 7);

        const k = m.path + "/" + id;

        store[k] = m.data;

        persist();
        notify(k);

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true,
          id
        });

        break;
      }

      /*
       * Supprimer un document
       */
      case "del": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Accès au projet refusé"
          });

          break;
        }

        delete store[m.path];

        persist();
        notify(m.path);

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true
        });

        break;
      }

      /*
       * Lire des données
       */
      case "get": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Accès au projet refusé"
          });

          break;
        }

        send(ws, {
          t: "got",
          rid: m.rid,
          ok: true,
          docs: colDocs(m.path),
          exists: m.path in store,
          data: store[m.path] ?? null
        });

        break;
      }

      /*
       * S'abonner à une collection/document
       */
      case "sub": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "Accès au projet refusé"
          });

          break;
        }

        const s = {
          ws,
          sid: m.sid,
          kind: m.kind,
          path: m.path
        };

        subs.add(s);
        mine.add(s);

        send(ws, snapFor(s));

        break;
      }

      /*
       * Se désabonner
       */
      case "unsub": {
        for (const s of mine) {
          if (s.sid === m.sid) {
            subs.delete(s);
            mine.delete(s);
          }
        }

        break;
      }

      /*
       * Événements temps réel.
       *
       * Ils sont maintenant envoyés uniquement
       * aux utilisateurs du même projet.
       */
      case "emit": {
        if (!ws.projectId) {
          break;
        }

        wss.clients.forEach((client) => {
          if (
            client.projectId === ws.projectId
          ) {
            send(client, {
              t: "ev",
              ch: m.ch,
              data: m.data
            });
          }
        });

        break;
      }
    }
  });

  ws.on("close", () => {
    for (const s of mine) {
      subs.delete(s);
    }
  });
});

http_.listen(PORT, () => {
  console.log(
    "Serveur de synchronisation sur le port " +
      PORT
  );
});
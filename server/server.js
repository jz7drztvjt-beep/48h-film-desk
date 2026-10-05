// Serveur de synchronisation 48H FILM DESK
// Lancement : npm install && npm run server

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Variables Supabase manquantes.");
  process.exit(1);
}

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

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

async function loadSupabaseStore() {
  const { data, error } = await supabase
    .from("f48_data")
    .select("path,data");

  if (error) {
    throw error;
  }

  for (const row of data || []) {
    store[row.path] = row.data;
  }

  console.log(
    "DonnÃ©es Supabase chargÃ©es : " +
    (data || []).length
  );
}

let saveT = null;

const persist = () => {
  clearTimeout(saveT);

  saveT = setTimeout(async () => {
    fs.writeFile(
      FILE,
      JSON.stringify(store),
      () => {}
    );

    try {
      const rows = Object.entries(store).map(
        ([path, data]) => ({
          path,
          data,
          updated_at: new Date().toISOString()
        })
      );

      if (rows.length > 0) {
        const { error } = await supabase
          .from("f48_data")
          .upsert(rows, {
            onConflict: "path"
          });

        if (error) {
          console.error(
            "Erreur sauvegarde Supabase :",
            error
          );
        } else {
          console.log(
            "Données sauvegardées dans Supabase."
          );
        }
      }
    } catch (error) {
      console.error(
        "Erreur Supabase :",
        error
      );
    }
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
 * Il n'y a plus de secret global cÃ´tÃ© utilisateur.
 *
 * La sÃ©curitÃ© repose maintenant sur le projet :
 * - crÃ©ation => accÃ¨s automatique au projet crÃ©Ã©
 * - code projet => accÃ¨s au projet correspondant
 */
function checkSecret(ws, m) {
  return true;
}

/*
 * VÃ©rifie qu'une connexion a bien rejoint/crÃ©Ã© un projet
 * et que le chemin demandÃ© appartient Ã  ce projet.
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
     * Aucun secret global n'est demandÃ©.
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
        error: "AccÃ¨s refusÃ©"
      });

      return;
    }

    switch (m.op) {

      /*
       * CrÃ©ation d'un projet
       */
      case "createProject": {
        const project = createProject();

        // Le crÃ©ateur devient automatiquement membre de ce projet
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

        // Cette connexion est maintenant liÃ©e Ã  ce projet
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
            error: "AccÃ¨s au projet refusÃ©"
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
            error: "AccÃ¨s au projet refusÃ©"
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
            error: "AccÃ¨s au projet refusÃ©"
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
       * Lire des donnÃ©es
       */
      case "get": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "AccÃ¨s au projet refusÃ©"
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
       * S'abonner Ã  une collection/document
       */
      case "sub": {
        if (!canAccessProject(ws, m.path)) {
          send(ws, {
            t: "got",
            rid: m.rid,
            ok: false,
            error: "AccÃ¨s au projet refusÃ©"
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
       * Se dÃ©sabonner
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
       * Ã‰vÃ©nements temps rÃ©el.
       *
       * Ils sont maintenant envoyÃ©s uniquement
       * aux utilisateurs du mÃªme projet.
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

loadSupabaseStore()
  .then(() => {
    http_.listen(PORT, () => {
      console.log(
        "Serveur de synchronisation sur le port " +
        PORT
      );

      console.log(
        "Stockage Supabase activÃ©."
      );
    });
  })
  .catch((error) => {
    console.error(
      "Impossible de charger Supabase :",
      error
    );

    process.exit(1);
  });

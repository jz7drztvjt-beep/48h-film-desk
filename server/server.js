// Serveur de synchronisation 48H FILM DESK (aucune dépendance cloud)
// Lancement : npm install && npm run server
const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");
const crypto = require("crypto");

const PORT = process.env.PORT || 8787;
const F48_SECRET = process.env.F48_SECRET || "";
const PROJECT_CODES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function makeProjectCode() {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += PROJECT_CODES[Math.floor(Math.random() * PROJECT_CODES.length)];
  }
  return code.slice(0,3) + "-" + code.slice(3);
}

function hashCode(code) {
  return crypto
    .createHash("sha256")
    .update(String(code).trim().toUpperCase())
    .digest("hex");
}
const FILE = path.join(__dirname, "data.json");

let store = {};
try { store = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {}
let saveT = null;
const persist = () => { clearTimeout(saveT); saveT = setTimeout(() => fs.writeFile(FILE, JSON.stringify(store), () => {}), 300); };

const http_ = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("48H FILM DESK sync OK"); });
const wss = new WebSocketServer({ server: http_ });
const subs = new Set(); // { ws, sid, kind, path }

const colDocs = (col) => Object.keys(store)
  .filter((k) => k.startsWith(col + "/") && !k.slice(col.length + 1).includes("/"))
  .map((k) => ({ id: k.slice(col.length + 1), data: store[k] }));

const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };
function createProject() {
  let code;
  let hash;

  do {
    code = makeProjectCode();
    hash = hashCode(code);
  } while (store["__project_codes/" + hash]);

  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  store["__project_codes/" + hash] = {
    id,
    createdAt: Date.now()
  };

  persist();

  return { id, code };
}

function findProjectByCode(code) {
  const hash = hashCode(code);
  const project = store["__project_codes/" + hash];

  if (!project) {
    return null;
  }

  return project;
}

function checkSecret(ws, m) {
  if (!F48_SECRET) return true;

  if (!m || !m.token) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(String(m.token)),
      Buffer.from(String(F48_SECRET))
    );
  } catch (e) {
    return false;
  }
}
function snapFor(s) {
  if (s.kind === "doc") return { t: "snap", sid: s.sid, exists: s.path in store, data: store[s.path] ?? null };
  return { t: "snap", sid: s.sid, docs: colDocs(s.path) };
}

function notify(key) {
  for (const s of subs) {
    const hit = s.kind === "doc"
      ? s.path === key
      : key.startsWith(s.path + "/") && !key.slice(s.path.length + 1).includes("/");
    if (hit) send(s.ws, snapFor(s));
  }
}

wss.on("connection", (ws) => {
  let authenticated = !F48_SECRET;
  const mine = new Set();  ws.on("message", (raw) => {
  let m; try { m = JSON.parse(raw); } catch (e) { return; }

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

  send(ws, {
    t: "got",
    rid: m.rid,
    ok: true,
    id: project.id
  });

  break;
}
case "createProject": {
  const project = createProject();

  send(ws, {
   t: "got",
    rid: m.rid,
    id: project.id,
    code: project.code
  });

  break;
}
      case "set": store[m.path] = m.data; persist(); notify(m.path); break;
      case "add": {
        const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        const k = m.path + "/" + id; store[k] = m.data; persist(); notify(k);
        send(ws, { t: "got", rid: m.rid, id }); break;
      }
      case "del": delete store[m.path]; persist(); notify(m.path); break;
      case "get":
        send(ws, { t: "got", rid: m.rid, docs: colDocs(m.path), exists: m.path in store, data: store[m.path] ?? null });
        break;
      case "sub": {
        const s = { ws, sid: m.sid, kind: m.kind, path: m.path };
        subs.add(s); mine.add(s); send(ws, snapFor(s)); break;
      }
      case "unsub":
        for (const s of mine) if (s.sid === m.sid) { subs.delete(s); mine.delete(s); }
        break;
      case "emit":
        wss.clients.forEach((c) => send(c, { t: "ev", ch: m.ch, data: m.data }));
        break;
    }
  });
  ws.on("close", () => { for (const s of mine) subs.delete(s); });
});

http_.listen(PORT, () => console.log("Serveur de synchronisation sur le port " + PORT));

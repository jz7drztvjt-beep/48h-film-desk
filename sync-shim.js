/* Remplace l'objet `claude` (fourni par claude.ai) par un client
   WebSocket vers server/server.js. Aucune dépendance externe. */
(function () {
  const URL_WS = window.F48_SERVER || "ws://localhost:8787";
  const SERVER_TOKEN = localStorage.getItem("f48_server_token") || "";
  const clean = (o) => JSON.parse(JSON.stringify(o ?? null));
  const MY = (() => {
    try {
      let u = localStorage.getItem("f48_uid");
      if (!u) { u = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("f48_uid", u); }
      return u;
    } catch (e) { return "anon" + Math.random().toString(36).slice(2); }
  })();

  let ws = null, ready = null, wasOpen = false, rid = 1;
  const pending = new Map(), subs = new Map(), evHandlers = new Set(), colCache = new Map();

  function connect() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const sock = new WebSocket(URL_WS);
      ws = sock;
     sock.onopen = () => {
  sock.send(JSON.stringify({
    op: "auth",
    token: SERVER_TOKEN
  }));
};
      sock.onerror = () => reject(new Error("serveur injoignable"));
      sock.onclose = () => {
        ready = null;
        if (wasOpen) setTimeout(() => connect().catch(() => {}), 2000);
      };
      sock.onmessage = (e) => {
        const m = JSON.parse(e.data);
if (m.t === "auth") {
  if (!m.ok) {
    ready = null;
    return;
  }

  wasOpen = true;

  subs.forEach((s, sid) => {
    sock.send(JSON.stringify({
      op: "sub",
      sid,
      kind: s.kind,
      path: s.path
    }));
  });

  resolve();
  return;
}
       if (m.t === "snap") {
  const s = subs.get(m.sid);
  if (s) {
    s.cb(
      s.kind === "col"
        ? colSnap(m.docs, m.sid)
        : docSnap(m)
    );
  }
}
        else if (m.t === "got") { const p = pending.get(m.rid); if (p) { pending.delete(m.rid); p(m); } }
        else if (m.t === "ev") evHandlers.forEach((h) => h(m.ch, m.data));
      };
    });
    return ready;
  }

  const op = (m) => connect().then(() => ws.send(JSON.stringify(m)));
  const rpc = (m) => new Promise((res) => { const id = rid++; pending.set(id, res); op({ ...m, rid: id }); });
  function sub(kind, path, cb) {
    const sid = rid++;
    subs.set(sid, { kind, path, cb });
    op({ op: "sub", sid, kind, path }).catch(() => {});
    return () => { subs.delete(sid); op({ op: "unsub", sid }).catch(() => {}); };
  }
  const colSnap = (docs, sid) => {
  const current = new Map(
    docs.map((d) => [
      d.id,
      {
        id: d.id,
        data: () => d.data
      }
    ])
  );

  const previous = colCache.get(sid) || new Map();
  const changes = [];

  // Nouveaux documents ou documents modifiés
  current.forEach((doc, id) => {
    if (!previous.has(id)) {
      changes.push({
        type: "added",
        doc
      });
    } else {
      const old = previous.get(id);
      const oldData = old.data();
      const newData = doc.data();

      if (JSON.stringify(oldData) !== JSON.stringify(newData)) {
        changes.push({
          type: "modified",
          doc
        });
      }
    }
  });

  // Documents supprimés
  previous.forEach((doc, id) => {
    if (!current.has(id)) {
      changes.push({
        type: "removed",
        doc
      });
    }
  });

  colCache.set(sid, current);

  return {
    docs: Array.from(current.values()),
    docChanges: () => changes
  };
};
  const docSnap = (m) => ({ id: m.id, exists: m.exists, data: () => m.data });
async function createRemoteProject() {
  const r = await rpc({ op: "createProject" });

  if (!r || !r.id || !r.code) {
    throw new Error("Création du projet impossible");
  }

  return {
    id: r.id,
    code: r.code
  };
}
async function joinRemoteProject(code) {
  const r = await rpc({
    op: "joinProject",
    code: String(code || "").trim().toUpperCase()
  });

  if (!r || !r.ok || !r.id) {
    return {
      ok: false,
      error: r && r.error ? r.error : "Code de projet invalide"
    };
  }

  return {
    ok: true,
    id: r.id
  };
}
  const db = {
    collection(p) {
      return {
        add: (data) => op({ op: "add", path: p, data }),
        get: () => rpc({ op: "get", path: p }).then((r) => colSnap(r.docs)),
        onSnapshot: (cb) => sub("col", p, cb)
      };
    },
    doc(p) {
      return {
        set: (data) => op({ op: "set", path: p, data }),
        delete: () => op({ op: "del", path: p }),
        get: () => rpc({ op: "get", path: p }).then((r) => docSnap({ exists: r.exists, data: r.data })),
        onSnapshot: (cb) => sub("doc", p, cb)
      };
    }
  };

  function makeRoom() {
    const CH = "main", peerPath = "rooms/main/peers/" + MY;
    let presence = null, hb = null;
    const beat = () => presence
      ? op({ op: "set", path: peerPath, data: clean({ presence, t: Date.now() }) })
      : op({ op: "del", path: peerPath });
    return {
      presence(p) {
        presence = p && p.name ? p : null;
        clearInterval(hb);
        if (presence) hb = setInterval(() => beat().catch(() => {}), 20000);
        return beat();
      },
      onPeers(cb) {
        let last = [], known = new Set();
        const push = () => {
  const now = Date.now();

  const peers = last
    .filter((d) => d.t && now - d.t < 60000)
    .map((d) => ({
      peer: d.id,
      presence: d.presence || {},
      isMe: d.id === MY,
      sameTab: false
    }));

  const oldPeers = Array.from(known);

  const joined = peers.filter((p) => !known.has(p.peer));
  const updated = peers.filter((p) => known.has(p.peer));

  const currentIds = new Set(peers.map((p) => p.peer));

  const left = oldPeers
    .filter((peer) => !currentIds.has(peer))
    .map((peer) => {
      const old = last.find((d) => d.id === peer);
      return {
        peer,
        presence: old ? old.presence || {} : {}
      };
    });

  known = currentIds;

  cb({
    peers,
    joined,
    updated,
    left
  });
};
        sub("col", "rooms/main/peers", (s) => { last = s.docs.map((d) => ({ id: d.id, ...d.data() })); push(); });
        setInterval(push, 15000);
      },
      on(type, fn) {
        const h = (ch, d) => { if (ch === CH && d.type === type && d.from !== MY) fn({ type, data: d.data, from: d.from }); };
        evHandlers.add(h);
        return () => evHandlers.delete(h);
      },
      emit(type, data) {
        return op({ op: "emit", ch: CH, data: { type, data: clean(data), from: MY } });
      }
    };
  }

  window.claude = {
    async use(name) {
      await connect();
     if (name === "db") {
  db.createRemoteProject = createRemoteProject;
  db.joinRemoteProject = joinRemoteProject;
  return db;
}
      if (name === "room") return makeRoom();
      if (name === "user") return { me: async () => ({ id: MY, name: null }) };
      throw new Error("Module inconnu : " + name);
    }
  };
})();

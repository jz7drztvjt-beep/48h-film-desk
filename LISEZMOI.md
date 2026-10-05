# 48H FILM DESK : version application (sans Firebase)

Fonctionnement : un petit serveur (server/server.js) garde les projets en ligne,
et l'application s'y connecte.

## 1. Lancer le serveur
    npm install
    npm run server
Le serveur écoute sur le port 8787 (fichier data.json créé à côté).

## 2. Lancer l'application
Dans un second terminal :
    npm start

## 3. Plusieurs personnes / appareils
- Même réseau (Wi-Fi) : dans server-config.js, mets l'IP du PC serveur,
  par ex. ws://192.168.1.20:8787 (sur le PC : `ipconfig` pour la trouver).
- Sur Internet : héberge server/server.js sur un serveur (VPS, Render, Railway...)
  et mets son adresse en wss://... dans server-config.js.

## 4. Créer l'installeur
    npm run build

Sans serveur joignable, l'app fonctionne en local (sans collaboration).

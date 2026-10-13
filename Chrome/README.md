# 🥖 Breadcrum – Chrome-Extension

Speichert die aktuelle Seite (oder einen Link) direkt in deinem
[Breadcrum](https://breadcrum.net)-Konto – im Instapaper-Stil: ein Klick, fertig.
Externe YouTube-Links (`/redirect?q=…`) werden direkt geöffnet, ohne
Redirect-Warnseite.

Diese Ausgabe ist für **Chrome** paketiert. Die gemeinsame Logik liegt in
`../extension-shared/` und wird mit `node ../scripts/sync-browser-files.mjs`
nach Chrome und Firefox kopiert. Sie verwendet die
[WebExtension-Polyfill](https://github.com/mozilla/webextension-polyfill).

## Features

- **1-Klick-Speichern** über die Breadcrum-API (`PUT /api/bookmarks`)
  mit deinem persönlichen Auth-Token – ohne Wechsel auf breadcrum.net.
- **Popup mit Vorschau:** Titel, Note, Zusammenfassung und Tags
  (automatisch aus der Seite extrahiert) vor dem Speichern editierbar.
- **Bookmarks-Ansicht im Popup:** deine letzten 20 Bookmarks,
  „Mehr laden" (Cursor-Pagination), Klick öffnet den Link.
- **Context-Menü:** „Seite zu Breadcrum speichern" (Rechtsklick auf Seite/Selektion)
  und „Link zu Breadcrum speichern" (Rechtsklick auf einen Link – Titel
  werden serverseitig ermittelt).
- **Tastenkürzel:** `Alt+Shift+B` speichert die aktuelle Seite sofort.
- **YouTube-Direktlinks:** externe Links in Beschreibungen/Kommentaren
  (`/redirect?q=…`) werden direkt geöffnet – ganz ohne YouTube-Warnseite.
  Gilt auch, falls man doch auf `/redirect` landet (sofortiges Weiterleiten),
  für Links-, Mittel- und Strg/Cmd-Klicks. Der alte 🥖-Button auf
  `/watch`-Seiten ist entfernt; Speichern geht weiter über Popup,
  Kontextmenü und Tastenkürzel.
- **Audio-Dateien:** Direkte URLs auf gängige Audioformate wie MP3, M4A, AAC,
  OGG, OPUS, WAV oder FLAC erzeugen ebenfalls automatisch eine Episode.
- **Statusabfrage:** Die automatische Prüfung, ob die geöffnete Seite schon
  gespeichert ist, ist standardmäßig ausgeschaltet. Sie lässt sich in den
  Einstellungen aktivieren; dabei wird die Tab-URL zur Prüfung an Breadcrum
  gesendet. Geprüft wird nur der jeweils aktive Tab – Hintergrund- und
  vorgezogene (Prefetch-)Tabs lösen keine Abfrage aus. Dieselbe URL wird pro
  Tab höchstens alle 30 Sekunden neu geprüft.

## Installation (Chrome – entpackt)

1. Chrome öffnen und `chrome://extensions` aufrufen.
2. Oben rechts **Entwicklermodus** aktivieren.
3. **Entpackte Erweiterung laden** → diesen Ordner auswählen.

Nach Änderungen einfach in `chrome://extensions` auf das **↻ (Neu laden)**-Symbol
der Erweiterung klicken.

> Hinweis: `--load-extension` per Kommandozeile wird seit Chrome 137 in
> regulären Chrome-Builds ignoriert – nur „Entwicklermodus → Entpackte
> Erweiterung laden" funktioniert.

## Einrichtung

1. Auf [breadcrum.net/account](https://breadcrum.net/account) einloggen.
2. Dort einen **Auth-Token** erstellen (Account → Auth Tokens → Create).
3. In der Extension: Rechtsklick auf das 🥖-Icon → **Einstellungen**
   (oder im Popup auf ⚙) → Token eintragen → **Token speichern**.

Das Token wird nur lokal in `browser.storage.local` gespeichert und
ausschließlich als `Authorization: Bearer <token>` an breadcrum.net gesendet.
Seiteninhalte werden beim manuellen Speichern auf ausdrückliche Aktion gelesen.
Die optionale Statusabfrage überträgt die URL des aktuellen Tabs an Breadcrum;
sie ist standardmäßig deaktiviert.

## Funktionsweise / API

- **Speichern:** `PUT https://breadcrum.net/api/bookmarks?meta=false&episode=<true|false>&archive=false`
  mit JSON-Body `{ url, title, note, summary, tags }`. Antworten:
  `201` = neu gespeichert, `200` = war bereits vorhanden, `401` = Token ungültig.
- **Liste:** `GET https://breadcrum.net/api/bookmarks?per_page=20[&before=<cursor>]`,
  Pagination über `pagination.before`.

`episode` ist bei erkennbaren Audio-Datei-URLs `true`.
Alle anderen Speicherwege verwenden `episode=false`. `meta` und `archive`
bleiben standardmäßig `false`.

## Struktur

```
breadcrum/                ← entpackte, aktuelle Version (Chrome lädt diesen Ordner)
├── manifest.json        Chrome-MV3 mit Service Worker
├── background.js        API-Layer (save/list), Context-Menü, Command, Notifications
├── extract.js           generische Metadaten-Extraktion (Port des Bookmarklets)
├── lib/browser-polyfill.min.js   WebExtension-Polyfill (browser.* für Chrome)
├── sites/youtube.js     YouTube-Direktlinks (umgeht /redirect-Warnseite)
├── popup/               Popup: Speichern-Tab, Bookmarks-Tab, Einstellungen
├── icons/               offizielle Breadcrum-Grafik (16–128 px)
└── Archiv/              Versionen-Snapshots (ZIPs, z. B. breadcrum-1.0.0.zip)
```

## Update-Workflow

Bei einer neuen Version wird die bisherige Version nach `Archiv/` verschoben
(Snapshot als ZIP), die neue Version bleibt entpackt im Hauptordner:

1. Neue Version im Hauptordner anpassen (Version in `manifest.json` erhöhen).
2. `npx web-ext build --source-dir . --artifacts-dir . --overwrite-dest`
   → ZIP nach `Archiv/breadcrum-<version>.zip` verschieben.
3. In Chrome: `chrome://extensions` → **↻ (Neu laden)**.

Gemeinsame Popup-, Extraktions- und Hintergrundlogik zuerst in
`../extension-shared/` ändern und anschließend das Synchronisierungsskript
ausführen. Browser-spezifische Manifeste und Polyfills bleiben in den jeweiligen
Plattformordnern.

## Hinweis zum Userscript

Die alte Video-Seiten-Integration („Breadcrum"-Button + „Watch later"-Button im
Userscript) wurde in die Extension übernommen. Das gekürzte Userscript
`YouTube Better Watch Later (nur Playlist).user.js` enthält nur noch den
Playlist-Bereich, damit es auf YouTube nicht zwei „Breadcrum"-Buttons gibt.

## Rechtliches

Breadcrum ist ein Dienst von [HifiWi.fi](https://hifiwi.fi) (AGPL-3.0,
[Quellcode](https://github.com/hifiwi-fi/breadcrum.net)). Icon-Basis ist das
offizielle Seiten-Logo. Diese Extension ist inoffiziell.

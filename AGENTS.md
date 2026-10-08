# Breadcrum

## Projekt-Kontext
Breadcrum ist ein Multi-Plattform-Repository mit Chrome- und Firefox-
WebExtensions, Android-App sowie YouTube-Userscripts. Gemeinsame Browser-Logik
liegt in `extension-shared/`; das Synchronisierungsskript kopiert sie in die
Chrome- und Firefox-Verzeichnisse.

## Konventionen
- Nutzertexte und Dokumentation auf Deutsch, Code-Identifier auf Englisch.
- API-Token nur lokal speichern und nur an `https://breadcrum.net` senden.
- Gemeinsame Browser-Logik nur in `extension-shared/` bearbeiten und danach
  `node scripts/sync-browser-files.mjs` ausführen.
- Die automatische URL-Statusabfrage bleibt standardmäßig deaktiviert; Änderungen
  daran müssen die sichtbare Einwilligung und die README-Dokumentation erhalten.
- Seiteninhalte nur nach einer konkreten Speicheraktion auslesen.
- Keine Änderungen an Produktivdiensten oder Kontodaten aus diesem Repository.

## Commands
- Gemeinsame Browser-Dateien nach Chrome und Firefox kopieren:
  `node scripts/sync-browser-files.mjs`.
- Statische Projektprüfungen: `node scripts/validate.mjs`.
- JavaScript-Syntaxprüfung: `node --check Chrome/background.js` (analog für
  weitere geänderte JavaScript-Dateien und die Firefox-Kopie).
- Manifest-JSON prüfen: `python3 -m json.tool Chrome/manifest.json` und
  `python3 -m json.tool Firefox/manifest.json`.
- Android-Debug-Build: `cd Android && ./gradlew assembleDebug`.
- GitHub Actions führt Manifest-, Syntax- und Synchronisierungsprüfungen aus;
  fachliche automatisierte Tests sind noch nicht vorhanden.

## Grenzen
- Browser-ZIPs und Android-APKs sind Release-Artefakte; nicht bei Codeprüfungen
  neu erzeugen oder ersetzen.
- Keine Tokens, Signaturschlüssel oder persönlichen Bookmark-Daten einchecken.
- Änderungen erst nach passender lokaler Prüfung als funktionsfähig behandeln.

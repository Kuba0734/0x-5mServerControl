# Regeln
- Antworte immer auf Deutsch
- Alle für Nutzer sichtbaren Texte (UI, Fehlermeldungen, Toasts) auf Englisch
- Code (Variablen, Funktionen, Events, Dateinamen) immer auf Englisch
- Keine Kommentare im Code
- Am Ende jeder Antwort mit Codeänderungen: eine Commit-Message auf Englisch

# Projekt
- Name: 0x-5mServerControl
- Zweck: Desktop-App zum Steuern eines FiveM-Servers (FXServer)
- Plattform: windows
- Auslieferung: eine portable .exe, kein Installer, keine Admin-Rechte nötig
- App-Daten (Settings, Profile, Logs) in `%LOCALAPPDATA%\0x-5mServerControl`

## Tech-Stack
- Electron + Node.js, TypeScript
- Prozesssteuerung über Node `child_process` im Main-Prozess, UI im Renderer, Kommunikation über IPC (contextBridge, `contextIsolation` an, `nodeIntegration` aus)

## Server-Profile
- Mehrere Server-Profile, jedes mit eigenen Pfaden, Port, Modus (direkt / txAdmin) und Einstellungen
- Mehrere Server dürfen parallel laufen; Validierung verhindert Port-Konflikte

## Remote-Server
- Jedes Profil ist lokal oder remote (SSH); alle Features funktionieren auch remote
- Linux und Windows werden über SSH gesteuert (Windows: OpenSSH-Server), Dateien über SFTP
- Anmeldung per Passwort, gespeichert verschlüsselt über Electron `safeStorage`
- Host-Key wird beim ersten Verbinden gemerkt, bei Abweichung wird die Verbindung abgelehnt
- Windows-Hosts: zusätzlicher Button, der eine Remotedesktop-Verbindung (`mstsc /v:host`) öffnet
- Remote-Server laufen unabhängig von der App weiter:
  - Linux: `screen`-Session `fxsc-<profileId>`, Befehle per `screen -X stuff`, Ausgabe in eine Log-Datei
  - Windows: PowerShell-Wrapper (per WMI gestartet), Befehle über Dateien, Ausgabe in eine Log-Datei
- Konsole liest die Log-Datei über SFTP; Status, CPU und RAM über SSH-Befehle
- Datenbank-Import bei Installation über SSH-Tunnel; Recipes werden lokal gebaut und als Archiv hochgeladen
- Löschen auf Remote-Hosts verschiebt in einen Papierkorb-Ordner unter `~/.fxsc/<profileId>/trash`
- Beim Schließen der App laufen Remote-Server weiter, nur lokale Server betreffen die Nachfrage

## Features
- Server-Installation (Wizard):
  - Artifacts herunterladen: Kanal wählbar (Recommended / Latest / bestimmte Build-Nummer)
  - Basis wählbar: bestehende server-data, Vanilla (cfx-server-data), ESX Legacy, QBCore, Qbox
  - Frameworks: Nutzer gibt MySQL/MariaDB-Verbindung ein (Host, Port, User, Passwort, DB), App testet die Verbindung und importiert die SQL-Dateien; keine eigene Datenbank mitliefern; Datenbank lässt sich im Setup abschalten (dann kein Import)
  - Erzeugt eine server.cfg mit Lizenz-Key, Hostname, Port
- Settings: Pfade zu FXServer-Artifacts und server-data, Animationen an/aus, Autostart
- Validierung vor dem Start: Pfade, FXServer.exe, server.cfg, sv_licenseKey, Port des Profils frei (Standard 30120)
- Start / Stop / Restart des Servers
  - Start: `FXServer.exe +exec server.cfg` im server-data-Ordner
  - Stop: zuerst `quit` über stdin, nach 10 s den Prozessbaum beenden
- Crash-Erkennung mit Auto-Restart (max. 3 Versuche in 5 min)
- Extern gestartete Server erkennen (FXServer-Prozess aus dem Artifacts-Ordner des Profils, lokal und remote): Status „Running externally", CPU/RAM, Stop beendet den Prozess; doppelter Start wird blockiert; beim Schließen der App werden sie nicht gestoppt
- Live-Konsole: stdout/stderr, Befehle über stdin, FiveM-Farbcodes, Suche/Filter, Befehlshistorie, Log-Export
- Performance-Seite: CPU, RAM, Uptime, Spielerzahl
- Spielerliste über `players.json`, Kick per Klick
- Resource-Manager: start/stop/restart/ensure
- File-Manager (auf server-data beschränkt):
  - Browsen, Erstellen, Umbenennen, Drag & Drop Import
  - Löschen immer in den Windows-Papierkorb
  - Text-Editor mit Syntax-Highlighting für Lua, JSON, cfg, SQL
  - ZIP entpacken und Ordner packen
  - Button „Im Explorer öffnen“
- Server-Settings:
  - server.cfg als Raw-Editor mit Syntax-Highlighting
  - ensure-Liste: Reihenfolge der Ressourcen per Drag & Drop, schreibt zurück in server.cfg
- Artifact-Updater mit Rollback: nur die vorherige Version wird behalten
- txAdmin-Unterstützung: pro Profil wählbar
  - Direkt-Modus: `FXServer.exe +exec server.cfg`, alle Features der App
  - txAdmin-Modus: App startet/stoppt nur den FXServer-Host mit txAdmin, zeigt Konsole und Link zum Web-Panel
- System-Tray mit Status, Single-Instance-Lock
- App-Auto-Update über GitHub Releases: portable .exe lädt neue Version und ersetzt sich selbst
- Beim Schließen fragen: Server stoppen oder weiterlaufen lassen

## Design
- Modern, clean, dunkel, hochwertig
- Monochrom: Schwarz, Weiß, Grau. Akzent `--accent` (Weiß), Text darauf `--on-accent`
- `--danger` und `--success` nur für Fehler, Löschen und Erfolg
- Glassmorphism: halbtransparente Panels, `backdrop-filter: blur()`, 1px-Ränder `rgba(255,255,255,0.08)`; Blur nur auf wenigen, großen Flächen, nie auf vielen Listenelementen
- Leicht abgerundete Ecken, weiche Schatten, großzügige Abstände
- Schrift: Inter, lokal eingebunden
- Icons als Inline-SVG
- Alle Farben, Radien, Abstände und Animationszeiten als CSS-Variablen in `src/ui/tokens.css`

## Animationen
- Nichts erscheint oder verschwindet abrupt
- Nur `transform` und `opacity` animieren, keine Layout-Properties
- Standard-Easing: `cubic-bezier(0.22, 1, 0.36, 1)`, Dauer 150–300 ms
- Modals: Fade + Scale 0.95 → 1 + leichter Slide nach oben, schließen umgekehrt
- Listen erscheinen gestaffelt (40–60 ms pro Element, max. ~10 Elemente staffeln)
- Hover: `translateY(-2px)` + dezenter Glow; Klick: `scale(0.97)`
- Toasts sliden seitlich ein, mit ablaufender Fortschrittsleiste
- Zahlen auf der Performance-Seite zählen animiert hoch
- Ladezustände mit Skeleton-Shimmer
- Tab- und Seitenwechsel mit Crossfade
- Nur CSS-Transitions und `@keyframes`, keine Libraries
- `prefers-reduced-motion` und eine eigene Einstellung in Settings schalten Animationen fast komplett ab
- Tab-Leiste und Adressleiste reagieren immer sofort, Animationen dürfen Eingaben nie verzögern

## Live-Konsole (Performance)
- Maximal 5000 Zeilen im Speicher, ältere verwerfen
- Virtualisiertes Rendering, keine Animation pro Zeile
- Auto-Scroll nur, wenn der Nutzer unten ist
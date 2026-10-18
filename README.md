# 0x-5mServerControl

A desktop app for Windows to install, run and manage FiveM servers (FXServer), on this computer or on remote Linux and Windows machines over SSH.

Ships as a single portable `.exe`. No installer and no admin rights needed. Settings live in `%LOCALAPPDATA%\0x-5mServerControl`.

## Features

- **Setup wizard**: download FXServer artifacts (recommended, latest or a specific build) and create a server from Vanilla, ESX Legacy, QBCore or Qbox, or use an existing server-data folder. Database import is optional.
- **Server control**: start, stop and restart, with pre-start checks (paths, FXServer, `server.cfg`, license key, free port). Crash detection restarts the server automatically, at most 3 times in 5 minutes.
- **Live console**: colored output, search and filter, command history and log export.
- **Performance**: CPU, RAM, uptime and player count.
- **Players**: player list with kick.
- **Resources**: start, stop, restart and ensure.
- **Files**: file manager with a code editor, ZIP extract and pack, and drag and drop import. Deleted files go to the Recycle Bin.
- **Server settings**: `server.cfg` editor and drag and drop resource start order.
- **Artifact updater**: update FXServer with one-step rollback.
- **txAdmin mode**: available per profile.
- **Remote servers over SSH**:
  - Linux servers run in `screen`. Windows servers run through a background wrapper started over WMI.
  - Both keep running when the app is closed.
  - Windows hosts get a Remote Desktop button.
- **External servers**: an FXServer started outside the app is detected, shown and can be stopped.
- **App**: system tray, single instance, prompt on close, launch at login and self-update from GitHub Releases.

## Requirements

- Windows 10 or 11 to run the app.
- A FiveM license key from [portal.cfx.re](https://portal.cfx.re).
- For frameworks: a MySQL or MariaDB server. This is optional during setup.
- For remote Linux hosts: SSH with password login, plus `screen`, `curl`, `tar`, and `zip`/`unzip` for the file manager.
- For remote Windows hosts: the OpenSSH Server feature with password login.

## Development

You need Node.js 24 or newer.

```bash
npm install
```

npm may block install scripts. If Electron does not start, download its binary:

```bash
node node_modules/electron/install.js
```

Build and start the app:

```bash
npm start
```

Run the tests:

```bash
npm test
```

Build the portable exe to `release\`:

```bash
npm run dist
```

## Releasing

`deploy.bat` bumps the patch version, builds the exe, commits and pushes the current branch, and creates a GitHub release with the exe attached. The app's auto-update reads from these releases. It needs the GitHub CLI (`gh`) and a logged-in account.

```bash
deploy.bat Short description of the changes
```

## Project layout

```
src/main      Electron main process (server control, SSH, installer, files)
src/preload   IPC bridge
src/shared    Types and helpers used by main and UI
src/ui        Renderer UI (plain TypeScript, CSS tokens in tokens.css)
src/test      Unit tests (node:test)
```

# OBS Bible & Songs

A local web app for running Bible verses, song lyrics, and PowerPoint slides as an OBS browser-source overlay during church services — with a control panel to drive what's displayed and a live overlay that updates in real time over WebSockets.

## Features

- **Bible lookup** — search verses/chapters by book (English or Swahili name), chapter, and verse, backed by a local SQLite database (`bible.sqlite`) with English and Swahili text.
- **Songs** — English (`songs/en`) and Swahili (`songs/sw`) lyrics libraries, listed and served by title.
- **Presentations** — upload `.ppt`, `.pptx`, or `.odp` files; they're converted to slide images (via LibreOffice + `pdftoppm`) and can be displayed slide-by-slide.
- **Backgrounds** — upload images or videos as overlay backgrounds, or set a solid banner/background color.
- **Live overlay** — `overlay.html` is the OBS browser source; `control.html` is the operator control panel. Both stay in sync over a WebSocket connection.

## Requirements

- [Node.js](https://nodejs.org)
- [LibreOffice](https://www.libreoffice.org) (`soffice`) and `pdftoppm` (from `poppler-utils`) on your `PATH` — only needed for the presentation upload/conversion feature.

## Getting started

```bash
npm install
npm start
```

Or just double-click `start.sh`, which installs dependencies on first run and opens the control panel in your browser.

Once running:

- Control panel: http://localhost:3000/control.html
- Overlay (add as an OBS Browser Source): http://localhost:3000/overlay.html

The port can be changed with the `PORT` environment variable.

## Project structure

```
server.js              Express + WebSocket server, all API routes
public/
  control.html          Operator control panel
  overlay.html           OBS browser-source overlay
  uploads/               Uploaded background images/videos
  presentations/         Converted presentation slide images
songs/
  en/                    English song lyrics + meta.json (id -> title)
  sw/                    Swahili song lyrics (title read from first line of each file)
bible.sqlite            Bible text database (English + Swahili)
books.json              English <-> Swahili book name mapping
```

## API overview

- `GET /api/books` — list of Bible books (English/Swahili names)
- `GET /api/bible?book=&chapter=&verse=` — single verse (English + Swahili)
- `GET /api/bible/chapter?book=&chapter=` — full chapter
- `GET /api/songs?lang=en|sw` — song list for a language
- `GET /api/songs/:id?lang=en|sw` — song lyrics
- `POST /api/upload-bg`, `GET /api/backgrounds`, `DELETE /api/backgrounds/:filename` — background image/video management
- `POST/GET/DELETE /api/presentations[/:id]` — presentation upload, listing, and removal

Control panel and overlay stay in sync via WebSocket messages (`SET_BG`, `SET_BANNER_COLOR`, etc.) broadcast by the server.

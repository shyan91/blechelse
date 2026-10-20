/*
 * The clip library: the .wav files the user provides.
 *
 * Two ways to load it:
 *  - Local: the user picks / drops the clip folder. Files stay on their machine.
 *  - Hosted: a `clips/` folder (with manifest.json) next to index.html, or
 *    ?clips=<url> pointing at one. Used when the app is self-hosted.
 *
 * Paths are normalised to the server layout, e.g. "/dt/ziele/variante2/tief/8000105.wav".
 * manifest.json (written by blechelse_scraper.py) supplies readable names for
 * stations, train types, delays, reasons and special announcements.
 */
(function () {
  "use strict";

  const ROOTS = new Set(["dt", "en", "fr", "gong"]);

  function normalisePath(rel) {
    const segs = rel.replace(/\\/g, "/").split("/").filter(Boolean);
    const i = segs.findIndex((s, idx) => ROOTS.has(s) && idx < segs.length - 1);
    return i === -1 ? null : "/" + segs.slice(i).join("/");
  }

  const collator = new Intl.Collator("de", { sensitivity: "base", numeric: true });
  const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss");

  class Library {
    constructor() {
      this.files = new Map();   // path -> File (local mode)
      this.paths = new Set();   // every known clip path
      this.manifest = {};       // path -> description
      this.remoteBase = null;   // base URL (hosted mode)
      this.source = "";
      this.buildCatalog();
    }

    get size() { return this.paths.size; }
    has(path) { return !!path && this.paths.has(path); }

    async arrayBuffer(path) {
      if (this.remoteBase) {
        const r = await fetch(this.remoteBase + path.slice(1));
        if (!r.ok) throw new Error(`HTTP ${r.status} for ${path}`);
        return r.arrayBuffer();
      }
      const f = this.files.get(path);
      if (!f) throw new Error(`Clip fehlt: ${path}`);
      return f.arrayBuffer();
    }

    // ------------------------------------------------------------ loading

    /** files: iterable of {file, rel} */
    async loadLocal(entries, label) {
      const files = new Map();
      let manifestFile = null;
      for (const { file, rel } of entries) {
        if (/(^|\/)manifest\.json$/i.test(rel)) {
          // prefer the shallowest manifest.json
          if (!manifestFile || rel.split("/").length < manifestFile.rel.split("/").length) manifestFile = { file, rel };
          continue;
        }
        if (!/\.wav$/i.test(rel)) continue;
        const p = normalisePath(rel);
        if (p) files.set(p, file);
      }
      let manifest = {};
      if (manifestFile) {
        try { manifest = JSON.parse(await manifestFile.file.text()); } catch (e) { console.warn("manifest.json unreadable", e); }
      }
      this.files = files;
      this.paths = new Set(files.keys());
      this.manifest = manifest;
      this.remoteBase = null;
      this.source = label || "Lokaler Ordner";
      this.buildCatalog();
    }

    async loadRemote(base) {
      base = base.endsWith("/") ? base : base + "/";
      const r = await fetch(base + "manifest.json", { cache: "no-cache" });
      if (!r.ok) throw new Error(`Kein manifest.json unter ${base}`);
      const manifest = await r.json();
      this.files = new Map();
      this.manifest = manifest;
      this.paths = new Set(Object.keys(manifest).map((p) => (p.startsWith("/") ? p : "/" + p)));
      this.remoteBase = new URL(base, location.href).href;
      this.source = "Server: " + base;
      this.buildCatalog();
    }

    // ------------------------------------------------------------ catalog

    desc(path, prefix) {
      let d = this.manifest[path];
      if (d && typeof d === "object") d = d.produced_by?.[0] || d.label || "";
      if (!d) return null;
      return prefix && d.startsWith(prefix) ? d.slice(prefix.length).trim() : d;
    }

    buildCatalog() {
      const stations = new Map();  // file -> name
      const gattungen = new Map(); // code -> label
      const delays = new Map(), reasons = new Map(), specials = new Map();
      const langs = new Set();

      for (const p of this.paths) {
        const segs = p.split("/"); // ["", lang, ...]
        const lang = segs[1];
        if (lang !== "gong") langs.add(lang);
        const file = segs[segs.length - 1];
        const folder = segs.slice(2, -1).join("/");
        if (folder.startsWith("ziele/")) {
          const name = this.desc(p, "Station");
          if (!stations.has(file) || (name && stations.get(file) === file)) stations.set(file, name || file.replace(/\.wav$/i, ""));
        } else if (folder === "zuggattungen/hoch") {
          const code = file.replace(/\.wav$/i, "");
          const name = this.desc(p, "Zuggattung");
          if (!gattungen.has(code) || name) gattungen.set(code, name || code.toUpperCase());
        } else if (folder === "zeiten/verspaetung_heute") {
          const n = parseInt(file, 10);
          delays.set(file, this.desc(p, "verspaetung:") || `ca. ${n} min`);
        } else if (folder === "gruende/grund_dafuer") {
          if (!reasons.has(file) || this.desc(p)) reasons.set(file, this.desc(p, "grund:") || `Grund ${parseInt(file, 10)}`);
        } else if (folder === "nza") {
          if (!specials.has(file) || this.desc(p)) specials.set(file, this.desc(p, "sonderansagen:") || `Sonderansage ${parseInt(file, 10)}`);
        }
      }

      const sortByName = (m) => [...m].map(([id, name]) => ({ id, name, key: fold(name) }))
        .sort((a, b) => collator.compare(a.name, b.name));
      const sortById = (m) => [...m].map(([id, name]) => ({ id, name })).sort((a, b) => collator.compare(a.id, b.id));

      // Main train types first, the rest alphabetically.
      const main = ["ice", "tgv", "rj", "ic", "ec", "en", "ire", "re", "rb", "s", "zug", "sonderzug"];
      const g = [...gattungen].map(([id, name]) => ({ id, name }))
        .sort((a, b) => {
          const ia = main.indexOf(a.id), ib = main.indexOf(b.id);
          if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
          return collator.compare(a.name, b.name);
        });

      this.catalog = {
        stations: sortByName(stations),
        stationMap: stations,
        gattungen: g,
        delays: sortById(delays),
        reasons: sortById(reasons),
        specials: sortById(specials),
        langs,
        stationName: (id) => stations.get(id) || (id ? id.replace(/\.wav$/i, "") : ""),
        delayName: (id) => delays.get(id) || id,
        reasonName: (id) => reasons.get(id) || id,
        specialName: (id) => specials.get(id) || id,
        gattungName: (id) => gattungen.get(id) || (id || "").toUpperCase(),
      };
    }

    /** Readable label for any clip path (used by the clip browser). */
    labelFor(path) {
      const d = this.desc(path);
      if (d) return d;
      const segs = path.split("/");
      const file = segs[segs.length - 1].replace(/\.wav$/i, "");
      const folder = segs.slice(2, -1).join("/");
      if (folder.startsWith("ziele/")) return this.catalog.stationName(file + ".wav");
      if (folder === "zuggattungen/hoch") return this.catalog.gattungName(file);
      if (folder.startsWith("gleise_zahlen")) return "Zahl " + file.replace("_", "");
      if (folder.startsWith("zeiten/stunden")) return file + " Uhr";
      if (folder.startsWith("zeiten/minuten")) return ":" + file;
      return file;
    }
  }

  // ------------------------------------------------------------ file gathering

  /** From <input type=file webkitdirectory> */
  function entriesFromInput(fileList) {
    return Array.from(fileList, (file) => ({ file, rel: file.webkitRelativePath || file.name }));
  }

  /** From a drag & drop DataTransfer (folders are walked recursively). */
  async function entriesFromDrop(dataTransfer, onProgress) {
    const out = [];
    const roots = Array.from(dataTransfer.items || [])
      .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
      .filter(Boolean);
    if (!roots.length) return entriesFromInput(dataTransfer.files || []);

    const readAll = (reader) => new Promise((resolve, reject) => {
      const all = [];
      const next = () => reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, reject);
      next();
    });
    const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

    const stack = roots.map((e) => ({ entry: e, path: e.name }));
    while (stack.length) {
      const { entry, path } = stack.pop();
      if (entry.isDirectory) {
        const children = await readAll(entry.createReader());
        for (const c of children) stack.push({ entry: c, path: path + "/" + c.name });
      } else if (/\.(wav|json)$/i.test(entry.name)) {
        out.push({ file: await fileOf(entry), rel: path });
        if (onProgress && out.length % 500 === 0) onProgress(out.length);
      }
    }
    return out;
  }

  window.ClipLibrary = { Library, entriesFromInput, entriesFromDrop, fold };
})();

/* UI glue: form, preview display, clip chain, player, clip browser. */
(function () {
  "use strict";

  const { TYPES, LANGS, compose, resolveChain } = window.Ansagen;
  const { Library, fold } = window.ClipLibrary;
  const Player = window.ClipPlayer;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const library = new Library();
  const STORAGE_KEY = "blechelse.studio.v1";

  // ------------------------------------------------------------ state

  const DEFAULTS = {
    type: "einfahrt", langs: ["dt"], gong: true, hall: false, gap: 40,
    gattung: "ice", nummer: "1234", ersatz: false,
    ziel: "", via1: "", via2: "", von: "",
    gleis: 7, zeit: "18:59", verspaetet: false, nichtEinsteigen: false,
    delay: "", grund: "", gleisNeu: "", nurBis: "", zusatzhalt: "", haltausfall: "",
    faelltAus: false, entschuldigung: false, sonder: "",
  };
  let state = { ...DEFAULTS };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch (_) {}
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {} };

  // ------------------------------------------------------------ toast

  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.toggle("is-error", !!isError);
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3200);
  }

  // ------------------------------------------------------------ combobox (station search)

  class Combo {
    constructor(root, onChange) {
      this.root = root;
      this.field = root.dataset.field;
      this.clearable = root.hasAttribute("data-clearable");
      this.onChange = onChange;
      this.value = "";
      root.innerHTML = `<input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${esc(root.dataset.placeholder || "")}" />
        ${this.clearable ? '<button type="button" class="combo-clear" aria-label="Leeren" hidden><svg><use href="#i-x"/></svg></button>' : ""}
        <ul class="combo-list" role="listbox" hidden></ul>`;
      this.input = $("input", root);
      this.list = $("ul", root);
      this.clearBtn = $(".combo-clear", root);
      this.items = [];
      this.active = 0;

      this.input.addEventListener("focus", () => { this.input.select(); this.open(""); });
      this.input.addEventListener("input", () => this.open(this.input.value));
      this.input.addEventListener("keydown", (e) => this.key(e));
      this.input.addEventListener("blur", () => setTimeout(() => this.close(), 120));
      this.list.addEventListener("mousedown", (e) => {
        const li = e.target.closest("li[data-id]");
        if (li) { e.preventDefault(); this.pick(li.dataset.id); }
      });
      this.clearBtn?.addEventListener("click", () => { this.pick(""); });
    }

    set(id) {
      this.value = id || "";
      this.input.value = id ? library.catalog.stationName(id) : "";
      if (this.clearBtn) this.clearBtn.hidden = !id;
    }

    open(query) {
      const q = fold(query.trim());
      const all = library.catalog.stations;
      let res;
      if (!q) res = all.slice(0, 60);
      else {
        const starts = [], contains = [];
        for (const s of all) {
          const i = s.key.indexOf(q);
          if (i === 0) starts.push(s); else if (i > 0) contains.push(s);
          if (starts.length >= 60) break;
        }
        res = starts.concat(contains).slice(0, 60);
      }
      this.items = res;
      this.active = 0;
      if (!res.length) {
        this.list.innerHTML = `<li class="combo-empty">Kein Bahnhof gefunden</li>`;
      } else {
        this.list.innerHTML = res.map((s, i) => {
          let name = esc(s.name);
          if (q) {
            const i0 = s.key.indexOf(q);
            if (i0 >= 0 && s.key.length === s.name.length) {
              name = esc(s.name.slice(0, i0)) + "<mark>" + esc(s.name.slice(i0, i0 + q.length)) + "</mark>" + esc(s.name.slice(i0 + q.length));
            }
          }
          return `<li role="option" data-id="${esc(s.id)}" class="${i === 0 ? "is-active" : ""}">${name}<small>${esc(s.id.replace(/\.wav$/i, ""))}</small></li>`;
        }).join("");
      }
      this.list.hidden = false;
      this.input.setAttribute("aria-expanded", "true");
    }

    close() {
      this.list.hidden = true;
      this.input.setAttribute("aria-expanded", "false");
      this.set(this.value); // restore text if the user typed without picking
    }

    key(e) {
      if (this.list.hidden && (e.key === "ArrowDown" || e.key === "Enter")) { this.open(this.input.value); return; }
      const lis = $$("li[data-id]", this.list);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!lis.length) return;
        this.active = (this.active + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, i) => li.classList.toggle("is-active", i === this.active));
        lis[this.active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (lis[this.active]) this.pick(lis[this.active].dataset.id);
      } else if (e.key === "Escape") {
        this.input.blur();
      }
    }

    pick(id) {
      this.set(id);
      this.list.hidden = true;
      this.onChange(this.field, id);
    }
  }

  const combos = $$(".combo").map((el) => new Combo(el, (field, id) => { state[field] = id; changed(); }));

  // ------------------------------------------------------------ static UI

  function renderTypeStrip() {
    $("#type-strip").innerHTML = TYPES.map((t) => `
      <button type="button" class="type-btn" role="tab" data-type="${t.id}">
        <span class="ti"><svg><use href="#i-${t.icon}"/></svg></span>
        <span><strong>${esc(t.name)}</strong><small>${esc(t.desc)}</small></span>
      </button>`).join("");
    $$(".type-btn").forEach((b) => b.addEventListener("click", () => { state.type = b.dataset.type; changed(); }));
  }

  function fillSelect(sel, items, emptyLabel, value) {
    sel.innerHTML = (emptyLabel != null ? `<option value="">${esc(emptyLabel)}</option>` : "") +
      items.map((i) => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join("");
    sel.value = value || "";
    if (sel.value !== (value || "") && emptyLabel == null && items[0]) sel.value = items[0].id;
  }

  function refreshCatalogUI() {
    const c = library.catalog;
    if (!c.gattungen.find((g) => g.id === state.gattung)) state.gattung = c.gattungen[0]?.id || "";
    fillSelect($("#f-gattung"), c.gattungen, null, state.gattung);
    fillSelect($("#f-delay"), c.delays, "Keine Angabe", state.delay);
    fillSelect($("#f-grund"), c.reasons, "Kein Grund", state.grund);

    // keep stored stations only if they exist in this library
    for (const f of ["ziel", "via1", "via2", "von", "nurBis", "zusatzhalt", "haltausfall"]) {
      if (state[f] && !c.stationMap.has(state[f])) state[f] = "";
    }
    const pickByName = (re) => (c.stations.find((s) => re.test(s.name)) || c.stations[0] || {}).id || "";
    if (!state.ziel) state.ziel = pickByName(/^München Hbf$/);
    if (!state.von) state.von = pickByName(/^Hamburg Hbf$/);
    combos.forEach((cb) => cb.set(state[cb.field]));

    if (!c.specials.find((s) => s.id === state.sonder)) state.sonder = c.specials[0]?.id || "";
    $("#sonder-grid").innerHTML = c.specials.length
      ? c.specials.map((s) => `<button type="button" class="chip" data-id="${esc(s.id)}">${esc(s.name)}</button>`).join("")
      : `<p class="muted small">Keine Sonderansagen (nza/) im Clip-Ordner gefunden.</p>`;
    $$("#sonder-grid .chip").forEach((b) => b.addEventListener("click", () => { state.sonder = b.dataset.id; changed(); }));

    browserIndex = null;
  }

  // ------------------------------------------------------------ bind inputs

  const bind = (id, key, kind = "value") => {
    const el = $("#" + id);
    const read = () => {
      state[key] = kind === "checked" ? el.checked : kind === "int" ? (parseInt(el.value, 10) || "") : el.value;
      changed();
    };
    el.addEventListener(kind === "checked" ? "change" : "input", read);
    if (kind !== "checked") el.addEventListener("change", read);
  };
  bind("f-gattung", "gattung");
  bind("f-nummer", "nummer");
  bind("f-ersatz", "ersatz", "checked");
  bind("f-gleis", "gleis", "int");
  bind("f-zeit", "zeit");
  bind("f-verspaetet", "verspaetet", "checked");
  bind("f-nichtEinsteigen", "nichtEinsteigen", "checked");
  bind("f-delay", "delay");
  bind("f-grund", "grund");
  bind("f-gleisNeu", "gleisNeu", "int");
  bind("f-faelltAus", "faelltAus", "checked");
  bind("f-entschuldigung", "entschuldigung", "checked");
  bind("o-gong", "gong", "checked");
  bind("o-hall", "hall", "checked");
  bind("o-gap", "gap", "int");
  $("#f-nummer").addEventListener("input", (e) => { e.target.value = e.target.value.replace(/\D/g, ""); });

  $$(".stepper button").forEach((b) => b.addEventListener("click", () => {
    const input = $("input", b.parentElement);
    input.value = Math.min(999, Math.max(1, (parseInt(input.value, 10) || 1) + Number(b.dataset.step)));
    input.dispatchEvent(new Event("input"));
  }));

  function syncInputs() {
    $("#f-gattung").value = state.gattung;
    $("#f-nummer").value = state.nummer;
    $("#f-ersatz").checked = state.ersatz;
    $("#f-gleis").value = state.gleis;
    $("#f-zeit").value = state.zeit;
    $("#f-verspaetet").checked = state.verspaetet;
    $("#f-nichtEinsteigen").checked = state.nichtEinsteigen;
    $("#f-delay").value = state.delay;
    $("#f-grund").value = state.grund;
    $("#f-gleisNeu").value = state.gleisNeu;
    $("#f-faelltAus").checked = state.faelltAus;
    $("#f-entschuldigung").checked = state.entschuldigung;
    $("#o-gong").checked = state.gong;
    $("#o-hall").checked = state.hall;
    $("#o-gap").value = state.gap;
    combos.forEach((cb) => cb.set(state[cb.field]));
  }

  // ------------------------------------------------------------ languages

  function renderLangs(type) {
    const seg = $("#lang-seg");
    let langs = state.langs.filter((l) => type.langs.includes(l));
    if (!langs.length) langs = [type.langs[0]];
    state.langs = langs;
    seg.classList.toggle("multi", langs.length > 1);
    seg.innerHTML = Object.entries(LANGS).map(([code, label]) => {
      const i = langs.indexOf(code);
      const disabled = !type.langs.includes(code);
      return `<button type="button" data-lang="${code}" class="${i >= 0 ? "is-on" : ""}" ${disabled ? "disabled" : ""}
        aria-pressed="${i >= 0}" title="${disabled ? "Für diesen Ansage-Typ nicht verfügbar" : "Sprache an/aus, Reihenfolge = Klickreihenfolge"}">
        <span class="ord">${i + 1}</span>${label}</button>`;
    }).join("");
  }
  $("#lang-seg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-lang]");
    if (!b || b.disabled) return;
    const l = b.dataset.lang;
    if (state.langs.includes(l)) {
      if (state.langs.length > 1) state.langs = state.langs.filter((x) => x !== l);
    } else state.langs = [...state.langs, l];
    changed();
  });

  // ------------------------------------------------------------ preview display

  const REGIO = new Set(["re", "rb", "ire", "rex", "me", "erb", "erx", "hex", "x", "alx", "brb", "nob", "ola", "via"]);

  function renderDisplay(type) {
    const c = library.catalog;
    const name = (id) => (id ? c.stationName(id) : "—");
    const hhmm = () => new Date().toTimeString().slice(0, 5);
    let time = state.zeit || "--:--", via = "", dest = "", ticker = [], strike = false, showTrain = true;

    switch (type.id) {
      case "einfahrt": case "bereit": case "info": {
        const vias = [state.via1, state.via2].filter(Boolean).map(name);
        via = vias.length ? "über " + vias.join(" – ") : "";
        dest = name(state.ziel);
        if (type.id === "bereit") ticker.push("Zug steht bereit");
        if (state.verspaetet && type.id === "einfahrt") ticker.push("Verspätung");
        break;
      }
      case "ankunft":
        via = "Aus"; dest = name(state.von);
        ticker.push(state.nichtEinsteigen ? "Zug endet hier · Bitte nicht einsteigen" : "Zug endet hier");
        if (state.verspaetet) ticker.push("Verspätung");
        break;
      case "tueren":
        time = hhmm(); showTrain = false; via = "Türen schließen selbsttätig"; dest = "Bitte einsteigen";
        break;
      case "durchfahrt":
        time = hhmm(); showTrain = false; via = `Vorsicht an Gleis ${state.gleis || ""}`; dest = "Zugdurchfahrt";
        ticker.push("Bitte zurückbleiben");
        break;
      case "sonder":
        time = hhmm(); showTrain = false; via = "Hinweis"; dest = state.sonder ? c.specialName(state.sonder) : "—";
        break;
    }
    if (type.id === "info") {
      if (state.delay) ticker.push(c.delayName(state.delay).replace(/min\b/, "Min.") + " später");
      if (state.gleisNeu) ticker.push(`Heute von Gleis ${state.gleisNeu}`);
      if (state.nurBis) ticker.push(`Fährt heute nur bis ${name(state.nurBis)}`);
      if (state.zusatzhalt) ticker.push(`Hält zusätzlich in ${name(state.zusatzhalt)}`);
      if (state.haltausfall) ticker.push(`Hält nicht in ${name(state.haltausfall)}`);
      if (state.faelltAus) { ticker.push("Fällt heute aus"); strike = true; }
      if (state.grund) ticker.push("Grund: " + c.reasonName(state.grund));
      if (!ticker.length) ticker.push("Information");
    }

    $("#d-time").textContent = time;
    const g = (state.gattung || "").toLowerCase();
    const badge = $("#d-badge");
    badge.textContent = c.gattungName(state.gattung) || "Zug";
    badge.className = "d-badge" + (g === "s" ? " is-sbahn" : REGIO.has(g) ? " is-regio" : "");
    $("#d-nr").textContent = state.nummer || "";
    $(".d-train").style.visibility = showTrain ? "" : "hidden";
    $("#d-gleis").textContent = state.gleisNeu && type.id === "info" ? state.gleisNeu : (state.gleis || "–");
    $("#d-via").textContent = via;
    const d = $("#d-dest");
    d.textContent = dest || "—";
    d.classList.toggle("is-strike", strike);
    const tick = $("#d-ticker");
    tick.hidden = !ticker.length;
    const text = ticker.length ? "+++ " + ticker.join(" +++ ") + " +++" : "";
    if ($("#d-ticker-text").textContent !== text) $("#d-ticker-text").textContent = text;
  }

  // ------------------------------------------------------------ chain

  let chain = [];

  function renderChain() {
    chain = resolveChain(compose({ ...state, gattungLabel: library.catalog.gattungName(state.gattung) }, library.catalog), library);
    const multi = new Set(chain.map((c) => c.lang).filter(Boolean)).size > 1;
    let lastLang = null;
    const html = [];
    chain.forEach((it, i) => {
      if (multi && it.lang && it.lang !== lastLang) {
        html.push(`<li class="lang-sep">${LANGS[it.lang]}</li>`);
        lastLang = it.lang;
      }
      html.push(`<li data-i="${i}" data-kind="${it.kind}" title="${esc(it.cands[0] || "")}"><span class="k"></span>${esc(it.label)}</li>`);
    });
    $("#chain").innerHTML = html.join("");
  }

  // ------------------------------------------------------------ main update

  function changed() {
    const type = TYPES.find((t) => t.id === state.type) || TYPES[0];
    state.type = type.id;
    $$(".type-btn").forEach((b) => {
      const on = b.dataset.type === type.id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on);
    });
    $("#type-title").textContent = type.name;
    $("#type-desc").textContent = type.desc;
    $$("[data-show]").forEach((el) => { el.hidden = !el.dataset.show.split(" ").includes(type.id); });
    $("#zeit-label").textContent = type.id === "ankunft" ? "Ankunft" : "Abfahrt";
    $$("#sonder-grid .chip").forEach((b) => b.classList.toggle("is-active", b.dataset.id === state.sonder));
    $("#o-gap-val").textContent = `${state.gap} ms`;
    renderLangs(type);
    renderDisplay(type);
    renderChain();
    save();
  }

  // ------------------------------------------------------------ playback

  let playing = null;

  function setPlayingUI(on) {
    const btn = $("#play-btn");
    btn.classList.toggle("is-stop", on);
    $("use", btn).setAttribute("href", on ? "#i-stop" : "#i-play");
    $("span", btn).textContent = on ? "Stopp" : "Ansage abspielen";
    $("#display").classList.toggle("is-playing", on);
    if (!on) {
      $$("#chain li.is-current").forEach((li) => li.classList.remove("is-current"));
      $("#d-progress-bar").style.width = "0";
    }
  }

  async function togglePlay() {
    if (playing) { playing.stop(); return; }
    const btn = $("#play-btn");
    btn.disabled = true;
    try {
      playing = await Player.play(library, chain, { gap: state.gap, hall: state.hall }, {
        onClip: (i) => {
          $$("#chain li.is-current").forEach((li) => li.classList.remove("is-current"));
          if (i >= 0) $(`#chain li[data-i="${i}"]`)?.classList.add("is-current");
        },
        onProgress: (p) => { $("#d-progress-bar").style.width = (p * 100).toFixed(1) + "%"; },
        onEnd: () => { playing = null; setPlayingUI(false); },
      });
      setPlayingUI(true);
    } catch (e) {
      console.error(e);
      playing = null;
      setPlayingUI(false);
      toast("Abspielen fehlgeschlagen: " + e.message, true);
    }
    btn.disabled = false;
  }

  async function exportWav() {
    const btn = $("#export-btn");
    btn.disabled = true;
    try {
      const blob = await Player.renderWav(library, chain, { gap: state.gap, hall: state.hall });
      const c = library.catalog;
      const parts = [TYPES.find((t) => t.id === state.type).name];
      if (["einfahrt", "ankunft", "bereit", "info"].includes(state.type)) {
        parts.push(c.gattungName(state.gattung) + (state.nummer || ""));
        parts.push(c.stationName(state.type === "ankunft" ? state.von : state.ziel));
      } else if (state.type === "sonder") parts.push(c.specialName(state.sonder));
      const name = parts.join("_").replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_|_$/g, "") + ".wav";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(`Gespeichert: ${name}`);
    } catch (e) {
      console.error(e);
      toast("Export fehlgeschlagen: " + e.message, true);
    }
    btn.disabled = false;
  }

  $("#play-btn").addEventListener("click", togglePlay);
  $("#export-btn").addEventListener("click", exportWav);
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && !e.target.closest("input, select, textarea, button") && !$("#view-generator").hidden) {
      e.preventDefault();
      togglePlay();
    }
  });

  // ------------------------------------------------------------ random announcement

  $("#random-btn").addEventListener("click", () => {
    const c = library.catalog;
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const big = c.stations.filter((s) => /Hbf$/.test(s.name));
    const pool = big.length > 10 ? big : c.stations;
    if (!pool.length) return;
    const main = c.gattungen.slice(0, 9);
    state.gattung = (pick(main) || {}).id || state.gattung;
    state.nummer = String(Math.floor(Math.random() * (Math.random() < .5 ? 999 : 9999)) + 1);
    state.gleis = Math.floor(Math.random() * 18) + 1;
    state.zeit = `${String(Math.floor(Math.random() * 24)).padStart(2, "0")}:${String(Math.floor(Math.random() * 59) + 1).padStart(2, "0")}`;
    state.ziel = pick(pool).id;
    state.von = pick(pool).id;
    state.via1 = Math.random() < .5 ? pick(pool).id : "";
    state.via2 = state.via1 && Math.random() < .4 ? pick(pool).id : "";
    if (state.type === "info") {
      state.delay = (pick(c.delays) || {}).id || "";
      state.grund = Math.random() < .7 ? (pick(c.reasons) || {}).id || "" : "";
      state.gleisNeu = Math.random() < .3 ? Math.floor(Math.random() * 18) + 1 : "";
      state.entschuldigung = Math.random() < .6;
    }
    if (state.type === "sonder") state.sonder = (pick(c.specials) || {}).id || "";
    syncInputs();
    changed();
  });

  // ------------------------------------------------------------ clip browser

  let browserIndex = null;
  let singleLi = null, singleCtl = null;

  function buildBrowserIndex() {
    browserIndex = [...library.paths].sort().map((p) => {
      const label = library.labelFor(p);
      return { p, label, key: fold(label + " " + p), lang: p.split("/")[1] };
    });
  }

  function renderBrowser() {
    if (!browserIndex) buildBrowserIndex();
    const q = fold($("#b-search").value.trim());
    const cat = $("#b-cat").value;
    const lang = $("#b-lang").value;
    const terms = q.split(/\s+/).filter(Boolean);
    const res = [];
    let total = 0;
    for (const it of browserIndex) {
      if (lang && it.lang !== lang) continue;
      if (cat && !it.p.includes("/" + cat)) continue;
      if (terms.length && !terms.every((t) => it.key.includes(t))) continue;
      total++;
      if (res.length < 250) res.push(it);
    }
    $("#b-meta").textContent = `${total.toLocaleString("de-DE")} Treffer${total > res.length ? `, die ersten ${res.length} werden angezeigt` : ""}`;
    $("#b-list").innerHTML = res.map((it) => `
      <li data-path="${esc(it.p)}">
        <button class="pb" type="button" aria-label="Abspielen"><svg><use href="#i-play"/></svg></button>
        <div style="min-width:0"><div class="name">${esc(it.label)}</div><div class="path">${esc(it.p)}</div></div>
        <span class="lang">${esc(LANGS[it.lang] || it.lang.toUpperCase())}</span>
      </li>`).join("");
  }

  let browserTimer;
  ["#b-search", "#b-cat", "#b-lang"].forEach((s) => $(s).addEventListener("input", () => {
    clearTimeout(browserTimer);
    browserTimer = setTimeout(renderBrowser, 120);
  }));
  $("#b-list").addEventListener("click", async (e) => {
    const li = e.target.closest("li[data-path]");
    if (!li || !e.target.closest(".pb")) return;
    if (singleCtl) singleCtl.stop();
    if (singleLi === li) { singleLi = null; return; }
    singleLi = li;
    li.classList.add("is-playing");
    $("use", li).setAttribute("href", "#i-stop");
    try {
      singleCtl = await Player.playSingle(library, li.dataset.path, () => {
        li.classList.remove("is-playing");
        $("use", li).setAttribute("href", "#i-play");
        if (singleLi === li) singleLi = null;
        singleCtl = null;
      });
    } catch (err) {
      li.classList.remove("is-playing");
      $("use", li).setAttribute("href", "#i-play");
      toast("Clip konnte nicht abgespielt werden: " + err.message, true);
    }
  });

  // ------------------------------------------------------------ views

  function showView(name) {
    $("#view-generator").hidden = name !== "generator";
    $("#view-browser").hidden = name !== "browser";
    $$(".tab").forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    if (name === "browser") renderBrowser();
  }
  $$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

  // ------------------------------------------------------------ loading clips (from the server)

  async function loadClips() {
    const cfg = window.BLECHELSE_CONFIG || {};
    const url = new URLSearchParams(location.search).get("clips") || cfg.clipsUrl || "clips/";
    await library.loadRemote(url);
    refreshCatalogUI();
    syncInputs();
    changed();
  }

  // ------------------------------------------------------------ theme + clock

  // Light is the default; dark only when chosen with the theme button.
  const themeBtn = $("#theme-btn");
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $("use", themeBtn).setAttribute("href", t === "dark" ? "#i-sun" : "#i-moon");
  }
  let theme = "light";
  try { if (localStorage.getItem("blechelse.theme") === "dark") theme = "dark"; } catch (_) {}
  applyTheme(theme);
  themeBtn.addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    try { localStorage.setItem("blechelse.theme", theme); } catch (_) {}
    applyTheme(theme);
  });

  (function clock() {
    const ticks = $(".clock-ticks");
    for (let i = 0; i < 60; i++) {
      const major = i % 5 === 0;
      const a = (i / 60) * Math.PI * 2;
      const r1 = major ? 33 : 38, r2 = 43;
      const l = document.createElementNS("http://www.w3.org/2000/svg", "line");
      l.setAttribute("x1", 50 + r1 * Math.sin(a)); l.setAttribute("y1", 50 - r1 * Math.cos(a));
      l.setAttribute("x2", 50 + r2 * Math.sin(a)); l.setAttribute("y2", 50 - r2 * Math.cos(a));
      if (major) l.setAttribute("class", "major");
      ticks.appendChild(l);
    }
    const h = $("#clock-h"), m = $("#clock-m"), s = $("#clock-s");
    const update = () => {
      const d = new Date();
      const sec = d.getSeconds();
      // station-clock style: the second hand sweeps in 58 s and waits at 12
      const secDeg = Math.min(360, ((sec + d.getMilliseconds() / 1000) / 58) * 360);
      s.setAttribute("transform", `rotate(${secDeg} 50 50)`);
      m.setAttribute("transform", `rotate(${d.getMinutes() * 6} 50 50)`);
      h.setAttribute("transform", `rotate(${(d.getHours() % 12) * 30 + d.getMinutes() * 0.5} 50 50)`);
      requestAnimationFrame(update);
    };
    update();
  })();

  // keep "current time" fields in the display fresh for door/through/special types
  setInterval(() => {
    if (["tueren", "durchfahrt", "sonder"].includes(state.type) && !$("#view-generator").hidden) {
      renderDisplay(TYPES.find((t) => t.id === state.type));
    }
  }, 15000);

  // ------------------------------------------------------------ start

  renderTypeStrip();
  refreshCatalogUI();
  syncInputs();
  changed();
  showView("generator");
  loadClips();
})();

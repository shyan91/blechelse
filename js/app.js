/* UI glue: form, preview display, clip chain, player, clip browser. */
(function () {
  "use strict";

  const { TYPES, LANGS, compose, resolveChain, phraseLabel } = window.Ansagen;
  const { Library, fold } = window.ClipLibrary;
  const Player = window.ClipPlayer;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

  const library = new Library();
  const STORAGE_KEY = "blechelse.studio.v1";

  // ------------------------------------------------------------ state

  /** A train in a list (coupled trains, connections, "fährt weiter als"). */
  const newTrain = (extra = {}) => ({ gattung: state.gattung || "ice", nummer: "", ziel: "", vias: [], ...extra });

  const DEFAULTS = {
    type: "einfahrt", langs: ["dt"], gong: true, hall: false, gap: 40,
    gattung: "ice", nummer: "1234", ersatz: false,
    ziel: "", vias: [], von: "",
    gleis: 7, zeit: "18:59", verspaetet: false, nichtEinsteigen: false,
    weiter: false, weiterZug: null,      // Ankunft: train continues as another train
    delay: "", gruende: [], gleisNeu: "", nurBis: "", zusatzhalt: [], haltausfall: [],
    faelltAus: false, entschuldigung: false,
    sonder: [],                           // special announcements, in order
    mit: [],                              // coupled trains
    teile: [],                            // splitting stations
    anschluesse: [],                      // connections: trains with zeit + gleis
    custom: [],                           // Baukasten: free sequence of clip paths
  };
  let state = { ...DEFAULTS };
  try { Object.assign(state, JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")); } catch (_) {}
  migrate(state);
  const save = () => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (_) {} };

  /** Convert settings saved by older versions of the page. */
  function migrate(s) {
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []);
    for (const k of ["vias", "zusatzhalt", "haltausfall", "teile", "gruende", "sonder", "mit", "anschluesse", "custom"]) s[k] = arr(s[k]);
    if ("via1" in s || "via2" in s) { s.vias = [s.via1, s.via2].filter(Boolean); delete s.via1; delete s.via2; }
    if ("grund" in s) { if (s.grund) s.gruende = [s.grund]; delete s.grund; }
    if ("mit1" in s) {
      for (const n of [1, 2]) {
        if (s.mit1 && s[`mit${n}`]) s.mit.push({ gattung: s[`mit${n}Gattung`], nummer: s[`mit${n}Nummer`], ziel: s[`mit${n}Ziel`], vias: arr(s[`mit${n}Via`]) });
      }
      if (s.teilung) s.teile = [s.teil1, s.teil2].filter(Boolean);
      for (const k of Object.keys(s)) if (/^(mit[12]|teil(ung|[12]))/.test(k)) delete s[k];
    }
    for (const t of [...s.mit, ...s.anschluesse, s.weiterZug].filter(Boolean)) {
      if (!Array.isArray(t.vias)) { t.vias = arr(t.via); delete t.via; }
    }
  }

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
      root.innerHTML = `<input type="text" role="combobox" aria-expanded="false" aria-autocomplete="list" placeholder="${esc(root.dataset.placeholder || "Bahnhof suchen …")}" />
        ${this.clearable ? '<button type="button" class="combo-clear" aria-label="Leeren" hidden><svg><use href="#i-x"/></svg></button>' : ""}
        <ul class="combo-list" role="listbox" hidden></ul>`;
      this.input = $("input", root);
      this.list = $("ul", root);
      this.clearBtn = $(".combo-clear", root);
      this.active = 0;

      this.input.addEventListener("focus", () => { this.input.select(); this.open(""); });
      this.input.addEventListener("input", () => this.open(this.input.value));
      this.input.addEventListener("keydown", (e) => this.key(e));
      this.input.addEventListener("blur", () => setTimeout(() => this.close(), 120));
      this.list.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const li = e.target.closest("li[data-id]");
        if (li) this.pick(li.dataset.id);
        else this.input.blur(); // e.g. "Kein Bahnhof gefunden": just close
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
        else this.close(); // no match: close the list instead of leaving it open
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

  // single-station fields in the static form (Nach, Von, Nur bis)
  const combos = $$("form > fieldset .combo, form .grid .combo")
    .filter((c) => !c.closest(".station-list, .train-list"))
    .map((root) => new Combo(root, (field, id) => {
      state[field] = id;
      // a field can appear in several types' forms (Nur bis: Einfahrt + Information); keep the copies in sync
      combos.forEach((cb) => { if (cb.field === field && cb.root !== root) cb.set(id); });
      changed();
    }));

  // ------------------------------------------------------------ list editors (unlimited entries)

  function addButton(label, onClick) {
    const b = el(`<button type="button" class="btn btn-secondary btn-sm sl-add"><svg><use href="#i-plus"/></svg>${esc(label)}</button>`);
    b.addEventListener("click", onClick);
    return b;
  }

  /** Editable list of stations, stored in `arr` (mutated in place). */
  function stationListEditor(box, arr, addLabel = "Bahnhof hinzufügen") {
    box.innerHTML = "";
    arr.forEach((id, i) => {
      const row = el(`<div class="sl-row"><div class="combo"></div>
        <button type="button" class="sl-remove" aria-label="Bahnhof entfernen" title="Entfernen"><svg><use href="#i-x"/></svg></button></div>`);
      new Combo($(".combo", row), (_, newId) => { arr[i] = newId; changed(); }).set(id);
      $(".sl-remove", row).addEventListener("click", () => { arr.splice(i, 1); stationListEditor(box, arr, addLabel); changed(); });
      box.appendChild(row);
    });
    box.appendChild(addButton(addLabel, () => {
      arr.push("");
      stationListEditor(box, arr, addLabel);
      changed();
      $$(".sl-row input", box).pop()?.focus();
    }));
  }

  /** Editable list of dropdown values (e.g. reasons), stored in `arr`. */
  function selectListEditor(box, arr, items, addLabel) {
    box.innerHTML = "";
    arr.forEach((id, i) => {
      const row = el(`<div class="sl-row"><select></select>
        <button type="button" class="sl-remove" aria-label="Entfernen" title="Entfernen"><svg><use href="#i-x"/></svg></button></div>`);
      const sel = $("select", row);
      fillSelect(sel, items, null, id);
      arr[i] = sel.value;
      sel.addEventListener("change", () => { arr[i] = sel.value; changed(); });
      $(".sl-remove", row).addEventListener("click", () => { arr.splice(i, 1); selectListEditor(box, arr, items, addLabel); changed(); });
      box.appendChild(row);
    });
    if (items.length) {
      box.appendChild(addButton(addLabel, () => {
        arr.push(items[0].id);
        selectListEditor(box, arr, items, addLabel);
        changed();
      }));
    }
  }

  /** One train: type, number, destination, any number of "über" stations, optional time/platform. */
  function trainCard(t, opts) {
    const c = library.catalog;
    if (!c.gattungen.find((g) => g.id === t.gattung)) t.gattung = c.gattungen[0]?.id || t.gattung || "";
    if (!Array.isArray(t.vias)) t.vias = [];
    const card = el(`<div class="train-card">
        ${opts.title || opts.onRemove ? `<div class="train-card-head"><strong>${esc(opts.title || "")}</strong>
          ${opts.onRemove ? '<button type="button" class="btn btn-ghost btn-sm" data-remove><svg><use href="#i-x"/></svg>Entfernen</button>' : ""}</div>` : ""}
        <div class="grid g-2">
          <label class="field"><span>Zuggattung</span><select data-k="gattung"></select></label>
          <label class="field"><span>Zugnummer</span><input data-k="nummer" inputmode="numeric" maxlength="6" placeholder="z. B. 5678" /></label>
          <div class="field field-wide"><span>Nach</span><div class="combo" data-field="ziel"></div></div>
          <div class="field field-wide"><span>Über <em class="opt">optional</em></span><div class="station-list"></div></div>
          ${opts.withTime ? '<label class="field"><span>Abfahrt</span><input data-k="zeit" type="time" /></label>' : ""}
          ${opts.withGleis ? '<label class="field"><span>Gleis</span><input data-k="gleis" type="number" min="1" max="999" /></label>' : ""}
        </div>
      </div>`);
    const sel = $("select", card);
    fillSelect(sel, c.gattungen, null, t.gattung);
    sel.addEventListener("change", () => { t.gattung = sel.value; changed(); });
    for (const input of $$("input[data-k]", card)) {
      const k = input.dataset.k;
      input.value = t[k] ?? "";
      input.addEventListener("input", () => {
        if (k === "nummer") input.value = input.value.replace(/\D/g, "");
        t[k] = k === "gleis" ? (parseInt(input.value, 10) || "") : input.value;
        changed();
      });
    }
    new Combo($(".combo", card), (_, id) => { t.ziel = id; changed(); }).set(t.ziel);
    stationListEditor($(".station-list", card), t.vias, "Zwischenhalt hinzufügen");
    $("[data-remove]", card)?.addEventListener("click", opts.onRemove);
    return card;
  }

  /** Editable list of trains, stored in `arr`. */
  function trainListEditor(box, arr, opts) {
    box.innerHTML = "";
    arr.forEach((t, i) => {
      box.appendChild(trainCard(t, {
        ...opts,
        title: opts.title(i),
        onRemove: () => { arr.splice(i, 1); trainListEditor(box, arr, opts); changed(); },
      }));
    });
    box.appendChild(addButton(opts.addLabel, () => {
      arr.push(opts.create());
      trainListEditor(box, arr, opts);
      changed();
      $$(".train-card", box).pop()?.querySelector("input")?.focus();
    }));
  }

  function renderLists() {
    for (const box of $$("form > fieldset .station-list[data-list], form .grid .station-list[data-list]")) {
      stationListEditor(box, state[box.dataset.list], box.dataset.add || "Bahnhof hinzufügen");
    }
    selectListEditor($("#gruende-list"), state.gruende, library.catalog.reasons, "Grund hinzufügen");
    trainListEditor($("#mit-list"), state.mit, {
      title: (i) => `Zug ${i + 2}`, addLabel: "Zug hinzufügen", create: () => newTrain(),
    });
    trainListEditor($("#anschluss-list"), state.anschluesse, {
      title: (i) => `Anschluss ${i + 1}`, addLabel: "Anschluss hinzufügen", withTime: true, withGleis: true,
      create: () => newTrain({ zeit: state.zeit || "18:59", gleis: 1 }),
    });
    if (!state.weiterZug) state.weiterZug = newTrain({ zeit: state.zeit || "18:59" });
    const wbox = $("#weiter-card");
    wbox.innerHTML = "";
    wbox.appendChild(trainCard(state.weiterZug, { withTime: true }));
  }

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

    // drop saved stations / ids this clip folder doesn't have (only once the lists are loaded)
    if (c.stations.length) {
      const ok = (id) => !id || c.stationMap.has(id);
      for (const f of ["ziel", "von", "nurBis"]) if (!ok(state[f])) state[f] = "";
      for (const k of ["vias", "zusatzhalt", "haltausfall", "teile"]) state[k] = state[k].filter(ok);
      for (const t of [...state.mit, ...state.anschluesse, state.weiterZug].filter(Boolean)) {
        if (!ok(t.ziel)) t.ziel = "";
        t.vias = (t.vias || []).filter(ok);
      }
    }
    if (c.reasons.length) state.gruende = state.gruende.filter((g) => c.reasons.some((r) => r.id === g));
    if (c.specials.length) state.sonder = state.sonder.filter((x) => c.specials.some((r) => r.id === x));

    const pickByName = (re) => (c.stations.find((s) => re.test(s.name)) || c.stations[0] || {}).id || "";
    if (!state.ziel) state.ziel = pickByName(/^München Hbf$/);
    if (!state.von) state.von = pickByName(/^Hamburg Hbf$/);
    if (!state.sonder.length && c.specials[0]) state.sonder = [c.specials[0].id];

    $("#sonder-grid").innerHTML = c.specials.length
      ? c.specials.map((s) => `<button type="button" class="chip" data-id="${esc(s.id)}"><span class="ord"></span>${esc(s.name)}</button>`).join("")
      : `<p class="muted small">Keine Sonderansagen (nza/) im Clip-Ordner gefunden.</p>`;
    $$("#sonder-grid .chip").forEach((b) => b.addEventListener("click", () => {
      const id = b.dataset.id;
      state.sonder = state.sonder.includes(id) ? state.sonder.filter((x) => x !== id) : [...state.sonder, id];
      changed();
    }));

    browserIndex = null;
    if (!$("#view-custom").hidden) { renderCustomSearch(); renderSeq(); }
    if (!$("#view-browser").hidden) renderBrowser();
  }

  // ------------------------------------------------------------ bind inputs

  const bind = (id, key, kind = "value") => {
    const input = $("#" + id);
    const read = () => {
      state[key] = kind === "checked" ? input.checked : kind === "int" ? (parseInt(input.value, 10) || "") : input.value;
      changed();
    };
    input.addEventListener(kind === "checked" ? "change" : "input", read);
    if (kind !== "checked") input.addEventListener("change", read);
  };
  bind("f-gattung", "gattung");
  bind("f-nummer", "nummer");
  bind("f-ersatz", "ersatz", "checked");
  bind("f-gleis", "gleis", "int");
  bind("f-zeit", "zeit");
  bind("f-verspaetet", "verspaetet", "checked");
  bind("f-nichtEinsteigen", "nichtEinsteigen", "checked");
  bind("f-weiter", "weiter", "checked");
  bind("f-delay", "delay");
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
    $("#f-weiter").checked = state.weiter;
    $("#f-delay").value = state.delay;
    $("#f-gleisNeu").value = state.gleisNeu;
    $("#f-faelltAus").checked = state.faelltAus;
    $("#f-entschuldigung").checked = state.entschuldigung;
    $("#o-gong").checked = state.gong;
    $("#o-hall").checked = state.hall;
    $("#o-gap").value = state.gap;
    combos.forEach((cb) => cb.set(state[cb.field]));
    renderLists();
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
  const badgeClass = (g) => (g === "s" ? " is-sbahn" : REGIO.has(g) ? " is-regio" : "");

  function renderDisplay(type) {
    const c = library.catalog;
    const name = (id) => (id ? c.stationName(id) : "—");
    const listText = (ids) => {
      const n = (ids || []).filter(Boolean).map(name);
      return n.length > 1 ? n.slice(0, -1).join(", ") + " und " + n[n.length - 1] : n[0] || "";
    };
    const viaText = (ids) => {
      const n = (ids || []).filter(Boolean).map(name);
      return n.length ? "über " + n.join(" – ") : "";
    };
    const hhmm = () => new Date().toTimeString().slice(0, 5);
    let time = state.zeit || "--:--", via = "", dest = "", ticker = [], strike = false, showTrain = true;
    let rows = []; // extra rows: coupled trains or connections

    switch (type.id) {
      case "einfahrt": case "bereit": case "info":
        via = viaText(state.vias);
        dest = name(state.ziel);
        if (type.id === "bereit") ticker.push("Zug steht bereit");
        if (state.verspaetet && type.id === "einfahrt") ticker.push("Verspätung");
        if (state.nurBis && type.id === "einfahrt") ticker.push(`Fährt heute nur bis ${name(state.nurBis)}`);
        rows = state.mit.map((t) => ({ g: t.gattung, nr: t.nummer, to: name(t.ziel) }));
        if (state.teile.some(Boolean) && type.id !== "info") ticker.push("Zugteilung in " + listText(state.teile));
        break;
      case "ankunft":
        via = "Aus"; dest = name(state.von);
        if (state.weiter && state.weiterZug) {
          const w = state.weiterZug;
          ticker.push(`Fährt weiter als ${c.gattungName(w.gattung)} ${w.nummer || ""} nach ${name(w.ziel)} um ${w.zeit || "--:--"}`.replace(/\s+/g, " "));
        } else {
          ticker.push(state.nichtEinsteigen ? "Zug endet hier · Bitte nicht einsteigen" : "Zug endet hier");
          if (state.verspaetet) ticker.push("Verspätung");
        }
        break;
      case "anschluss":
        time = hhmm(); showTrain = false; via = "Ihre Anschlüsse";
        dest = state.anschluesse.length === 1 ? "1 Anschlusszug" : `${state.anschluesse.length || "Keine"} Anschlusszüge`;
        rows = state.anschluesse.map((a) => ({ g: a.gattung, nr: a.nummer, to: name(a.ziel), meta: `${a.zeit || "--:--"} · Gl. ${a.gleis || "–"}` }));
        break;
      case "tueren":
        time = hhmm(); showTrain = false; via = "Türen schließen selbsttätig"; dest = "Bitte einsteigen";
        break;
      case "durchfahrt":
        time = hhmm(); showTrain = false; via = `Vorsicht an Gleis ${state.gleis || ""}`; dest = "Zugdurchfahrt";
        ticker.push("Bitte zurückbleiben");
        break;
      case "sonder": {
        time = hhmm(); showTrain = false;
        const names = state.sonder.map((id) => c.specialName(id));
        via = names.length > 1 ? "Hinweise" : "Hinweis";
        dest = names[0] || "—";
        if (names.length > 1) ticker.push(...names);
        break;
      }
    }
    if (type.id === "info") {
      if (state.delay) ticker.push(c.delayName(state.delay).replace(/min\b/, "Min.") + " später");
      if (state.gleisNeu) ticker.push(`Heute von Gleis ${state.gleisNeu}`);
      if (state.nurBis) ticker.push(`Fährt heute nur bis ${name(state.nurBis)}`);
      if (state.zusatzhalt.some(Boolean)) ticker.push(`Hält zusätzlich in ${listText(state.zusatzhalt)}`);
      if (state.haltausfall.some(Boolean)) ticker.push(`Hält nicht in ${listText(state.haltausfall)}`);
      if (state.faelltAus) { ticker.push("Fällt heute aus"); strike = true; }
      if (state.gruende.length) ticker.push("Grund: " + state.gruende.map((g) => c.reasonName(g)).join(", "));
      if (!ticker.length) ticker.push("Information");
    }

    $("#d-time").textContent = time;
    const g = (state.gattung || "").toLowerCase();
    const badge = $("#d-badge");
    badge.textContent = c.gattungName(state.gattung) || "Zug";
    badge.className = "d-badge" + badgeClass(g);
    $("#d-nr").textContent = state.nummer || "";
    $(".d-train").style.visibility = showTrain ? "" : "hidden";
    $(".d-platform").style.visibility = type.id === "anschluss" || type.id === "sonder" ? "hidden" : "";
    $("#d-gleis").textContent = state.gleisNeu && type.id === "info" ? state.gleisNeu : (state.gleis || "–");
    $("#d-via").textContent = via;
    const d = $("#d-dest");
    d.textContent = dest || "—";
    d.classList.toggle("is-strike", strike);
    const rowsEl = $("#d-coupled");
    rowsEl.hidden = !rows.length;
    rowsEl.innerHTML = rows.map((r) => `<div><span class="d-badge${badgeClass(r.g)}">${esc(c.gattungName(r.g))}</span>` +
      `<span class="nr">${esc(r.nr || "")}</span><span class="to">${esc(r.to)}</span>` +
      (r.meta ? `<span class="meta">${esc(r.meta)}</span>` : "") + `</div>`).join("");
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
    $$("[data-show]").forEach((x) => { x.hidden = !x.dataset.show.split(" ").includes(type.id); });
    $$("[data-if]").forEach((x) => { x.hidden = !state[x.dataset.if]; });
    // with "fährt weiter als" the arrival time/flags don't apply
    const weiter = type.id === "ankunft" && state.weiter;
    $("#f-zeit").closest(".field").hidden = $("#f-zeit").closest(".field").hidden || weiter;
    $("#f-nichtEinsteigen").closest(".switch").hidden = $("#f-nichtEinsteigen").closest(".switch").hidden || weiter;
    $("#zeit-label").textContent = type.id === "ankunft" ? "Ankunft" : "Abfahrt";
    $$("#sonder-grid .chip").forEach((b) => {
      const i = state.sonder.indexOf(b.dataset.id);
      b.classList.toggle("is-active", i >= 0);
      $(".ord", b).textContent = i >= 0 && state.sonder.length > 1 ? `${i + 1}.` : "";
    });
    $("#o-gap-val").textContent = $("#k-gap-val").textContent = `${state.gap} ms`;
    if (document.activeElement !== $("#o-gap")) $("#o-gap").value = state.gap;
    if (document.activeElement !== $("#k-gap")) $("#k-gap").value = state.gap;
    $("#o-hall").checked = $("#k-hall").checked = state.hall;
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
      } else if (state.type === "sonder" && state.sonder[0]) parts.push(c.specialName(state.sonder[0]));
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
    const rnd = (n) => Math.floor(Math.random() * n);
    const pick = (arr) => arr[rnd(arr.length)];
    const big = c.stations.filter((s) => /Hbf$/.test(s.name));
    const pool = big.length > 10 ? big : c.stations;
    if (!pool.length) return;
    const main = c.gattungen.slice(0, 9);
    const stations = (n) => Array.from({ length: n }, () => pick(pool).id);
    const time = () => `${String(rnd(24)).padStart(2, "0")}:${String(rnd(59) + 1).padStart(2, "0")}`;
    const randTrain = (extra) => ({ gattung: (pick(main) || {}).id || state.gattung, nummer: String(rnd(9999) + 1), ziel: pick(pool).id, vias: stations(rnd(2)), ...extra });
    state.gattung = (pick(main) || {}).id || state.gattung;
    state.nummer = String(rnd(Math.random() < .5 ? 999 : 9999) + 1);
    state.gleis = rnd(18) + 1;
    state.zeit = time();
    state.ziel = pick(pool).id;
    state.von = pick(pool).id;
    state.vias = stations(rnd(4));
    if (state.type === "info") {
      state.delay = (pick(c.delays) || {}).id || "";
      state.gruende = c.reasons.length && Math.random() < .7 ? [pick(c.reasons).id] : [];
      state.gleisNeu = Math.random() < .3 ? rnd(18) + 1 : "";
      state.entschuldigung = Math.random() < .6;
    }
    if (state.type === "anschluss") state.anschluesse = Array.from({ length: rnd(3) + 1 }, () => randTrain({ zeit: time(), gleis: rnd(18) + 1 }));
    if (state.type === "sonder" && c.specials.length) state.sonder = [pick(c.specials).id];
    syncInputs();
    changed();
  });

  // ------------------------------------------------------------ clip browser

  let browserIndex = null;
  let singleLi = null, singleCtl = null;

  /** Best readable name for any clip path. */
  function clipLabel(p) {
    const ph = phraseLabel(p);
    if (ph) return ph;
    const l = library.labelFor(p);
    if (l === "module" || l === "literal" || !l) {
      const segs = p.split("/");
      return (p.startsWith("/gong/") ? "Gong " : "Baustein ") + segs[segs.length - 1].replace(/\.wav$/i, "");
    }
    // manifest descriptions carry a category prefix ("Station …", "grund: …"); show just the name
    return l.replace(/^(Station|Zuggattung)\s+/, "").replace(/^(verspaetung|grund|sonderansagen):\s*/, "")
      .replace(/^Zahl (\d+)_$/, "Zahl $1 … (mit Rest)");
  }

  function buildBrowserIndex() {
    browserIndex = [...library.paths].sort().map((p) => {
      const label = clipLabel(p);
      return { p, label, key: fold(label + " " + p), lang: p.split("/")[1] };
    });
  }

  /** Search the clip index; returns { res (max 250), total }. */
  function searchClips(prefix) {
    if (!browserIndex) buildBrowserIndex();
    const q = fold($(`#${prefix}-search`).value.trim());
    const cat = $(`#${prefix}-cat`).value;
    const lang = $(`#${prefix}-lang`).value;
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
    $(`#${prefix}-meta`).textContent = `${total.toLocaleString("de-DE")} Treffer${total > res.length ? `, die ersten ${res.length} werden angezeigt` : ""}`;
    return res;
  }

  const clipRow = (it, extra = "") => `
      <li data-path="${esc(it.p)}">
        <button class="pb" type="button" aria-label="Anhören"><svg><use href="#i-play"/></svg></button>
        <div style="min-width:0"><div class="name">${esc(it.label)}</div><div class="path">${esc(it.p)}</div></div>
        <div class="actions"><span class="lang">${esc(LANGS[it.lang] || it.lang.toUpperCase())}</span>${extra}</div>
      </li>`;

  function renderBrowser() {
    $("#b-list").innerHTML = searchClips("b").map((it) => clipRow(it)).join("");
  }

  let browserTimer;
  ["#b-search", "#b-cat", "#b-lang"].forEach((s) => $(s).addEventListener("input", () => {
    clearTimeout(browserTimer);
    browserTimer = setTimeout(renderBrowser, 120);
  }));

  /** Preview a single clip from a result list (play button toggles). */
  async function previewClick(e) {
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
  }
  $("#b-list").addEventListener("click", previewClick);

  // ------------------------------------------------------------ Baukasten (free clip sequence)

  let seqPlaying = null;
  const seqItems = () => state.custom.map((p) => ({ label: clipLabel(p), cands: [p], kind: "custom" }));

  function renderCustomSearch() {
    const res = searchClips("k");
    $("#k-list").innerHTML = res.map((it) => clipRow(it,
      `<button class="add${state.custom.includes(it.p) ? " is-added" : ""}" type="button" aria-label="Hinzufügen" title="Zur eigenen Ansage hinzufügen"><svg><use href="#i-plus"/></svg></button>`)).join("");
  }

  function renderSeq() {
    const list = $("#k-seq");
    list.innerHTML = state.custom.map((p, i) => `
      <li draggable="true" data-i="${i}">
        <span class="grip" title="Ziehen zum Verschieben"><svg><use href="#i-grip"/></svg></span>
        <span class="no">${i + 1}</span>
        <div style="min-width:0"><div class="name">${esc(clipLabel(p))}</div><div class="path">${esc(p)}</div></div>
        <span class="ops">
          <button type="button" data-op="up" aria-label="Nach oben" ${i === 0 ? "disabled" : ""}><svg><use href="#i-up"/></svg></button>
          <button type="button" data-op="down" aria-label="Nach unten" ${i === state.custom.length - 1 ? "disabled" : ""}><svg><use href="#i-down"/></svg></button>
          <button type="button" data-op="remove" aria-label="Entfernen"><svg><use href="#i-x"/></svg></button>
        </span>
      </li>`).join("");
    const n = state.custom.length;
    $("#k-count").textContent = n ? `${n} Clip${n === 1 ? "" : "s"}` : "";
    $("#k-empty").hidden = n > 0;
    $$("#k-list .add").forEach((b) => b.classList.toggle("is-added", state.custom.includes(b.closest("li").dataset.path)));
    save();
  }

  function moveSeq(from, to) {
    if (to < 0 || to >= state.custom.length || from === to) return;
    const [x] = state.custom.splice(from, 1);
    state.custom.splice(to, 0, x);
    renderSeq();
  }

  let customTimer;
  ["#k-search", "#k-cat", "#k-lang"].forEach((s) => $(s).addEventListener("input", () => {
    clearTimeout(customTimer);
    customTimer = setTimeout(renderCustomSearch, 120);
  }));
  $("#k-list").addEventListener("click", (e) => {
    const add = e.target.closest(".add");
    if (add) {
      state.custom.push(add.closest("li").dataset.path);
      renderSeq();
      const seq = $("#k-seq");
      seq.scrollTop = seq.scrollHeight;
      return;
    }
    previewClick(e);
  });
  $("#k-seq").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-op]");
    if (!b) return;
    const i = Number(b.closest("li").dataset.i);
    if (b.dataset.op === "up") moveSeq(i, i - 1);
    else if (b.dataset.op === "down") moveSeq(i, i + 1);
    else { state.custom.splice(i, 1); renderSeq(); }
  });

  // drag & drop reordering
  let dragFrom = -1;
  $("#k-seq").addEventListener("dragstart", (e) => {
    const li = e.target.closest("li[data-i]");
    if (!li) return;
    dragFrom = Number(li.dataset.i);
    li.classList.add("is-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(dragFrom));
  });
  $("#k-seq").addEventListener("dragover", (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    $$("#k-seq li").forEach((li) => li.classList.remove("drop-before"));
    e.target.closest("li[data-i]")?.classList.add("drop-before");
  });
  $("#k-seq").addEventListener("drop", (e) => {
    if (dragFrom < 0) return;
    e.preventDefault();
    const li = e.target.closest("li[data-i]");
    let to = li ? Number(li.dataset.i) : state.custom.length - 1;
    if (li && to > dragFrom) to -= 1; // insert before the target
    moveSeq(dragFrom, to);
  });
  $("#k-seq").addEventListener("dragend", () => {
    dragFrom = -1;
    $$("#k-seq li").forEach((li) => li.classList.remove("drop-before", "is-dragging"));
  });

  $("#k-clear").addEventListener("click", () => { state.custom = []; renderSeq(); });

  function setSeqPlayingUI(on) {
    const btn = $("#k-play");
    btn.classList.toggle("is-stop", on);
    $("use", btn).setAttribute("href", on ? "#i-stop" : "#i-play");
    $("span", btn).textContent = on ? "Stopp" : "Abspielen";
    if (!on) $$("#k-seq li.is-current").forEach((li) => li.classList.remove("is-current"));
  }

  $("#k-play").addEventListener("click", async () => {
    if (seqPlaying) { seqPlaying.stop(); return; }
    if (!state.custom.length) return;
    if (playing) playing.stop();
    const btn = $("#k-play");
    btn.disabled = true;
    try {
      seqPlaying = await Player.play(library, seqItems(), { gap: state.gap, hall: state.hall }, {
        onClip: (i) => {
          $$("#k-seq li.is-current").forEach((li) => li.classList.remove("is-current"));
          if (i >= 0) $(`#k-seq li[data-i="${i}"]`)?.classList.add("is-current");
        },
        onEnd: () => { seqPlaying = null; setSeqPlayingUI(false); },
      });
      setSeqPlayingUI(true);
    } catch (e) {
      seqPlaying = null;
      setSeqPlayingUI(false);
      toast("Abspielen fehlgeschlagen: " + e.message, true);
    }
    btn.disabled = false;
  });

  $("#k-export").addEventListener("click", async () => {
    if (!state.custom.length) return;
    const btn = $("#k-export");
    btn.disabled = true;
    try {
      const blob = await Player.renderWav(library, seqItems(), { gap: state.gap, hall: state.hall });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "Eigene_Ansage.wav";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("Gespeichert: Eigene_Ansage.wav");
    } catch (e) {
      toast("Export fehlgeschlagen: " + e.message, true);
    }
    btn.disabled = false;
  });

  // gap + hall are shared with the generator
  bind("k-hall", "hall", "checked");
  bind("k-gap", "gap", "int");

  // ------------------------------------------------------------ views

  function showView(name) {
    $("#view-generator").hidden = name !== "generator";
    $("#view-browser").hidden = name !== "browser";
    $("#view-custom").hidden = name !== "custom";
    $$(".tab").forEach((t) => {
      const on = t.dataset.view === name;
      t.classList.toggle("is-active", on);
      t.setAttribute("aria-selected", on);
    });
    if (name === "browser") renderBrowser();
    if (name === "custom") { renderCustomSearch(); renderSeq(); }
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

  // keep "current time" fields in the display fresh for types that show the clock time
  setInterval(() => {
    if (["tueren", "durchfahrt", "sonder", "anschluss"].includes(state.type) && !$("#view-generator").hidden) {
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

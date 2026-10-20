/*
 * Builds the list of clips that make up an announcement.
 *
 * Every announcement is a chain of short clips. A chain item looks like
 *   { label: "Gleis", cands: ["/dt/module_3_1/016.wav"], kind: "phrase" }
 * where `cands` lists alternative paths (first one that exists is used).
 * resolveChain() then checks which clips the loaded library really has.
 */
(function () {
  "use strict";

  // Spoken building blocks: folder + clip code per language (null = not recorded).
  const PHRASES = {
    gleis:           { f: "module_3_1", dt: "016",  en: "023",  label: "Gleis" },
    einfahrt:        { f: "module_3_1", dt: "012",  en: "022",  label: "Einfahrt" },
    ersatz:          { f: "module_3_1", dt: "008",  en: "025",  label: "Ersatzzug" },
    nach:            { f: "module",     dt: "0054", en: "0049", label: "nach" },
    von:             { f: "module",     dt: "0065", en: "0012", label: "von" },
    ueber:           { f: "module_3_1", dt: "035",  en: "035",  label: "über" },
    und:             { f: "module_3_1", dt: "036",  en: "002",  label: "und" },
    abfahrt:         { f: "module_3_1", dt: "001",  en: "008",  label: "Abfahrt" },
    abfahrtUrspr:    { f: "module_3_1", dt: "002",  en: "027",  label: "planmäßige Abfahrt" },
    ankunft:         { f: "module",     dt: "0004", en: "0001", label: "Ankunft" },
    ankunftUrspr:    { f: "module_3_1", dt: "005",  en: "026",  label: "planmäßige Ankunft" },
    nichtEinsteigen: { f: "module_3_1", dt: "007",  en: "024",  label: "Bitte nicht einsteigen" },
    vorsicht:        { f: "module_3_1", dt: "046",  en: "005",  label: "Vorsicht bei der Einfahrt" },
    steht:           { f: "module_3_1", dt: "034",  en: "000",  label: "steht bereit" },
    info:            { f: "module_3_1", dt: "030",  en: "020",  label: "Information zu" },
    gleiswechsel:    { f: "module",     dt: "0323", en: "0073", label: "heute von Gleis" },
    nurBis:          { f: "module_3_1", dt: "021",  en: "011",  label: "fährt heute nur bis" },
    nurBisEnde:      { f: "module_3_1", dt: "044",  en: "021",  label: "(Ende)" },
    zusatzhalt:      { f: "module_3_1", dt: "020",  en: "037",  label: "hält zusätzlich in" },
    haltausfall:     { f: "module_3_1", dt: "022",  en: "038",  label: "hält nicht in" },
    faelltAus:       { f: "module_3_1", dt: "014",  en: "015",  label: "fällt heute aus" },
    entschuldigung:  { f: "module_3_1", dt: "042",  en: "036",  label: "Entschuldigung" },
    mit:             { f: "module_3_1", dt: "031",  en: "039",  label: "zusammen mit" },
    weiterAls:       { f: "module_3_1", dt: "040",  en: "006",  label: "fährt weiter als" },
    anschluesse:     { f: "module_3_1", dt: "026",  en: "040",  label: "Ihre Anschlüsse" },
    vonGleis:        { f: "module_3_1", dt: "039",  en: "014",  label: "von Gleis" },
    teilung:         { f: "module_3_1", dt: "045",  en: "030",  label: "Zugteilung in" },
    teilungEnde:     { f: "module_3_1", dt: "015",  en: "000",  label: "(Zugteilung)" },
    tuerenGleis:     { f: "module",     dt: "0048", en: "0021", label: "Am Gleis" },
    tuerenEnde:      { f: "module",     dt: "0011", en: "0029", label: "Türen schließen" },
    durchfahrt1:     { f: "module",     dt: "0153", en: null,   label: "Gleis" },
    durchfahrt2:     { f: "module",     dt: "0155", en: null,   label: "Vorsicht an Gleis" },
    durchfahrt3:     { f: "module",     dt: "0159", en: null,   label: "Zugdurchfahrt" },
  };

  const GONG = { label: "Gong", cands: ["/gong/513/513_2.wav"], kind: "gong" };
  const GONG_DOORS = { label: "Gong", cands: ["/gong/klangtyp_konvent/ceg-gongs2.wav", "/gong/513/513_2.wav"], kind: "gong" };

  // Announcement types shown in the UI.
  const TYPES = [
    { id: "einfahrt",   name: "Einfahrt",       icon: "train",   langs: ["dt", "en"],
      desc: "Zug fährt ein und fährt weiter" },
    { id: "ankunft",    name: "Ankunft",        icon: "arrive",  langs: ["dt", "en"],
      desc: "Zug endet hier" },
    { id: "bereit",     name: "Bereitstellung", icon: "ready",   langs: ["dt", "en"],
      desc: "Zug steht am Gleis bereit" },
    { id: "info",       name: "Information",    icon: "info",    langs: ["dt", "en"],
      desc: "Verspätung, Gleiswechsel, Ausfall" },
    { id: "anschluss",  name: "Anschlüsse",     icon: "connect", langs: ["dt", "en"],
      desc: "Anschlusszüge mit Zeit und Gleis" },
    { id: "tueren",     name: "Abfahrt",        icon: "doors",   langs: ["dt", "en"],
      desc: "Einsteigen, Türen schließen" },
    { id: "durchfahrt", name: "Durchfahrt",     icon: "through", langs: ["dt"],
      desc: "Zug fährt ohne Halt durch" },
    { id: "sonder",     name: "Sonderansage",   icon: "speaker", langs: ["dt", "en", "fr"],
      desc: "Gepäck, Rauchverbot, Hinweise" },
  ];

  const LANGS = { dt: "DE", en: "EN", fr: "FR" };

  // ---------------------------------------------------------------- helpers

  function phrase(key, lang) {
    const p = PHRASES[key];
    const code = p[lang];
    return { label: p.label, cands: code ? [`/${lang}/${p.f}/${code}.wav`] : [], kind: "phrase" };
  }

  /** Split a number into the clips the voice can say: 0–99, full hundreds/thousands, or "hundreds_" + rest. */
  function numberParts(n) {
    n = Math.floor(Math.abs(Number(n)));
    if (!Number.isFinite(n)) return [];
    if (n < 100 || (n % 100 === 0 && n < 10000)) return [String(n)];
    if (n < 1000) return [`${n - (n % 100)}_`, String(n % 100)];
    // 1000+ that is not a full hundred: say it in pairs ("12" "34")
    return trainNumberParts(String(n));
  }

  /** Train numbers are read in groups, e.g. 1234 → 12 · 34, 79123 → 791 · 23. */
  function trainNumberParts(str) {
    const digits = String(str || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
    if (!digits) return [];
    const n = Number(digits);
    if (digits.length <= 3) return numberParts(n);
    if (digits.length === 4 && n % 100 === 0) return [String(n)];
    let groups;
    if (digits.length === 4) groups = [digits.slice(0, 2), digits.slice(2)];
    else if (digits.length === 5) groups = [digits.slice(0, 3), digits.slice(3)];
    else groups = digits.match(/.{1,2}/g);
    const out = [];
    groups.forEach((g, i) => {
      // a group like "05" after the first one is read as "null fünf"
      if (i > 0 && g.length > 1 && g[0] === "0") {
        out.push("0", ...numberParts(Number(g.slice(1))));
      } else {
        out.push(...numberParts(Number(g)));
      }
    });
    return out;
  }

  function number(n, lang, pitch, isTrainNo) {
    const parts = isTrainNo ? trainNumberParts(n) : numberParts(n);
    return parts.map((p) => ({
      label: p.replace("_", ""),
      cands: [`/${lang}/gleise_zahlen/${pitch}/${p}.wav`],
      kind: "number",
    }));
  }

  function time(hhmm, lang) {
    const [h, m] = String(hhmm || "00:00").split(":").map((x) => parseInt(x, 10) || 0);
    const hh = String(h).padStart(2, "0");
    const mm = String(m).padStart(2, "0");
    return [
      { label: `${h} Uhr`, cands: [`/${lang}/zeiten/stunden/hoch/${hh}.wav`], kind: "time" },
      { label: mm, cands: [`/${lang}/zeiten/minuten/tief/${mm}.wav`], kind: "time" },
    ];
  }

  function station(id, lang, variants, catalog, fallbackLabel) {
    if (!id) return { label: fallbackLabel || "Bahnhof wählen", cands: [], kind: "station" };
    return {
      label: catalog.stationName(id),
      cands: variants.map((v) => `/${lang}/ziele/${v}/${id}`),
      kind: "station",
    };
  }

  const END = ["variante2/tief"];
  const MID = ["variante2/hoch"];
  const VIA_END = ["variante1/tief", "variante2/tief"];

  function train(s, lang, withErsatz) {
    const out = [];
    if (withErsatz && s.ersatz) out.push(phrase("ersatz", lang));
    const g = (s.gattung || "").toLowerCase();
    out.push({
      label: s.gattungLabel || (g ? g.toUpperCase() : "Zug"),
      cands: g ? [`/${lang}/zuggattungen/hoch/${g}.wav`] : [],
      kind: "train",
    });
    if (s.nummer) out.push(...number(s.nummer, lang, "hoch", true));
    return out;
  }

  /** "nach Ziel" or "nach Ziel über A, B und C" (any number of stations in between) */
  function destination(s, lang, catalog) {
    const vias = (s.vias || []).filter(Boolean);
    const out = [phrase("nach", lang)];
    if (!vias.length) {
      out.push(station(s.ziel, lang, END, catalog, "Ziel wählen"));
      return out;
    }
    out.push(station(s.ziel, lang, MID, catalog, "Ziel wählen"), phrase("ueber", lang));
    vias.slice(0, -1).forEach((id) => out.push(station(id, lang, MID, catalog)));
    if (vias.length > 1) out.push(phrase("und", lang));
    out.push(station(vias[vias.length - 1], lang, VIA_END, catalog));
    return out;
  }

  /** Any number of trains travelling together with the main one ("zusammen mit ICE 5678 nach ..."). */
  function coupled(s, lang, c) {
    const out = [];
    for (const t of s.mit || []) {
      out.push(phrase("mit", lang));
      out.push(...train({ gattung: t.gattung, nummer: t.nummer, gattungLabel: c.gattungName(t.gattung) }, lang, false));
      out.push(...destination(t, lang, c));
    }
    return out;
  }

  /** A list of stations: "A" or "A, B und C" (all but the last spoken with rising pitch). */
  function stationList(ids, lang, c) {
    ids = (ids || []).filter(Boolean);
    if (ids.length <= 1) return ids.map((id) => station(id, lang, END, c));
    const out = ids.slice(0, -1).map((id) => station(id, lang, MID, c));
    out.push(phrase("und", lang), station(ids[ids.length - 1], lang, END, c));
    return out;
  }

  /** "Zugteilung in A, B und C" (nothing when no splitting station is set) */
  function splitting(s, lang, c) {
    const ids = (s.teile || []).filter(Boolean);
    if (!ids.length) return [];
    return [phrase("teilung", lang), ...stationList(ids, lang, c), phrase("teilungEnde", lang)];
  }

  // ---------------------------------------------------------------- per type

  const BUILD = {
    einfahrt(s, lang, c) {
      return [
        phrase("gleis", lang), ...number(s.gleis, lang, "hoch"),
        phrase("einfahrt", lang), ...train(s, lang, true),
        ...destination(s, lang, c),
        ...coupled(s, lang, c),
        phrase(s.verspaetet ? "abfahrtUrspr" : "abfahrt", lang), ...time(s.zeit, lang),
        ...splitting(s, lang, c),
        phrase("vorsicht", lang),
      ];
    },
    ankunft(s, lang, c) {
      const out = [
        phrase("gleis", lang), ...number(s.gleis, lang, "hoch"),
        phrase("einfahrt", lang), ...train(s, lang, true),
        phrase("von", lang), station(s.von, lang, END, c, "Herkunft wählen"),
      ];
      if (s.weiter && s.weiterZug) {
        // the arriving train continues as another train
        const w = s.weiterZug;
        out.push(phrase("weiterAls", lang),
          ...train({ gattung: w.gattung, nummer: w.nummer, gattungLabel: c.gattungName(w.gattung) }, lang, false),
          ...destination(w, lang, c),
          phrase("abfahrt", lang), ...time(w.zeit, lang));
      } else {
        out.push(phrase(s.verspaetet ? "ankunftUrspr" : "ankunft", lang), ...time(s.zeit, lang));
        if (s.nichtEinsteigen) out.push(phrase("nichtEinsteigen", lang));
      }
      out.push(phrase("vorsicht", lang));
      return out;
    },
    bereit(s, lang, c) {
      return [
        phrase("gleis", lang), ...number(s.gleis, lang, "hoch"),
        phrase("steht", lang), ...train(s, lang, true),
        ...destination(s, lang, c),
        ...coupled(s, lang, c),
        phrase("abfahrt", lang), ...time(s.zeit, lang),
        ...splitting(s, lang, c),
      ];
    },
    info(s, lang, c) {
      const out = [
        phrase("info", lang), ...train(s, lang, true),
        ...destination(s, lang, c),
        ...coupled(s, lang, c),
        phrase("abfahrt", lang), ...time(s.zeit, lang),
      ];
      if (s.delay) out.push({ label: c.delayName(s.delay), cands: [`/${lang}/zeiten/verspaetung_heute/${s.delay}`], kind: "info" });
      if (s.gleisNeu) out.push(phrase("gleiswechsel", lang), ...number(s.gleisNeu, lang, "hoch"));
      if (s.nurBis) out.push(phrase("nurBis", lang), station(s.nurBis, lang, END, c), phrase("nurBisEnde", lang));
      const extra = (s.zusatzhalt || []).filter(Boolean);
      if (extra.length) out.push(phrase("zusatzhalt", lang), ...stationList(extra, lang, c));
      const skipped = (s.haltausfall || []).filter(Boolean);
      if (skipped.length) out.push(phrase("haltausfall", lang), ...stationList(skipped, lang, c));
      if (s.faelltAus) out.push(phrase("faelltAus", lang));
      for (const g of (s.gruende || []).filter(Boolean)) {
        out.push({ label: c.reasonName(g), cands: [`/${lang}/gruende/grund_dafuer/${g}`], kind: "info" });
      }
      if (s.entschuldigung) out.push(phrase("entschuldigung", lang));
      return out;
    },
    tueren(s, lang) {
      return [phrase("tuerenGleis", lang), ...number(s.gleis, lang, "hoch"), phrase("tuerenEnde", lang)];
    },
    durchfahrt(s, lang) {
      return [
        phrase("durchfahrt1", lang), ...number(s.gleis, lang, "hoch"),
        phrase("durchfahrt2", lang), ...number(s.gleis, lang, "hoch"),
        phrase("durchfahrt3", lang),
      ];
    },
    sonder(s, lang, c) {
      const ids = (s.sonder || []).filter(Boolean);
      if (!ids.length) return [{ label: "Sonderansage wählen", cands: [], kind: "info" }];
      return ids.map((id) => ({ label: c.specialName(id), cands: [`/${lang}/nza/${id}`], kind: "info" }));
    },
    anschluss(s, lang, c) {
      const list = s.anschluesse || [];
      if (!list.length) return [{ label: "Anschluss hinzufügen", cands: [], kind: "info" }];
      const out = [phrase("anschluesse", lang)];
      list.forEach((a, i) => {
        if (i > 0 && i === list.length - 1) out.push(phrase("und", lang));
        out.push(...train({ gattung: a.gattung, nummer: a.nummer, gattungLabel: c.gattungName(a.gattung) }, lang, false),
          ...destination(a, lang, c),
          phrase("abfahrt", lang), ...time(a.zeit, lang),
          phrase("vonGleis", lang), ...number(a.gleis, lang, "tief"));
      });
      return out;
    },
  };

  /** Returns [{label, cands, kind, lang}] for the whole announcement. */
  function compose(state, catalog) {
    const type = TYPES.find((t) => t.id === state.type) || TYPES[0];
    const langs = (state.langs || ["dt"]).filter((l) => type.langs.includes(l));
    if (!langs.length) langs.push(type.langs[0]);
    const chain = [];
    if (state.gong !== false) chain.push({ ...(type.id === "tueren" ? GONG_DOORS : GONG), lang: null });
    for (const lang of langs) {
      for (const item of BUILD[type.id](state, lang, catalog)) chain.push({ ...item, lang });
    }
    return chain;
  }

  /** Puts the candidate the manifest knows about first (if there is a manifest). */
  function resolveChain(chain, library) {
    return chain.map((item) => {
      const known = item.cands.find((p) => library.has(p));
      const cands = known ? [known, ...item.cands.filter((p) => p !== known)] : item.cands;
      return { ...item, cands };
    });
  }

  /** Readable name for a text-snippet clip path, e.g. "/dt/module_3_1/046.wav" → "Vorsicht bei der Einfahrt". */
  const PHRASE_BY_PATH = new Map();
  for (const p of Object.values(PHRASES)) {
    for (const lang of ["dt", "en"]) if (p[lang]) PHRASE_BY_PATH.set(`/${lang}/${p.f}/${p[lang]}.wav`, p.label);
  }
  PHRASE_BY_PATH.set(GONG.cands[0], "Gong");
  PHRASE_BY_PATH.set(GONG_DOORS.cands[0], "Gong (Abfahrt)");
  const phraseLabel = (path) => PHRASE_BY_PATH.get(path) || null;

  window.Ansagen = { TYPES, LANGS, compose, resolveChain, trainNumberParts, numberParts, phraseLabel };
})();

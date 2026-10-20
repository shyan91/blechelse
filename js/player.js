/*
 * Plays a chain of clips back to back with the Web Audio API and can render
 * the same chain to a single WAV file.
 *
 * Options: gap (ms between clips), hall (station-hall reverb on/off).
 */
(function () {
  "use strict";

  let ctx = null;
  const cache = new Map(); // path -> Promise<AudioBuffer>

  function audioContext() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    return ctx;
  }

  function decode(library, path) {
    if (!cache.has(path)) {
      const p = library.arrayBuffer(path).then((buf) => audioContext().decodeAudioData(buf));
      p.catch(() => cache.delete(path));
      cache.set(path, p);
    }
    return cache.get(path);
  }

  function clearCache() { cache.clear(); }

  /** Synthetic impulse response: a big, tiled station hall. */
  function hallImpulse(c, seconds = 2.6, decay = 3.2) {
    const rate = c.sampleRate;
    const len = Math.floor(rate * seconds);
    const ir = c.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections in the first 80 ms, then a smooth tail
        const early = i < rate * 0.08 && Math.random() < 0.004 ? 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * 0.55;
      }
    }
    return ir;
  }

  /** Connect sources → (dry + optional hall) → destination. Returns the input node. */
  function buildGraph(c, hall) {
    const input = c.createGain();
    // Light band-pass: station loudspeakers don't do deep bass or sparkle.
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = hall ? 180 : 60;
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = hall ? 6500 : 12000;
    input.connect(hp).connect(lp);
    const dry = c.createGain(); dry.gain.value = hall ? 0.75 : 1;
    lp.connect(dry).connect(c.destination);
    if (hall) {
      const conv = c.createConvolver();
      conv.buffer = hallImpulse(c);
      const pre = c.createDelay(0.2); pre.delayTime.value = 0.045;
      const wet = c.createGain(); wet.gain.value = 0.42;
      lp.connect(pre).connect(conv).connect(wet).connect(c.destination);
    }
    return input;
  }

  /** Lay the buffers out on a timeline. */
  function timeline(buffers, gapMs) {
    const gap = Math.max(0, gapMs) / 1000;
    let t = 0;
    const slots = buffers.map((b) => {
      const s = { start: t, end: t + b.duration };
      t = s.end + gap;
      return s;
    });
    return { slots, total: Math.max(0, t - gap) };
  }

  /**
   * Play the playable items of a resolved chain.
   * callbacks: onClip(indexInChain|-1), onProgress(0..1), onEnd()
   * Returns a controller { stop() } once audio has started.
   */
  async function play(library, chain, opts, callbacks = {}) {
    const c = audioContext();
    if (c.state === "suspended") await c.resume();
    const playable = chain.map((it, i) => ({ it, i })).filter((x) => x.it.ok);
    if (!playable.length) throw new Error("Keine abspielbaren Clips");
    const buffers = await Promise.all(playable.map((x) => decode(library, x.it.path)));

    const input = buildGraph(c, opts.hall);
    const { slots, total } = timeline(buffers, opts.gap);
    const t0 = c.currentTime + 0.08;
    const sources = buffers.map((b, k) => {
      const src = c.createBufferSource();
      src.buffer = b;
      src.connect(input);
      src.start(t0 + slots[k].start);
      return src;
    });

    let stopped = false, raf = 0, current = -2;
    const tailEnd = total + (opts.hall ? 1.6 : 0.05);
    const tick = () => {
      if (stopped) return;
      const t = c.currentTime - t0;
      const k = slots.findIndex((s) => t >= s.start && t < s.end);
      const idx = k === -1 ? -1 : playable[k].i;
      if (idx !== current) { current = idx; callbacks.onClip?.(idx); }
      callbacks.onProgress?.(Math.min(1, Math.max(0, t / total)));
      if (t >= tailEnd) return finish();
      raf = requestAnimationFrame(tick);
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      sources.forEach((s) => { try { s.stop(); } catch (_) {} });
      setTimeout(() => input.disconnect(), 50);
      callbacks.onClip?.(-1);
      callbacks.onEnd?.();
    };
    raf = requestAnimationFrame(tick);
    return { stop: finish, duration: total };
  }

  /** Render the chain to a 16-bit mono WAV Blob (includes gap + hall). */
  async function renderWav(library, chain, opts) {
    const playable = chain.filter((it) => it.ok);
    if (!playable.length) throw new Error("Keine abspielbaren Clips");
    const buffers = await Promise.all(playable.map((it) => decode(library, it.path)));
    const rate = 44100;
    const { slots, total } = timeline(buffers, opts.gap);
    const length = Math.ceil((total + (opts.hall ? 2.4 : 0.1)) * rate);
    const off = new OfflineAudioContext(1, length, rate);
    const input = buildGraph(off, opts.hall);
    buffers.forEach((b, k) => {
      const src = off.createBufferSource();
      src.buffer = b;
      src.connect(input);
      src.start(slots[k].start);
    });
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  }

  function encodeWav(samples, rate) {
    // normalise to avoid clipping when hall is added
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const gain = peak > 0.98 ? 0.98 / peak : 1;
    const buf = new ArrayBuffer(44 + samples.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    str(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); str(8, "WAVE");
    str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, samples.length * 2, true);
    for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, samples[i] * gain));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: "audio/wav" });
  }

  /** Play one single clip (clip browser). */
  async function playSingle(library, path, onEnd) {
    return play(library, [{ ok: true, path }], { gap: 0, hall: false }, { onEnd });
  }

  window.ClipPlayer = { play, playSingle, renderWav, clearCache };
})();

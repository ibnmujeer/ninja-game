/*
 * audio (L5): WebAudio, synthesised; no audio files (moved from v1 section 3, unchanged).
 */
(function () {
  'use strict';

  NBA.define('audio', ['prefs', 'dom'], (prefs, dom) => {
    const { hasUserActivation } = dom;

    const AUDIO = {
      ctx: null,
      master: null,
      noiseBuf: null,

      /**
       * Create (once) or resume the AudioContext. Called only from real taps,
       * because browsers block audio that starts without one. If WebAudio is
       * missing, ctx stays null and every effect is silently skipped.
       */
      unlock() {
        if (!hasUserActivation()) return; // before any real tap, browsers would refuse (and warn)
        try {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (!Ctx) return;
          if (!this.ctx) {
            this.ctx = new Ctx();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.22; // low master volume
            this.master.connect(this.ctx.destination);
          }
          if (this.ctx.state !== 'running') {
            const p = this.ctx.resume();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        } catch (e) { this.ctx = null; }
      },

      /** One oscillator note with a short attack and an exponential fade. */
      tone(freq, dur, opt) {
        const o = opt || {};
        const ctx = this.ctx;
        const t0 = ctx.currentTime + (o.when || 0);
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = o.type || 'triangle';
        osc.frequency.setValueAtTime(freq, t0);
        if (o.slideTo) osc.frequency.exponentialRampToValueAtTime(o.slideTo, t0 + dur);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(o.gain || 0.3, t0 + (o.attack || 0.008));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t0);
        osc.stop(t0 + dur + 0.05);
      },

      /** A burst of filtered white noise (for the villain's knock). */
      noise(dur, opt) {
        const o = opt || {};
        const ctx = this.ctx;
        if (!this.noiseBuf) {
          const len = Math.floor(ctx.sampleRate * 0.5);
          this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
          const ch = this.noiseBuf.getChannelData(0);
          for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
        }
        const t0 = ctx.currentTime + (o.when || 0);
        const src = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const g = ctx.createGain();
        src.buffer = this.noiseBuf;
        filter.type = 'lowpass';
        filter.frequency.value = o.lowpass || 800;
        g.gain.setValueAtTime(o.gain || 0.3, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(filter);
        filter.connect(g);
        g.connect(this.master);
        src.start(t0);
        src.stop(t0 + dur + 0.05);
      },

      /** Play a named effect from SOUNDS. Silent when muted or without WebAudio. */
      play(name, arg) {
        if (!this.ctx || !prefs.get('sound') || !SOUNDS[name]) return;
        try { SOUNDS[name](this, arg); } catch (e) { /* stay silent */ }
      }
    };

    /** Every sound effect, built from oscillators and noise. */
    const SOUNDS = {
      tap: (a) => a.tone(660, 0.05, { type: 'triangle', gain: 0.16 }),
      // Brick place: the pitch rises one semitone per brick in the tower.
      place: (a, height) => a.tone(300 * Math.pow(2, (height || 0) / 12), 0.09, { type: 'triangle', gain: 0.3 }),
      undo: (a) => a.tone(520, 0.12, { type: 'sine', gain: 0.22, slideTo: 300 }),
      correct: (a) => {
        [523, 659, 784].forEach((f, i) => a.tone(f, 0.11, { type: 'triangle', gain: 0.28, when: i * 0.09 }));
        a.tone(1047, 0.28, { type: 'triangle', gain: 0.28, when: 0.27 });
      },
      // Soft and warm on purpose: low, quiet, slow attack. Not a buzzer.
      wrong: (a) => a.tone(247, 0.26, { type: 'sine', gain: 0.1, attack: 0.02, slideTo: 220 }),
      knock: (a) => {
        a.noise(0.18, { lowpass: 700, gain: 0.35 });
        a.tone(140, 0.22, { type: 'sine', gain: 0.4, slideTo: 55 });
      },
      star: (a) => {
        a.tone(1319, 0.12, { type: 'sine', gain: 0.18 });
        a.tone(1568, 0.22, { type: 'sine', gain: 0.18, when: 0.1 });
      },
      fanfare: (a) => {
        [392, 523, 659, 784].forEach((f, i) => a.tone(f, 0.15, { type: 'triangle', gain: 0.26, when: i * 0.13 }));
        a.tone(1047, 0.7, { type: 'triangle', gain: 0.26, when: 0.52 });
      }
    };

    return { AUDIO, SOUNDS };
  });
}());

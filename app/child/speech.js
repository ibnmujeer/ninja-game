/*
 * speech (L5): speechSynthesis (moved from v1 section 4, unchanged).
 * hasUserActivation lives in dom.js (audio.js needs it and loads before this file);
 * it is re-exported here for v1 callers.
 */
(function () {
  'use strict';

  NBA.define('speech', ['config', 'prefs', 'dom'], (config, prefs, dom) => {
    const { TIMING } = config;
    const { hasUserActivation } = dom;

    const SPEECH = {
      synth: null,
      voice: null,
      token: 0,          // only the newest say() request may speak
      log: null,         // the ?test hook sets this to an array of every line
      symbolLeak: false, // ?test only: true if a line ever held a maths symbol

      init() {
        try {
          if (!('speechSynthesis' in window) || !window.speechSynthesis ||
              typeof window.SpeechSynthesisUtterance !== 'function') return;
          this.synth = window.speechSynthesis;
          this.pickVoice();
          // Voices often arrive later, through this event.
          if (typeof this.synth.addEventListener === 'function') {
            this.synth.addEventListener('voiceschanged', () => this.pickVoice());
          }
        } catch (e) { this.synth = null; }
      },

      /** Prefer offline (localService) voices, then en-GB, then any English voice. */
      pickVoice() {
        try {
          let best = null;
          let bestScore = -1;
          (this.synth.getVoices() || []).forEach((v) => {
            const lang = String(v.lang || '').replace('_', '-').toLowerCase();
            if (lang.indexOf('en') !== 0) return;
            const score = (v.localService ? 4 : 0) + (lang === 'en-gb' ? 2 : 0);
            if (score > bestScore) { best = v; bestScore = score; }
          });
          this.voice = best;
        } catch (e) { this.voice = null; }
      },

      /**
       * Say one short line. Anything already speaking is cancelled first. The
       * game never waits for onstart/onend (they may never fire). {now: true}
       * speaks inside the current tap, which iOS needs for the first line;
       * otherwise speak() runs a moment after cancel(), because Chromium can
       * drop a speak() that comes straight after cancel().
       */
      say(text, opt) {
        const line = String(text || '').trim();
        if (!line) return;
        if (this.log) {
          this.log.push(line);
          if (/[\u2212\u00d7\u00f7\u2605=+]/.test(line)) this.symbolLeak = true;
        }
        if (!prefs.get('sound') || !this.synth || !hasUserActivation()) return;
        try { this.synth.cancel(); } catch (e) { /* ignore */ }
        const my = ++this.token;
        const speakNow = () => {
          if (my !== this.token) return;
          try {
            const u = new window.SpeechSynthesisUtterance(line);
            u.lang = this.voice ? this.voice.lang : 'en-GB';
            if (this.voice) u.voice = this.voice;
            u.rate = 0.9;
            u.pitch = 1.1;
            this.synth.speak(u);
          } catch (e) { /* the game carries on silently */ }
        };
        if (opt && opt.now) speakNow(); else setTimeout(speakNow, TIMING.SPEAK_DEFER);
      },

      cancel() {
        this.token++;
        try { if (this.synth) this.synth.cancel(); } catch (e) { /* ignore */ }
      }
    };

    /** Turn display text into speech text: "3s" -> "threes", "\u2026" -> ".". */
    const PLURAL_WORDS = { 2: 'twos', 3: 'threes', 4: 'fours', 5: 'fives', 6: 'sixes', 7: 'sevens', 8: 'eights', 9: 'nines', 10: 'tens' };
    function forSpeech(text) {
      return String(text)
        .replace(/\b(\d+)s\b/g, (m, n) => PLURAL_WORDS[n] || m)
        .replace(/\u2026/g, '.')
        .replace(/[,\s]+(?=[.!?])/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/\s+/g, ' ')
        .trim();
    }

    return { SPEECH, PLURAL_WORDS, forSpeech, hasUserActivation };
  });
}());

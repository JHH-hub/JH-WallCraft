/* JH-WallCraft v3 · Wallpaper Engine 零依赖实时通信内核 */
(function (global) {
  'use strict';

  var THEMES = {
    'geek-indigo': {
      label: 'GEEK INDIGO',
      accent: '#6366f1',
      accent2: '#38bdf8',
      accent3: '#a855f7',
      rgb1: '79, 70, 229',
      rgb2: '14, 165, 233',
      rgb3: '139, 92, 246'
    },
    'cyber-cyan': {
      label: 'CYBER CYAN',
      accent: '#22d3ee',
      accent2: '#3b82f6',
      accent3: '#14b8a6',
      rgb1: '6, 182, 212',
      rgb2: '37, 99, 235',
      rgb3: '20, 184, 166'
    },
    'emerald-matrix': {
      label: 'EMERALD MATRIX',
      accent: '#10b981',
      accent2: '#06b6d4',
      accent3: '#3b82f6',
      rgb1: '16, 185, 129',
      rgb2: '6, 182, 212',
      rgb3: '29, 78, 216'
    },
    'amber-forge': {
      label: 'AMBER FORGE',
      accent: '#f97316',
      accent2: '#f43f5e',
      accent3: '#f59e0b',
      rgb1: '234, 88, 12',
      rgb2: '219, 39, 119',
      rgb3: '245, 158, 11'
    }
  };

  function resolveTheme(preset) {
    if (preset === 'auto-circadian' || !THEMES[preset]) {
      var h = new Date().getHours();
      if (h >= 6 && h < 12) preset = 'cyber-cyan';
      else if (h >= 12 && h < 18) preset = 'geek-indigo';
      else if (h >= 18 && h < 22) preset = 'amber-forge';
      else preset = 'geek-indigo';
    }
    return THEMES[preset] || THEMES['geek-indigo'];
  }

  function applyThemeCss(screen, preset, glowIntensity, bezelContinuous) {
    var t = resolveTheme(preset);
    var root = document.documentElement;
    root.style.setProperty('--accent', t.accent);
    root.style.setProperty('--accent2', t.accent2);
    root.style.setProperty('--accent3', t.accent3);

    var amb = document.getElementById('ambientLayer');
    if (amb) {
      var k = Math.max(0.2, Math.min(1.5, (glowIntensity || 100) / 100)) * 0.28;
      var orb1Pos = screen === 'm1_left'
        ? (bezelContinuous !== false ? '98% 42%' : '72% 35%')
        : (bezelContinuous !== false ? '2% 42%' : '38% 25%');
      var orb2Pos = screen === 'm1_left' ? '18% 16%' : '76% 14%';
      var orb3Pos = screen === 'm1_left' ? '32% 85%' : '62% 84%';
      amb.style.background =
        'radial-gradient(circle at ' + orb1Pos + ', rgba(' + t.rgb1 + ',' + (k * 1.15).toFixed(3) + '), transparent 48%),' +
        'radial-gradient(circle at ' + orb2Pos + ', rgba(' + t.rgb2 + ',' + k.toFixed(3) + '), transparent 46%),' +
        'radial-gradient(circle at ' + orb3Pos + ', rgba(' + t.rgb3 + ',' + (k * 0.85).toFixed(3) + '), transparent 45%)';
    }
    return t;
  }

  function cleanText(s) {
    return String(s || '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').trim();
  }

  function parseLocalDate(str) {
    if (!str) return new Date();
    var p = String(str).split('-');
    if (p.length !== 3) return new Date();
    return new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  }

  function formatLocalDate(d) {
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function isoWeekNumber(d) {
    var dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    dt.setDate(dt.getDate() + 4 - (dt.getDay() || 7));
    var yearStart = new Date(dt.getFullYear(), 0, 1);
    return Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
  }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function WallCraftLiveClient(opts) {
    this.screen = opts.screen;
    this.apiBase = opts.apiBase || 'http://127.0.0.1:18766';
    this.onFast = opts.onFast || function () {};
    this.onSlow = opts.onSlow || function () {};
    this.onTick = opts.onTick || function () {};

    this.paused = false;
    this.lastConfigVersion = null;
    this.lastBackdropVer = null;
    this.fastTimer = null;
    this.slowTimer = null;
    this.clockTimer = null;
    this.slowData = null;
    this.fastData = null;

    this._loadCache();
  }

  WallCraftLiveClient.prototype._loadCache = function () {
    try {
      var s = localStorage.getItem('wc_live_slow_' + this.screen);
      if (s) {
        this.slowData = JSON.parse(s);
        this.onSlow(this.slowData);
      }
      var f = localStorage.getItem('wc_live_fast');
      if (f) {
        this.fastData = JSON.parse(f);
        this.onFast(this.fastData);
      }
    } catch (e) {}
  };

  WallCraftLiveClient.prototype.updateBackdrop = function (cfgVer, enabled) {
    var img = document.getElementById('backdropImg');
    if (!img) return;
    if (enabled === false) {
      img.classList.remove('ready');
      img.removeAttribute('src');
      this.lastBackdropVer = 'off';
      return;
    }
    var key = String(cfgVer || '0');
    if (this.lastBackdropVer === key) return;
    this.lastBackdropVer = key;
    var url = this.apiBase + '/api/backdrop-image/' + this.screen + '?v=' + encodeURIComponent(key);
    img.onload = function () {
      if (img.naturalWidth > 0) img.classList.add('ready');
      else img.classList.remove('ready');
    };
    img.onerror = function () {
      img.classList.remove('ready');
    };
    img.src = url;
  };

  WallCraftLiveClient.prototype.fetchJson = function (path, options) {
    return fetch(this.apiBase + path, options || {}).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  };

  WallCraftLiveClient.prototype.pollFast = function () {
    var self = this;
    if (self.paused) return Promise.resolve();
    return self.fetchJson('/api/live-fast').then(function (data) {
      self.fastData = data;
      try { localStorage.setItem('wc_live_fast', JSON.stringify(data)); } catch (e) {}
      self.onFast(data);
      if (data.configVersion && data.configVersion !== self.lastConfigVersion) {
        self.lastConfigVersion = data.configVersion;
        self.pollSlow(false);
      }
    }).catch(function () {});
  };

  WallCraftLiveClient.prototype.pollSlow = function (force) {
    var self = this;
    if (self.paused) return Promise.resolve();
    return self.fetchJson('/api/live-slow' + (force ? '?force=1' : '')).then(function (data) {
      self.slowData = data;
      self.lastConfigVersion = data.configVersion || self.lastConfigVersion;
      try { localStorage.setItem('wc_live_slow_' + self.screen, JSON.stringify(data)); } catch (e) {}
      var bdEnabled = !(data.config && data.config.backdrops && data.config.backdrops.enabled === false);
      var bdChoice = data.config && data.config.backdrops && data.config.backdrops[self.screen];
      self.updateBackdrop(self.lastConfigVersion, bdEnabled && bdChoice !== 'none');
      self.onSlow(data);
    }).catch(function () {});
  };

  WallCraftLiveClient.prototype.postAction = function (path, body) {
    var self = this;
    return self.fetchJson(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (res) {
      self.pollFast();
      self.pollSlow(false);
      return res;
    });
  };

  WallCraftLiveClient.prototype.startTimers = function () {
    var self = this;
    self.stopTimers();
    self.onTick(new Date());
    self.clockTimer = setInterval(function () { self.onTick(new Date()); }, 1000);
    self.fastTimer = setInterval(function () { self.pollFast(); }, 3000);
    self.slowTimer = setInterval(function () { self.pollSlow(false); }, 60000);
  };

  WallCraftLiveClient.prototype.stopTimers = function () {
    if (this.clockTimer) { clearInterval(this.clockTimer); this.clockTimer = null; }
    if (this.fastTimer) { clearInterval(this.fastTimer); this.fastTimer = null; }
    if (this.slowTimer) { clearInterval(this.slowTimer); this.slowTimer = null; }
  };

  WallCraftLiveClient.prototype.setPaused = function (isPaused) {
    var next = !!isPaused;
    if (next === this.paused) return;
    this.paused = next;
    if (next) {
      this.stopTimers();
    } else {
      this.startTimers();
      this.pollFast();
    }
  };

  WallCraftLiveClient.prototype.start = function () {
    var self = this;
    self.startTimers();
    self.pollFast();
    self.pollSlow(false);

    document.addEventListener('visibilitychange', function () {
      self.setPaused(document.hidden);
    });

    global.wallpaperPropertyListener = {
      setPaused: function (p) { self.setPaused(p); },
      applyUserProperties: function (props) {
        if (props && props.apibase && props.apibase.value) {
          self.apiBase = props.apibase.value;
          self.lastBackdropVer = null;
          self.pollFast();
          self.pollSlow(false);
        }
      }
    };
  };

  global.WC = {
    WallCraftLiveClient: WallCraftLiveClient,
    applyThemeCss: applyThemeCss,
    cleanText: cleanText,
    parseLocalDate: parseLocalDate,
    formatLocalDate: formatLocalDate,
    isoWeekNumber: isoWeekNumber,
    escHtml: escHtml
  };
})(window);

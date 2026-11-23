// JH-WallCraft v2 Web Console Controller

class WallCraftConsole {
  constructor() {
    this.config = null;
    this.telemetry = null;
    this.backdrops = [];
    this.backdropTarget = 'm1_right';
    this.activeScreen = 'm1_right';
    this.saveTimer = null;
    this.init();
  }

  async init() {
    this.bindEvents();
    await this.loadBackdrops();
    await this.loadConfig();
    await this.loadTelemetry(false);
    this.refreshPreview(false);
    setInterval(() => this.loadTelemetry(false), 30000);
  }

  async api(url, options = {}) {
    const res = await fetch(url, options);
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
  }

  toast(msg, isError = false) {
    const el = document.getElementById('toastMsg');
    el.textContent = msg;
    el.style.color = isError ? '#f43f5e' : '#34d399';
    if (msg) {
      setTimeout(() => {
        if (el.textContent === msg) el.textContent = '';
      }, 5000);
    }
  }

  async loadBackdrops() {
    try {
      const data = await this.api('/api/backdrops');
      this.backdrops = data.backdrops || [];
      this.renderBackdropPicker();
    } catch (e) {
      console.error('loadBackdrops failed', e);
    }
  }

  async loadConfig() {
    try {
      const data = await this.api('/api/config');
      this.config = data.config;
      this.renderConfigUI();
    } catch (e) {
      this.toast(`读取配置失败: ${e.message}`, true);
    }
  }

  scheduleSave(refreshPreviewAfter = true) {
    document.getElementById('saveState').textContent = '保存中…';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.saveConfig(refreshPreviewAfter), 250);
  }

  async saveConfig(refreshPreviewAfter = true) {
    if (!this.config) return;
    try {
      const data = await this.api('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.config),
      });
      this.config = data.config;
      document.getElementById('saveState').textContent = '已保存';
      if (refreshPreviewAfter) {
        this.refreshPreview(true);
      }
    } catch (e) {
      document.getElementById('saveState').textContent = '保存失败';
      this.toast(`保存配置失败: ${e.message}`, true);
    }
  }

  async loadTelemetry(force = false) {
    try {
      const data = await this.api(`/api/telemetry?force=${force ? 1 : 0}`);
      this.telemetry = data.telemetry;
      this.renderTelemetryUI();
    } catch (e) {
      this.toast(`遥测采集失败: ${e.message}`, true);
    }
  }

  renderTelemetryUI() {
    const t = this.telemetry;
    if (!t) return;
    document.getElementById('telemetryTime').textContent = `遥测时间：${t.collected_at || '--'}`;

    const setPill = (id, text, cls) => {
      const el = document.getElementById(id);
      el.className = `node-pill ${cls}`;
      el.innerHTML = `<i class="dot"></i>${text}`;
    };

    const g1 = t.m1?.gpu;
    setPill('pillM1', g1?.ok ? `4090 ${g1.util_pct}% · ${g1.temp_c}C` : '4090 离线', g1?.ok ? 'ok' : 'err');

    const m2 = t.m2 || {};
    const g2 = m2.gpu;
    if (m2.agent_online && g2?.ok) {
      setPill('pillM2', `5080 ${g2.util_pct}% · ${g2.temp_c}C`, m2.busy ? 'busy' : 'ok');
    } else {
      setPill('pillM2', '5080 离线', 'err');
    }

    const cm = m2.comfy || {};
    if (cm.online) {
      setPill('pillComfy', `ComfyUI R${cm.running}/Q${cm.pending}`, cm.running > 0 ? 'busy' : 'ok');
    } else {
      setPill('pillComfy', 'ComfyUI 离线', 'err');
    }

    const nas = t.nas || {};
    setPill('pillNas', nas.ok ? `NAS ${nas.vol_pct || 0}%` : 'NAS 离线', nas.ok ? 'ok' : 'err');

    const th = t.thesis || {};
    const gh = t.github || {};
    const pp = t.papers || {};
    document.getElementById('summaryThesis').textContent = `论文进度：${(th.total_cjk || 0).toLocaleString()} / ${(th.target_words || 40000).toLocaleString()} 字 (${th.pct || 0}%)`;
    document.getElementById('summaryGithub').textContent = `GitHub 12W：${gh.total_commits || 0} commits · 连续 ${gh.streak_days || 0} 天`;
    document.getElementById('summaryPapers').textContent = `文献雷达：共 ${pp.total_docs || 0} 篇 · 今日 +${pp.today_count || 0}`;
  }

  renderConfigUI() {
    const c = this.config;
    if (!c) return;

    document.querySelectorAll('#modeSegmented button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === (c.mode || 'daily'));
    });
    document.getElementById('themePreset').value = c.themePreset || 'auto-circadian';
    document.getElementById('glowIntensity').value = c.glowIntensity ?? 100;
    document.getElementById('glowVal').textContent = `${c.glowIntensity ?? 100}%`;
    document.getElementById('iconZones').checked = c.iconZones !== false;
    document.getElementById('bezelContinuousGlow').checked = c.bezelContinuousGlow !== false;
    document.getElementById('lateNightNudge').checked = c.lateNightNudge !== false;
    document.getElementById('rollingCalendar').checked = c.rollingCalendar !== false;

    const manualBox = document.getElementById('manualCalRange');
    manualBox.classList.toggle('hidden', c.rollingCalendar !== false);

    document.getElementById('countdownName').value = c.countdown?.name || '';
    document.getElementById('countdownDate').value = c.countdown?.date || '';
    document.getElementById('countdownStart').value = c.countdown?.startDate || '';
    document.getElementById('thesisTargetWords').value = c.thesisTargetWords || 40000;
    document.getElementById('calendarStart').value = c.calendarStart || '';
    document.getElementById('calendarEnd').value = c.calendarEnd || '';

    this.renderBackdropControls();
    this.renderTodos();
    this.renderEvents();
    this.renderMilestones();
    this.renderMarks();
    this.renderMemos();
  }

  renderBackdropControls() {
    const c = this.config;
    if (!c) return;
    const bd = c.backdrops || {};
    document.getElementById('bdEnabled').checked = bd.enabled !== false;
    document.getElementById('m2ShowNas').checked = c.m2ShowNas !== false;

    document.querySelectorAll('#bdTargetTabs button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === this.backdropTarget);
    });

    const isM2 = this.backdropTarget === 'm2_main';
    const br = isM2 ? (bd.m2Brightness ?? 78) : (bd.brightness ?? 62);
    const bl = isM2 ? (bd.m2Blur ?? 0) : (bd.blur ?? 2);
    const vig = bd.vignette ?? 52;

    document.getElementById('bdBrightness').value = br;
    document.getElementById('bdBrightnessVal').textContent = `${br}%`;
    document.getElementById('bdBlur').value = bl;
    document.getElementById('bdBlurVal').textContent = `${bl}px`;
    document.getElementById('bdVignette').value = vig;
    document.getElementById('bdVignetteVal').textContent = `${vig}%`;

    this.renderBackdropPicker();
  }

  renderBackdropPicker() {
    const grid = document.getElementById('backdropGrid');
    if (!grid) return;
    grid.innerHTML = '';
    const currentId = (this.config?.backdrops || {})[this.backdropTarget] || 'none';
    this.backdrops.forEach(item => {
      const card = document.createElement('div');
      card.className = `bd-card ${item.id === currentId ? 'active' : ''}`;
      card.title = item.name;
      card.innerHTML = `
        <img src="/api/backdrop-thumb/${encodeURIComponent(item.id)}" loading="lazy" alt="${this.esc(item.name)}">
        <div class="bd-name">${this.esc(item.name.replace(/\s*\(.*?\)\s*/g, ''))}</div>
      `;
      card.addEventListener('click', () => {
        if (!this.config) return;
        this.config.backdrops = this.config.backdrops || {};
        this.config.backdrops[this.backdropTarget] = item.id;
        this.config.backdrops.enabled = true;
        document.getElementById('bdEnabled').checked = true;
        this.activeScreen = this.backdropTarget;
        document.querySelectorAll('#screenTabs button').forEach(b => {
          b.classList.toggle('active', b.dataset.screen === this.activeScreen);
        });
        this.renderBackdropPicker();
        this.scheduleSave();
      });
      grid.appendChild(card);
    });
  }

  renderTodos() {
    const list = document.getElementById('todoList');
    list.innerHTML = '';
    (this.config.todos || []).forEach((t, idx) => {
      const row = document.createElement('div');
      row.className = `list-row ${t.done ? 'done' : ''} ${t.p0 ? 'p0' : ''}`;
      row.innerHTML = `
        <input type="checkbox" ${t.done ? 'checked' : ''}>
        <span class="row-title" title="${this.esc(t.text)}">${this.esc(t.text)}</span>
        <button class="icon-btn ${t.p0 ? 'p0-active' : ''}" title="切换 P0">P0</button>
        <button class="icon-btn del-btn" title="删除">✕</button>
      `;
      row.querySelector('input').addEventListener('change', e => {
        t.done = e.target.checked;
        this.renderTodos();
        this.scheduleSave();
      });
      row.querySelectorAll('button')[0].addEventListener('click', () => {
        t.p0 = !t.p0;
        this.renderTodos();
        this.scheduleSave();
      });
      row.querySelector('.del-btn').addEventListener('click', () => {
        this.config.todos.splice(idx, 1);
        this.renderTodos();
        this.scheduleSave();
      });
      list.appendChild(row);
    });
  }

  renderEvents() {
    const list = document.getElementById('eventList');
    list.innerHTML = '';
    (this.config.events || []).forEach((ev, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <span class="color-swatch" style="background:${this.esc(ev.color || '#38bdf8')}"></span>
        <span class="row-title">${this.esc(ev.name)}</span>
        <span class="row-meta">${this.esc(ev.start.slice(5))}~${this.esc(ev.end.slice(5))}</span>
        <button class="icon-btn">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.config.events.splice(idx, 1);
        this.renderEvents();
        this.scheduleSave();
      });
      list.appendChild(row);
    });
  }

  renderMilestones() {
    const list = document.getElementById('milestoneList');
    list.innerHTML = '';
    (this.config.milestones || []).forEach((ms, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <span class="color-swatch" style="background:${this.esc(ms.color || '#f43f5e')}"></span>
        <span class="row-title">${this.esc(ms.name)}</span>
        <span class="row-meta">${this.esc(ms.date)}</span>
        <button class="icon-btn">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.config.milestones.splice(idx, 1);
        this.renderMilestones();
        this.scheduleSave();
      });
      list.appendChild(row);
    });
  }

  renderMarks() {
    const list = document.getElementById('markList');
    list.innerHTML = '';
    (this.config.marks || []).forEach((mk, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <span class="color-swatch" style="background:#f472b6"></span>
        <span class="row-title">${this.esc(mk.name || '')} ${this.esc(mk.time || '')}</span>
        <span class="row-meta">${this.esc(mk.date)}</span>
        <button class="icon-btn">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.config.marks.splice(idx, 1);
        this.renderMarks();
        this.scheduleSave();
      });
      list.appendChild(row);
    });
  }

  renderMemos() {
    const list = document.getElementById('memoList');
    list.innerHTML = '';
    (this.config.memos || []).forEach((mm, idx) => {
      const row = document.createElement('div');
      row.className = 'list-row';
      row.innerHTML = `
        <span class="row-title">${this.esc(mm.text)}</span>
        <button class="icon-btn">✕</button>
      `;
      row.querySelector('button').addEventListener('click', () => {
        this.config.memos.splice(idx, 1);
        this.renderMemos();
        this.scheduleSave();
      });
      list.appendChild(row);
    });
  }

  refreshPreview(refresh = true) {
    const ts = Date.now();
    const rFlag = refresh ? 1 : 0;
    const singleImg = document.getElementById('singlePreviewImg');
    const ovGrid = document.getElementById('overviewGrid');

    if (this.activeScreen === 'overview') {
      singleImg.classList.add('hidden');
      ovGrid.classList.remove('hidden');
      document.getElementById('ovLeft').src = `/api/preview/m1_left?refresh=${rFlag}&t=${ts}`;
      document.getElementById('ovRight').src = `/api/preview/m1_right?refresh=${rFlag}&t=${ts}`;
      document.getElementById('ovM2').src = `/api/preview/m2_main?refresh=${rFlag}&t=${ts}`;
    } else {
      ovGrid.classList.add('hidden');
      singleImg.classList.remove('hidden');
      singleImg.src = `/api/preview/${this.activeScreen}?refresh=${rFlag}&t=${ts}`;
    }
  }

  async applyTargets(targets, btnEl) {
    const orig = btnEl.textContent;
    btnEl.disabled = true;
    btnEl.textContent = '同步中…';
    try {
      const res = await this.api('/api/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targets, force: true }),
      });
      this.toast(`同步成功 (${Object.keys(res.screens || {}).join(', ')})`);
      await this.loadTelemetry(false);
      this.refreshPreview(false);
    } catch (e) {
      this.toast(`同步失败: ${e.message}`, true);
    } finally {
      btnEl.disabled = false;
      btnEl.textContent = orig;
    }
  }

  bindEvents() {
    // Topbar actions
    document.getElementById('refreshDataBtn').addEventListener('click', async () => {
      await this.loadTelemetry(true);
      this.refreshPreview(true);
      this.toast('数据已刷新并重绘预览');
    });
    document.getElementById('applyAllBtn').addEventListener('click', async e => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '同步中…';
      try {
        await this.api('/api/we-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        await this.api('/api/apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ targets: ['m2'], force: true }) });
        this.toast('一号机 WE 与二号机均已同步');
        await this.loadTelemetry(false);
        this.refreshPreview(false);
      } catch (err) {
        this.toast(`同步失败: ${err.message}`, true);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
    document.getElementById('applyM1Btn').addEventListener('click', async e => {
      const btn = e.target;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '重载中…';
      try {
        await this.api('/api/we-apply', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        this.toast('已重载一号机 Wallpaper Engine 双屏');
      } catch (err) {
        this.toast(`重载失败: ${err.message}`, true);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
    document.getElementById('applyM2Btn').addEventListener('click', e => this.applyTargets(['m2'], e.target));
    document.getElementById('forcePreviewBtn').addEventListener('click', () => this.refreshPreview(true));

    // Mode segmented
    document.querySelectorAll('#modeSegmented button').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this.config) return;
        this.config.mode = btn.dataset.mode;
        this.renderConfigUI();
        this.scheduleSave();
      });
    });

    // Theme & toggles
    document.getElementById('themePreset').addEventListener('change', e => {
      this.config.themePreset = e.target.value;
      this.scheduleSave();
    });
    document.getElementById('glowIntensity').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('glowVal').textContent = `${v}%`;
      this.config.glowIntensity = v;
      this.scheduleSave();
    });
    ['iconZones', 'bezelContinuousGlow', 'lateNightNudge', 'rollingCalendar'].forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        this.config[id] = e.target.checked;
        this.renderConfigUI();
        this.scheduleSave();
      });
    });

    // Steam Backdrops controls
    document.getElementById('bdEnabled').addEventListener('change', e => {
      this.config.backdrops = this.config.backdrops || {};
      this.config.backdrops.enabled = e.target.checked;
      this.scheduleSave();
    });
    document.getElementById('m2ShowNas').addEventListener('change', e => {
      this.config.m2ShowNas = e.target.checked;
      this.scheduleSave();
    });
    document.querySelectorAll('#bdTargetTabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        this.backdropTarget = btn.dataset.target;
        this.renderBackdropControls();
      });
    });
    document.getElementById('bdBrightness').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('bdBrightnessVal').textContent = `${v}%`;
      this.config.backdrops = this.config.backdrops || {};
      if (this.backdropTarget === 'm2_main') {
        this.config.backdrops.m2Brightness = v;
      } else {
        this.config.backdrops.brightness = v;
      }
      this.scheduleSave();
    });
    document.getElementById('bdBlur').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('bdBlurVal').textContent = `${v}px`;
      this.config.backdrops = this.config.backdrops || {};
      if (this.backdropTarget === 'm2_main') {
        this.config.backdrops.m2Blur = v;
      } else {
        this.config.backdrops.blur = v;
      }
      this.scheduleSave();
    });
    document.getElementById('bdVignette').addEventListener('input', e => {
      const v = parseInt(e.target.value, 10);
      document.getElementById('bdVignetteVal').textContent = `${v}%`;
      this.config.backdrops = this.config.backdrops || {};
      this.config.backdrops.vignette = v;
      this.scheduleSave();
    });

    // Countdown & Thesis target
    ['countdownName', 'countdownDate', 'countdownStart'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        this.config.countdown = {
          name: document.getElementById('countdownName').value.trim(),
          date: document.getElementById('countdownDate').value,
          startDate: document.getElementById('countdownStart').value,
        };
        this.scheduleSave();
      });
    });
    document.getElementById('thesisTargetWords').addEventListener('change', e => {
      this.config.thesisTargetWords = Math.max(5000, parseInt(e.target.value || '40000', 10));
      this.scheduleSave();
    });
    ['calendarStart', 'calendarEnd'].forEach(id => {
      document.getElementById(id).addEventListener('change', e => {
        this.config[id] = e.target.value;
        this.scheduleSave();
      });
    });

    // Add Todo
    const addTodo = () => {
      const inp = document.getElementById('newTodoText');
      const txt = inp.value.trim();
      if (!txt) return;
      const p0 = document.getElementById('newTodoP0').checked;
      this.config.todos = this.config.todos || [];
      this.config.todos.push({ text: txt, done: false, p0 });
      inp.value = '';
      document.getElementById('newTodoP0').checked = false;
      this.renderTodos();
      this.scheduleSave();
    };
    document.getElementById('addTodoBtn').addEventListener('click', addTodo);
    document.getElementById('newTodoText').addEventListener('keydown', e => { if (e.key === 'Enter') addTodo(); });

    // Add Memo
    const addMemo = () => {
      const inp = document.getElementById('newMemoText');
      const txt = inp.value.trim();
      if (!txt) return;
      this.config.memos = this.config.memos || [];
      this.config.memos.push({ text: txt, done: false });
      inp.value = '';
      this.renderMemos();
      this.scheduleSave();
    };
    document.getElementById('addMemoBtn').addEventListener('click', addMemo);
    document.getElementById('newMemoText').addEventListener('keydown', e => { if (e.key === 'Enter') addMemo(); });

    // Screen preview tabs
    document.querySelectorAll('#screenTabs button').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#screenTabs button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeScreen = btn.dataset.screen;
        this.refreshPreview(false);
      });
    });

    // Modals
    const openModal = id => document.getElementById(id).classList.add('open');
    const closeModal = id => document.getElementById(id).classList.remove('open');

    document.getElementById('openEventModalBtn').addEventListener('click', () => openModal('eventModal'));
    document.getElementById('closeEvBtn').addEventListener('click', () => closeModal('eventModal'));
    document.getElementById('saveEvBtn').addEventListener('click', () => {
      const name = document.getElementById('evName').value.trim();
      const start = document.getElementById('evStart').value;
      const end = document.getElementById('evEnd').value || start;
      const color = document.getElementById('evColor').value;
      if (!name || !start) return;
      this.config.events = this.config.events || [];
      this.config.events.push({ name, start, end, color });
      closeModal('eventModal');
      this.renderEvents();
      this.scheduleSave();
    });

    document.getElementById('openMilestoneModalBtn').addEventListener('click', () => openModal('milestoneModal'));
    document.getElementById('closeMsBtn').addEventListener('click', () => closeModal('milestoneModal'));
    document.getElementById('saveMsBtn').addEventListener('click', () => {
      const name = document.getElementById('msName').value.trim();
      const date = document.getElementById('msDate').value;
      const color = document.getElementById('msColor').value;
      if (!name || !date) return;
      this.config.milestones = this.config.milestones || [];
      this.config.milestones.push({ name, date, color });
      closeModal('milestoneModal');
      this.renderMilestones();
      this.scheduleSave();
    });

    document.getElementById('openMarkModalBtn').addEventListener('click', () => openModal('markModal'));
    document.getElementById('closeMkBtn').addEventListener('click', () => closeModal('markModal'));
    document.getElementById('saveMkBtn').addEventListener('click', () => {
      const name = document.getElementById('mkName').value.trim();
      const date = document.getElementById('mkDate').value;
      const time = document.getElementById('mkTime').value.trim();
      if (!date || (!name && !time)) return;
      this.config.marks = this.config.marks || [];
      this.config.marks.push({ name, date, time, icon: 'MARK' });
      closeModal('markModal');
      this.renderMarks();
      this.scheduleSave();
    });
  }

  esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

window.addEventListener('DOMContentLoaded', () => new WallCraftConsole());

/* JH-WallCraft Right · Monitor 0 实时交互控制 */
(function () {
  'use strict';

  var WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var lastDayKey = '';
  var lastSlow = null;

  var client = new WC.WallCraftLiveClient({
    screen: 'm1_right',
    onTick: function (now) {
      var y = now.getFullYear();
      var m = ('0' + (now.getMonth() + 1)).slice(-2);
      var d = ('0' + now.getDate()).slice(-2);
      var hh = ('0' + now.getHours()).slice(-2);
      var mm = ('0' + now.getMinutes()).slice(-2);
      var ss = ('0' + now.getSeconds()).slice(-2);
      var dayKey = y + '-' + m + '-' + d;

      document.getElementById('dateText').textContent = y + '.' + m + '.' + d;
      document.getElementById('clockText').textContent = hh + ':' + mm + ':' + ss;
      document.getElementById('subText').textContent =
        WEEKDAYS[now.getDay()] + ' // W' + ('0' + WC.isoWeekNumber(now)).slice(-2) + ' // NODE-01 PRIMARY';

      // Late-night nudge 01:30..05:00
      var hm = now.getHours() * 60 + now.getMinutes();
      var nudge = lastSlow && lastSlow.config ? lastSlow.config.lateNightNudge !== false : true;
      var nightEl = document.getElementById('nightOwlPill');
      if (nightEl) nightEl.classList.toggle('hidden', !(nudge && hm >= 90 && hm <= 300));

      if (lastDayKey && lastDayKey !== dayKey) {
        lastDayKey = dayKey;
        if (lastSlow) renderSlow(lastSlow);
        client.pollSlow(true);
      }
      lastDayKey = dayKey;
    },
    onFast: function (data) {
      renderFast(data);
    },
    onSlow: function (bundle) {
      lastSlow = bundle;
      renderSlow(bundle);
    }
  });

  function renderFast(data) {
    if (!data) return;
    if (data.serverTime) {
      document.getElementById('syncPill').textContent = 'LIVE ' + data.serverTime;
    }
    var m1 = data.m1 || {};
    var g1 = m1.gpu || {};
    var ram = m1.ram || {};
    var disks = m1.disks || [];

    var vramGb = g1.ok ? (g1.vram_used_mb / 1024).toFixed(1) + ' / ' + (g1.vram_total_mb / 1024).toFixed(0) + ' GB' : '--';
    var gpuBusy = g1.ok && g1.util_pct >= 60;
    var rows = [
      {
        label: 'RTX 4090 // GPU & VRAM',
        ok: !!g1.ok,
        busy: gpuBusy,
        val: g1.ok ? g1.util_pct + '% · ' + vramGb + ' · ' + g1.temp_c + 'C · ' + Math.round(g1.power_w || 0) + 'W' : 'OFFLINE',
        pct: g1.vram_pct || 0
      },
      {
        label: 'SYSTEM RAM // MEMORY',
        ok: (ram.total_gb || 0) > 0,
        busy: false,
        val: (ram.used_gb || 0).toFixed(1) + ' / ' + (ram.total_gb || 0).toFixed(1) + ' GB (' + (ram.pct || 0) + '%)',
        pct: ram.pct || 0
      }
    ];
    for (var i = 0; i < Math.min(2, disks.length); i++) {
      var dk = disks[i];
      rows.push({
        label: 'LOCAL DISK // ' + dk.drive + ':\\',
        ok: true,
        busy: (dk.pct || 0) >= 90,
        val: '已用 ' + Math.round(dk.used_gb) + ' / ' + Math.round(dk.total_gb) + ' GB · 剩余 ' + Math.round(dk.free_gb) + ' GB',
        pct: dk.pct || 0
      });
    }

    var html = '';
    for (var r = 0; r < rows.length; r++) {
      var it = rows[r];
      var dotCls = it.busy ? 'busy' : (it.ok ? '' : 'off');
      html += '<div class="hw-item">' +
        '<div class="hw-top">' +
          '<span class="hw-label"><i class="status-dot ' + dotCls + '"></i>' + WC.escHtml(it.label) + '</span>' +
          '<span class="hw-val mono">' + WC.escHtml(it.val) + '</span>' +
        '</div>' +
        '<div class="progress-track"><div class="progress-fill" style="width:' + Math.max(0, Math.min(100, it.pct)) + '%"></div></div>' +
      '</div>';
    }
    document.getElementById('hwList').innerHTML = html;
  }

  function renderSlow(bundle) {
    if (!bundle) return;
    var cfg = bundle.config || {};
    var mode = cfg.mode || 'daily';
    var cleanMode = (mode === 'clean');

    // Theme & mode pills
    var t = WC.applyThemeCss('m1_right', cfg.themePreset || 'auto-circadian', cfg.glowIntensity || 100, cfg.bezelContinuousGlow !== false);
    document.getElementById('themePill').textContent = t.label;
    var btns = document.querySelectorAll('#modePills .mode-btn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('active', btns[i].getAttribute('data-mode') === mode);
    }

    // Icon dock visibility
    var dock = document.getElementById('iconDockCol');
    if (dock) dock.style.visibility = cfg.iconZones === false ? 'hidden' : 'visible';

    // Countdown (or clean mode clock focus)
    var now = new Date();
    var todayZero = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (cleanMode) {
      document.getElementById('cdMeta').textContent = 'FOCUS MODE // CLEAN DESK';
      document.getElementById('cdName').textContent = '隐私保护已开启';
      document.getElementById('cdDays').textContent = 'CLEAN';
      document.getElementById('cdUnit').textContent = 'PRIVACY GUARD';
      document.getElementById('cdBar').style.width = '100%';
    } else {
      var cd = cfg.countdown || {};
      var targetD = WC.parseLocalDate(cd.date);
      var startD = WC.parseLocalDate(cd.startDate);
      var daysLeft = Math.round((targetD - todayZero) / 86400000);
      var span = Math.max(1, Math.round((targetD - startD) / 86400000));
      var pct = Math.max(0, Math.min(100, Math.round(((todayZero - startD) / 86400000) / span * 100)));
      document.getElementById('cdMeta').textContent = 'DEADLINE // ' + WC.formatLocalDate(targetD);
      document.getElementById('cdName').textContent = WC.cleanText(cd.name || 'TARGET');
      var cdDaysEl = document.getElementById('cdDays');
      cdDaysEl.textContent = daysLeft >= 0 ? String(daysLeft) : '+' + Math.abs(daysLeft);
      cdDaysEl.style.color = daysLeft <= 7 ? '#f43f5e' : '#f8fafc';
      document.getElementById('cdUnit').textContent = daysLeft >= 0 ? 'DAYS LEFT' : 'DAYS OVER';
      document.getElementById('cdBar').style.width = pct + '%';
    }

    // Todos vs Clean Mode GitHub pulse
    var todoCont = document.getElementById('todoContainer');
    var cleanHm = document.getElementById('cleanHeatmap');
    var focusTitle = document.getElementById('focusCardTitle');
    var focusPill = document.getElementById('focusStatPill');

    if (cleanMode) {
      var gh = bundle.github || {};
      focusTitle.textContent = '本地代码提交脉搏 // GITHUB PULSE';
      focusPill.textContent = (gh.total_commits || 0) + ' COMMITS · ' + (gh.streak_days || 0) + 'D STREAK';
      todoCont.classList.add('hidden');
      cleanHm.classList.remove('hidden');
      renderCleanHeatmap(cleanHm, gh);
    } else {
      cleanHm.classList.add('hidden');
      todoCont.classList.remove('hidden');
      focusTitle.textContent = '今日聚焦 // TOP FOCUS';
      var todos = cfg.todos || [];
      var doneCnt = todos.filter(function (x) { return !!x.done; }).length;
      focusPill.textContent = doneCnt + '/' + todos.length + ' DONE';

      var indexed = todos.map(function (item, idx) {
        return { item: item, idx: idx };
      });
      indexed.sort(function (a, b) {
        if (!!a.item.done !== !!b.item.done) return a.item.done ? 1 : -1;
        var ap = !!(a.item.p0 || String(a.item.text || '').indexOf('🔴') >= 0);
        var bp = !!(b.item.p0 || String(b.item.text || '').indexOf('🔴') >= 0);
        return (bp ? 1 : 0) - (ap ? 1 : 0);
      });

      var tHtml = '';
      for (var ti = 0; ti < Math.min(7, indexed.length); ti++) {
        var row = indexed[ti];
        var tItem = row.item;
        var isDone = !!tItem.done;
        var isP0 = !!(tItem.p0 || String(tItem.text || '').indexOf('🔴') >= 0);
        var cls = 'todo-item' + (isDone ? ' done' : '') + (isP0 && !isDone ? ' p0' : '');
        tHtml += '<div class="' + cls + '" data-idx="' + row.idx + '">' +
          '<span class="todo-box">' + (isDone ? '✓' : '') + '</span>' +
          '<span class="todo-txt">' + WC.escHtml(WC.cleanText(tItem.text)) + '</span>' +
          (isP0 && !isDone ? '<span class="pill pill-rose">P0</span>' : '') +
        '</div>';
      }
      if (!indexed.length) {
        tHtml = '<div style="color:#94a3b8;font-size:15px;">暂无待办，可在 18766 控制台添加今日焦点任务</div>';
      }
      todoCont.innerHTML = tHtml;
    }

    // Thesis live stats
    var th = bundle.thesis || {};
    var totalCjk = th.total_cjk || 0;
    var targetW = th.target_words || cfg.thesisTargetWords || 40000;
    var thPct = th.pct || 0;
    document.getElementById('thesisTotal').textContent = totalCjk.toLocaleString();
    document.getElementById('thesisSub').textContent = '/ ' + targetW.toLocaleString() + ' 字 (' + thPct.toFixed(1) + '%)';
    document.getElementById('thesisUpd').textContent = 'UPD ' + (th.updated || '--');
    document.getElementById('thesisBar').style.width = Math.min(100, thPct) + '%';

    var chs = th.chapters || [];
    var maxCh = 1;
    for (var ci = 0; ci < chs.length; ci++) maxCh = Math.max(maxCh, chs[ci].cjk || 1);
    var chHtml = '';
    for (var j = 0; j < Math.min(7, chs.length); j++) {
      var c = chs[j];
      var wPct = Math.round(((c.cjk || 0) / maxCh) * 100);
      chHtml += '<div class="ch-row">' +
        '<span class="ch-name">' + WC.escHtml(c.label) + '</span>' +
        '<div class="progress-track" style="height:6px;"><div class="progress-fill" style="width:' + wPct + '%"></div></div>' +
        '<span class="ch-cnt">' + (c.cjk || 0).toLocaleString() + '</span>' +
      '</div>';
    }
    document.getElementById('chapterList').innerHTML = chHtml;

    // Memos (or streak summary in clean mode)
    var memoTitle = document.getElementById('memoTitle');
    var memoList = document.getElementById('memoList');
    if (cleanMode) {
      var gh2 = bundle.github || {};
      memoTitle.textContent = '创作节奏 // GITHUB STREAK';
      memoList.innerHTML =
        '<div class="memo-row"><i class="memo-dot"></i>连续提交 ' + (gh2.streak_days || 0) + ' 天 · 今日 +' + (gh2.today_commits || 0) + ' commits</div>' +
        '<div class="memo-row"><i class="memo-dot"></i>近12周累计 ' + (gh2.total_commits || 0) + ' commits · 活跃 ' + (gh2.active_days || 0) + ' 天</div>';
    } else {
      memoTitle.textContent = '灵感与备忘 // MEMO';
      var memos = cfg.memos || [];
      var mHtml = '';
      for (var mi = 0; mi < Math.min(4, memos.length); mi++) {
        mHtml += '<div class="memo-row"><i class="memo-dot"></i><span>' + WC.escHtml(WC.cleanText(memos[mi].text)) + '</span></div>';
      }
      memoList.innerHTML = mHtml;
    }

    // Papers radar
    var pp = bundle.papers || {};
    document.getElementById('paperStatPill').textContent = '馆藏 ' + (pp.total_docs || 0) + ' 篇 · 今日 +' + (pp.today_count || 0);
    var pList = pp.papers || [];
    var pHtml = '';
    for (var pi = 0; pi < Math.min(5, pList.length); pi++) {
      var doc = pList[pi];
      var badge = doc.is_today
        ? '<span class="pill pill-green" style="padding:2px 7px;font-size:11px;">TODAY</span>'
        : '<span class="pill" style="padding:2px 7px;font-size:11px;">' + WC.escHtml(doc.year || 'REF') + '</span>';
      var meta = [doc.authors || 'Unknown', (doc.pages || 0) + 'p', doc.added_at || ''].filter(Boolean).join(' · ');
      pHtml += '<div class="paper-row">' + badge +
        '<div class="paper-info">' +
          '<div class="paper-title">' + WC.escHtml(doc.title) + '</div>' +
          '<div class="paper-meta">' + WC.escHtml(meta) + '</div>' +
        '</div>' +
      '</div>';
    }
    document.getElementById('paperList').innerHTML = pHtml;
  }

  function renderCleanHeatmap(container, gh) {
    var cells = gh.cells || [];
    if (!cells.length) { container.innerHTML = ''; return; }
    var maxCnt = Math.max(1, gh.max_daily || 1);
    var byPos = {};
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      byPos[c.dow + '_' + c.week] = c;
    }
    var dows = ['M', '', 'W', '', 'F', '', 'S'];
    var html = '';
    for (var row = 0; row < 7; row++) {
      html += '<span class="hm-dow">' + dows[row] + '</span>';
      for (var col = 0; col < 12; col++) {
        var cell = byPos[row + '_' + col];
        if (!cell || cell.future) {
          html += '<div class="hm-cell future"></div>';
        } else {
          var cnt = cell.count || 0;
          var lvl = '';
          if (cnt > 0) {
            var r = cnt / maxCnt;
            lvl = r < 0.25 ? 'l1' : (r < 0.55 ? 'l2' : (r < 0.8 ? 'l3' : 'l4'));
          }
          html += '<div class="hm-cell ' + lvl + '" title="' + cell.date + ': ' + cnt + ' commits"></div>';
        }
      }
    }
    container.innerHTML = html;
  }

  // Click todo directly on desktop to toggle completion
  document.getElementById('todoContainer').addEventListener('click', function (e) {
    var row = e.target.closest('.todo-item');
    if (!row) return;
    var idx = parseInt(row.getAttribute('data-idx'), 10);
    if (isNaN(idx)) return;
    client.postAction('/api/todo-toggle', { index: idx });
  });

  // Click mode buttons directly on desktop
  document.getElementById('modePills').addEventListener('click', function (e) {
    var btn = e.target.closest('.mode-btn');
    if (!btn) return;
    var mode = btn.getAttribute('data-mode');
    if (mode) client.postAction('/api/mode', { mode: mode });
  });

  client.start();
})();

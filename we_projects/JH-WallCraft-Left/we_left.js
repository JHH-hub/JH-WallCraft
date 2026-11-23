/* JH-WallCraft Left · Monitor 1 实时日历与热力图控制 */
(function () {
  'use strict';

  var lastDayKey = '';
  var lastSlow = null;

  var client = new WC.WallCraftLiveClient({
    screen: 'm1_left',
    onTick: function (now) {
      var hh = ('0' + now.getHours()).slice(-2);
      var mm = ('0' + now.getMinutes()).slice(-2);
      var ss = ('0' + now.getSeconds()).slice(-2);
      var dayKey = WC.formatLocalDate(now);
      document.getElementById('leftClock').textContent = hh + ':' + mm + ':' + ss;

      if (lastDayKey && lastDayKey !== dayKey) {
        lastDayKey = dayKey;
        if (lastSlow) renderSlow(lastSlow);
        client.pollSlow(true);
      }
      lastDayKey = dayKey;
    },
    onFast: function (data) {
      if (data && data.serverTime) {
        document.getElementById('leftSyncPill').textContent = 'LIVE ' + data.serverTime;
      }
    },
    onSlow: function (bundle) {
      lastSlow = bundle;
      renderSlow(bundle);
    }
  });

  function renderSlow(bundle) {
    if (!bundle) return;
    var cfg = bundle.config || {};
    WC.applyThemeCss('m1_left', cfg.themePreset || 'auto-circadian', cfg.glowIntensity || 100, cfg.bezelContinuousGlow !== false);

    renderCalendar(cfg);
    renderGithub(bundle.github || {});
    renderThesisOverview(bundle.thesis || {}, bundle.papers || {}, cfg.thesisTargetWords || 40000);
  }

  function hexAlpha(hex, alpha) {
    var h = String(hex || '#38bdf8').replace('#', '');
    if (h.length !== 6) return 'rgba(56,189,248,' + alpha + ')';
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  function renderCalendar(cfg) {
    var now = new Date();
    var todayStr = WC.formatLocalDate(now);
    var cs = WC.parseLocalDate(cfg.calendarStart || todayStr);
    var ce = WC.parseLocalDate(cfg.calendarEnd || todayStr);

    var titleEl = document.getElementById('calSpanTitle');
    titleEl.textContent = (cs.getFullYear() + '.' + ('0' + (cs.getMonth() + 1)).slice(-2)) +
      ' — ' + (ce.getFullYear() + '.' + ('0' + (ce.getMonth() + 1)).slice(-2));

    var dowCs = cs.getDay() === 0 ? 6 : cs.getDay() - 1;
    var gridMonday = new Date(cs.getFullYear(), cs.getMonth(), cs.getDate() - dowCs);
    var cleanMode = (cfg.mode === 'clean');

    // Pre-allocate non-overlapping event lanes
    var dayLanes = {}; // ds -> [ev0, ev1]
    if (!cleanMode) {
      var occ = {};
      var events = cfg.events || [];
      for (var ei = 0; ei < events.length; ei++) {
        var ev = events[ei];
        var es = WC.parseLocalDate(ev.start);
        var ee = WC.parseLocalDate(ev.end || ev.start);
        if (ee < es) { var tmp = es; es = ee; ee = tmp; }
        var days = [];
        for (var k = 0; k < 42; k++) {
          var cd = new Date(gridMonday.getFullYear(), gridMonday.getMonth(), gridMonday.getDate() + k);
          if (cd >= es && cd <= ee) days.push(WC.formatLocalDate(cd));
        }
        if (!days.length) continue;

        var lane = 0;
        while (lane < 2) {
          var conflict = false;
          for (var di = 0; di < days.length; di++) {
            if (occ[days[di] + '_' + lane]) { conflict = true; break; }
          }
          if (!conflict) break;
          lane++;
        }
        if (lane >= 2) lane = 1;

        for (var dj = 0; dj < days.length; dj++) {
          var dsKey = days[dj];
          occ[dsKey + '_' + lane] = true;
          if (!dayLanes[dsKey]) dayLanes[dsKey] = [null, null];
          dayLanes[dsKey][lane] = {
            name: WC.cleanText(ev.name),
            color: ev.color || '#38bdf8',
            showLabel: dj === 0 || (new Date(WC.parseLocalDate(dsKey)).getDay() === 1)
          };
        }
      }
    }

    var msByDay = {};
    var mkByDay = {};
    if (!cleanMode) {
      (cfg.milestones || []).forEach(function (ms) {
        if (ms.date && !msByDay[ms.date]) msByDay[ms.date] = ms;
      });
      (cfg.marks || []).forEach(function (mk) {
        if (mk.date && !mkByDay[mk.date]) mkByDay[mk.date] = mk;
      });
    }

    var html = '';
    for (var i = 0; i < 42; i++) {
      var d = new Date(gridMonday.getFullYear(), gridMonday.getMonth(), gridMonday.getDate() + i);
      var ds = WC.formatLocalDate(d);
      var col = i % 7;
      var inRange = (d >= cs && d <= ce);
      var isToday = (ds === todayStr);
      var isWknd = (col >= 5);

      var cls = 'cal-cell' + (!inRange ? ' out' : '') + (isToday ? ' today' : '') + (isWknd ? ' wknd' : '');
      var topRight = '';
      if (isToday) {
        topRight = '<span class="pill pill-accent" style="padding:1px 6px;font-size:10px;">TODAY</span>';
      } else if (mkByDay[ds]) {
        var mk = mkByDay[ds];
        topRight = '<span class="pill pill-rose" style="padding:1px 6px;font-size:10px;">' + WC.escHtml(WC.cleanText(mk.time || mk.name)) + '</span>';
      }

      var lanesHtml = '<div class="cal-lanes">';
      var lanes = dayLanes[ds];
      if (lanes) {
        for (var l = 0; l < 2; l++) {
          var item = lanes[l];
          if (item) {
            lanesHtml += '<div class="cal-ev-bar" style="background:' + hexAlpha(item.color, 0.22) + ';border:1px solid ' + hexAlpha(item.color, 0.85) + ';">' +
              (item.showLabel ? WC.escHtml(item.name) : '&nbsp;') + '</div>';
          } else if (l === 0 && lanes[1]) {
            lanesHtml += '<div class="cal-ev-bar" style="visibility:hidden;">&nbsp;</div>';
          }
        }
      }
      lanesHtml += '</div>';

      var msHtml = '';
      if (msByDay[ds]) {
        var ms = msByDay[ds];
        msHtml = '<div class="cal-ms-pill" style="background:' + WC.escHtml(ms.color || '#f43f5e') + ';">' + WC.escHtml(WC.cleanText(ms.name)) + '</div>';
      }

      html += '<div class="' + cls + '">' +
        '<div class="cal-cell-top">' +
          '<span class="cal-day-wrap"><span class="cal-day-num num">' + d.getDate() + '</span>' +
          ((d.getDate() === 1 || i === 0) ? '<span class="cal-mon-tag">' + (d.getMonth() + 1) + '月</span>' : '') +
          '</span>' + topRight +
        '</div>' +
        lanesHtml + msHtml +
      '</div>';
    }
    document.getElementById('calGrid').innerHTML = html;
  }

  function renderGithub(gh) {
    document.getElementById('ghKpi').textContent =
      (gh.total_commits || 0) + ' COMMITS · ' + (gh.active_days || 0) + 'D ACTIVE · STREAK ' + (gh.streak_days || 0) + 'D · TODAY ' + (gh.today_commits || 0);

    var cells = gh.cells || [];
    var maxCnt = Math.max(1, gh.max_daily || 1);
    var byPos = {};
    for (var i = 0; i < cells.length; i++) {
      byPos[cells[i].dow + '_' + cells[i].week] = cells[i];
    }
    var dows = ['M', '', 'W', '', 'F', '', 'S'];
    var gHtml = '';
    for (var r = 0; r < 7; r++) {
      gHtml += '<span class="hm-dow">' + dows[r] + '</span>';
      for (var c = 0; c < 12; c++) {
        var cell = byPos[r + '_' + c];
        if (!cell || cell.future) {
          gHtml += '<div class="hm-cell future"></div>';
        } else {
          var cnt = cell.count || 0;
          var lvl = '';
          if (cnt > 0) {
            var ratio = cnt / maxCnt;
            lvl = ratio < 0.25 ? 'l1' : (ratio < 0.55 ? 'l2' : (ratio < 0.8 ? 'l3' : 'l4'));
          }
          gHtml += '<div class="hm-cell ' + lvl + '" title="' + cell.date + ' · ' + cnt + ' commits"></div>';
        }
      }
    }
    document.getElementById('ghGrid').innerHTML = gHtml;

    var repos = gh.top_repos || [];
    var maxRc = repos.length ? Math.max(1, repos[0].commits || 1) : 1;
    var rHtml = '';
    for (var ri = 0; ri < Math.min(5, repos.length); ri++) {
      var rp = repos[ri];
      var pct = Math.round(((rp.commits || 0) / maxRc) * 100);
      rHtml += '<div>' +
        '<div class="repo-row-top"><span>' + WC.escHtml(rp.name) + '</span><span style="color:var(--accent2);">' + rp.commits + '</span></div>' +
        '<div class="progress-track" style="height:5px;"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }
    document.getElementById('repoList').innerHTML = rHtml;
  }

  function renderThesisOverview(th, pp, targetWords) {
    var cjk = th.total_cjk || 0;
    var target = th.target_words || targetWords || 40000;
    var pct = Math.max(0, Math.min(100, th.pct || 0));
    var circ = 301.59;
    document.getElementById('ringArc').style.strokeDashoffset = (circ * (1 - pct / 100)).toFixed(2);
    document.getElementById('ringPct').textContent = Math.round(pct) + '%';
    document.getElementById('ringSub').textContent = Math.floor(cjk / 1000) + 'k/' + Math.floor(target / 1000) + 'k';

    var chs = th.chapters || [];
    var maxCh = 1;
    for (var i = 0; i < chs.length; i++) maxCh = Math.max(maxCh, chs[i].cjk || 1);
    var chHtml = '';
    for (var j = 0; j < Math.min(7, chs.length); j++) {
      var c = chs[j];
      var wPct = Math.round(((c.cjk || 0) / maxCh) * 100);
      chHtml += '<div class="ch-row" style="grid-template-columns:42% 1fr 48px;font-size:clamp(10px,0.92vmin,13px);">' +
        '<span class="ch-name">' + WC.escHtml(c.label) + '</span>' +
        '<div class="progress-track" style="height:5px;"><div class="progress-fill" style="width:' + wPct + '%"></div></div>' +
        '<span class="ch-cnt">' + (c.cjk || 0).toLocaleString() + '</span>' +
      '</div>';
    }
    document.getElementById('leftChapters').innerHTML = chHtml;

    document.getElementById('refFooter').textContent =
      '文献库: ' + (pp.total_docs || 0) + ' 篇 (' + (pp.total_pages || 0).toLocaleString() + ' 页) · 今日新增 +' + (pp.today_count || 0);
  }

  client.start();
})();

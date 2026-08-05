const { createCanvas } = require('canvas');
const fs = require('fs');

// ─────────────────────────────────────────────
// 日期工具（全部使用本地时间，避免 UTC 偏移导致"今天"高亮错误）
// ─────────────────────────────────────────────
const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = new Date();
today.setHours(0, 0, 0, 0); // 本地今天零点

// 从字符串构造本地日期（避免 new Date("YYYY-MM-DD") 被解析为 UTC）
function localDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

// 计算两个本地日期相差天数
function diffDays(a, b) {
    return Math.round((b - a) / 86400000);
}

// ─────────────────────────────────────────────
// 配置（8月内容，可自由编辑）
// ─────────────────────────────────────────────
function getConfig() {
    const t = new Date();
    const startDate = new Date(t.getFullYear(), t.getMonth(), 1); // 本月1号
    const endDate = new Date(t.getFullYear(), t.getMonth() + 2, 0); // 下下月0号=下月最后一天
    return {
        calendarStart: fmt(startDate),
        calendarEnd: fmt(endDate),
        countdown: { name: '论文初稿', date: '2026-09-30' },
        glowIntensity: 100,
        glowCount: 3,
        glowPreset: 'blue-purple',
        bgImageEnabled: false,
        events: [
            { name: '论文写作', start: '2026-08-01', end: '2026-08-31', color: '#60a5fa' },
            { name: '春芽计划·提交', start: '2026-08-01', end: '2026-08-10', color: '#4ade80' },
            { name: '转正答辩·资料整理', start: '2026-08-20', end: '2026-08-31', color: '#f59e0b' },
            { name: '毕设中筛·准备', start: '2026-09-01', end: '2026-09-15', color: '#a78bfa' },
        ],
        milestones: [
            { name: '春芽提交', date: '2026-08-10', color: '#4ade80' },
            { name: '周报', date: '2026-08-14', color: '#60a5fa' },
            { name: '周报', date: '2026-08-21', color: '#60a5fa' },
            { name: '周报', date: '2026-08-28', color: '#60a5fa' },
            { name: '转正答辩', date: '2026-08-29', color: '#f59e0b' },
        ],
        marks: [
            { name: '朋友考试', date: '2026-08-08', time: '22:30', icon: '🎓' },
            { name: '朋友考试', date: '2026-08-15', time: '18:30', icon: '🎓' },
            { name: '朋友考试', date: '2026-08-22', time: '22:30', icon: '🎓' },
        ],
        todos: [
            { text: '完成论文第2章初稿', done: false },
            { text: '春芽计划·产品说明定稿', done: false },
            { text: '春芽计划·截图补全', done: false },
            { text: '转正答辩·材料梳理', done: false },
            { text: '阅读2篇核心文献', done: false },
        ],
        memos: [
            { text: '答辩材料归档到 NAS', done: false },
            { text: '春芽计划 8.10 截止提交', done: false },
            { text: '毕设中筛预计 9 月中旬', done: false },
        ],
        // 项目进度（用于环形图）
        projects: [
            { name: '论文', pct: 35, color: '#60a5fa' },
            { name: '春芽计划', pct: 70, color: '#4ade80' },
            { name: '转正答辩', pct: 20, color: '#f59e0b' },
            { name: '毕设中筛', pct: 10, color: '#a78bfa' },
        ],
        // 本周待办完成趋势（周一到周日）
        weekDone: [3, 5, 4, 6, 2, 0, 0],
        weekTotal: [5, 6, 5, 7, 5, 0, 0],
    };
}

// ─────────────────────────────────────────────
// AssetDesk 数据对接（读取真实项目进度与完成趋势）
// ─────────────────────────────────────────────
const ASSETDESK_DIR = 'C:/Users/jihuiwang/Documents/GitHub/Vertex-AssetDesk';

function readJsonSafe(p) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) { return null; }
}

// 从 animTracker_v6.json 计算各项目完成度（done slots / total slots）
function loadAssetProjects() {
    const d = readJsonSafe(ASSETDESK_DIR + '/data/animTracker_v6.json');
    if (!d || !Array.isArray(d.projects)) return null;
    const out = [];
    for (const p of d.projects) {
        const levels = p.levels || [];
        const slots = [];
        for (const l of levels) for (const s of (l.slots || [])) slots.push(s);
        if (!slots.length) continue;
        const done = slots.filter(s => s.state === 'done').length;
        const pct = Math.round(done / slots.length * 100);
        out.push({ name: p.name, pct, total: slots.length, done });
    }
    return out;
}

// 从 events.jsonl 统计本周（周一到周日）每日事件活动量（所有事件，含扫描/状态变化）
function loadWeekDone() {
    const p = ASSETDESK_DIR + '/events.jsonl';
    let lines;
    try { lines = fs.readFileSync(p, 'utf-8').split('\n'); } catch (e) { return null; }
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 周一=0
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const done = new Array(7).fill(0);
    const total = new Array(7).fill(0);
    for (const line of lines) {
        if (!line.trim()) continue;
        let ev;
        try { ev = JSON.parse(line); } catch (e) { continue; }
        if (!ev.ts) continue;
        const d = new Date(ev.ts);
        const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        const diff = Math.round((day - monday) / 86400000);
        if (diff >= 0 && diff < 7) {
            total[diff]++; // 活动量 = 当天所有事件数
            if (ev.event === 'slot_state_change' && ev.to_state === 'done') done[diff]++;
        }
    }
    // 若本周活动量为 0（周初无数据），回退到最近7天
    if (total.every(v => v === 0)) {
        const done7 = new Array(7).fill(0);
        const total7 = new Array(7).fill(0);
        for (const line of lines) {
            if (!line.trim()) continue;
            let ev;
            try { ev = JSON.parse(line); } catch (e) { continue; }
            if (!ev.ts) continue;
            const d = new Date(ev.ts);
            const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
            const diff = Math.round((now - day) / 86400000);
            if (diff >= 0 && diff < 7) {
                total7[6 - diff]++;
                if (ev.event === 'slot_state_change' && ev.to_state === 'done') done7[6 - diff]++;
            }
        }
        return { done: done7, total: total7, fallback: true };
    }
    return { done, total };
}

// 合并：优先用 AssetDesk 真实数据，缺失时回退到配置占位
function mergeAssetData(cfg) {
    const projects = loadAssetProjects();
    if (projects && projects.length) {
        // 取进行中的项目（未100%完成），按完成度升序，最多6个
        const active = projects.filter(p => p.pct < 100).sort((a, b) => a.pct - b.pct).slice(0, 6);
        if (active.length) {
            const palette = ['#60a5fa', '#fb923c', '#f87171', '#a78bfa', '#4ade80', '#fbbf24'];
            cfg.projects = active.map((p, i) => ({ name: p.name, pct: p.pct, color: palette[i % palette.length] }));
        }
    }
    const week = loadWeekDone();
    if (week) {
        // 仅当 AssetDesk 数据充足（至少3天有活动）时才覆盖，否则保留配置占位
        const activeDays = week.total.filter(v => v > 0).length;
        if (activeDays >= 3) {
            cfg.weekDone = week.done;
            cfg.weekTotal = week.total;
            cfg.weekSource = 'AssetDesk';
        } else {
            cfg.weekSource = 'manual';
        }
    }
    return cfg;
}

// ─────────────────────────────────────────────
// 渲染
// ─────────────────────────────────────────────
function rr(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function generate(W, H, cfg) {
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const s = W / 3840;
    const lm = Math.round(1150 * s), rm = Math.round(120 * s), tm = Math.round(100 * s);
    const ct = Math.round(250 * s), cw = Math.round(310 * s), ch = Math.round(175 * s);
    const tfs = Math.round(56 * s), sfs = Math.round(32 * s), dfs = Math.round(36 * s);
    const smfs = Math.round(18 * s), efs = Math.round(18 * s);

    // 基础背景
    ctx.fillStyle = '#08080f';
    ctx.fillRect(0, 0, W, H);

    // 弥散光（蓝紫色系）
    const clrs = [[80, 120, 220], [160, 100, 200], [100, 80, 180]];
    const intn = (cfg.glowIntensity || 100) / 100;
    const glowPositions = [
        { x: 0.58, y: 0.1, r: 0.5, a: 0.15 },
        { x: 0.66, y: 0.5, r: 0.4, a: 0.12 },
        { x: 0.45, y: 0.7, r: 0.45, a: 0.1 }
    ];
    glowPositions.forEach((p, i) => {
        const [r, g, b] = clrs[i];
        const al = p.a * intn;
        const cx = W * (p.x + 0.3);
        const cy = H * (p.y - 0.3);
        const rad = Math.max(W, H) * p.r;
        const g2 = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        g2.addColorStop(0, `rgba(${r},${g},${b},${al})`);
        g2.addColorStop(0.5, `rgba(${r},${g},${b},${al * 0.5})`);
        g2.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g2;
        ctx.fillRect(0, 0, W, H);
    });

    const now = new Date();

    // 标题：年月
    ctx.font = `bold ${tfs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月`, lm, tm + tfs);

    // 倒计时
    if (cfg.countdown) {
        const td = localDate(cfg.countdown.date);
        const dl = diffDays(today, td);
        ctx.font = `${sfs}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#60a5fa';
        const cdText = dl > 0 ? `距${cfg.countdown.name || '目标'} ${dl} 天` : (dl === 0 ? `${cfg.countdown.name || '目标'}就是今天！` : '目标已过');
        ctx.fillText(cdText, lm, tm + tfs + 50 * s);
    }

    // 右上角今日信息
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const ts = `TODAY  ${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')} ${weekdays[now.getDay()]}`;
    ctx.font = `${Math.round(28 * s)}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#8888aa';
    ctx.fillText(ts, W - rm - ctx.measureText(ts).width, tm + 40 * s);

    // 星期标题行
    const wn = ['一', '二', '三', '四', '五', '六', '日'];
    ctx.font = `${Math.round(24 * s)}px "Microsoft YaHei", sans-serif`;
    for (let i = 0; i < 7; i++) {
        const x = lm + i * cw + cw / 2;
        ctx.fillStyle = i >= 5 ? '#ff9999' : '#666688';
        ctx.fillText(wn[i], x - ctx.measureText(wn[i]).width / 2, ct);
    }

    // 日历网格
    const cs = cfg.calendarStart ? localDate(cfg.calendarStart) : new Date();
    const ce = cfg.calendarEnd ? localDate(cfg.calendarEnd) : new Date(cs.getTime() + 41 * 86400000);
    const sw = cs.getDay() || 7;
    const fm = new Date(cs);
    fm.setDate(fm.getDate() - (sw - 1));
    const gt = ct + 40 * s;
    const d2c = {};
    let cd = new Date(fm);

    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const x = lm + col * cw, y = gt + row * ch;
            d2c[fmt(cd)] = { x, y, col, row };
            const ir = cd >= cs && cd <= ce;
            const it = cd.getTime() === today.getTime();
            const pd = 4 * s;
            ctx.beginPath();
            rr(ctx, x + pd, y + pd, cw - pd * 2, ch - pd * 2, 10 * s);
            if (it) {
                ctx.fillStyle = 'rgba(30,50,80,0.8)';
                ctx.fill();
                ctx.strokeStyle = '#60a5fa';
                ctx.lineWidth = 3 * s;
                ctx.stroke();
            } else if (ir) {
                ctx.strokeStyle = '#252535';
                ctx.lineWidth = 1 * s;
                ctx.stroke();
            } else {
                ctx.strokeStyle = '#151520';
                ctx.lineWidth = 1 * s;
                ctx.stroke();
            }
            cd.setDate(cd.getDate() + 1);
        }
    }

    // 时间线事件
    if (cfg.events) {
        const bh = 28 * s, tyo = 70 * s;
        ctx.font = `${efs}px "Microsoft YaHei", sans-serif`;
        for (const ev of cfg.events) {
            if (!d2c[ev.start]) continue;
            let ec = localDate(ev.start);
            const ee = localDate(ev.end);
            const segs = [];
            while (ec <= ee) {
                const k = fmt(ec);
                const cl = d2c[k];
                if (cl) {
                    if (segs.length === 0 || segs[segs.length - 1].row !== cl.row) {
                        segs.push({ row: cl.row, ec: cl.col, sx: cl.x, y: cl.y, first: segs.length === 0 });
                    } else {
                        segs[segs.length - 1].ec = cl.col;
                    }
                }
                ec.setDate(ec.getDate() + 1);
            }
            for (const sg of segs) {
                const sx = sg.sx + 10 * s, ex = lm + sg.ec * cw + cw - 10 * s, sy = sg.y + tyo;
                ctx.beginPath();
                rr(ctx, sx, sy, ex - sx, bh, 6 * s);
                ctx.strokeStyle = ev.color || '#60a5fa';
                ctx.lineWidth = 2 * s;
                ctx.stroke();
                if (sg.first) {
                    ctx.fillStyle = ev.color || '#60a5fa';
                    ctx.fillText(ev.name.length > 8 ? ev.name.slice(0, 7) + '…' : ev.name, sx + 10 * s, sy + 18 * s);
                }
            }
        }
    }

    // 关键节点
    if (cfg.milestones) {
        const bh = 28 * s, tyo = 70 * s;
        ctx.font = `bold ${efs}px "Microsoft YaHei", sans-serif`;
        for (const ml of cfg.milestones) {
            const cl = d2c[ml.date];
            if (!cl) continue;
            const tx = cl.x + 10 * s, ty = cl.y + tyo;
            const tw = ctx.measureText(ml.name).width + 16 * s;
            ctx.beginPath();
            rr(ctx, tx, ty, tw, bh, 6 * s);
            ctx.fillStyle = ml.color || '#4ade80';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.fillText(ml.name, tx + 8 * s, ty + 18 * s);
        }
    }

    // 特殊标记
    if (cfg.marks) {
        ctx.font = `${16 * s}px "Microsoft YaHei", sans-serif`;
        for (const mk of cfg.marks) {
            const cl = d2c[mk.date];
            if (!cl) continue;
            const label = mk.time ? `${mk.icon}${mk.time}` : mk.icon + mk.name;
            const labelWidth = ctx.measureText(label).width + 10 * s;
            const markX = cl.x + cw - labelWidth - 10 * s;
            const markY = cl.y + ch - 35 * s;
            ctx.beginPath();
            rr(ctx, markX - 5 * s, markY - 2 * s, labelWidth + 10 * s, 24 * s, 5 * s);
            ctx.fillStyle = '#f472b6';
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.fillText(label, markX, markY + 14 * s);
        }
    }

    // 日期数字
    let cd2 = new Date(fm);
    ctx.font = `bold ${dfs}px "Microsoft YaHei", sans-serif`;
    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const x = lm + col * cw, y = gt + row * ch;
            const ir = cd2 >= cs && cd2 <= ce;
            const it = cd2.getTime() === today.getTime();
            const iw = col >= 5;
            const nc = !ir ? '#252530' : it ? '#60a5fa' : iw ? '#ff9999' : '#fff';
            if (cd2.getDate() === 1 && ir) {
                ctx.font = `${smfs}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = '#4ade80';
                ctx.fillText(`${cd2.getMonth() + 1}月`, x + 12 * s, y + 22 * s);
                ctx.font = `bold ${dfs}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = nc;
                ctx.fillText(String(cd2.getDate()), x + 12 * s, y + 55 * s);
            } else {
                ctx.fillStyle = nc;
                ctx.fillText(String(cd2.getDate()), x + 12 * s, y + 40 * s);
            }
            cd2.setDate(cd2.getDate() + 1);
        }
    }

    // 图例
    const ly = gt + 6 * ch + 20 * s;
    ctx.font = `${smfs}px "Microsoft YaHei", sans-serif`;
    let lx2 = lm;
    for (const lg of [
        { name: '论文写作', color: '#60a5fa' },
        { name: 'pxlsan', color: '#fb923c' },
        { name: 'OBTI', color: '#f87171' },
        { name: 'ACGTI', color: '#a78bfa' },
        { name: '节点', color: '#4ade80' }
    ]) {
        ctx.beginPath();
        rr(ctx, lx2, ly, 18 * s, 18 * s, 4 * s);
        ctx.fillStyle = lg.color;
        ctx.fill();
        ctx.fillStyle = '#666677';
        ctx.fillText(lg.name, lx2 + 24 * s, ly + 14 * s);
        lx2 += 150 * s;
    }

    // 右侧信息面板（今日待办 + 备忘录，垂直堆叠，带卡片背景）
    const px = lm + 7 * cw + 50 * s; // 右侧起始 x
    const pw = W - rm - px;          // 面板宽度
    const cardPad = 26 * s;
    const cardRadius = 16 * s;

    // 今日待办卡片
    if (cfg.todos && cfg.todos.length > 0) {
        const todoCardTop = ct;
        const todoCardH = 6 * ch * 0.62; // 占日历高度约62%
        // 卡片背景
        ctx.save();
        ctx.beginPath();
        rr(ctx, px, todoCardTop, pw, todoCardH, cardRadius);
        ctx.fillStyle = 'rgba(12,14,30,0.55)';
        ctx.fill();
        ctx.strokeStyle = '#60a5fa44';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        ctx.restore();

        let todoY = todoCardTop + cardPad;
        ctx.font = `bold ${28 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#60a5fa';
        ctx.fillText('今日待办', px + cardPad, todoY + 28 * s);
        todoY += 50 * s;
        const cbSize = 20 * s;
        const itemSpacing = 38 * s;
        ctx.font = `${22 * s}px "Microsoft YaHei", sans-serif`;
        for (const todo of cfg.todos) {
            if (todoY + itemSpacing > todoCardTop + todoCardH - cardPad) break;
            ctx.beginPath();
            rr(ctx, px + cardPad, todoY, cbSize, cbSize, 4 * s);
            if (todo.done) {
                ctx.fillStyle = '#4ade80';
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${16 * s}px "Microsoft YaHei", sans-serif`;
                ctx.fillText('✓', px + cardPad + 4 * s, todoY + 15 * s);
                ctx.font = `${22 * s}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = '#555566';
            } else {
                ctx.strokeStyle = '#555566';
                ctx.lineWidth = 2 * s;
                ctx.stroke();
                ctx.fillStyle = '#ccccdd';
            }
            const displayText = todo.text.length > 16 ? todo.text.slice(0, 15) + '…' : todo.text;
            ctx.fillText(displayText, px + cardPad + cbSize + 10 * s, todoY + 16 * s);
            todoY += itemSpacing;
        }
    }

    // 备忘录卡片
    if (cfg.memos && cfg.memos.length > 0) {
        const memoCardTop = ct + 6 * ch * 0.62 + 20 * s;
        const memoCardH = 6 * ch * 0.38 - 20 * s;
        // 卡片背景
        ctx.save();
        ctx.beginPath();
        rr(ctx, px, memoCardTop, pw, memoCardH, cardRadius);
        ctx.fillStyle = 'rgba(12,14,30,0.55)';
        ctx.fill();
        ctx.strokeStyle = '#fb923c44';
        ctx.lineWidth = 1.5 * s;
        ctx.stroke();
        ctx.restore();

        let memoY = memoCardTop + cardPad;
        ctx.font = `bold ${28 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#fb923c';
        ctx.fillText('备忘录', px + cardPad, memoY + 28 * s);
        memoY += 50 * s;
        ctx.font = `${22 * s}px "Microsoft YaHei", sans-serif`;
        for (const memo of cfg.memos) {
            if (memoY + 38 * s > memoCardTop + memoCardH - cardPad) break;
            ctx.fillStyle = '#8888aa';
            const displayText = memo.text.length > 16 ? memo.text.slice(0, 15) + '…' : memo.text;
            ctx.fillText('· ' + displayText, px + cardPad, memoY + 16 * s);
            memoY += 38 * s;
        }
    }

    // ─────────────────────────────────────────────
    // 数据图表区（日历正下方，横跨日历宽度）
    // 布局：环形图（左）+ 柱状图（右）左右并排，各占一半宽度
    // ─────────────────────────────────────────────
    const chartX = lm;
    const chartW = 7 * cw;
    const chartY = gt + 6 * ch + 30 * s; // 日历网格正下方
    const halfW = chartW / 2;

    // 1) 项目进度环形图（左半区，图例横向单行）
    if (cfg.projects && cfg.projects.length > 0) {
        const donutCX = chartX + halfW * 0.28;
        const donutCY = chartY + 150 * s;
        const donutR = 78 * s;
        const gap = 6 * s;

        // 标题
        ctx.font = `bold ${30 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('项目进度', chartX, chartY + 30 * s);

        // 背景环
        ctx.beginPath();
        ctx.arc(donutCX, donutCY, donutR, 0, Math.PI * 2);
        ctx.strokeStyle = '#1a1a2a';
        ctx.lineWidth = 20 * s;
        ctx.stroke();

        // 各项目分段
        let startAngle = -Math.PI / 2;
        for (const p of cfg.projects) {
            const frac = p.pct / 100;
            const endAngle = startAngle + frac * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(donutCX, donutCY, donutR, startAngle + gap * s / donutR, endAngle - gap * s / donutR);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 20 * s;
            ctx.lineCap = 'round';
            ctx.stroke();
            startAngle = endAngle;
        }

        // 中心百分比
        const avgPct = Math.round(cfg.projects.reduce((a, p) => a + p.pct, 0) / cfg.projects.length);
        ctx.font = `bold ${40 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText(avgPct + '%', donutCX, donutCY + 14 * s);
        ctx.font = `${16 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#8888aa';
        ctx.fillText('总进度', donutCX, donutCY + 40 * s);
        ctx.textAlign = 'left';

        // 图例（环形图右侧，横向单行，最多6个，项目名截断更短）
        const lgStartX = donutCX + donutR + 28 * s;
        const lgStartY = donutCY - donutR + 6 * s;
        const lgRowH = 30 * s;
        ctx.font = `${20 * s}px "Microsoft YaHei", sans-serif`;
        cfg.projects.forEach((p, i) => {
            const ly = lgStartY + i * lgRowH;
            ctx.beginPath();
            ctx.arc(lgStartX + 8 * s, ly + 8 * s, 6 * s, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.fillStyle = '#ccccdd';
            // 项目名超过5个字符时截断
            const shortName = p.name.length > 5 ? p.name.slice(0, 5) + '…' : p.name;
            ctx.fillText(`${shortName} ${p.pct}%`, lgStartX + 22 * s, ly + 12 * s);
        });
    }

    // 2) 本周完成趋势（柱状图，右半区）
    if (cfg.weekDone && cfg.weekDone.length > 0) {
        const barX0 = chartX + halfW;
        ctx.font = `bold ${30 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#ffffff';
        const barTitle = cfg.weekSource === 'AssetDesk' ? '本周资产活动' : '本周完成趋势';
        ctx.fillText(barTitle, barX0, chartY + 30 * s);
        // 数据来源标注
        if (cfg.weekSource === 'AssetDesk') {
            ctx.font = `${16 * s}px "Microsoft YaHei", sans-serif`;
            ctx.fillStyle = '#666688';
            ctx.textAlign = 'right';
            ctx.fillText('AssetDesk', chartX + chartW, chartY + 30 * s);
            ctx.textAlign = 'left';
        }

        const barW = 40 * s;
        const barGap = 22 * s;
        const chartH = 150 * s;
        const baseY = chartY + 56 * s + chartH;
        const maxVal = Math.max(...cfg.weekTotal, 1);
        const wd = ['一', '二', '三', '四', '五', '六', '日'];
        // AssetDesk 模式：直接用活动量(total)作为彩色柱子；manual 模式：完成量(done)前景 + 总量背景
        const isAsset = cfg.weekSource === 'AssetDesk';
        // 柱状图整体居中于右半区
        const totalBarW = 7 * barW + 6 * barGap;
        const barStartX = barX0 + (halfW - totalBarW) / 2;

        for (let i = 0; i < cfg.weekDone.length; i++) {
            const bx = barStartX + i * (barW + barGap);
            const val = isAsset ? cfg.weekTotal[i] : cfg.weekDone[i];
            const totalH = (cfg.weekTotal[i] / maxVal) * chartH;
            const valH = (val / maxVal) * chartH;

            if (!isAsset) {
                // 总量背景条（仅 manual 模式）
                ctx.beginPath();
                rr(ctx, bx, baseY - totalH, barW, totalH, 5 * s);
                ctx.fillStyle = '#1a1a2a';
                ctx.fill();
            }

            // 彩色柱子（AssetDesk=活动量，manual=完成量）
            if (valH > 0) {
                ctx.beginPath();
                rr(ctx, bx, baseY - valH, barW, valH, 5 * s);
                ctx.fillStyle = i === now.getDay() - 1 ? '#60a5fa' : '#4ade80';
                ctx.fill();
            }

            // 数值标签
            if (valH > 0) {
                ctx.font = `bold ${18 * s}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = i === now.getDay() - 1 ? '#60a5fa' : '#4ade80';
                ctx.textAlign = 'center';
                ctx.fillText(val, bx + barW / 2, baseY - valH - 8 * s);
                ctx.textAlign = 'left';
            }

            // 星期标签
            ctx.font = `${18 * s}px "Microsoft YaHei", sans-serif`;
            ctx.fillStyle = i === now.getDay() - 1 ? '#60a5fa' : '#666688';
            ctx.textAlign = 'center';
            ctx.fillText(wd[i], bx + barW / 2, baseY + 22 * s);
            ctx.textAlign = 'left';
        }
    }

    // 底部时间戳
    ctx.font = `${smfs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#252535';
    ctx.fillText(
        `Generated: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        lm, H - 40 * s
    );

    return canvas;
}

const cfg = mergeAssetData(getConfig());
const outPath = process.argv[2] || 'wallpaper.png';
const buf = generate(3840, 2400, cfg).toBuffer('image/png');
fs.writeFileSync(outPath, buf);
console.log('OK');
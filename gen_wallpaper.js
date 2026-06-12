const { createCanvas } = require('canvas');
const fs = require('fs');

function getDefaultConfig() {
    const today = new Date();
    const startDate = new Date(today);
    startDate.setDate(1);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 2);
    endDate.setDate(0);
    const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return {
        calendarStart: fmt(startDate),
        calendarEnd: fmt(endDate),
        countdown: { name: '答辩', date: '2026-06-24' },
        glowIntensity: 100,
        glowCount: 3,
        glowPreset: 'blue-purple',
        bgImageEnabled: false,
        events: [
            { name: '研究/综述', start: '2026-06-01', end: '2026-06-10', color: '#60a5fa' },
            { name: '反馈/修改', start: '2026-06-11', end: '2026-06-16', color: '#fb923c' },
            { name: '准备材料', start: '2026-06-17', end: '2026-06-23', color: '#f87171' }
        ],
        milestones: [
            { name: '综述完成', date: '2026-06-10', color: '#60a5fa' },
            { name: '交开题报告表', date: '2026-06-17', color: '#f59e0b' },
            { name: '答辩', date: '2026-06-24', color: '#f43f5e' }
        ],
        marks: [
            { name: '朋友考试', date: '2026-06-12', time: '22:30', icon: '🎓' },
            { name: '朋友考试', date: '2026-06-15', time: '22:30', icon: '🎓' },
            { name: '朋友考试', date: '2026-06-20', time: '18:30', icon: '🎓' }
        ],
        todos: [
            { text: '完成《画皮》第6关动画', done: false },
            { text: '检查素材评审反馈', done: false },
            { text: '阅读2篇核心文献', done: false }
        ]
    };
}

const fmt = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

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

    // 弥散光（蓝紫色系，固定3个光源，top-right位置）
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

    // 标题：年月
    const now = new Date();
    ctx.font = `bold ${tfs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.fillText(`${now.getFullYear()}年${String(now.getMonth() + 1).padStart(2, '0')}月`, lm, tm + tfs);

    // 倒计时
    if (cfg.countdown) {
        const td = new Date(cfg.countdown.date);
        const dl = Math.ceil((td - now) / 86400000);
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
    const cs = cfg.calendarStart ? new Date(cfg.calendarStart) : new Date();
    const ce = cfg.calendarEnd ? new Date(cfg.calendarEnd) : new Date(cs.getTime() + 41 * 86400000);
    const sw = cs.getDay() || 7;
    const fm = new Date(cs);
    fm.setDate(fm.getDate() - (sw - 1));
    const gt = ct + 40 * s;
    const d2c = {};
    let cd = new Date(fm);
    const td0 = new Date();
    td0.setHours(0, 0, 0, 0);

    for (let row = 0; row < 6; row++) {
        for (let col = 0; col < 7; col++) {
            const x = lm + col * cw, y = gt + row * ch;
            d2c[fmt(cd)] = { x, y, col, row };
            const ir = cd >= cs && cd <= ce;
            const it = cd.getTime() === td0.getTime();
            const pd = 4 * s;
            ctx.beginPath();
            rr(ctx, x + pd, y + pd, cw - pd * 2, ch - pd * 2, 10 * s);
            if (it) {
                ctx.fillStyle = 'rgba(30,50,80,0.8)';
                ctx.fill();
                ctx.strokeStyle = '#60a5fa';
                ctx.lineWidth = 2 * s;
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
            let ec = new Date(ev.start);
            const ee = new Date(ev.end);
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
            const it = cd2.getTime() === td0.getTime();
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
        { name: '研究/综述', color: '#60a5fa' },
        { name: '反馈/修改', color: '#fb923c' },
        { name: '准备材料', color: '#f87171' },
        { name: '开题答辩', color: '#4ade80' }
    ]) {
        ctx.beginPath();
        rr(ctx, lx2, ly, 18 * s, 18 * s, 4 * s);
        ctx.fillStyle = lg.color;
        ctx.fill();
        ctx.fillStyle = '#666677';
        ctx.fillText(lg.name, lx2 + 24 * s, ly + 14 * s);
        lx2 += 160 * s;
    }

    // 待办列表
    if (cfg.todos && cfg.todos.length > 0) {
        const todoX = lm + 7 * cw + 60 * s;
        let todoY = ct;
        ctx.font = `bold ${28 * s}px "Microsoft YaHei", sans-serif`;
        ctx.fillStyle = '#ffffff';
        ctx.fillText('今日待办', todoX, todoY + 28 * s);
        todoY += 45 * s;
        const cbSize = 20 * s;
        const itemSpacing = 38 * s;
        ctx.font = `${22 * s}px "Microsoft YaHei", sans-serif`;
        for (const todo of cfg.todos) {
            ctx.beginPath();
            rr(ctx, todoX, todoY, cbSize, cbSize, 4 * s);
            if (todo.done) {
                ctx.fillStyle = '#4ade80';
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = `bold ${16 * s}px "Microsoft YaHei", sans-serif`;
                ctx.fillText('✓', todoX + 4 * s, todoY + 15 * s);
                ctx.font = `${22 * s}px "Microsoft YaHei", sans-serif`;
                ctx.fillStyle = '#555566';
            } else {
                ctx.strokeStyle = '#555566';
                ctx.lineWidth = 2 * s;
                ctx.stroke();
                ctx.fillStyle = '#ccccdd';
            }
            const displayText = todo.text.length > 22 ? todo.text.slice(0, 21) + '…' : todo.text;
            ctx.fillText(displayText, todoX + cbSize + 10 * s, todoY + 16 * s);
            todoY += itemSpacing;
        }
    }

    // 底部时间戳
    ctx.font = `${smfs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#252535';
    const footerNow = new Date();
    ctx.fillText(
        `Generated: ${footerNow.getFullYear()}-${String(footerNow.getMonth() + 1).padStart(2, '0')}-${String(footerNow.getDate()).padStart(2, '0')} ${String(footerNow.getHours()).padStart(2, '0')}:${String(footerNow.getMinutes()).padStart(2, '0')}`,
        lm, H - 40 * s
    );

    return canvas;
}

const cfg = getDefaultConfig();
const outPath = process.argv[2] || 'wallpaper.png';
const buf = generate(1536, 960, cfg).toBuffer('image/png');
fs.writeFileSync(outPath, buf);
console.log('OK');

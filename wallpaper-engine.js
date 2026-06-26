/**
 * 壁纸渲染引擎
 * 布局（新版）：
 *   上方：Header（年月 + 倒计时 + 今日）
 *   中间：日历（横向铺满，左右边距对称）
 *   下方：三栏横排 — 今日待办 | AssetDesk进度 | 备忘录
 */

class WallpaperEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.config = null;
        this.customBgImage = null;
    }

    init(canvas, config) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config;
    }

    setCustomBackground(image) {
        this.customBgImage = image;
    }

    generate(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;

        this.drawBackground(width, height);

        const layout = this.calculateLayout(width, height);

        this.drawHeader(layout);
        this.drawCalendar(layout);
        this.drawTimelineEvents(layout);
        this.drawMilestones(layout);
        this.drawMarks(layout);
        this.drawDates(layout);
        this.drawLegend(layout);
        this.drawBottomPanels(layout);
        this.drawFooter(layout);

        return this.canvas;
    }

    calculateLayout(width, height) {
        const scale = width / 3840;
        // 右侧 2/3 区域：左边距从 1/3 处开始，右边距对称
        const sideMargin = Math.round(80 * scale);
        const leftStart  = Math.round(width / 3);  // 左侧 1/3 留空给图标
        const calWidth   = width - leftStart - sideMargin;
        const cols       = 7;
        const cellWidth  = Math.floor(calWidth / cols);
        const cellHeight = Math.round(148 * scale);
        const topMargin  = Math.round(80 * scale);
        const headerH    = Math.round(160 * scale);
        const calTop     = topMargin + headerH;
        const rows       = 6;
        const calH       = cellHeight * rows + Math.round(48 * scale); // weekday label + grid
        const bottomY    = calTop + calH + Math.round(32 * scale);

        return {
            width, height, scale,
            sideMargin,
            leftStart,
            leftMargin:  leftStart,
            rightMargin: sideMargin,
            topMargin,
            headerH,
            calTop,
            calWidth,
            cellWidth,
            cellHeight,
            cols,
            rows,
            bottomY,   // 下方三栏起始 Y
            bottomH: height - bottomY - Math.round(50 * scale), // 可用高度
            dateNumY:       Math.round(cellHeight * 0.30),
            monthLabelY:    Math.round(cellHeight * 0.14),
            timelineY:      Math.round(cellHeight * 0.44),
            milestoneY:     Math.round(cellHeight * 0.78),
            markY:          Math.round(cellHeight * 0.60),
            markBarHeight:  Math.round(Math.max(14, cellHeight * 0.17)),
            eventBarHeight: Math.round(Math.max(14, cellHeight * 0.18)),
            titleFontSize: Math.round(64 * scale),
            subFontSize:   Math.round(36 * scale),
            dateFontSize:  Math.round(38 * scale),
            smallFontSize: Math.round(22 * scale),
            eventFontSize: Math.round(18 * scale),
            markFontSize:  Math.round(Math.max(12, 15 * scale)),
        };
    }

    drawBackground(width, height) {
        this.ctx.fillStyle = '#08080f';
        this.ctx.fillRect(0, 0, width, height);
        if (this.config.bgImageEnabled && this.customBgImage) {
            this.drawCustomImage(width, height);
        }
        if (this.config.glowEnabled !== false) {
            this.drawGradientBackground(width, height);
        }
    }

    drawCustomImage(width, height) {
        const brightness = (this.config.bgBrightness || 100) / 100;
        const blur       = this.config.bgBlur || 0;
        const vignette   = (this.config.bgVignette || 50) / 100;
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width  = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');
        const imgRatio    = this.customBgImage.width / this.customBgImage.height;
        const canvasRatio = width / height;
        let dw, dh, dx, dy;
        if (imgRatio > canvasRatio) {
            dh = height; dw = height * imgRatio;
            dx = (width - dw) / 2; dy = 0;
        } else {
            dw = width; dh = width / imgRatio;
            dx = 0; dy = (height - dh) / 2;
        }
        tempCtx.drawImage(this.customBgImage, dx, dy, dw, dh);
        if (blur > 0) this.ctx.filter = `blur(${blur}px)`;
        this.ctx.drawImage(tempCanvas, 0, 0);
        this.ctx.filter = 'none';
        if (brightness < 1) {
            this.ctx.fillStyle = `rgba(8,8,16,${1 - brightness})`;
            this.ctx.fillRect(0, 0, width, height);
        } else if (brightness > 1) {
            this.ctx.fillStyle = `rgba(255,255,255,${(brightness - 1) * 0.3})`;
            this.ctx.fillRect(0, 0, width, height);
        }
        if (vignette > 0) {
            const grad = this.ctx.createRadialGradient(
                width / 2, height / 2, 0,
                width / 2, height / 2, Math.max(width, height) * 0.7
            );
            grad.addColorStop(0,   'rgba(0,0,0,0)');
            grad.addColorStop(0.5, 'rgba(0,0,0,0)');
            grad.addColorStop(1,   `rgba(8,8,16,${vignette})`);
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, width, height);
        }
    }

    getGlowColors() {
        const preset = this.config.glowPreset || 'blue-purple';
        const presets = {
            'blue-purple': { colors: [[80,120,220],[160,100,200],[100,80,180],[70,100,170]] },
            'pink-orange': { colors: [[220,100,150],[240,140,100],[200,80,120],[180,120,80]] },
            'green-cyan':  { colors: [[60,180,160],[80,200,220],[40,160,140],[100,180,200]] },
            'gold-warm':   { colors: [[220,180,80],[240,140,60],[200,160,100],[180,120,40]] },
        };
        if (preset === 'custom') {
            const c1 = this.hexToRgb(this.config.glowColor1 || '#5078dc');
            const c2 = this.hexToRgb(this.config.glowColor2 || '#a064c8');
            return { colors: [c1, c2, this.mixColors(c1, c2, 0.5), this.mixColors(c1, [50,50,80], 0.3)] };
        }
        return presets[preset] || presets['blue-purple'];
    }

    getGlowPositionOffset() {
        const pos = this.config.glowPosition || 'top-right';
        const offsets = {
            'top-left':      { x: -0.3, y: -0.3 }, 'top-center':    { x:  0,   y: -0.3 }, 'top-right':     { x:  0.3, y: -0.3 },
            'center-left':   { x: -0.3, y:  0   }, 'center':        { x:  0,   y:  0   }, 'center-right':  { x:  0.3, y:  0   },
            'bottom-left':   { x: -0.3, y:  0.3 }, 'bottom-center': { x:  0,   y:  0.3 }, 'bottom-right':  { x:  0.3, y:  0.3 },
        };
        return offsets[pos] || offsets['top-right'];
    }

    drawGradientBackground(width, height) {
        const colorConfig = this.getGlowColors();
        const posOffset   = this.getGlowPositionOffset();
        const intensity   = (this.config.glowIntensity || 100) / 100;
        const glowCount   = this.config.glowCount || 3;
        const glowConfigs = {
            1: [{ x:0.55, y:0.35, r:0.6,  alpha:0.2  }],
            2: [{ x:0.45, y:0.25, r:0.5,  alpha:0.18 }, { x:0.65, y:0.55, r:0.45, alpha:0.15 }],
            3: [{ x:0.58, y:0.1,  r:0.5,  alpha:0.15 }, { x:0.66, y:0.5,  r:0.4,  alpha:0.12 }, { x:0.45, y:0.7, r:0.45, alpha:0.1 }],
        };
        const positions = glowConfigs[glowCount] || glowConfigs[3];
        for (let i = 0; i < positions.length; i++) {
            const pos    = positions[i];
            const color  = colorConfig.colors[i % colorConfig.colors.length];
            const alpha  = pos.alpha * intensity;
            const cx     = width  * (pos.x + posOffset.x);
            const cy     = height * (pos.y + posOffset.y);
            const radius = Math.max(width, height) * pos.r;
            const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            const [r, g, b] = color;
            grad.addColorStop(0,   `rgba(${r},${g},${b},${alpha})`);
            grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.5})`);
            grad.addColorStop(1,   'rgba(0,0,0,0)');
            this.ctx.fillStyle = grad;
            this.ctx.fillRect(0, 0, width, height);
        }
    }

    drawHeader(layout) {
        const today = new Date();
        const { leftMargin, topMargin, scale, width, rightMargin, titleFontSize, subFontSize } = layout;
        // 年月
        this.ctx.font      = `bold ${titleFontSize}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#ffffff';
        const title = `${today.getFullYear()}年${String(today.getMonth() + 1).padStart(2, '0')}月`;
        this.ctx.fillText(title, leftMargin, topMargin + titleFontSize);
        // 倒计时
        if (this.config.countdown && this.config.countdown.date) {
            const target   = new Date(this.config.countdown.date);
            const daysLeft = Math.ceil((target - today) / 86400000);
            const txt = daysLeft > 0
                ? `距${this.config.countdown.name || '目标'} ${daysLeft} 天`
                : (daysLeft === 0 ? `${this.config.countdown.name || '目标'}就是今天！` : `${this.config.countdown.name || '目标'}已完成`);
            this.ctx.font      = `${subFontSize}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = daysLeft < 0 ? '#4ade80' : '#60a5fa';
            this.ctx.fillText(txt, leftMargin, topMargin + titleFontSize + Math.round(52 * scale));
        }
        // 右上：今日
        const weekdays = ['周日','周一','周二','周三','周四','周五','周六'];
        const todayStr = `TODAY  ${String(today.getMonth()+1).padStart(2,'0')}.${String(today.getDate()).padStart(2,'0')} ${weekdays[today.getDay()]}`;
        const fSize    = Math.round(30 * scale);
        this.ctx.font      = `${fSize}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#8888aa';
        const tw = this.ctx.measureText(todayStr).width;
        this.ctx.fillText(todayStr, width - rightMargin - tw, topMargin + Math.round(44 * scale));
    }

    drawCalendar(layout) {
        const { leftMargin, calTop, cellWidth, cellHeight, cols, rows, scale } = layout;
        const today = new Date(); today.setHours(0,0,0,0);
        const wkNames = ['一','二','三','四','五','六','日'];
        const wkFSize = Math.round(26 * scale);
        this.ctx.font = `${wkFSize}px "Microsoft YaHei", sans-serif`;
        for (let i = 0; i < 7; i++) {
            const x = leftMargin + i * cellWidth + cellWidth / 2;
            this.ctx.fillStyle = i >= 5 ? '#ff9999' : '#666688';
            const tw = this.ctx.measureText(wkNames[i]).width;
            this.ctx.fillText(wkNames[i], x - tw / 2, calTop + Math.round(28 * scale));
        }
        // 月历范围：优先用 config，否则取当月 1 号 ~ 月末
        const refDate  = this.config.calendarStart ? this.parseLocalDate(this.config.calendarStart) : new Date();
        const calYear  = refDate.getFullYear();
        const calMonth = refDate.getMonth();
        const calStart = this.config.calendarStart ? this.parseLocalDate(this.config.calendarStart) : new Date(calYear, calMonth, 1);
        const calEnd   = this.config.calendarEnd   ? this.parseLocalDate(this.config.calendarEnd)   : new Date(calYear, calMonth + 1, 0);  // 月末最后一天
        // 网格从当月1号所在的周一开始
        const monthFirst  = new Date(calYear, calMonth, 1);
        const startWd     = monthFirst.getDay() || 7;  // 1=Mon..7=Sun
        const firstMonday = new Date(monthFirst);
        firstMonday.setDate(firstMonday.getDate() - (startWd - 1));
        const gridTop = calTop + Math.round(48 * scale);
        this.dateToCell = {};
        let cur = new Date(firstMonday);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x  = leftMargin + col * cellWidth;
                const y  = gridTop + row * cellHeight;
                const dk = this.formatDate(cur);
                this.dateToCell[dk] = { x, y, col, row };
                const inRange = cur >= calStart && cur <= calEnd;
                const isToday = cur.getTime() === today.getTime();
                const pad     = Math.round(4 * scale);
                const radius  = Math.round(10 * scale);
                this.ctx.beginPath();
                this.roundRect(x + pad, y + pad, cellWidth - pad*2, cellHeight - pad*2, radius);
                if (isToday) {
                    // 外发光（先画大一圈的半透明）
                    this.ctx.save();
                    this.ctx.shadowColor = '#60a5fa';
                    this.ctx.shadowBlur  = Math.round(18 * scale);
                    this.ctx.beginPath();
                    this.roundRect(x + pad, y + pad, cellWidth - pad*2, cellHeight - pad*2, radius);
                    this.ctx.fillStyle = 'rgba(30,70,140,0.95)';
                    this.ctx.fill();
                    this.ctx.restore();
                    // 再画清晰描边
                    this.ctx.beginPath();
                    this.roundRect(x + pad, y + pad, cellWidth - pad*2, cellHeight - pad*2, radius);
                    this.ctx.strokeStyle = '#60a5fa';
                    this.ctx.lineWidth   = Math.round(2.5 * scale);
                    this.ctx.stroke();
                } else if (inRange) {
                    this.ctx.strokeStyle = '#252535';
                    this.ctx.lineWidth   = Math.round(1 * scale);
                    this.ctx.stroke();
                } else {
                    this.ctx.strokeStyle = '#1e1e2e';
                    this.ctx.lineWidth   = Math.round(1 * scale);
                    this.ctx.stroke();
                }
                cur.setDate(cur.getDate() + 1);
            }
        }
    }

    drawTimelineEvents(layout) {
        if (!this.config.events || !this.config.events.length) return;
        const { scale, cellWidth, timelineY, eventBarHeight, eventFontSize } = layout;
        this.ctx.font = `${eventFontSize}px "Microsoft YaHei", sans-serif`;
        for (const event of this.config.events) {
            if (!this.dateToCell[event.start]) continue;
            let cur     = new Date(event.start);
            const end   = new Date(event.end);
            const segs  = [];
            while (cur <= end) {
                const dk   = this.formatDate(cur);
                const cell = this.dateToCell[dk];
                if (cell) {
                    const last = segs[segs.length - 1];
                    if (!last || last.row !== cell.row) {
                        segs.push({ row: cell.row, startCol: cell.col, endCol: cell.col, startX: cell.x, y: cell.y, isFirst: segs.length === 0 });
                    } else {
                        last.endCol = cell.col;
                    }
                }
                cur.setDate(cur.getDate() + 1);
            }
            for (const seg of segs) {
                const sx = seg.startX + Math.round(10 * scale);
                const ex = layout.leftMargin + seg.endCol * cellWidth + cellWidth - Math.round(10 * scale);
                const sy = seg.y + timelineY;
                const bh = eventBarHeight;
                this.ctx.beginPath();
                this.roundRect(sx, sy, ex - sx, bh, Math.round(5 * scale));
                this.ctx.strokeStyle = event.color || '#60a5fa';
                this.ctx.lineWidth   = Math.round(2 * scale);
                this.ctx.stroke();
                if (seg.isFirst) {
                    this.ctx.beginPath();
                    this.roundRect(sx, sy, Math.round(4 * scale), bh, Math.round(2 * scale));
                    this.ctx.fillStyle = event.color || '#60a5fa';
                    this.ctx.fill();
                    this.ctx.fillStyle = event.color || '#60a5fa';
                    const displayName  = event.name.length > 8 ? event.name.slice(0, 7) + '…' : event.name;
                    this.ctx.fillText(displayName, sx + Math.round(10 * scale), sy + Math.round(bh * 0.7));
                }
            }
        }
    }

    drawMilestones(layout) {
        if (!this.config.milestones || !this.config.milestones.length) return;
        const { scale, milestoneY, eventFontSize } = layout;
        this.ctx.font = `bold ${eventFontSize}px "Microsoft YaHei", sans-serif`;
        for (const ms of this.config.milestones) {
            const cell = this.dateToCell[ms.date];
            if (!cell) continue;
            const tagX  = cell.x + Math.round(8 * scale);
            const tagY  = cell.y + milestoneY;
            const bh    = layout.markBarHeight;
            const tw    = this.ctx.measureText(ms.name).width;
            const tagW  = tw + Math.round(14 * scale);
            this.ctx.beginPath();
            this.roundRect(tagX, tagY, tagW, bh, Math.round(5 * scale));
            this.ctx.fillStyle = ms.color || '#4ade80';
            this.ctx.fill();
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(ms.name, tagX + Math.round(7 * scale), tagY + Math.round(bh * 0.72));
        }
    }

    drawMarks(layout) {
        if (!this.config.marks || !this.config.marks.length) return;
        const { scale, cellWidth, markY, markBarHeight, markFontSize } = layout;
        this.ctx.font = `${markFontSize}px "Microsoft YaHei", sans-serif`;
        for (const mark of this.config.marks) {
            const cell = this.dateToCell[mark.date];
            if (!cell) continue;
            const label  = mark.time ? `${mark.icon || '🎓'}${mark.time}` : `${mark.icon || '🎓'}${mark.name}`;
            const lw     = this.ctx.measureText(label).width;
            const ph     = markBarHeight;
            const pw     = lw + Math.round(10 * scale);
            const px = cell.x + Math.round(8 * scale);
            const py = cell.y + markY;
            this.ctx.beginPath();
            this.roundRect(px, py, pw, ph, Math.round(5 * scale));
            this.ctx.fillStyle = mark.color || '#a855f7';
            this.ctx.fill();
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(label, px + Math.round(5 * scale), py + Math.round(ph * 0.72));
        }
    }

    drawDates(layout) {
        const { leftMargin, calTop, cellWidth, cellHeight, cols, rows, scale,
                dateFontSize, smallFontSize, dateNumY, monthLabelY } = layout;
        const today = new Date(); today.setHours(0,0,0,0);
        const refDate  = this.config.calendarStart ? this.parseLocalDate(this.config.calendarStart) : new Date();
        const calYear  = refDate.getFullYear();
        const calMonth = refDate.getMonth();
        const calStart = this.config.calendarStart ? this.parseLocalDate(this.config.calendarStart) : new Date(calYear, calMonth, 1);
        const calEnd   = this.config.calendarEnd   ? this.parseLocalDate(this.config.calendarEnd)   : new Date(calYear, calMonth + 1, 0);
        const monthFirst  = new Date(calYear, calMonth, 1);
        const startWd     = monthFirst.getDay() || 7;
        const firstMonday = new Date(monthFirst);
        firstMonday.setDate(firstMonday.getDate() - (startWd - 1));
        const gridTop = calTop + Math.round(48 * scale);
        let cur = new Date(firstMonday);
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x       = leftMargin + col * cellWidth;
                const y       = gridTop + row * cellHeight;
                const inRange = cur >= calStart && cur <= calEnd;
                const isToday = cur.getTime() === today.getTime();
                const isWknd  = col >= 5;
                let numColor;
                if      (!inRange) numColor = '#555570';
                else if (isToday)  numColor = '#60a5fa';
                else if (isWknd)   numColor = '#ff9999';
                else               numColor = '#ffffff';
                const dayStr = String(cur.getDate());
                const xOff   = Math.round(12 * scale);
                if (cur.getDate() === 1 && inRange) {
                    this.ctx.font      = `${smallFontSize}px "Microsoft YaHei", sans-serif`;
                    this.ctx.fillStyle = '#4ade80';
                    const mlLabel = `${cur.getMonth() + 1}月`;
                    const mlW     = this.ctx.measureText(mlLabel).width;
                    this.ctx.fillText(mlLabel, x + cellWidth - mlW - xOff, y + monthLabelY);
                }
                this.ctx.font      = `bold ${dateFontSize}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillStyle = numColor;
                this.ctx.fillText(dayStr, x + xOff, y + dateNumY);
                cur.setDate(cur.getDate() + 1);
            }
        }
    }

    drawLegend(layout) {
        const { leftMargin, calTop, cellHeight, rows, scale, smallFontSize } = layout;
        const gridTop   = calTop + Math.round(48 * scale);
        const legendY   = gridTop + rows * cellHeight + Math.round(12 * scale);
        const dotSize   = Math.round(24 * scale);
        const itemGap   = Math.round(200 * scale);
        const legends = [
            { name: '研究/综述', color: '#60a5fa' },
            { name: '反馈/修改', color: '#fb923c' },
            { name: '准备材料', color: '#f87171' },
            { name: '开题答辩', color: '#4ade80' },
            { name: '特殊标记', color: '#a855f7' },
        ];
        this.ctx.font = `${Math.round(28 * scale)}px "Microsoft YaHei", sans-serif`;
        let lx = leftMargin;
        for (const leg of legends) {
            this.ctx.beginPath();
            this.roundRect(lx, legendY, dotSize, dotSize, Math.round(3 * scale));
            this.ctx.fillStyle = leg.color;
            this.ctx.fill();
            this.ctx.fillStyle = '#666677';
            this.ctx.fillText(leg.name, lx + dotSize + Math.round(6 * scale), legendY + Math.round(dotSize * 0.82));
            lx += itemGap;
        }
    }

    drawBottomPanels(layout) {
        const { leftStart, width, sideMargin, bottomY, bottomH, scale } = layout;
        const totalW  = width - leftStart - sideMargin;
        const panelW  = Math.round((totalW - Math.round(40 * scale) * 2) / 3);
        const pad     = Math.round(28 * scale);
        const radius  = Math.round(18 * scale);
        const lineH   = Math.round(56 * scale);
        const titleSz = Math.round(38 * scale);
        const itemSz  = Math.round(32 * scale);
        const gap     = Math.round(40 * scale);

        const panels = [
            { x: leftStart,                       label: '今日待办',  color: '#60a5fa' },
            { x: leftStart + panelW + gap,         label: 'AssetDesk', color: '#a78bfa' },
            { x: leftStart + (panelW + gap) * 2,   label: '备忘录',    color: '#fb923c' },
        ];

        for (const p of panels) {
            // 面板背景
            this.ctx.save();
            this.ctx.beginPath();
            this.roundRect(p.x, bottomY, panelW, bottomH, radius);
            this.ctx.fillStyle = 'rgba(10,12,28,0.55)';
            this.ctx.fill();
            this.ctx.strokeStyle = p.color + '44';
            this.ctx.lineWidth = Math.max(1, Math.round(1.5 * scale));
            this.ctx.stroke();
            this.ctx.restore();

            // 标题
            this.ctx.font      = `bold ${titleSz}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = p.color;
            this.ctx.fillText(p.label, p.x + pad, bottomY + pad + titleSz);
        }

        // === 今日待办 ===
        const todoPanelX = panels[0].x;
        const todos = Array.isArray(this.config.todos) ? this.config.todos : [];
        let ty = bottomY + pad + titleSz + Math.round(16 * scale);
        const cbSize = Math.round(18 * scale);
        this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
        if (todos.length === 0) {
            this.ctx.fillStyle = '#444455';
            this.ctx.fillText('暂无待办', todoPanelX + pad, ty + itemSz);
        }
        for (const todo of todos.slice(0, 8)) {
            if (ty + lineH > bottomY + bottomH - pad) break;
            this.ctx.beginPath();
            this.roundRect(todoPanelX + pad, ty + Math.round(4 * scale), cbSize, cbSize, Math.round(4 * scale));
            if (todo.done) {
                this.ctx.fillStyle = '#4ade80'; this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillText('✓', todoPanelX + pad + Math.round(3 * scale), ty + Math.round(cbSize * 0.85));
                this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillStyle = '#444455';
            } else {
                this.ctx.strokeStyle = '#555566'; this.ctx.lineWidth = Math.round(1.5 * scale); this.ctx.stroke();
                this.ctx.fillStyle = '#ccccdd';
            }
            const maxW  = panelW - pad * 2 - cbSize - Math.round(10 * scale);
            const label = this.truncateText(todo.text, maxW);
            this.ctx.fillText(label, todoPanelX + pad + cbSize + Math.round(10 * scale), ty + itemSz);
            ty += lineH;
        }

        // === AssetDesk ===
        const adPanelX = panels[1].x;
        const snapshot = this.config.assetDeskSnapshot;
        let ay = bottomY + pad + titleSz + Math.round(16 * scale);
        if (!snapshot) {
            this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = '#444455';
            this.ctx.fillText('未连接 AssetDesk', adPanelX + pad, ay + itemSz);
        } else {
            const summary  = snapshot.weekSummary  || {};
            const status   = snapshot.assetStatus  || {};
            const projects = Array.isArray(status.projects) ? status.projects : [];

            // 总数大字
            this.ctx.font      = `bold ${Math.round(66 * scale)}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = '#a78bfa';
            this.ctx.fillText(`${summary.pending_total ?? 0}`, adPanelX + pad, ay + Math.round(66 * scale));
            this.ctx.font      = `${Math.round(28 * scale)}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = '#9090b0';
            this.ctx.fillText(`待推进  ·  进行中 ${summary.partial ?? 0}  待处理 ${summary.todo ?? 0}`,
                adPanelX + pad, ay + Math.round(100 * scale));
            ay += Math.round(116 * scale);

            // 进度条 + 项目列表
            this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
            for (const proj of projects.slice(0, 6)) {
                if (ay + lineH > bottomY + bottomH - pad) break;
                const name = this.truncateText(proj.name || 'AssetDesk', Math.round(panelW * 0.45));
                this.ctx.fillStyle = '#d8dcff';
                this.ctx.fillText(name, adPanelX + pad, ay + itemSz);

                // 进度条
                const barX = adPanelX + pad + Math.round(panelW * 0.48);
                const barW = Math.round(panelW * 0.36);
                const barH = Math.round(8 * scale);
                const barY = ay + Math.round(itemSz * 0.4);
                const pct  = proj.total > 0 ? (proj.done || 0) / proj.total : 0;
                this.ctx.beginPath(); this.roundRect(barX, barY, barW, barH, Math.round(3 * scale));
                this.ctx.fillStyle = 'rgba(60,60,90,0.6)'; this.ctx.fill();
                if (pct > 0) {
                    this.ctx.beginPath(); this.roundRect(barX, barY, Math.round(barW * pct), barH, Math.round(3 * scale));
                    this.ctx.fillStyle = pct >= 0.8 ? '#4ade80' : pct >= 0.4 ? '#fb923c' : '#f87171';
                    this.ctx.fill();
                }
                // 数量
                this.ctx.fillStyle = '#7dd3fc';
                this.ctx.font = `${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillText(`${proj.todo ?? proj.total ?? 0}`, adPanelX + panelW - pad - Math.round(40 * scale), ay + itemSz);
                this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
                ay += lineH;
            }

            // 警告
            const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings : [];
            for (const w of warnings.slice(0, 2)) {
                if (ay + lineH > bottomY + bottomH - pad) break;
                this.ctx.fillStyle = '#fb923c';
                this.ctx.font = `${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillText(this.truncateText(`⚠ ${w}`, panelW - pad * 2), adPanelX + pad, ay + itemSz);
                ay += lineH;
            }
        }

        // === 备忘录 ===
        const memoPanelX = panels[2].x;
        const memos = Array.isArray(this.config.memos) ? this.config.memos : [];
        let my = bottomY + pad + titleSz + Math.round(16 * scale);
        this.ctx.font = `${itemSz}px "Microsoft YaHei", sans-serif`;
        if (memos.length === 0) {
            this.ctx.fillStyle = '#444455';
            this.ctx.fillText('暂无备忘', memoPanelX + pad, my + itemSz);
        }
        for (const memo of memos.slice(0, 8)) {
            if (my + lineH > bottomY + bottomH - pad) break;
            // 小圆点
            this.ctx.beginPath();
            this.ctx.arc(memoPanelX + pad + Math.round(6 * scale), my + Math.round(itemSz * 0.55), Math.round(5 * scale), 0, Math.PI * 2);
            this.ctx.fillStyle = memo.done ? '#444455' : '#fb923c';
            this.ctx.fill();
            this.ctx.fillStyle = memo.done ? '#444455' : '#e8d5c0';
            const maxW  = panelW - pad * 2 - Math.round(20 * scale);
            const label = this.truncateText(memo.text, maxW);
            this.ctx.fillText(label, memoPanelX + pad + Math.round(20 * scale), my + itemSz);
            my += lineH;
        }
    }

    truncateText(text, maxWidth) {
        const value = String(text || '');
        if (this.ctx.measureText(value).width <= maxWidth) return value;
        let out = value;
        while (out.length > 0 && this.ctx.measureText(out + '…').width > maxWidth) {
            out = out.slice(0, -1);
        }
        return out + '…';
    }

    drawFooter(layout) {
        const { leftMargin, height, scale, smallFontSize } = layout;
        const now = new Date();
        const txt = `Generated: ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
        this.ctx.font      = `${smallFontSize}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#252535';
        this.ctx.fillText(txt, leftMargin, height - Math.round(40 * scale));
    }

    roundRect(x, y, w, h, r) {
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h,     x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y,         x + r, y);
        this.ctx.closePath();
    }

    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    }

    // 按本地时间解析 YYYY-MM-DD，避免 new Date("2026-06-01") 被当作 UTC 导致东八区偏移问题
    parseLocalDate(str) {
        const [y, m, d] = str.split('-').map(Number);
        const dt = new Date(y, m - 1, d);
        dt.setHours(0, 0, 0, 0);
        return dt;
    }

    hexToRgb(hex) {
        const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return r ? [parseInt(r[1],16), parseInt(r[2],16), parseInt(r[3],16)] : [80,120,220];
    }

    mixColors(c1, c2, ratio) {
        return [
            Math.round(c1[0] * (1-ratio) + c2[0] * ratio),
            Math.round(c1[1] * (1-ratio) + c2[1] * ratio),
            Math.round(c1[2] * (1-ratio) + c2[2] * ratio),
        ];
    }

    toBlob(type = 'image/png', quality = 0.95) {
        return new Promise(resolve => this.canvas.toBlob(resolve, type, quality));
    }

    async download(filename = 'wallpaper.png') {
        const blob = await this.toBlob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
    }
}

window.WallpaperEngine = WallpaperEngine;


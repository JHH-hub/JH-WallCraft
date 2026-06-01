/**
 * 壁纸渲染引擎
 * 负责在 Canvas 上绘制日历壁纸
 */

class WallpaperEngine {
    constructor() {
        this.canvas = null;
        this.ctx = null;
        this.config = null;
        this.customBgImage = null;
    }

    /**
     * 初始化引擎
     */
    init(canvas, config) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.config = config;
    }

    /**
     * 设置自定义背景图
     */
    setCustomBackground(image) {
        this.customBgImage = image;
    }

    /**
     * 生成壁纸
     */
    generate(width, height) {
        this.canvas.width = width;
        this.canvas.height = height;

        // 绘制背景
        this.drawBackground(width, height);

        // 计算布局参数
        const layout = this.calculateLayout(width, height);

        // 绘制标题区域
        this.drawHeader(layout);

        // 绘制日历网格
        this.drawCalendar(layout);

        // 绘制时间线事件
        this.drawTimelineEvents(layout);

        // 绘制关键节点
        this.drawMilestones(layout);

        // 绘制特殊标记
        this.drawMarks(layout);

        // 绘制日期数字
        this.drawDates(layout);

        // 绘制图例
        this.drawLegend(layout);

        // 绘制待办列表
        this.drawTodos(layout);

        // 绘制底部信息
        this.drawFooter(layout);

        return this.canvas;
    }

    /**
     * 计算布局参数
     */
    calculateLayout(width, height) {
        const scale = width / 3840; // 基于 3840 宽度的缩放比
        
        return {
            width,
            height,
            scale,
            leftMargin: Math.round(1150 * scale),
            rightMargin: Math.round(120 * scale),
            topMargin: Math.round(100 * scale),
            
            // 日历参数
            calTop: Math.round(250 * scale),
            cellWidth: Math.round(310 * scale),
            cellHeight: Math.round(175 * scale),
            cols: 7,
            rows: 6,
            
            // 字体大小
            titleFontSize: Math.round(56 * scale),
            subFontSize: Math.round(32 * scale),
            dateFontSize: Math.round(36 * scale),
            smallFontSize: Math.round(18 * scale),
            eventFontSize: Math.round(18 * scale),
        };
    }

    /**
     * 绘制背景
     */
    drawBackground(width, height) {
        // 基础深色背景
        this.ctx.fillStyle = '#08080f';
        this.ctx.fillRect(0, 0, width, height);

        const glowEnabled = this.config.glowEnabled !== false;
        const bgImageEnabled = this.config.bgImageEnabled && this.customBgImage;

        // 先画背景图片（如果启用）
        if (bgImageEnabled) {
            this.drawCustomImage(width, height);
        }

        // 再叠加弥散光（如果启用）
        if (glowEnabled) {
            this.drawGradientBackground(width, height);
        }
    }

    /**
     * 绘制自定义图片
     */
    drawCustomImage(width, height) {
        const brightness = (this.config.bgBrightness || 100) / 100;
        const blur = this.config.bgBlur || 0;
        const vignette = (this.config.bgVignette || 50) / 100;

        // 创建临时canvas来处理模糊
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d');

        // 计算图片绘制尺寸（cover模式）
        const imgRatio = this.customBgImage.width / this.customBgImage.height;
        const canvasRatio = width / height;
        
        let drawWidth, drawHeight, drawX, drawY;
        
        if (imgRatio > canvasRatio) {
            drawHeight = height;
            drawWidth = height * imgRatio;
            drawX = (width - drawWidth) / 2;
            drawY = 0;
        } else {
            drawWidth = width;
            drawHeight = width / imgRatio;
            drawX = 0;
            drawY = (height - drawHeight) / 2;
        }
        
        // 绘制图片到临时canvas
        tempCtx.drawImage(this.customBgImage, drawX, drawY, drawWidth, drawHeight);

        // 应用模糊（如果有）
        if (blur > 0) {
            this.ctx.filter = `blur(${blur}px)`;
        }
        
        // 绘制到主canvas
        this.ctx.drawImage(tempCanvas, 0, 0);
        this.ctx.filter = 'none';

        // 应用亮度调整（通过叠加层）
        if (brightness < 1) {
            this.ctx.fillStyle = `rgba(8, 8, 16, ${1 - brightness})`;
            this.ctx.fillRect(0, 0, width, height);
        } else if (brightness > 1) {
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(brightness - 1) * 0.3})`;
            this.ctx.fillRect(0, 0, width, height);
        }

        // 应用暗角效果
        if (vignette > 0) {
            const gradient = this.ctx.createRadialGradient(
                width / 2, height / 2, 0,
                width / 2, height / 2, Math.max(width, height) * 0.7
            );
            gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)');
            gradient.addColorStop(1, `rgba(8, 8, 16, ${vignette})`);
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, width, height);
        }
    }

    /**
     * 获取弥散光颜色配置
     */
    getGlowColors() {
        const preset = this.config.glowPreset || 'blue-purple';
        const presets = {
            'blue-purple': {
                colors: [[80, 120, 220], [160, 100, 200], [100, 80, 180], [70, 100, 170]],
            },
            'pink-orange': {
                colors: [[220, 100, 150], [240, 140, 100], [200, 80, 120], [180, 120, 80]],
            },
            'green-cyan': {
                colors: [[60, 180, 160], [80, 200, 220], [40, 160, 140], [100, 180, 200]],
            },
            'gold-warm': {
                colors: [[220, 180, 80], [240, 140, 60], [200, 160, 100], [180, 120, 40]],
            },
        };

        if (preset === 'custom') {
            // 从自定义颜色生成
            const c1 = this.hexToRgb(this.config.glowColor1 || '#5078dc');
            const c2 = this.hexToRgb(this.config.glowColor2 || '#a064c8');
            return {
                colors: [
                    c1,
                    c2,
                    this.mixColors(c1, c2, 0.5),
                    this.mixColors(c1, [50, 50, 80], 0.3),
                ],
            };
        }

        return presets[preset] || presets['blue-purple'];
    }

    /**
     * 获取光源位置偏移
     */
    getGlowPositionOffset() {
        const pos = this.config.glowPosition || 'top-right';
        const offsets = {
            'top-left': { x: -0.3, y: -0.3 },
            'top-center': { x: 0, y: -0.3 },
            'top-right': { x: 0.3, y: -0.3 },
            'center-left': { x: -0.3, y: 0 },
            'center': { x: 0, y: 0 },
            'center-right': { x: 0.3, y: 0 },
            'bottom-left': { x: -0.3, y: 0.3 },
            'bottom-center': { x: 0, y: 0.3 },
            'bottom-right': { x: 0.3, y: 0.3 },
        };
        return offsets[pos] || offsets['top-right'];
    }

    /**
     * 绘制弥散光渐变背景
     */
    drawGradientBackground(width, height) {
        const colorConfig = this.getGlowColors();
        const posOffset = this.getGlowPositionOffset();
        const intensity = (this.config.glowIntensity || 100) / 100;
        const glowCount = this.config.glowCount || 3;

        // 根据数量定义不同的光源配置
        const glowConfigs = {
            1: [
                { x: 0.55, y: 0.35, r: 0.6, alpha: 0.2 },
            ],
            2: [
                { x: 0.45, y: 0.25, r: 0.5, alpha: 0.18 },
                { x: 0.65, y: 0.55, r: 0.45, alpha: 0.15 },
            ],
            3: [
                { x: 0.58, y: 0.1, r: 0.5, alpha: 0.15 },
                { x: 0.66, y: 0.5, r: 0.4, alpha: 0.12 },
                { x: 0.45, y: 0.7, r: 0.45, alpha: 0.1 },
            ],
        };

        const positions = glowConfigs[glowCount] || glowConfigs[3];

        for (let i = 0; i < positions.length; i++) {
            const pos = positions[i];
            const color = colorConfig.colors[i % colorConfig.colors.length];
            const alpha = pos.alpha * intensity;

            const cx = width * (pos.x + posOffset.x);
            const cy = height * (pos.y + posOffset.y);
            const radius = Math.max(width, height) * pos.r;
            
            const gradient = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
            const [r, g, b] = color;
            gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${alpha})`);
            gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${alpha * 0.5})`);
            gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
            
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, width, height);
        }
    }

    /**
     * 辅助：hex 转 rgb
     */
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? [
            parseInt(result[1], 16),
            parseInt(result[2], 16),
            parseInt(result[3], 16)
        ] : [80, 120, 220];
    }

    /**
     * 辅助：混合两个颜色
     */
    mixColors(c1, c2, ratio) {
        return [
            Math.round(c1[0] * (1 - ratio) + c2[0] * ratio),
            Math.round(c1[1] * (1 - ratio) + c2[1] * ratio),
            Math.round(c1[2] * (1 - ratio) + c2[2] * ratio),
        ];
    }

    /**
     * 绘制标题区域
     */
    drawHeader(layout) {
        const today = new Date();
        const { leftMargin, topMargin, scale, width, rightMargin } = layout;

        // 年月标题
        this.ctx.font = `bold ${layout.titleFontSize}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#ffffff';
        const title = `${today.getFullYear()}年${String(today.getMonth() + 1).padStart(2, '0')}月`;
        this.ctx.fillText(title, leftMargin, topMargin + layout.titleFontSize);

        // 倒计时
        if (this.config.countdown && this.config.countdown.date) {
            const targetDate = new Date(this.config.countdown.date);
            const daysLeft = Math.ceil((targetDate - today) / (1000 * 60 * 60 * 24));
            const countdownText = daysLeft > 0 
                ? `距${this.config.countdown.name || '目标'} ${daysLeft} 天`
                : (daysLeft === 0 ? `${this.config.countdown.name || '目标'}就是今天！` : '目标已过');
            
            this.ctx.font = `${layout.subFontSize}px "Microsoft YaHei", sans-serif`;
            this.ctx.fillStyle = '#60a5fa';
            this.ctx.fillText(countdownText, leftMargin, topMargin + layout.titleFontSize + 50 * scale);
        }

        // 右上角今日
        const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        const todayStr = `TODAY  ${String(today.getMonth() + 1).padStart(2, '0')}.${String(today.getDate()).padStart(2, '0')} ${weekdays[today.getDay()]}`;
        this.ctx.font = `${Math.round(28 * scale)}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#8888aa';
        const todayWidth = this.ctx.measureText(todayStr).width;
        this.ctx.fillText(todayStr, width - rightMargin - todayWidth, topMargin + 40 * scale);
    }

    /**
     * 绘制日历网格
     */
    drawCalendar(layout) {
        const { leftMargin, calTop, cellWidth, cellHeight, cols, rows, scale } = layout;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // 星期标题
        const weekdayNames = ['一', '二', '三', '四', '五', '六', '日'];
        this.ctx.font = `${Math.round(24 * scale)}px "Microsoft YaHei", sans-serif`;
        
        for (let i = 0; i < 7; i++) {
            const x = leftMargin + i * cellWidth + cellWidth / 2;
            this.ctx.fillStyle = i >= 5 ? '#ff9999' : '#666688';
            const text = weekdayNames[i];
            const textWidth = this.ctx.measureText(text).width;
            this.ctx.fillText(text, x - textWidth / 2, calTop);
        }

        // 获取日期范围
        const calStart = this.config.calendarStart ? new Date(this.config.calendarStart) : new Date();
        const calEnd = this.config.calendarEnd ? new Date(this.config.calendarEnd) : new Date(calStart.getTime() + 41 * 24 * 60 * 60 * 1000);

        // 找到起始周一
        const startWd = calStart.getDay() || 7; // 周日为7
        const firstMonday = new Date(calStart);
        firstMonday.setDate(firstMonday.getDate() - (startWd - 1));

        const gridTop = calTop + 40 * scale;

        // 存储日期到格子位置的映射
        this.dateToCell = {};
        let currentDate = new Date(firstMonday);

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = leftMargin + col * cellWidth;
                const y = gridTop + row * cellHeight;
                
                const dateKey = this.formatDate(currentDate);
                this.dateToCell[dateKey] = { x, y, col, row };

                const inRange = currentDate >= calStart && currentDate <= calEnd;
                const isToday = currentDate.getTime() === today.getTime();

                // 绘制格子边框
                const pad = 4 * scale;
                this.ctx.beginPath();
                this.roundRect(x + pad, y + pad, cellWidth - pad * 2, cellHeight - pad * 2, 10 * scale);
                
                if (isToday) {
                    this.ctx.fillStyle = 'rgba(30, 50, 80, 0.8)';
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#60a5fa';
                    this.ctx.lineWidth = 2 * scale;
                    this.ctx.stroke();
                } else if (inRange) {
                    this.ctx.strokeStyle = '#252535';
                    this.ctx.lineWidth = 1 * scale;
                    this.ctx.stroke();
                } else {
                    this.ctx.strokeStyle = '#151520';
                    this.ctx.lineWidth = 1 * scale;
                    this.ctx.stroke();
                }

                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
    }

    /**
     * 绘制时间线事件
     */
    drawTimelineEvents(layout) {
        if (!this.config.events || this.config.events.length === 0) return;

        const { scale, cellWidth, cellHeight } = layout;
        const barHeight = 28 * scale;
        const timelineYOffset = 70 * scale;

        this.ctx.font = `${layout.eventFontSize}px "Microsoft YaHei", sans-serif`;

        for (const event of this.config.events) {
            const startKey = event.start;
            const endKey = event.end;
            
            if (!this.dateToCell[startKey]) continue;

            // 找出事件跨越的所有行
            let currentDate = new Date(startKey);
            const endDate = new Date(endKey);
            const rowSegments = [];

            while (currentDate <= endDate) {
                const dateKey = this.formatDate(currentDate);
                const cell = this.dateToCell[dateKey];
                
                if (cell) {
                    if (rowSegments.length === 0 || rowSegments[rowSegments.length - 1].row !== cell.row) {
                        rowSegments.push({
                            row: cell.row,
                            startCol: cell.col,
                            endCol: cell.col,
                            startX: cell.x,
                            y: cell.y,
                            isFirst: rowSegments.length === 0
                        });
                    } else {
                        rowSegments[rowSegments.length - 1].endCol = cell.col;
                    }
                }
                
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // 绘制每行的时间线段（空心边框）
            for (const seg of rowSegments) {
                const sx = seg.startX + 10 * scale;
                const ex = layout.leftMargin + seg.endCol * cellWidth + cellWidth - 10 * scale;
                const sy = seg.y + timelineYOffset;

                this.ctx.beginPath();
                this.roundRect(sx, sy, ex - sx, barHeight, 6 * scale);
                this.ctx.strokeStyle = event.color || '#60a5fa';
                this.ctx.lineWidth = 2 * scale;
                this.ctx.stroke();

                // 文字
                if (seg.isFirst) {
                    this.ctx.fillStyle = event.color || '#60a5fa';
                    const displayName = event.name.length > 8 ? event.name.slice(0, 7) + '…' : event.name;
                    this.ctx.fillText(displayName, sx + 10 * scale, sy + 18 * scale);
                }
            }
        }
    }

    /**
     * 绘制关键节点
     */
    drawMilestones(layout) {
        if (!this.config.milestones || this.config.milestones.length === 0) return;

        const { scale } = layout;
        const barHeight = 28 * scale;
        const timelineYOffset = 70 * scale;

        this.ctx.font = `bold ${layout.eventFontSize}px "Microsoft YaHei", sans-serif`;

        for (const milestone of this.config.milestones) {
            const cell = this.dateToCell[milestone.date];
            if (!cell) continue;

            const tagX = cell.x + 10 * scale;
            const tagY = cell.y + timelineYOffset;

            const textWidth = this.ctx.measureText(milestone.name).width;
            const tagWidth = textWidth + 16 * scale;

            // 实心圆角矩形
            this.ctx.beginPath();
            this.roundRect(tagX, tagY, tagWidth, barHeight, 6 * scale);
            this.ctx.fillStyle = milestone.color || '#4ade80';
            this.ctx.fill();

            // 白色文字
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(milestone.name, tagX + 8 * scale, tagY + 18 * scale);
        }
    }

    /**
     * 绘制特殊标记
     */
    drawMarks(layout) {
        if (!this.config.marks || this.config.marks.length === 0) return;

        const { scale, cellWidth, cellHeight } = layout;
        this.ctx.font = `${16 * scale}px "Microsoft YaHei", sans-serif`;

        for (const mark of this.config.marks) {
            const cell = this.dateToCell[mark.date];
            if (!cell) continue;

            const label = mark.time ? `${mark.icon}${mark.time}` : mark.icon + mark.name;
            const labelWidth = this.ctx.measureText(label).width + 10 * scale;
            
            // 右下角位置
            const markX = cell.x + cellWidth - labelWidth - 10 * scale;
            const markY = cell.y + cellHeight - 35 * scale;

            // 粉色背景标签
            this.ctx.beginPath();
            this.roundRect(markX - 5 * scale, markY - 2 * scale, labelWidth + 10 * scale, 24 * scale, 5 * scale);
            this.ctx.fillStyle = '#f472b6';
            this.ctx.fill();

            // 文字
            this.ctx.fillStyle = '#ffffff';
            this.ctx.fillText(label, markX, markY + 14 * scale);
        }
    }

    /**
     * 绘制日期数字
     */
    drawDates(layout) {
        const { leftMargin, calTop, cellWidth, cellHeight, cols, rows, scale } = layout;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const calStart = this.config.calendarStart ? new Date(this.config.calendarStart) : new Date();
        const calEnd = this.config.calendarEnd ? new Date(this.config.calendarEnd) : new Date(calStart.getTime() + 41 * 24 * 60 * 60 * 1000);

        const startWd = calStart.getDay() || 7;
        const firstMonday = new Date(calStart);
        firstMonday.setDate(firstMonday.getDate() - (startWd - 1));

        const gridTop = calTop + 40 * scale;
        let currentDate = new Date(firstMonday);

        this.ctx.font = `bold ${layout.dateFontSize}px "Microsoft YaHei", sans-serif`;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = leftMargin + col * cellWidth;
                const y = gridTop + row * cellHeight;

                const inRange = currentDate >= calStart && currentDate <= calEnd;
                const isToday = currentDate.getTime() === today.getTime();
                const isWeekend = col >= 5;

                let numColor;
                if (!inRange) {
                    numColor = '#252530';
                } else if (isToday) {
                    numColor = '#60a5fa';
                } else if (isWeekend) {
                    numColor = '#ff9999';
                } else {
                    numColor = '#ffffff';
                }

                const dayStr = String(currentDate.getDate());

                // 月初标记
                if (currentDate.getDate() === 1 && inRange) {
                    this.ctx.font = `${layout.smallFontSize}px "Microsoft YaHei", sans-serif`;
                    this.ctx.fillStyle = '#4ade80';
                    this.ctx.fillText(`${currentDate.getMonth() + 1}月`, x + 12 * scale, y + 22 * scale);
                    
                    this.ctx.font = `bold ${layout.dateFontSize}px "Microsoft YaHei", sans-serif`;
                    this.ctx.fillStyle = numColor;
                    this.ctx.fillText(dayStr, x + 12 * scale, y + 55 * scale);
                } else {
                    this.ctx.fillStyle = numColor;
                    this.ctx.fillText(dayStr, x + 12 * scale, y + 40 * scale);
                }

                currentDate.setDate(currentDate.getDate() + 1);
            }
        }
    }

    /**
     * 绘制图例
     */
    drawLegend(layout) {
        const { leftMargin, calTop, cellHeight, rows, scale } = layout;
        const gridTop = calTop + 40 * scale;
        const legendY = gridTop + rows * cellHeight + 20 * scale;

        const legends = [
            { name: '研究/综述', color: '#60a5fa' },
            { name: '反馈/修改', color: '#fb923c' },
            { name: '准备材料', color: '#f87171' },
            { name: '开题答辩', color: '#4ade80' },
        ];

        this.ctx.font = `${layout.smallFontSize}px "Microsoft YaHei", sans-serif`;
        let lx = leftMargin;

        for (const legend of legends) {
            // 色块
            this.ctx.beginPath();
            this.roundRect(lx, legendY, 18 * scale, 18 * scale, 4 * scale);
            this.ctx.fillStyle = legend.color;
            this.ctx.fill();

            // 文字
            this.ctx.fillStyle = '#666677';
            this.ctx.fillText(legend.name, lx + 24 * scale, legendY + 14 * scale);

            lx += 160 * scale;
        }
    }

    /**
     * 绘制待办列表
     */
    drawTodos(layout) {
        if (!this.config.todos || this.config.todos.length === 0) return;

        const { leftMargin, calTop, cellWidth, cols, rightMargin, width, scale } = layout;
        const todoX = leftMargin + cols * cellWidth + 60 * scale;
        let todoY = calTop;

        // 标题
        this.ctx.font = `bold ${28 * scale}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.fillText('今日待办', todoX, todoY + 28 * scale);

        todoY += 45 * scale;
        const checkboxSize = 20 * scale;
        const itemSpacing = 38 * scale;

        this.ctx.font = `${22 * scale}px "Microsoft YaHei", sans-serif`;

        for (const todo of this.config.todos) {
            // 复选框
            this.ctx.beginPath();
            this.roundRect(todoX, todoY, checkboxSize, checkboxSize, 4 * scale);
            
            if (todo.done) {
                this.ctx.fillStyle = '#4ade80';
                this.ctx.fill();
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = `bold ${16 * scale}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillText('✓', todoX + 4 * scale, todoY + 15 * scale);
                this.ctx.font = `${22 * scale}px "Microsoft YaHei", sans-serif`;
                this.ctx.fillStyle = '#555566';
            } else {
                this.ctx.strokeStyle = '#555566';
                this.ctx.lineWidth = 2 * scale;
                this.ctx.stroke();
                this.ctx.fillStyle = '#ccccdd';
            }

            // 文字
            const displayText = todo.text.length > 22 ? todo.text.slice(0, 21) + '…' : todo.text;
            this.ctx.fillText(displayText, todoX + checkboxSize + 10 * scale, todoY + 16 * scale);

            todoY += itemSpacing;
        }
    }

    /**
     * 绘制底部信息
     */
    drawFooter(layout) {
        const { leftMargin, height, scale } = layout;
        
        this.ctx.font = `${layout.smallFontSize}px "Microsoft YaHei", sans-serif`;
        this.ctx.fillStyle = '#252535';
        
        const now = new Date();
        const footer = `Generated: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        this.ctx.fillText(footer, leftMargin, height - 40 * scale);
    }

    /**
     * 辅助方法：绘制圆角矩形路径
     */
    roundRect(x, y, w, h, r) {
        this.ctx.moveTo(x + r, y);
        this.ctx.lineTo(x + w - r, y);
        this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        this.ctx.lineTo(x + w, y + h - r);
        this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        this.ctx.lineTo(x + r, y + h);
        this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        this.ctx.lineTo(x, y + r);
        this.ctx.quadraticCurveTo(x, y, x + r, y);
        this.ctx.closePath();
    }

    /**
     * 辅助方法：格式化日期为 YYYY-MM-DD
     */
    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * 导出为 Blob
     */
    toBlob(type = 'image/png', quality = 0.95) {
        return new Promise((resolve) => {
            this.canvas.toBlob(resolve, type, quality);
        });
    }

    /**
     * 下载壁纸
     */
    async download(filename = 'wallpaper.png') {
        const blob = await this.toBlob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    }
}

// 导出
window.WallpaperEngine = WallpaperEngine;

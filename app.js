/**
 * 日程壁纸生成器 - 应用主逻辑
 */

class WallpaperApp {
    constructor() {
        this.engine = new WallpaperEngine();
        this.assetDeskClient = window.AssetDeskClient ? new AssetDeskClient() : null;
        this.config = this.loadConfig();
        this.customBgImage = null;
        this.lastGeneratedDate = null;
        this.autoUpdateInterval = null;
        
        this.init();
    }

    /**
     * 加载配置
     */
    loadConfig() {
        const saved = localStorage.getItem('wallpaper_config');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (e) {
                console.error('配置解析失败', e);
            }
        }
        
        // 默认配置
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - today.getDay() + 1); // 本周一
        const endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 41); // 6周
        return {
            glowEnabled: true,
            bgImageEnabled: false,
            bgBrightness: 100,
            bgBlur: 0,
            bgVignette: 50,
            screens: [
                { name: '主屏幕', width: 3840, height: 2400 }
            ],
            calendarStart: this.formatDate(startDate),
            calendarEnd: this.formatDate(endDate),
            countdown: {
                name: '答辩',
                date: '2026-06-24'
            },
            todos: [
                { text: '完成《画皮》第6关动画', done: false },
                { text: '检查素材评审反馈', done: false },
                { text: '阅读2篇核心文献', done: false },
            ],
            events: [
                { name: '确定研究框架', start: '2026-05-25', end: '2026-06-04', color: '#60a5fa' },
                { name: '文献综述', start: '2026-06-06', end: '2026-06-09', color: '#60a5fa' },
                { name: '开题报告撰写', start: '2026-06-10', end: '2026-06-16', color: '#fb923c' },
                { name: '答辩准备', start: '2026-06-18', end: '2026-06-23', color: '#f87171' },
            ],
            milestones: [
                { name: '框架确定', date: '2026-06-05', color: '#60a5fa' },
                { name: '综述完成', date: '2026-06-10', color: '#60a5fa' },
                { name: '交开题报告表', date: '2026-06-17', color: '#f59e0b' },
                { name: '答辩', date: '2026-06-24', color: '#f43f5e' },
            ],
            marks: [
                { name: '朋友考试', date: '2026-06-08', time: '22:30', icon: '🎓' },
                { name: '朋友考试', date: '2026-06-09', time: '20:00', icon: '🎓' },
                { name: '朋友考试', date: '2026-06-12', time: '22:30', icon: '🎓' },
                { name: '朋友考试', date: '2026-06-15', time: '22:30', icon: '🎓' },
                { name: '朋友考试', date: '2026-06-20', time: '18:30', icon: '🎓' },
            ],
            autoUpdate: true
        };
    }

    /**
     * 保存配置
     */
    saveConfig() {
        localStorage.setItem('wallpaper_config', JSON.stringify(this.config));
    }

    /**
     * 初始化应用
     */
    init() {
        this.bindElements();
        this.bindEvents();
        this.renderUI();
        this.initEngine();
        this.startAutoUpdate();
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 绑定DOM元素
     */
    bindElements() {
        // 弥散光设置
        this.glowEnabled = document.getElementById('glowEnabled');
        this.gradientSettings = document.getElementById('gradientSettings');
        this.glowCount = document.getElementById('glowCount');
        this.glowPreset = document.getElementById('glowPreset');
        this.customColorGroup = document.getElementById('customColorGroup');
        this.glowColor1 = document.getElementById('glowColor1');
        this.glowColor2 = document.getElementById('glowColor2');
        this.glowPosition = document.getElementById('glowPosition');
        this.glowIntensity = document.getElementById('glowIntensity');
        this.glowIntensityVal = document.getElementById('glowIntensityVal');

        // 背景图片设置
        this.bgImageEnabled = document.getElementById('bgImageEnabled');
        this.bgImageSettings = document.getElementById('bgImageSettings');
        this.bgUpload = document.getElementById('bgUpload');
        this.bgPreview = document.getElementById('bgPreview');
        this.bgBrightness = document.getElementById('bgBrightness');
        this.bgBrightnessVal = document.getElementById('bgBrightnessVal');
        this.bgBlur = document.getElementById('bgBlur');
        this.bgBlurVal = document.getElementById('bgBlurVal');
        this.bgVignette = document.getElementById('bgVignette');
        this.bgVignetteVal = document.getElementById('bgVignetteVal');

        // 屏幕配置
        this.screenList = document.getElementById('screenList');
        this.addScreenBtn = document.getElementById('addScreenBtn');
        this.previewScreen = document.getElementById('previewScreen');

        // 日历范围
        this.calStart = document.getElementById('calStart');
        this.calEnd = document.getElementById('calEnd');

        // 倒计时
        this.countdownName = document.getElementById('countdownName');
        this.countdownDate = document.getElementById('countdownDate');

        // 待办
        this.todoList = document.getElementById('todoList');
        this.newTodoInput = document.getElementById('newTodoInput');
        this.addTodoBtn = document.getElementById('addTodoBtn');

        // 事件
        this.eventList = document.getElementById('eventList');
        this.addEventBtn = document.getElementById('addEventBtn');
        this.eventModal = document.getElementById('eventModal');

        // 节点
        this.milestoneList = document.getElementById('milestoneList');
        this.addMilestoneBtn = document.getElementById('addMilestoneBtn');
        this.milestoneModal = document.getElementById('milestoneModal');

        // 标记
        this.markList = document.getElementById('markList');
        this.addMarkBtn = document.getElementById('addMarkBtn');
        this.markModal = document.getElementById('markModal');

        // 预览
        this.previewCanvas = document.getElementById('previewCanvas');
        this.canvasContainer = document.getElementById('canvasContainer');
        this.canvasOverlay = document.getElementById('canvasOverlay');
        this.fullscreenPreviewBtn = document.getElementById('fullscreenPreviewBtn');
        this.previewModal = document.getElementById('previewModal');
        this.fullPreviewCanvas = document.getElementById('fullPreviewCanvas');
        this.closePreviewBtn = document.getElementById('closePreviewBtn');
        this.lastGenerated = document.getElementById('lastGenerated');
        this.autoUpdateStatus = document.getElementById('autoUpdateStatus');

        // 操作按钮
        this.setWallpaperBtn = document.getElementById('setWallpaperBtn');
        this.exportBtn = document.getElementById('exportBtn');

        // AssetDesk 联动
        this.assetdeskFile      = document.getElementById('assetdeskFile');
        this.assetdeskImportBtn = document.getElementById('assetdeskImportBtn');
        this.assetdeskClearBtn  = document.getElementById('assetdeskClearBtn');
        this.assetdeskStatus    = document.getElementById('assetdeskStatus');
    }

    /**
     * 绑定事件
     */
    bindEvents() {
        // 弥散光开关
        this.glowEnabled.addEventListener('change', () => {
            this.config.glowEnabled = this.glowEnabled.checked;
            this.gradientSettings.style.display = this.config.glowEnabled ? 'block' : 'none';
            this.saveConfig();
            this.generatePreview();
        });

        // 背景图片开关
        this.bgImageEnabled.addEventListener('change', () => {
            this.config.bgImageEnabled = this.bgImageEnabled.checked;
            this.bgImageSettings.style.display = this.config.bgImageEnabled ? 'block' : 'none';
            this.saveConfig();
            this.generatePreview();
        });

        // 背景图上传
        this.bgUpload.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        this.customBgImage = img;
                        this.engine.setCustomBackground(img);
                        this.bgPreview.innerHTML = `<img src="${ev.target.result}">`;
                        // 保存图片数据到配置
                        this.config.customBgData = ev.target.result;
                        this.saveConfig();
                        this.generatePreview();
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }
        });

        // 图片亮度
        this.bgBrightness.addEventListener('input', () => {
            this.config.bgBrightness = parseInt(this.bgBrightness.value);
            this.bgBrightnessVal.textContent = this.config.bgBrightness + '%';
            this.saveConfig();
            this.generatePreview();
        });

        // 图片模糊
        this.bgBlur.addEventListener('input', () => {
            this.config.bgBlur = parseInt(this.bgBlur.value);
            this.bgBlurVal.textContent = this.config.bgBlur + 'px';
            this.saveConfig();
            this.generatePreview();
        });

        // 暗角强度
        this.bgVignette.addEventListener('input', () => {
            this.config.bgVignette = parseInt(this.bgVignette.value);
            this.bgVignetteVal.textContent = this.config.bgVignette + '%';
            this.saveConfig();
            this.generatePreview();
        });

        // 光源数量
        this.glowCount.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                this.glowCount.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.config.glowCount = parseInt(btn.dataset.count);
                this.saveConfig();
                this.generatePreview();
            });
        });

        // 弥散光色系切换
        this.glowPreset.addEventListener('change', () => {
            this.config.glowPreset = this.glowPreset.value;
            this.customColorGroup.style.display = this.config.glowPreset === 'custom' ? 'block' : 'none';
            this.saveConfig();
            this.generatePreview();
        });

        // 自定义颜色
        this.glowColor1.addEventListener('input', () => {
            this.config.glowColor1 = this.glowColor1.value;
            this.saveConfig();
            this.generatePreview();
        });
        this.glowColor2.addEventListener('input', () => {
            this.config.glowColor2 = this.glowColor2.value;
            this.saveConfig();
            this.generatePreview();
        });

        // 光源位置
        this.glowPosition.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                this.glowPosition.querySelectorAll('button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.config.glowPosition = btn.dataset.pos;
                this.saveConfig();
                this.generatePreview();
            });
        });

        // 光源强度
        this.glowIntensity.addEventListener('input', () => {
            this.config.glowIntensity = parseInt(this.glowIntensity.value);
            this.glowIntensityVal.textContent = this.config.glowIntensity + '%';
            this.saveConfig();
            this.generatePreview();
        });

        // 添加屏幕
        this.addScreenBtn.addEventListener('click', () => {
            this.config.screens.push({ name: `屏幕${this.config.screens.length + 1}`, width: 1920, height: 1080 });
            this.saveConfig();
            this.renderScreens();
        });

        // 预览屏幕切换
        this.previewScreen.addEventListener('change', () => {
            this.generatePreview();
        });

        // 日历范围
        this.calStart.addEventListener('change', () => {
            this.config.calendarStart = this.calStart.value;
            this.saveConfig();
            this.generatePreview();
        });
        this.calEnd.addEventListener('change', () => {
            this.config.calendarEnd = this.calEnd.value;
            this.saveConfig();
            this.generatePreview();
        });

        // 倒计时
        this.countdownName.addEventListener('change', () => {
            this.config.countdown.name = this.countdownName.value;
            this.saveConfig();
            this.generatePreview();
        });
        this.countdownDate.addEventListener('change', () => {
            this.config.countdown.date = this.countdownDate.value;
            this.saveConfig();
            this.generatePreview();
        });

        // 添加待办
        this.addTodoBtn.addEventListener('click', () => this.addTodo());
        this.newTodoInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.addTodo();
        });

        // 添加事件/节点/标记
        this.addEventBtn.addEventListener('click', () => this.showEventModal());
        this.addMilestoneBtn.addEventListener('click', () => this.showMilestoneModal());
        this.addMarkBtn.addEventListener('click', () => this.showMarkModal());

        // 弹窗按钮
        document.getElementById('cancelEventBtn').addEventListener('click', () => this.hideModal('eventModal'));
        document.getElementById('saveEventBtn').addEventListener('click', () => this.saveEvent());
        document.getElementById('cancelMilestoneBtn').addEventListener('click', () => this.hideModal('milestoneModal'));
        document.getElementById('saveMilestoneBtn').addEventListener('click', () => this.saveMilestone());
        document.getElementById('cancelMarkBtn').addEventListener('click', () => this.hideModal('markModal'));
        document.getElementById('saveMarkBtn').addEventListener('click', () => this.saveMark());

        // 点击遮罩关闭弹窗
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.classList.remove('active');
                }
            });
        });

        // 预览放大
        this.canvasContainer.addEventListener('click', () => this.showFullPreview());
        this.fullscreenPreviewBtn.addEventListener('click', () => this.showFullPreview());
        this.closePreviewBtn.addEventListener('click', () => this.hideModal('previewModal'));

        // 一键设置壁纸
        this.setWallpaperBtn.addEventListener('click', () => this.setAsWallpaper());
        this.exportBtn.addEventListener('click', () => this.exportAll());

        // AssetDesk 联动
        this.assetdeskImportBtn.addEventListener('click', () => this.importFromAssetDesk(false));
        this.assetdeskClearBtn.addEventListener('click', () => this.clearAssetDeskTodos());
    }

    /**
     * 初始化渲染引擎
     */
    initEngine() {
        this.engine.init(this.previewCanvas, this.config);
    }

    /**
     * 渲染UI
     */
    renderUI() {
        // 弥散光开关
        this.glowEnabled.checked = this.config.glowEnabled !== false;
        this.gradientSettings.style.display = this.config.glowEnabled !== false ? 'block' : 'none';

        // 背景图片开关
        this.bgImageEnabled.checked = this.config.bgImageEnabled || false;
        this.bgImageSettings.style.display = this.config.bgImageEnabled ? 'block' : 'none';

        // 图片参数
        this.bgBrightness.value = this.config.bgBrightness || 100;
        this.bgBrightnessVal.textContent = (this.config.bgBrightness || 100) + '%';
        this.bgBlur.value = this.config.bgBlur || 0;
        this.bgBlurVal.textContent = (this.config.bgBlur || 0) + 'px';
        this.bgVignette.value = this.config.bgVignette || 50;
        this.bgVignetteVal.textContent = (this.config.bgVignette || 50) + '%';

        // 弥散光设置
        this.glowPreset.value = this.config.glowPreset || 'blue-purple';
        this.customColorGroup.style.display = this.config.glowPreset === 'custom' ? 'block' : 'none';
        this.glowColor1.value = this.config.glowColor1 || '#5078dc';
        this.glowColor2.value = this.config.glowColor2 || '#a064c8';
        this.glowIntensity.value = this.config.glowIntensity || 100;
        this.glowIntensityVal.textContent = (this.config.glowIntensity || 100) + '%';
        
        // 光源数量
        const count = this.config.glowCount || 3;
        this.glowCount.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.count) === count);
        });
        
        // 光源位置
        const pos = this.config.glowPosition || 'top-right';
        this.glowPosition.querySelectorAll('button').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.pos === pos);
        });

        // 恢复自定义背景图
        if (this.config.customBgData) {
            const img = new Image();
            img.onload = () => {
                this.customBgImage = img;
                this.engine.setCustomBackground(img);
                this.bgPreview.innerHTML = `<img src="${this.config.customBgData}">`;
                this.generatePreview();
            };
            img.src = this.config.customBgData;
        }

        // 日历范围
        this.calStart.value = this.config.calendarStart;
        this.calEnd.value = this.config.calendarEnd;

        // 倒计时
        this.countdownName.value = this.config.countdown?.name || '';
        this.countdownDate.value = this.config.countdown?.date || '';

        // 渲染列表
        this.renderScreens();
        this.renderTodos();
        this.renderEvents();
        this.renderMilestones();
        this.renderMarks();
    }

    /**
     * 显示全屏预览
     */
    showFullPreview() {
        const screenIndex = parseInt(this.previewScreen.value) || 0;
        const screen = this.config.screens[screenIndex];
        
        // 生成全分辨率壁纸到全屏canvas
        this.fullPreviewCanvas.width = screen.width;
        this.fullPreviewCanvas.height = screen.height;
        
        const fullCtx = this.fullPreviewCanvas.getContext('2d');
        fullCtx.drawImage(this.previewCanvas, 0, 0, this.previewCanvas.width, this.previewCanvas.height, 
                          0, 0, screen.width, screen.height);
        
        // 重新用引擎生成全分辨率
        const tempCanvas = this.engine.canvas;
        this.engine.canvas = this.fullPreviewCanvas;
        this.engine.ctx = fullCtx;
        this.engine.generate(screen.width, screen.height);
        this.engine.canvas = tempCanvas;
        this.engine.ctx = tempCanvas.getContext('2d');
        
        this.previewModal.classList.add('active');
    }

    /**
     * 一键设置壁纸
     */
    async setAsWallpaper() {
        const screenIndex = parseInt(this.previewScreen.value) || 0;
        const screen = this.config.screens[screenIndex];
        
        // 生成全分辨率壁纸
        this.engine.generate(screen.width, screen.height);
        
        // 导出为blob并下载到固定位置
        const blob = await this.engine.toBlob();
        
        // 创建下载链接，下载到用户的下载目录
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'wallpaper.png';
        a.click();
        URL.revokeObjectURL(url);
        
        // 提示用户
        this.showNotification('壁纸已生成', '请在下载目录找到 wallpaper.png 并设为桌面背景');
        
        // 更新预览
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 渲染屏幕列表
     */
    renderScreens() {
        this.screenList.innerHTML = this.config.screens.map((screen, index) => `
            <div class="screen-item" data-index="${index}">
                <input type="text" value="${screen.name}" class="screen-name" style="width: 80px">
                <input type="number" value="${screen.width}" class="screen-width"> × 
                <input type="number" value="${screen.height}" class="screen-height">
                <button class="delete-btn" onclick="app.deleteScreen(${index})">×</button>
            </div>
        `).join('');

        // 更新预览下拉
        this.previewScreen.innerHTML = this.config.screens.map((screen, index) => 
            `<option value="${index}">${screen.name} (${screen.width}×${screen.height})</option>`
        ).join('');

        // 绑定输入事件
        this.screenList.querySelectorAll('.screen-item').forEach((item, index) => {
            item.querySelector('.screen-name').addEventListener('change', (e) => {
                this.config.screens[index].name = e.target.value;
                this.saveConfig();
                this.renderScreens();
            });
            item.querySelector('.screen-width').addEventListener('change', (e) => {
                this.config.screens[index].width = parseInt(e.target.value) || 1920;
                this.saveConfig();
                this.renderScreens();
            });
            item.querySelector('.screen-height').addEventListener('change', (e) => {
                this.config.screens[index].height = parseInt(e.target.value) || 1080;
                this.saveConfig();
                this.renderScreens();
            });
        });
    }

    /**
     * 删除屏幕
     */
    deleteScreen(index) {
        if (this.config.screens.length > 1) {
            this.config.screens.splice(index, 1);
            this.saveConfig();
            this.renderScreens();
        }
    }

    /**
     * 渲染待办列表
     */
    renderTodos() {
        this.todoList.innerHTML = this.config.todos.map((todo, index) => `
            <div class="todo-item ${todo.done ? 'done' : ''}" data-index="${index}">
                <input type="checkbox" ${todo.done ? 'checked' : ''} onchange="app.toggleTodo(${index})">
                <span class="todo-text">${todo.text}</span>
                <button class="delete-btn" onclick="app.deleteTodo(${index})">×</button>
            </div>
        `).join('');
    }

    /**
     * 添加待办
     */
    addTodo() {
        const text = this.newTodoInput.value.trim();
        if (text) {
            this.config.todos.push({ text, done: false });
            this.newTodoInput.value = '';
            this.saveConfig();
            this.renderTodos();
            this.generatePreview();
        }
    }

    /**
     * 切换待办状态
     */
    toggleTodo(index) {
        this.config.todos[index].done = !this.config.todos[index].done;
        this.saveConfig();
        this.renderTodos();
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 删除待办
     */
    deleteTodo(index) {
        this.config.todos.splice(index, 1);
        this.saveConfig();
        this.renderTodos();
        this.generatePreview();
    }

    // ─────────────────────────────────────────────
    // AssetDesk 联动
    // ─────────────────────────────────────────────

    /**
     * 解析 events.jsonl，重放事件流得出每个 slot 的当前状态
     * 规则：每个 sid 取最后一条事件的 to_state
     * 筛出 to_state 为 todo/partial 的 slot 作为待办
     */
    /**
     * 从 AssetDesk API 自动拉取未完成槽位（GET http://127.0.0.1:18765/slots）
     * silent=true 时失败不显示错误（用于启动时静默尝试）
     */
    async importFromAssetDesk(silent = false) {
        if (!this.assetDeskClient) {
            if (this.assetdeskStatus) {
                this.assetdeskStatus.textContent = 'AssetDesk 客户端未加载';
                this.assetdeskStatus.style.color = '#fb923c';
            }
            return;
        }

        if (this.assetdeskStatus) {
            this.assetdeskStatus.textContent = '正在连接 AssetDesk...';
            this.assetdeskStatus.style.color = '#8888aa';
        }

        const result = await this.assetDeskClient.getWallpaperData();
        if (!result.ok) {
            console.warn('AssetDesk 同步失败', result.error);
            if (this.assetdeskStatus) {
                this.assetdeskStatus.textContent = silent ? 'AssetDesk 未连接' : `AssetDesk 未连接：${result.error || '请先启动 AssetDesk'}`;
                this.assetdeskStatus.style.color = silent ? '#444455' : '#fb923c';
            }
            return;
        }

        const snapshot = result.data;
        const newTodos = this.assetDeskClient.toTodos(snapshot);
        this.config.assetDeskSnapshot = snapshot;
        this.config.todos = this.config.todos.filter(t => !t.fromAssetDesk);
        this.config.todos.push(...newTodos);

        this.saveConfig();
        this.renderTodos();
        this.generatePreview();

        if (this.assetdeskStatus) {
            const summary = snapshot.weekSummary || {};
            const count = summary.pending_total ?? newTodos.length;
            const suffix = result.fromCache ? '（使用上次快照）' : '';
            this.assetdeskStatus.textContent = count > 0
                ? `已同步 ${count} 个资产焦点${suffix}`
                : `AssetDesk 暂无待处理资产${suffix}`;
            this.assetdeskStatus.style.color = result.fromCache ? '#fb923c' : '#4ade80';
        }
    }

    clearAssetDeskTodos() {
        const before = this.config.todos.length;
        this.config.todos = this.config.todos.filter(t => !t.fromAssetDesk);
        const removed = before - this.config.todos.length;
        this.config.assetDeskSnapshot = null;
        if (this.assetDeskClient) this.assetDeskClient.clearSnapshot();
        this.saveConfig();
        this.renderTodos();
        this.generatePreview();
        this.assetdeskStatus.textContent = removed > 0 ? `已清理 ${removed} 个 AssetDesk 项目` : '没有已导入的 AssetDesk 项目';
        this.assetdeskStatus.style.color = '#8888aa';
    }

    /**
     * 渲染事件列表
     */
    renderEvents() {
        this.eventList.innerHTML = this.config.events.map((event, index) => `
            <div class="list-item" data-index="${index}">
                <div class="color-dot" style="background: ${event.color}"></div>
                <span class="item-text">${event.name}</span>
                <span class="item-date">${event.start.slice(5)}</span>
                <div class="item-actions">
                    <button onclick="app.editEvent(${index})">✎</button>
                    <button onclick="app.deleteEvent(${index})">×</button>
                </div>
            </div>
        `).join('');
    }

    /**
     * 显示事件弹窗
     */
    showEventModal(index = null) {
        this.editingEventIndex = index;
        const event = index !== null ? this.config.events[index] : null;
        
        document.getElementById('eventName').value = event?.name || '';
        document.getElementById('eventStart').value = event?.start || '';
        document.getElementById('eventEnd').value = event?.end || '';
        document.getElementById('eventColor').value = event?.color || '#60a5fa';
        
        this.eventModal.classList.add('active');
    }

    /**
     * 编辑事件
     */
    editEvent(index) {
        this.showEventModal(index);
    }

    /**
     * 保存事件
     */
    saveEvent() {
        const event = {
            name: document.getElementById('eventName').value,
            start: document.getElementById('eventStart').value,
            end: document.getElementById('eventEnd').value,
            color: document.getElementById('eventColor').value
        };

        if (!event.name || !event.start || !event.end) {
            alert('请填写完整信息');
            return;
        }

        if (this.editingEventIndex !== null) {
            this.config.events[this.editingEventIndex] = event;
        } else {
            this.config.events.push(event);
        }

        this.saveConfig();
        this.renderEvents();
        this.generatePreview();
        this.hideModal('eventModal');
    }

    /**
     * 删除事件
     */
    deleteEvent(index) {
        this.config.events.splice(index, 1);
        this.saveConfig();
        this.renderEvents();
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 渲染节点列表
     */
    renderMilestones() {
        this.milestoneList.innerHTML = this.config.milestones.map((m, index) => `
            <div class="list-item" data-index="${index}">
                <div class="color-dot" style="background: ${m.color}"></div>
                <span class="item-text">${m.name}</span>
                <span class="item-date">${m.date.slice(5)}</span>
                <div class="item-actions">
                    <button onclick="app.editMilestone(${index})">✎</button>
                    <button onclick="app.deleteMilestone(${index})">×</button>
                </div>
            </div>
        `).join('');
    }

    /**
     * 显示节点弹窗
     */
    showMilestoneModal(index = null) {
        this.editingMilestoneIndex = index;
        const m = index !== null ? this.config.milestones[index] : null;
        
        document.getElementById('milestoneName').value = m?.name || '';
        document.getElementById('milestoneDate').value = m?.date || '';
        document.getElementById('milestoneColor').value = m?.color || '#4ade80';
        
        this.milestoneModal.classList.add('active');
    }

    editMilestone(index) {
        this.showMilestoneModal(index);
    }

    saveMilestone() {
        const m = {
            name: document.getElementById('milestoneName').value,
            date: document.getElementById('milestoneDate').value,
            color: document.getElementById('milestoneColor').value
        };

        if (!m.name || !m.date) {
            alert('请填写完整信息');
            return;
        }

        if (this.editingMilestoneIndex !== null) {
            this.config.milestones[this.editingMilestoneIndex] = m;
        } else {
            this.config.milestones.push(m);
        }

        this.saveConfig();
        this.renderMilestones();
        this.generatePreview();
        this.hideModal('milestoneModal');
    }

    deleteMilestone(index) {
        this.config.milestones.splice(index, 1);
        this.saveConfig();
        this.renderMilestones();
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 渲染标记列表
     */
    renderMarks() {
        this.markList.innerHTML = this.config.marks.map((m, index) => `
            <div class="list-item" data-index="${index}">
                <span style="font-size: 16px">${m.icon}</span>
                <span class="item-text">${m.name}</span>
                <span class="item-date">${m.date.slice(5)} ${m.time || ''}</span>
                <div class="item-actions">
                    <button onclick="app.editMark(${index})">✎</button>
                    <button onclick="app.deleteMark(${index})">×</button>
                </div>
            </div>
        `).join('');
    }

    showMarkModal(index = null) {
        this.editingMarkIndex = index;
        const m = index !== null ? this.config.marks[index] : null;
        
        document.getElementById('markName').value = m?.name || '';
        document.getElementById('markDate').value = m?.date || '';
        document.getElementById('markTime').value = m?.time || '';
        document.getElementById('markIcon').value = m?.icon || '🎓';
        
        this.markModal.classList.add('active');
    }

    editMark(index) {
        this.showMarkModal(index);
    }

    saveMark() {
        const m = {
            name: document.getElementById('markName').value,
            date: document.getElementById('markDate').value,
            time: document.getElementById('markTime').value,
            icon: document.getElementById('markIcon').value
        };

        if (!m.name || !m.date) {
            alert('请填写完整信息');
            return;
        }

        if (this.editingMarkIndex !== null) {
            this.config.marks[this.editingMarkIndex] = m;
        } else {
            this.config.marks.push(m);
        }

        this.saveConfig();
        this.renderMarks();
        this.generatePreview();
        this.hideModal('markModal');
    }

    deleteMark(index) {
        this.config.marks.splice(index, 1);
        this.saveConfig();
        this.renderMarks();
        this.generatePreview();

        // 启动时静默尝试从 AssetDesk 同步待办
        this.importFromAssetDesk(true);
    }

    /**
     * 隐藏弹窗
     */
    hideModal(id) {
        document.getElementById(id).classList.remove('active');
    }

    /**
     * 生成预览
     */
    generatePreview() {
        const screenIndex = parseInt(this.previewScreen.value) || 0;
        const screen = this.config.screens[screenIndex];
        
        this.engine.config = this.config;
        this.engine.generate(screen.width, screen.height);
        
        this.lastGeneratedDate = new Date();
        this.lastGenerated.textContent = `上次生成：${this.formatTime(this.lastGeneratedDate)}`;
    }

    /**
     * 导出所有屏幕
     */
    async exportAll() {
        for (let i = 0; i < this.config.screens.length; i++) {
            const screen = this.config.screens[i];
            this.engine.generate(screen.width, screen.height);
            await this.engine.download(`wallpaper_${screen.name}_${screen.width}x${screen.height}.png`);
            
            // 等待一下避免浏览器限制
            await new Promise(r => setTimeout(r, 500));
        }
    }

    /**
     * 启动自动更新
     */
    startAutoUpdate() {
        // 每分钟检查一次日期变化
        this.autoUpdateInterval = setInterval(() => {
            this.checkDateChange();
        }, 60000);

        // 页面可见性变化时也检查
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                this.checkDateChange();
            }
        });
    }

    /**
     * 检查日期变化
     */
    checkDateChange() {
        const today = this.formatDate(new Date());
        const lastDate = this.lastGeneratedDate ? this.formatDate(this.lastGeneratedDate) : null;
        
        if (lastDate !== today) {
            console.log('日期已变化，自动更新壁纸');
            this.generatePreview();
            this.showNotification('壁纸已自动更新', '新的一天，壁纸已重新生成');
        }
    }

    /**
     * 显示通知
     */
    showNotification(title, body) {
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body });
        } else if ('Notification' in window && Notification.permission !== 'denied') {
            Notification.requestPermission().then(permission => {
                if (permission === 'granted') {
                    new Notification(title, { body });
                }
            });
        }
    }

    /**
     * 辅助：格式化日期
     */
    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    /**
     * 辅助：格式化时间
     */
    formatTime(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }
}

// 启动应用
let app;
document.addEventListener('DOMContentLoaded', () => {
    app = new WallpaperApp();
    
    // 请求通知权限
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
    }
});

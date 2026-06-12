/**
 * AssetDesk read-only client for WallCraft.
 * Keeps WallCraft as a wallpaper/view layer: fetch, normalize, cache, and degrade gracefully.
 */
class AssetDeskClient {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'http://127.0.0.1:18765';
        this.cacheKey = options.cacheKey || 'wallcraft_assetdesk_snapshot_v1';
        this.timeoutMs = options.timeoutMs || 3000;
    }

    async fetchJson(path) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const res = await fetch(`${this.baseUrl}${path}`, {
                method: 'GET',
                cache: 'no-store',
                signal: controller.signal,
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (!data || data.ok === false) throw new Error(data?.error || 'AssetDesk returned invalid data');
            return data;
        } finally {
            clearTimeout(timer);
        }
    }

    async getWallpaperData() {
        try {
            const data = await this.fetchJson('/api/wallpaper');
            const normalized = this.normalizeWallpaperData(data);
            this.saveSnapshot(normalized);
            return { ok: true, online: true, fromCache: false, data: normalized };
        } catch (primaryError) {
            try {
                // Compatibility fallback for older AssetDesk server.py
                const slots = await this.fetchJson('/slots');
                const normalized = this.normalizeLegacySlots(slots);
                this.saveSnapshot(normalized);
                return { ok: true, online: true, fromCache: false, data: normalized, warning: primaryError.message };
            } catch (fallbackError) {
                const cached = this.loadSnapshot();
                if (cached) {
                    return {
                        ok: true,
                        online: false,
                        fromCache: true,
                        data: cached,
                        error: fallbackError.message || primaryError.message,
                    };
                }
                return {
                    ok: false,
                    online: false,
                    fromCache: false,
                    data: null,
                    error: fallbackError.message || primaryError.message,
                };
            }
        }
    }

    normalizeWallpaperData(data) {
        const focus = Array.isArray(data.today_focus) ? data.today_focus : [];
        const assetStatus = data.asset_status || {};
        const weekSummary = data.week_summary || {};
        return {
            source: data.source || 'AssetDesk',
            generatedAt: data.generated_at || new Date().toISOString(),
            title: data.title || '今日工作状态',
            subtitle: data.subtitle || '来自 AssetDesk 的个人资产流转快照',
            todayFocus: focus,
            weekSummary,
            assetStatus,
            recentEvents: Array.isArray(data.recent_events) ? data.recent_events : [],
            warnings: Array.isArray(data.warnings) ? data.warnings : [],
            raw: data,
        };
    }

    normalizeLegacySlots(slots) {
        const pending = Array.isArray(slots.pending) ? slots.pending : [];
        const todayFocus = pending.slice(0, 5).map(item => {
            const project = item.project_name || item.pid || 'AssetDesk';
            const level = item.level_name || item.lid || '';
            const label = item.slot_label || item.slot_type || 'Pending Slot';
            return {
                title: `[${project}] ${level} / ${label}`.replace(/\s+/g, ' ').trim(),
                project,
                level,
                label,
                state: item.to_state === 'partial' ? '进行中' : '待处理',
                raw_state: item.to_state || '',
                sid: item.sid || '',
                ts: item.ts || 0,
            };
        });
        const projectMap = {};
        pending.forEach(item => {
            const name = item.project_name || item.pid || 'AssetDesk';
            const bucket = projectMap[name] || { name, total: 0, todo: 0, partial: 0 };
            bucket.total += 1;
            if (item.to_state === 'partial') bucket.partial += 1;
            else bucket.todo += 1;
            projectMap[name] = bucket;
        });
        const partial = pending.filter(x => x.to_state === 'partial').length;
        const todo = pending.length - partial;
        return {
            source: 'AssetDesk',
            generatedAt: new Date().toISOString(),
            title: '今日工作状态',
            subtitle: '来自 AssetDesk /slots 的兼容快照',
            todayFocus,
            weekSummary: { pending_total: pending.length, todo, partial, project_count: Object.keys(projectMap).length },
            assetStatus: { pending_total: pending.length, todo, partial, projects: Object.values(projectMap) },
            recentEvents: [],
            warnings: [],
            raw: { legacy_slots: slots },
        };
    }

    toTodos(snapshot) {
        if (!snapshot || !Array.isArray(snapshot.todayFocus)) return [];
        return snapshot.todayFocus.map(item => {
            const state = item.state ? ` · ${item.state}` : '';
            return {
                text: `${item.title}${state}`.replace(/\s+/g, ' ').trim(),
                done: false,
                fromAssetDesk: true,
                assetdeskState: item.raw_state || item.state || '',
                assetdeskSid: item.sid || '',
            };
        });
    }

    saveSnapshot(snapshot) {
        try {
            localStorage.setItem(this.cacheKey, JSON.stringify({ savedAt: new Date().toISOString(), snapshot }));
        } catch (e) {
            console.warn('AssetDesk snapshot cache failed', e);
        }
    }

    loadSnapshot() {
        try {
            const raw = localStorage.getItem(this.cacheKey);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed?.snapshot || null;
        } catch (e) {
            return null;
        }
    }

    clearSnapshot() {
        try { localStorage.removeItem(this.cacheKey); } catch (e) {}
    }
}

window.AssetDeskClient = AssetDeskClient;

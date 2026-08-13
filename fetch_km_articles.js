// 获取 KM 热榜文章，筛选 AI/设计/视频相关，保存为 JSON 供壁纸渲染
const { execSync } = require('child_process');
const fs = require('fs');

const OUT = 'C:/Users/jihuiwang/Documents/GitHub/JH-WallCraft/km_articles.json';

// 关键词过滤：AI、设计、视频、动画、游戏、AIGC 等
const KEYWORDS = ['AI', 'ai', 'AIGC', '设计', '视频', '动画', '游戏', '美术', '创作', '生成', '模型', '工作流', '工具', '效率', 'Prompt', 'prompt', '智能', '数字'];

function fetchHotArticles() {
    try {
        const raw = execSync('mcporter call "km.hot-articles(limit:20)"', {
            encoding: 'utf8',
            timeout: 30000,
            env: { ...process.env }
        });
        return raw;
    } catch (e) {
        console.error('KM 调用失败:', e.message);
        return '';
    }
}

// 解析 mcporter 输出，提取文章标题、作者、链接、标签
function parseArticles(raw) {
    const articles = [];
    // 每篇文章以 "- 标题:" 开头
    const blocks = raw.split(/\n(?=- 标题:)/);
    for (const block of blocks) {
        const titleMatch = block.match(/标题:\s*([^,]+)/);
        const authorMatch = block.match(/作者:\s*([^,]+)/);
        const linkMatch = block.match(/链接:\s*(\S+)/);
        const tagMatch = block.match(/标签:\s*([^,]+)/);
        if (titleMatch && linkMatch) {
            const title = titleMatch[1].trim();
            const link = linkMatch[1].trim();
            const tags = tagMatch ? tagMatch[1].trim() : '';
            // 关键词过滤
            const text = title + ' ' + tags;
            if (KEYWORDS.some(k => text.includes(k))) {
                articles.push({
                    title,
                    author: authorMatch ? authorMatch[1].trim() : '',
                    link,
                    tags
                });
            }
        }
    }
    return articles;
}

const raw = fetchHotArticles();
const articles = parseArticles(raw);
const result = {
    fetchedAt: new Date().toISOString(),
    articles: articles.slice(0, 6) // 最多6篇
};

// 健壮性：如果拉取失败或结果为空，保留旧数据，避免壁纸每日推荐变空
if (result.articles.length === 0 && fs.existsSync(OUT)) {
    try {
        const old = JSON.parse(fs.readFileSync(OUT, 'utf8'));
        if (old.articles && old.articles.length) {
            console.log('KM 拉取为空，保留旧数据');
            process.exit(0);
        }
    } catch (e) { /* 旧数据损坏则覆盖 */ }
}

fs.writeFileSync(OUT, JSON.stringify(result, null, 2));
console.log(`已保存 ${result.articles.length} 篇推荐文章到 ${OUT}`);
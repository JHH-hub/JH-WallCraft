const { createCanvas, loadImage } = require('canvas');
const fs = require('fs');

(async () => {
    const img = await loadImage('C:/Users/jihuiwang/wallcraft_wallpaper.png');
    const W = img.width, H = img.height;
    const cv = createCanvas(W, H);
    const c = cv.getContext('2d');
    c.drawImage(img, 0, 0);
    const d = c.getImageData(0, 0, W, H).data;

    // 判定"有内容"的像素：亮度明显高于弥散光背景
    function lum(i) { return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; }
    const TH = 55; // 背景弥散光大约 <50

    // 每 16px 行/列 统计内容密度
    console.log('=== 行密度 (每20px一段, 内容像素数) ===');
    for (let y = 0; y < H; y += 20) {
        let cnt = 0, minX = W, maxX = 0;
        for (let yy = y; yy < Math.min(y + 20, H); yy++) {
            for (let x = 0; x < W; x++) {
                const i = (yy * W + x) * 4;
                if (lum(i) > TH) { cnt++; if (x < minX) minX = x; if (x > maxX) maxX = x; }
            }
        }
        const bar = '#'.repeat(Math.min(60, Math.round(cnt / 60)));
        console.log(`y=${String(y).padStart(4)}: ${String(cnt).padStart(6)} x=[${minX === W ? '-' : minX},${maxX || '-'}] ${bar}`);
    }

    console.log('\n=== 列密度 (每40px一段) ===');
    for (let x = 0; x < W; x += 40) {
        let cnt = 0;
        for (let xx = x; xx < Math.min(x + 40, W); xx++) {
            for (let y = 0; y < H; y++) {
                const i = (y * W + xx) * 4;
                if (lum(i) > TH) cnt++;
            }
        }
        const bar = '#'.repeat(Math.min(60, Math.round(cnt / 60)));
        console.log(`x=${String(x).padStart(4)}: ${String(cnt).padStart(6)} ${bar}`);
    }
})();
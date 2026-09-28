/**
 * 生成"成长观察"的主屏幕图标（PNG）。iPhone 的主屏幕图标不认 SVG，只能给 PNG。
 *
 * 用法：node tools/grow-icons.mjs
 * 输出到 public/grow/icon-{180,192,512}.png。图案画在中间 80% 的圆里，
 * 安卓把图标裁成圆形/水滴形时也不会切掉。
 */
import { chromium } from 'playwright';

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <rect width="512" height="512" fill="#3b7353"/>
  <g stroke="#f6f3ed" stroke-width="28" stroke-linecap="round" stroke-linejoin="round">
    <path d="M256 392V252" fill="none"/>
    <path d="M256 252c0-72 46-112 122-112 0 72-46 112-122 112z" fill="#f6f3ed"/>
    <path d="M256 296c0-56-38-90-102-90 0 56 38 90 102 90z" fill="#f6f3ed"/>
    <path d="M176 392h160" fill="none"/>
  </g>
</svg>`;

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;overflow:hidden">${SVG}</body></html>`);
  await page.screenshot({ path: `public/grow/icon-${size}.png`, omitBackground: false });
  await page.close();
}
await browser.close();
console.log('icons written to public/grow/');

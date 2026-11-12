const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const svg = fs.readFileSync(process.argv[2], 'utf8');
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, size, pad] of [['icon-192', 192, 0], ['icon-512', 512, 0], ['apple-touch-icon', 180, 0], ['icon-maskable-512', 512, 0.12]]) {
    await p.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * (1 - 2 * pad));
    await p.setContent(`<html><body style="margin:0;background:#c6bdfb;display:grid;place-items:center;width:${size}px;height:${size}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `).replace('rx="14"', pad ? 'rx="0"' : name === 'apple-touch-icon' ? 'rx="0"' : 'rx="14"')}</body></html>`);
    await p.screenshot({ path: `${process.argv[3]}/${name}.png`, omitBackground: name !== 'apple-touch-icon' && !pad });
  }
  await b.close();
})();

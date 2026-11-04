const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
function scanMedia(directory = path.join(root, 'commonfiles')) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && /\.(png|jpe?g|webp|gif|avif|mp4|webm|ogv)$/i.test(entry.name) && !/^bg_welcome/i.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }))
    .map(entry => ({ src: 'commonfiles/' + entry.name, type: /\.(mp4|webm|ogv)$/i.test(entry.name) ? 'video' : 'image' }));
}
if (require.main === module) {
  const items = scanMedia();
  fs.writeFileSync(path.join(root, 'data/media_manifest.json'), JSON.stringify(items, null, 2) + '\n');
  console.log(`홍보 미디어 ${items.length}개를 data/media_manifest.json에 기록했습니다.`);
}
module.exports = { scanMedia };

const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const target = path.resolve(process.argv[2] || path.join(root, '../dtaq'));
const indexPath = path.join(target, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');
if (!/<\/head>/i.test(html)) throw Error('dtaq/index.html에 head 요소가 없습니다.');
const bridgePath = path.join(target, 'include/js/led-bridge.js');
if (fs.existsSync(bridgePath) && !fs.readFileSync(bridgePath, 'utf8').includes('DTaQ kiosk -> LED adapter')) {
  throw Error('기존 include/js/led-bridge.js가 있어 덮어쓰지 않았습니다.');
}
fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
fs.copyFileSync(path.join(root, 'integration/dtaq-bridge.js'), bridgePath);
if (!/src=["']include\/js\/led-bridge\.js(?:\?[^"']*)?["']/.test(html)) {
  html = html.replace(/<\/head>/i, '    <script src="include/js/led-bridge.js"></script>\n</head>');
  fs.writeFileSync(indexPath, html);
}
console.log(`DTaQ LED 송신 어댑터 연결 완료: ${target}`);

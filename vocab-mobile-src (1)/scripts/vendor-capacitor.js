/* =====================================================================
 * vendor-capacitor.js —— 同步 Capacitor 运行时与插件脚本到 webDir
 * ---------------------------------------------------------------------
 * 背景：本工程没有打包器（纯 <script> 加载），而 Capacitor 的 third-party
 * 插件是通过 UMD 脚本调用 registerPlugin 把自己挂到 Capacitor.Plugins 上的。
 * 因此必须把下面两个文件复制到 webDir，并在 index.html 中按顺序引入：
 *   1) @capacitor/core 的 capacitor.js  —— 提供 window.Capacitor / registerPlugin
 *   2) 插件自身的 UMD 构建 dist/plugin.js —— 注册 Plugins.TextToSpeech
 * 否则 Android WebView 里 window.Capacitor.Plugins 里没有任何插件，
 * 而 WebView 又不实现 Web Speech API，朗读就会报“不支持语音朗读”。
 *
 * 用法：npm run vendor:capacitor（构建 APK 前由 prebuild:android 自动执行）
 * ===================================================================== */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const target = path.join(root, 'app', 'js', 'capacitor');

// [npm 包名, 包内文件路径, 复制后的文件名]
const FILES = [
  ['@capacitor/core', 'dist/capacitor.js', 'capacitor.js'],
  ['@capacitor-community/text-to-speech', 'dist/plugin.js', 'text-to-speech.js']
];

fs.mkdirSync(target, { recursive: true });

let copied = 0;
for (const [pkg, file, name] of FILES) {
  const src = path.join(root, 'node_modules', ...pkg.split('/'), file);
  if (!fs.existsSync(src)) {
    console.error('× 未找到 ' + pkg + '/' + file + '，请先执行 npm install');
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(target, name));
  copied++;
  console.log('✓ ' + pkg + ' → app/js/capacitor/' + name);
}

console.log('\n已同步 ' + copied + ' 个 Capacitor 脚本。');

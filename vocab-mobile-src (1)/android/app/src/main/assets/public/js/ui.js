/* =====================================================================
 * ui.js —— 通用界面工具
 * ---------------------------------------------------------------------
 * 提供：HTML 转义、元素创建、轻提示 Toast、确认弹窗、简单模态框。
 * 全局暴露 window.UI。
 * ===================================================================== */

(function (global) {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== null && attrs[k] !== undefined) {
          node.setAttribute(k, attrs[k]);
        }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c === null || c === undefined) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // 轻提示
  var toastTimer = null;
  function toast(msg, type) {
    var box = document.getElementById('toast');
    if (!box) {
      box = el('div', { id: 'toast', class: 'toast' });
      document.body.appendChild(box);
    }
    box.textContent = msg;
    box.className = 'toast show' + (type ? ' toast-' + type : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { box.className = 'toast'; }, 2200);
  }

  // 通用确认弹窗，返回 Promise<boolean>
  function confirm(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = el('div', { class: 'modal-overlay' });
      var box = el('div', { class: 'modal' }, [
        el('div', { class: 'modal-title', text: opts.title || '请确认' }),
        opts.message ? el('div', { class: 'modal-msg', html: opts.message }) : null,
        el('div', { class: 'modal-actions' }, [
          el('button', {
            class: 'btn btn-ghost', text: opts.cancelText || '取消',
            onclick: function () { document.body.removeChild(overlay); resolve(false); }
          }),
          el('button', {
            class: 'btn btn-primary', text: opts.okText || '确定',
            onclick: function () { document.body.removeChild(overlay); resolve(true); }
          })
        ])
      ]);
      overlay.appendChild(box);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) { document.body.removeChild(overlay); resolve(false); }
      });
      document.body.appendChild(overlay);
    });
  }

  // 简单输入框弹窗，返回 Promise<string|null>
  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = el('div', { class: 'modal-overlay' });
      var input = el('input', { class: 'input', type: 'text', value: opts.value || '', placeholder: opts.placeholder || '' });
      var box = el('div', { class: 'modal' }, [
        el('div', { class: 'modal-title', text: opts.title || '请输入' }),
        el('div', { class: 'modal-msg' }, [input]),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onclick: function () { document.body.removeChild(overlay); resolve(null); } }),
          el('button', { class: 'btn btn-primary', text: '确定', onclick: function () { document.body.removeChild(overlay); resolve(input.value.trim()); } })
        ])
      ]);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      setTimeout(function () { input.focus(); }, 50);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } });
    });
  }

  // 多字段编辑弹窗：一次性编辑多个字段（如英文单词 + 中文释义）。
  // opts.fields = [{ label, value, placeholder }]，返回 Promise< string[] | null >，
  // 取消时 resolve(null)。
  function editFields(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = el('div', { class: 'modal-overlay' });
      var inputs = [];
      var fields = opts.fields || [];
      var fieldNodes = fields.map(function (f) {
        var inp = el('input', { class: 'input', type: 'text', value: f.value || '', placeholder: f.placeholder || '' });
        inputs.push(inp);
        return el('label', { class: 'field' }, [el('span', { text: f.label || '' }), inp]);
      });
      var box = el('div', { class: 'modal' }, [
        el('div', { class: 'modal-title', text: opts.title || '编辑' }),
        el('div', { class: 'modal-msg' }, fieldNodes),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', text: '取消', onclick: function () { document.body.removeChild(overlay); resolve(null); } }),
          el('button', {
            class: 'btn btn-primary', text: '确定', onclick: function () {
              document.body.removeChild(overlay);
              resolve(inputs.map(function (i) { return i.value.trim(); }));
            }
          })
        ])
      ]);
      overlay.appendChild(box);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) { document.body.removeChild(overlay); resolve(null); } });
      document.body.appendChild(overlay);
      setTimeout(function () { if (inputs[0]) inputs[0].focus(); }, 50);
    });
  }

  /* -------------------- 文本朗读（系统 TTS） --------------------
   * 平台适配（关键）：
   *   - Android / iOS（Capacitor 原生）：必须使用 @capacitor-community/text-to-speech 原生插件。
   *     原因：Android 的 WebView 不实现 Web Speech API（window.speechSynthesis 不存在）。
   *     前提：index.html 需先加载 Capacitor core 运行时（提供 registerPlugin）与本插件 UMD，
   *           否则 Capacitor.Plugins.TextToSpeech 为 undefined，会退到最后一步报不支持。
   *   - Windows / Electron / 现代浏览器：Web Speech API 的 speechSynthesis（同为系统语音引擎）。
   *   - 都不支持：非静默时提示一次。
   * ------------------------------------------------------------ */

  // 原生环境的 TTS 插件实例；仅在真机（非 web/ Electron）返回。
  function nativeTTS() {
    try {
      var cap = global.Capacitor;
      if (!cap || !cap.Plugins) return null;
      if (cap.isNativePlatform && cap.isNativePlatform()) {
        return cap.Plugins.TextToSpeech || null;
      }
    } catch (e) { /* 忽略异常，回退到 Web Speech */ }
    return null;
  }

  // 系统缺少对应语言语音数据时的引导（每会话最多提示一次，避免每题自动朗读刷屏）
  var voicePrompted = false;
  function guideVoiceInstall(tts, reason) {
    if (voicePrompted) return;
    voicePrompted = true;
    confirm({
      title: '缺少语音数据',
      message: '系统尚未安装英文语音引擎，是否前往系统设置安装？<br><small>' + escapeHtml(reason || '') + '</small>',
      okText: '去设置',
      cancelText: '稍后再说'
    }).then(function (go) {
      if (!go) return;
      try { tts.openInstall(); } catch (e) { toast('无法打开语音设置', 'error'); }
    });
  }

  // 使用系统 TTS 朗读文本。lang 为语音语言（英文单词用 'en-US'）。
  // opts.silent=true 时即使失败也不弹提示（用于每道题的自动朗读）。
  function speak(text, lang, opts) {
    opts = opts || {};
    if (!text) return;
    var l = lang || 'en-US';

    // 1) Android / iOS 原生：走系统 TTS 插件
    var tts = nativeTTS();
    if (tts) {
      try {
        tts.speak({ text: text, lang: l, rate: 0.9 }).catch(function (e) {
          if (opts.silent) return;                       // 自动朗读失败不打扰用户
          var msg = (e && e.message) || String(e || '');
          // 原生 speak() 会先校验语言是否受支持，缺语音数据时会报此类错误
          if (/language|supported|voice/i.test(msg)) guideVoiceInstall(tts, msg);
          else toast('朗读失败：' + msg, 'error');
        });
        return;
      } catch (e) { /* 异常则继续尝试 Web Speech */ }
    }

    // 2) 浏览器 / Electron：Web Speech API（同为系统语音引擎）
    try {
      var synth = global.speechSynthesis;
      if (synth && typeof SpeechSynthesisUtterance !== 'undefined') {
        try { synth.cancel(); } catch (e) { /* 忽略 */ }
        var u = new SpeechSynthesisUtterance(text);
        u.lang = l; u.rate = 0.9; u.pitch = 1;
        synth.speak(u);
        return;
      }
    } catch (e) { /* 继续 */ }

    // 3) 环境不支持
    if (!opts.silent) toast('当前环境不支持语音朗读', 'error');
  }

  // 小喇叭按钮：点击朗读指定文本。通常放在单词右侧，朗读其英文发音。
  function speakerBtn(text, lang) {
    var btn = el('button', { class: 'speaker', title: '朗读发音', type: 'button', 'aria-label': '朗读发音' });
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10v4h4l5 5V5L7 10H3zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.06A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      speak(text, lang || 'en-US');
    });
    return btn;
  }

  // 文件下载（浏览器 / Electron 通用）
  function downloadText(filename, text, mime) {
    try {
      if (isNativeCapacitor()) {
        // 移动端（Capacitor 原生）：写入文档目录并提示
        return downloadOnMobile(filename, text);
      }
    } catch (e) { /* 忽略，走通用下载 */ }
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); document.body.removeChild(a); }, 200);
  }

  // 移动端文件写出（Capacitor Filesystem + Share）
  function downloadOnMobile(filename, text) {
    var cap = global.Capacitor;
    var Filesystem = cap.Plugins && cap.Plugins.Filesystem;
    var Share = cap.Plugins && cap.Plugins.Share;
    if (!Filesystem) {
      toast('当前环境不支持直接导出文件，请在桌面端操作', 'error');
      return;
    }
    Filesystem.writeFile({
      path: filename,
      data: text,
      directory: 'DOCUMENT',
      recursive: true
    }).then(function () {
      toast('已导出到：文档/' + filename);
      if (Share) {
        Share.share({ title: filename, text: '词库文件：' + filename })
          .catch(function () { /* 用户取消分享不报错 */ });
      }
    }).catch(function (e) {
      toast('导出失败：' + (e && e.message || e), 'error');
    });
  }

  // 是否为 Capacitor 原生环境（已加载 Filesystem 插件即视为原生）
  function isNativeCapacitor() {
    return !!(global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Filesystem);
  }

  function isMobile() {
    return isNativeCapacitor();
  }

  global.UI = {
    el: el,
    escapeHtml: escapeHtml,
    toast: toast,
    confirm: confirm,
    prompt: prompt,
    editFields: editFields,
    downloadText: downloadText,
    isMobile: isMobile,
    speak: speak,
    speakerBtn: speakerBtn
  };
})(window);

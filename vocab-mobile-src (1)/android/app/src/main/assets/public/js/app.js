/* =====================================================================
 * app.js —— 应用启动与导航
 * ---------------------------------------------------------------------
 * 负责：加载持久化状态、绑定顶部标签切换、按需渲染对应模块。
 * ===================================================================== */

(function (global) {
  'use strict';
  var UI = global.UI, S = global.VocabStore;

  var MODULES = {
    task: global.TaskModule,
    test: global.TestModule,
    library: global.LibraryModule,
    search: global.SearchModule
  };
  var current = 'task';

  function renderCurrent() {
    var view = document.getElementById('view');
    if (MODULES[current] && MODULES[current].render) MODULES[current].render(view);
  }

  function switchTo(tab) {
    if (!MODULES[tab]) return;
    current = tab;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tab);
    }
    renderCurrent();
  }

  function init() {
    S.load();
    S.ensureLibrary();

    // 绑定标签点击
    document.getElementById('tabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.tab');
      if (!btn) return;
      switchTo(btn.getAttribute('data-tab'));
    });

    // 跨模块跳转支持：暴露全局切换函数
    global.switchTab = switchTo;

    // 首次渲染默认标签
    renderCurrent();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);

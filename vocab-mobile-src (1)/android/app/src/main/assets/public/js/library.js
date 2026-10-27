/* =====================================================================
 * library.js —— 词库模块
 * ---------------------------------------------------------------------
 * 功能：
 *   - 查看 / 切换 / 新建 / 重命名 / 删除词库（同时仅一个启用）
 *   - 手动增删改单词条目
 *   - 导出当前词库为文件（多端同步）
 *   - 从文件导入为新词库，或将文件与当前词库合并
 * 所有改动由 VocabStore 自动保存。
 * ===================================================================== */

(function (global) {
  'use strict';
  var UI = global.UI, S = global.VocabStore, el = UI.el;

  function render(view) {
    S.ensureLibrary();
    view.innerHTML = '';
    var libs = S.getLibraries();
    var active = S.getActiveLibrary();

    // 词库切换条
    var chipBox = el('div', { class: 'lib-select' });
    libs.forEach(function (lib) {
      chipBox.appendChild(el('button', {
        class: 'chip' + (lib.id === active.id ? ' active' : ''),
        text: lib.name + ' (' + lib.words.length + ')',
        onclick: function () { S.setActiveLibrary(lib.id); render(view); }
      }));
    });

    var toolbar = el('div', { class: 'row wrap', style: 'margin-bottom:12px;' }, [
      el('button', { class: 'btn', text: '+ 新建词库', onclick: newLibrary }),
      el('button', { class: 'btn', text: '重命名', onclick: renameLib }),
      el('button', { class: 'btn btn-danger', text: '删除词库', onclick: deleteLib }),
      el('button', { class: 'btn', text: '导出文件', onclick: exportLib }),
      el('button', { class: 'btn', text: '导入为新词库', onclick: importNew }),
      el('button', { class: 'btn', text: '合并到当前', onclick: mergeLib })
    ]);

    var head = el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '词库：' + UI.escapeHtml(active.name) }),
      chipBox, toolbar,
      el('div', { class: 'hint', text: '提示：导出文件可用于多端同步；“合并到当前”会把文件中的单词并入当前词库（相同单词更新释义）。' })
    ]);
    view.appendChild(head);

    // 手动添加单词
    var wordInput = el('input', { class: 'input', type: 'text', placeholder: '英文单词', id: 'lib-word' });
    var cnInput = el('input', { class: 'input', type: 'text', placeholder: '中文释义', id: 'lib-cn' });
    var addBtn = el('button', {
      class: 'btn btn-primary', text: '添加',
      onclick: function () {
        var w = wordInput.value.trim(), c = cnInput.value.trim();
        if (!w) { UI.toast('请输入英文单词'); return; }
        var rec = S.addWord(active.id, w, c);
        UI.toast(rec ? '已添加' : '添加失败', rec ? '' : 'error');
        wordInput.value = ''; cnInput.value = '';
        render(view);
      }
    });
    var addCard = el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '手动添加单词' }),
      el('div', { class: 'row' }, [wordInput, cnInput, addBtn])
    ]);
    view.appendChild(addCard);

    // 单词列表
    var listCard = el('div', { class: 'card' }, [el('div', { class: 'section-title', text: '单词列表（' + active.words.length + '）' })]);
    if (active.words.length === 0) {
      listCard.appendChild(el('div', { class: 'empty', text: '该词库暂无单词，可在“每日任务”中录入，或手动添加。' }));
    } else {
      // 倒序展示，最新录入在最上
      active.words.slice().reverse().forEach(function (w) {
        var del = el('button', { class: 'btn btn-ghost btn-danger', text: '删除', onclick: function () {
          S.deleteWord(active.id, w.id); render(view);
        }});
        var edit = el('button', { class: 'btn btn-ghost', text: '改', onclick: function () { editWord(active, w); } });
        listCard.appendChild(el('div', { class: 'word-item' }, [
          el('span', { class: 'word-en', text: w.word }),
          el('span', { class: 'word-cn', text: w.translation || '' }),
          w.errorCount ? el('span', { class: 'tag', text: '错' + w.errorCount }) : null,
          el('div', { class: 'row' }, [edit, del])
        ]));
      });
    }
    view.appendChild(listCard);
  }

  function editWord(lib, w) {
    // 单一弹窗同时编辑英文单词与中文释义，避免两步弹窗链路的脆弱性
    UI.editFields({
      title: '修改单词',
      fields: [
        { label: '英文单词', value: w.word },
        { label: '中文释义', value: w.translation || '' }
      ]
    }).then(function (vals) {
      if (!vals) return;
      S.updateWord(lib.id, w.id, { word: vals[0], translation: vals[1] });
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  function newLibrary() {
    UI.prompt({ title: '新建词库', placeholder: '词库名称' }).then(function (name) {
      if (name === null) return;
      var lib = S.createLibrary(name || undefined);
      UI.toast('已新建：' + lib.name);
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  function renameLib() {
    var active = S.getActiveLibrary();
    UI.prompt({ title: '重命名词库', value: active.name }).then(function (name) {
      if (!name) return;
      S.renameLibrary(active.id, name);
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  function deleteLib() {
    var active = S.getActiveLibrary();
    UI.confirm({ title: '删除词库', message: '确定删除“' + UI.escapeHtml(active.name) + '”吗？此操作不可撤销。' }).then(function (ok) {
      if (!ok) return;
      var r = S.deleteLibrary(active.id);
      UI.toast(r.ok ? '已删除' : (r.msg || '已删除'), r.ok ? '' : 'error');
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  function exportLib() {
    var active = S.getActiveLibrary();
    var text = S.exportActiveLibrary();
    if (!text) { UI.toast('无可导出的词库', 'error'); return; }
    var fname = (active.name || 'vocab') + '.json';
    UI.downloadText(fname, text, 'application/json');
    UI.toast('已导出 ' + fname);
  }

  function pickFile(cb) {
    var inp = el('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
    document.body.appendChild(inp);
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      if (!f) { document.body.removeChild(inp); return; }
      var reader = new FileReader();
      reader.onload = function () { cb(reader.result); document.body.removeChild(inp); };
      reader.onerror = function () { UI.toast('读取文件失败', 'error'); document.body.removeChild(inp); };
      reader.readAsText(f);
    });
    inp.click();
  }

  function importNew() {
    pickFile(function (text) {
      var r = S.importAsNewLibrary(text);
      if (r.ok) { UI.toast('已导入新词库，共 ' + r.count + ' 词'); }
      else { UI.toast(r.msg || '导入失败', 'error'); }
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  function mergeLib() {
    var active = S.getActiveLibrary();
    pickFile(function (text) {
      var r = S.mergeIntoActiveLibrary(text);
      if (r.ok) { UI.toast('合并完成：新增 ' + r.added + '，更新 ' + r.updated); }
      else { UI.toast(r.msg || '合并失败', 'error'); }
      global.LibraryModule.render(document.getElementById('view'));
    });
  }

  global.LibraryModule = { render: render };
})(window);

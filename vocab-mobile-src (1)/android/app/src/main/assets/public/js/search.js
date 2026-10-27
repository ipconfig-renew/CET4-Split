/* =====================================================================
 * search.js —— 检索模块
 * ---------------------------------------------------------------------
 * 在当前【启用词库】中检索：
 *   - 输入英文：查找单词（含子串），显示其中文释义
 *   - 输入中文：模糊匹配释义，显示对应英文单词
 * 两者统一为“包含匹配”，满足中英互查需求。
 * ===================================================================== */

(function (global) {
  'use strict';
  var UI = global.UI, S = global.VocabStore, el = UI.el;

  function render(view) {
    S.ensureLibrary();
    view.innerHTML = '';
    var active = S.getActiveLibrary();

    var input = el('input', {
      class: 'input', type: 'text', placeholder: '输入英文或中文进行检索…', id: 'search-input', autocomplete: 'off'
    });
    var resultBox = el('div', { class: 'card' }, [el('div', { class: 'hint', text: '在词库“' + UI.escapeHtml(active.name) + '”中检索（共 ' + active.words.length + ' 词）。输入英文查中文，输入中文模糊查英文。' })]);

    function doSearch() {
      var q = input.value.trim().toLowerCase();
      resultBox.innerHTML = '';
      if (!q) {
        resultBox.appendChild(el('div', { class: 'hint', text: '在词库“' + UI.escapeHtml(active.name) + '”中检索（共 ' + active.words.length + ' 词）。' }));
        return;
      }
      var hits = active.words.filter(function (w) {
        return w.word.toLowerCase().indexOf(q) >= 0 || (w.translation || '').toLowerCase().indexOf(q) >= 0;
      });
      if (hits.length === 0) {
        resultBox.appendChild(el('div', { class: 'empty', text: '未找到匹配“' + UI.escapeHtml(input.value) + '”的单词。' }));
        return;
      }
      resultBox.appendChild(el('div', { class: 'hint', text: '找到 ' + hits.length + ' 条结果：' }));
      hits.slice(0, 200).forEach(function (w) {
        resultBox.appendChild(el('div', { class: 'word-item' }, [
          el('span', { class: 'word-en', text: w.word }),
          el('span', { class: 'word-cn', text: w.translation || '' }),
          el('div', { class: 'row', style: 'gap:6px; flex:0 0 auto;' }, [
            UI.speakerBtn(w.word, 'en-US'),
            w.errorCount ? el('span', { class: 'tag', text: '错' + w.errorCount }) : null
          ])
        ]));
      });
    }

    input.addEventListener('input', doSearch);

    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '检索' }),
      input
    ]));
    view.appendChild(resultBox);
  }

  global.SearchModule = { render: render };
})(window);

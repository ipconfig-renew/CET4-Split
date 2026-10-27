/* =====================================================================
 * task.js —— 每日任务模块（状态机）
 * ---------------------------------------------------------------------
 * 流程：开始 → 录入 →（自动进入「测试」模块）→ 完成
 *   - 录入：用户填写单词+中文，实时拼写校验（红色波浪下划线），点“下一个”时若疑似错误给出提示
 *   - 录入完成后自动转入「测试」模块（检测 + 可选拼写 + 复习），
 *     由 test.js 负责，测试对象为【今日录入的全部单词】。
 *   - 完成：显示当日正确率 + 古诗词鼓励语（含出处）
 * 进度条随阶段推进；所有进度与单词均自动持久化。
 * ===================================================================== */

(function (global) {
  'use strict';
  var UI = global.UI, S = global.VocabStore, Spell = global.Spell, el = UI.el;

  // 古诗词鼓励语（含出处）
  var POEMS = [
    { line: '长风破浪会有时，直挂云帆济沧海。', src: '——李白《行路难·其一》' },
    { line: '千淘万漉虽辛苦，吹尽狂沙始到金。', src: '——刘禹锡《浪淘沙·其八》' },
    { line: '宝剑锋从磨砺出，梅花香自苦寒来。', src: '——《警世贤文·勤奋篇》' },
    { line: '博观而约取，厚积而薄发。', src: '——苏轼《稼说送张琥》' },
    { line: '三更灯火五更鸡，正是男儿读书时。', src: '——颜真卿《劝学》' },
    { line: '路漫漫其修远兮，吾将上下而求索。', src: '——屈原《离骚》' },
    { line: '黑发不知勤学早，白首方悔读书迟。', src: '——颜真卿《劝学》' },
    { line: '操千曲而后晓声，观千剑而后识器。', src: '——刘勰《文心雕龙·知音》' }
  ];

  function renderProgress(view, task) {
    var total = task.newGoal || 1;
    var pct = Math.max(0, Math.min(100, Math.round(100 * task.recordedIds.length / total)));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'progress' }, [el('i', { style: 'width:' + pct + '%' })]),
      el('div', { class: 'progress-text', text: '录入进度：' + pct + '%  （' + task.recordedIds.length + '/' + task.newGoal + '）' })
    ]));
  }

  function render(view) {
    S.ensureLibrary();
    var task = S.getTask();
    view.innerHTML = '';
    if (task.phase === 'done') return renderDone(view, task);
    if (task.phase === 'testing') return renderTesting(view, task);
    renderProgress(view, task);
    if (task.phase === 'idle') return renderIdle(view, task);
    if (task.phase === 'recording') return renderRecording(view, task);
  }

  /* ----------------- 设置 + 开始 ----------------- */
  function renderIdle(view, task) {
    var st = S.getSettings();
    var newGoal = el('input', { class: 'input', type: 'number', min: '1', value: st.newGoal, id: 'set-new' });
    var revGoal = el('input', { class: 'input', type: 'number', min: '0', value: st.reviewGoal, id: 'set-rev' });
    var spellChk = el('input', { type: 'checkbox', id: 'set-spell' });
    if (st.enableSpelling) spellChk.checked = true;

    var card = el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '每日任务设置' }),
      el('label', { class: 'field' }, [el('span', { text: '每日新学词数' }), newGoal]),
      el('label', { class: 'field' }, [el('span', { text: '每日复习词数' }), revGoal]),
      el('label', { class: 'field' }, [
        el('span', { text: '启用拼写阶段' }),
        el('label', { class: 'toggle' }, [spellChk, el('span', { text: '（可在检测后练习拼写，可跳过）' })]
      )]),
      el('button', {
        class: 'btn btn-primary btn-block', text: '保存设置', onclick: function () {
          var n = parseInt(newGoal.value, 10); var r = parseInt(revGoal.value, 10);
          if (!n || n < 1) n = 1; if (isNaN(r) || r < 0) r = 0;
          S.setSettings({ newGoal: n, reviewGoal: r, enableSpelling: spellChk.checked });
          UI.toast('设置已保存');
          render(view);
        }
      })
    ]);
    view.appendChild(card);

    var active = S.getActiveLibrary();
    view.appendChild(el('div', { class: 'card center' }, [
      el('div', { class: 'hint', text: '当前启用词库：' + UI.escapeHtml(active.name) + '（共 ' + active.words.length + ' 词）' }),
      el('button', {
        class: 'btn btn-primary btn-block', text: '开始任务', style: 'margin-top:10px;',
        onclick: function () { S.startTask(); render(view); }
      }),
      el('div', { class: 'hint', style: 'margin-top:8px;', text: '默认：新学 ' + st.newGoal + ' 词 + 复习 ' + st.reviewGoal + ' 词' }),
      el('div', { class: 'hint', style: 'margin-top:6px;', text: '录入完成后将自动进入「测试」模块进行检浏与复习。' })
    ]));
  }

  /* ----------------- 录入阶段 ----------------- */
  function renderRecording(view, task) {
    var lib = S.getActiveLibrary();
    var wordInput = el('input', { class: 'input', type: 'text', placeholder: '输入英文单词', id: 'rec-word', autocomplete: 'off' });
    var cnInput = el('input', { class: 'input', type: 'text', placeholder: '输入中文释义', id: 'rec-cn', autocomplete: 'off' });

    // 实时拼写校验：不在词典中则加红色波浪下划线
    wordInput.addEventListener('input', function () {
      var v = wordInput.value.trim();
      if (v && !Spell.isValid(v)) wordInput.classList.add('typo');
      else wordInput.classList.remove('typo');
    });

    function beginDailyTest() {
      S.finishRecording();
      global.TestModule.startSession({ source: 'task' });
    }

    function submit() {
      var w = wordInput.value.trim();
      var c = cnInput.value.trim();
      if (!w) { UI.toast('请输入英文单词'); return; }
      if (!c) { UI.toast('请输入中文释义'); return; }
      // 疑似拼写错误则二次确认
      if (!Spell.isValid(w)) {
        UI.confirm({
          title: '拼写提示',
          message: '“' + UI.escapeHtml(w) + '” 疑似拼写错误（不在常用词典中）。仍要提交吗？',
          okText: '仍要提交', cancelText: '返回修改'
        }).then(function (ok) {
          if (!ok) { wordInput.focus(); return; }
          doRecord(w, c);
        });
      } else {
        doRecord(w, c);
      }
    }

    function doRecord(w, c) {
      S.recordNewWord(w, c);
      wordInput.value = ''; cnInput.value = '';
      wordInput.classList.remove('typo');
      if (task.recordedIds.length >= task.newGoal) {
        UI.toast('新词录入完成，进入测试');
        beginDailyTest();
      } else {
        UI.toast('已录入 ' + task.recordedIds.length + '/' + task.newGoal);
        render(view);
      }
    }

    var card = el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '录入阶段（' + task.recordedIds.length + ' / ' + task.newGoal + '）' }),
      el('label', { class: 'field' }, [el('span', { text: '英文单词（疑似错误会标红）' }), wordInput]),
      el('label', { class: 'field' }, [el('span', { text: '中文释义' }), cnInput]),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-primary', text: '下一个', onclick: submit }),
        task.recordedIds.length > 0 ? el('button', {
          class: 'btn', text: '结束录入并测试', onclick: function () {
            UI.confirm({ title: '结束录入', message: '仅录入了 ' + task.recordedIds.length + ' 个新词，确定结束并进入测试？' })
              .then(function (ok) { if (ok) beginDailyTest(); });
          }
        }) : null
      ])
    ]);
    view.appendChild(card);
  }

  /* ----------------- 录入后中转（测试进行中） ----------------- */
  function renderTesting(view, task) {
    view.appendChild(el('div', { class: 'card center' }, [
      el('div', { class: 'big-word', text: '录入完成' }),
      el('div', { class: 'hint', text: '检测、拼写与复习已在「测试」模块进行。' }),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:10px;', text: '前往测试模块',
        onclick: function () { global.switchTab('test'); }
      })
    ]));
  }

  /* ----------------- 完成 ----------------- */
  function renderDone(view, task) {
    var t = S.getTest();
    var newCount = task.recordedIds.length;
    var detCorrect = 0, detTotal = 0, spellCorrect = 0, spellTotal = 0, revCorrect = 0, revCount = 0;
    if (t) {
      Object.keys(t.detectionResults).forEach(function (k) { detTotal++; if (t.detectionResults[k].correct) detCorrect++; });
      if (S.getSettings().enableSpelling) {
        Object.keys(t.spellingResults).forEach(function (k) { spellTotal++; if (t.spellingResults[k]) spellCorrect++; });
      }
      Object.keys(t.reviewResults).forEach(function (k) { revCount++; if (t.reviewResults[k]) revCorrect++; });
    }
    var detRate = detTotal ? Math.round(100 * detCorrect / detTotal) : 0;
    var spellRate = spellTotal ? Math.round(100 * spellCorrect / spellTotal) : 0;
    var revRate = revCount ? Math.round(100 * revCorrect / revCount) : 0;
    var poem = POEMS[newCount % POEMS.length];

    var children = [
      el('div', { class: 'big-word', text: '今日任务完成 🎉' }),
      el('div', { class: 'kv' }, [el('span', { text: '新学单词' }), el('span', { text: String(newCount) + ' 个' })]),
      el('div', { class: 'kv' }, [el('span', { text: '检测正确率' }), el('span', { text: detRate + '%（' + detCorrect + '/' + detTotal + '）' })]),
    ];
    if (S.getSettings().enableSpelling) {
      children.push(el('div', { class: 'kv' }, [el('span', { text: '拼写正确率' }), el('span', { text: spellRate + '%（' + spellCorrect + '/' + spellTotal + '）' })]));
    }
    children.push(el('div', { class: 'kv' }, [el('span', { text: '复习正确率' }), el('span', { text: revRate + '%（' + revCorrect + '/' + revCount + '）' })]));
    children.push(el('div', { class: 'poem' }, [
      el('div', { class: 'line', text: poem.line }),
      el('div', { class: 'src', text: poem.src })
    ]));
    children.push(el('div', { class: 'row', style: 'margin-top:14px;' }, [
      el('button', { class: 'btn btn-primary', text: '返回首页', onclick: function () { switchTab('task'); } }),
      el('button', { class: 'btn', text: '重置今日任务（测试用）', onclick: function () {
        UI.confirm({ title: '重置', message: '将清空今日任务与测试进度（单词仍保留在词库）。' }).then(function (ok) {
          if (ok) { S.resetTodayTask(); render(view); }
        });
      }})
    ]));
    view.appendChild(el('div', { class: 'card center' }, children));
  }

  function switchTab(name) {
    var btn = document.querySelector('.tab[data-tab="' + name + '"]');
    if (btn) btn.click();
  }

  global.TaskModule = { render: render };
})(window);

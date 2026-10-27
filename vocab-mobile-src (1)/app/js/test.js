/* =====================================================================
 * test.js —— 测试模块（检测 + 可选拼写 + 复习）
 * ---------------------------------------------------------------------
 * 定位：相当于「每日任务」录入阶段之后的「检测 +（可选）拼写 + 复习」。
 *   - 检测：显示今日录入的单词，四选一中文释义，点击即判正误，错误计入词库
 *   - 拼写（可选/可跳过）：显示中文释义，用户拼写英文，点击“确定”判正误
 *   - 复习：从词库抽取旧词（艾宾浩斯到期优先 + 掌握度加权），四选一检测
 *
 * 四选一干扰项策略：每个单词的备选释义取自【与它同一天录入】的其它单词的释义
 *   （跨全部词库收集；今日词→今天的其它词，旧复习词→它当初录入那天的词），不足 3 个
 *   时回退到全库释义，确保四选一成立。
 *
 * 测试对象（检测/拼写 阶段）：
 *   所有“今日录入”的单词（addedAt 落在今天）——覆盖：
 *     ① 每日任务录入的单词
 *     ② 在词库中手动录入的单词
 *     ③ 导入/合并词库中时间戳为今日的单词
 *   （跨所有词库收集，避免漏测）
 *
 * 运行方式（两种）：
 *   - 作为每日任务的一部分：录入完成后自动进入（source='task'），
 *     完成时一并标记每日任务为完成。
 *   - 独立运行：在「测试」标签点击“开始测试”即可（source='standalone'），
 *     即使今日没有新录入单词，也可仅复习旧词。
 *
 * 进度条随阶段推进；所有进度与作答均自动持久化（state.test）。
 * ===================================================================== */

(function (global) {
  'use strict';
  var UI = global.UI, S = global.VocabStore, el = UI.el;

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

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // 跨库按 id 获取单词记录
  function testWord(id) {
    var f = S.findWordAnywhere(id);
    return f ? f.word : null;
  }

  // 单词标题区：大号单词 + 小喇叭朗读按钮（朗读英文发音）
  function wordHead(word) {
    return el('div', { class: 'word-head' }, [
      el('div', { class: 'big-word', text: word.word }),
      UI.speakerBtn(word.word, 'en-US')
    ]);
  }

  // 自动朗读一次（静默：不支持也不弹提示），用于进入每道题时
  function autoSpeak(word) {
    if (word && word.word) UI.speak(word.word, 'en-US', { silent: true });
  }

  // 收集全部词库的中文释义，作为干扰项兜底来源
  function allTranslations() {
    var seen = {}, set = [];
    S.getLibraries().forEach(function (lib) {
      lib.words.forEach(function (w) {
        if (w.translation && !seen[w.translation]) { seen[w.translation] = true; set.push(w.translation); }
      });
    });
    return set;
  }

  // 取某时间戳所在“天”的零点时间戳（用于判断是否为“同一天录入”）
  function dayStart(ts) {
    var d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // 构建四选一选项：正确项 + 干扰项（优先来自同一天录入词的释义，不足则从全库补充）
  function buildOptions(correctText, poolTexts) {
    var opts = [{ text: correctText, correct: true }];
    var seen = {}; seen[correctText] = true;
    var distract = [];
    poolTexts.forEach(function (t) {
      if (t && !seen[t]) { seen[t] = true; distract.push(t); }
    });
    shuffle(distract);
    for (var i = 0; i < 3 && i < distract.length; i++) opts.push({ text: distract[i], correct: false });
    return shuffle(opts);
  }

  // 干扰项文本池：取与【当前单词同一天录入】的其它单词的释义（跨全部词库收集）。
  // 例如今日录入的词，干扰项来自今天录入的其它词；复习阶段某旧词，干扰项来自
  // 它当初被录入那天录入的其它词。不足 3 个时回退到全库释义，确保四选一成立。
  function distractorPool(wordId) {
    var rec = testWord(wordId);
    if (!rec || !rec.addedAt) return allTranslations();
    var start = dayStart(rec.addedAt);
    var end = start + 24 * 60 * 60 * 1000 - 1;
    var texts = [], seen = {};
    S.getLibraries().forEach(function (lib) {
      lib.words.forEach(function (w) {
        if (w.id === wordId) return;            // 排除自身
        if (!w.translation) return;
        if (w.addedAt >= start && w.addedAt <= end) {   // 同一天录入
          if (!seen[w.translation]) { seen[w.translation] = true; texts.push(w.translation); }
        }
      });
    });
    if (texts.length < 3) {
      allTranslations().forEach(function (x) { if (texts.indexOf(x) === -1) texts.push(x); });
    }
    return texts;
  }

  /* ----------------- 进度条 ----------------- */
  function spellActive(t) {
    return (S.getSettings().enableSpelling && !t.spellingSkipped && t.poolIds.length > 0);
  }
  function totalSteps(t) {
    var r = t.poolIds.length;
    return r + (spellActive(t) ? r : 0) + (t.reviewQueue ? t.reviewQueue.length : 0) + (t.wrongQueue ? t.wrongQueue.length : 0);
  }
  function completedSteps(t) {
    var r = t.poolIds.length;
    var spellPart = spellActive(t) ? r : 0;
    switch (t.phase) {
      case 'idle': case 'detectConfirm': return 0;
      case 'detection': return t.detectionIndex;
      case 'spelling': return r + t.spellingIndex;
      case 'review': return r + spellPart + t.reviewIndex;
      case 'retry': return r + spellPart + (t.reviewQueue ? t.reviewQueue.length : 0) + t.wrongIndex;
      case 'done': return totalSteps(t);
    }
    return 0;
  }
  function renderProgress(view, t) {
    var total = totalSteps(t) || 1;
    var pct = Math.max(0, Math.min(100, Math.round(100 * completedSteps(t) / total)));
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'progress' }, [el('i', { style: 'width:' + pct + '%' })]),
      el('div', { class: 'progress-text', text: '测试进度：' + pct + '%  （' + completedSteps(t) + '/' + total + '）' })
    ]));
  }

  // 由「每日任务」录入完成后调用：开启测试并跳转到本模块
  function startSession(opts) {
    opts = opts || {};
    S.startTest(opts.source || 'standalone');
    global.switchTab('test');
  }

  function render(view) {
    S.ensureLibrary();
    var t = S.getTest();
    view.innerHTML = '';
    renderProgress(view, t);
    switch (t.phase) {
      case 'detectConfirm': return renderDetectConfirm(view, t);
      case 'detection': return renderDetection(view, t);
      case 'spelling': return renderSpelling(view, t);
      case 'review': return renderReview(view, t);
      case 'retry': return renderRetry(view, t);
      case 'done': return renderDone(view, t);
      default: return renderIdle(view, t);
    }
  }

  /* ----------------- 独立运行：开始 ----------------- */
  function renderIdle(view, t) {
    var today = S.getTodayWords();
    var st = S.getSettings();
    var lib = S.getActiveLibrary();
    var reviewN = lib ? S.selectReviewWords(lib, {}, st.reviewGoal).length : 0;
    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'section-title', text: '测试模块' }),
      el('div', { class: 'hint', text: '本模块相当于每日任务的「检测 +（可选）拼写 + 复习」。测试对象为【今日录入的所有单词】：每日任务录入、词库手动录入，以及导入/合并中标记为今日的单词。' }),
      el('div', { class: 'kv' }, [el('span', { text: '今日新词' }), el('span', { text: String(today.length) + ' 个' })]),
      el('div', { class: 'kv' }, [el('span', { text: '复习候选（旧词）' }), el('span', { text: '约 ' + reviewN + ' 个' })]),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:10px;', text: '开始测试',
        onclick: function () { S.startTest('standalone'); render(view); }
      })
    ]));
    view.appendChild(el('div', { class: 'card center' }, [
      el('div', { class: 'hint', text: '提示：在「每日任务」中录入完当日单词后，会自动进入本模块。' }),
      el('button', { class: 'btn', text: '前往每日任务', onclick: function () { global.switchTab('task'); } })
    ]));
  }

  /* ----------------- 检测确认（任务来源） ----------------- */
  function renderDetectConfirm(view, t) {
    view.appendChild(el('div', { class: 'card center' }, [
      el('div', { class: 'big-word', text: '录入完成' }),
      el('div', { class: 'hint', text: '今日共 ' + t.poolIds.length + ' 个新词已存入“' + UI.escapeHtml(S.getActiveLibrary().name) + '”。' }),
      el('div', { class: 'hint', text: '接下来进入「测试」：先检测释义，再练习拼写，最后复习旧词。' }),
      el('button', {
        class: 'btn btn-primary btn-block', style: 'margin-top:10px;', text: '开始检测',
        onclick: function () { S.startTestDetection(); render(view); }
      })
    ]));
  }

  /* ----------------- 检测阶段 ----------------- */
  function renderDetection(view, t) {
    var idx = t.detectionIndex;
    var id = t.poolIds[idx];
    var word = testWord(id);
    if (!word) { // 单词被删除等异常，自动跳过
      t.detectionIndex++;
      if (t.detectionIndex >= t.poolIds.length) S.finishTestDetection();
      return render(view);
    }
    autoSpeak(word);
    var options = buildOptions(word.translation, distractorPool(id));
    var answered = false;
    var fb = el('div', { class: 'feedback' });
    var optBox = el('div', { class: 'options' });
    var nextBtn = el('button', {
      class: 'btn btn-primary btn-block', text: '下一个', style: 'margin-top:12px; display:none;',
      onclick: function () {
        t.detectionIndex++;
        if (t.detectionIndex >= t.poolIds.length) S.finishTestDetection();
        render(view);
      }
    });

    options.forEach(function (opt) {
      var b = el('button', { class: 'option', text: opt.text });
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        var correct = opt.correct;
        S.answerTestDetection(id, correct);
        if (!correct) S.recordTestWrong(id);
        Array.prototype.forEach.call(optBox.children, function (c) {
          if (c.textContent === opt.text) c.classList.add(correct ? 'correct' : 'wrong');
          c.disabled = true;
        });
        if (correct) { fb.textContent = '✓ 回答正确'; fb.className = 'feedback ok'; }
        else {
          fb.innerHTML = '✗ 回答错误，正确答案：' + UI.escapeHtml(word.translation);
          fb.className = 'feedback no';
          Array.prototype.forEach.call(optBox.children, function (c) {
            if (c.textContent === word.translation) c.classList.add('correct');
          });
        }
        nextBtn.style.display = 'block';
      });
      optBox.appendChild(b);
    });

    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'hint', text: '检测阶段（' + (idx + 1) + ' / ' + t.poolIds.length + '）' }),
      wordHead(word),
      el('div', { class: 'hint', text: '请选择正确的中文释义：' }),
      optBox, fb, nextBtn
    ]));
  }

  /* ----------------- 拼写阶段 ----------------- */
  function renderSpelling(view, t) {
    var idx = t.spellingIndex;
    var id = t.poolIds[idx];
    var word = testWord(id);
    if (!word) {
      t.spellingIndex++;
      if (t.spellingIndex >= t.poolIds.length) S.finishTestSpelling();
      return render(view);
    }
    autoSpeak(word);
    var input = el('input', { class: 'input', type: 'text', placeholder: '输入英文拼写', autocomplete: 'off' });
    var fb = el('div', { class: 'feedback' });
    var answered = false;

    function check() {
      if (answered) return;
      var v = input.value.trim().toLowerCase();
      if (!v) { UI.toast('请输入拼写'); return; }
      answered = true;
      var ok = (v === word.word.trim().toLowerCase());
      S.answerTestSpelling(id, ok);
      if (!ok) S.recordTestWrong(id);
      if (ok) { fb.textContent = '✓ 拼写正确'; fb.className = 'feedback ok'; }
      else { fb.innerHTML = '✗ 拼写错误，正确写法：' + UI.escapeHtml(word.word); fb.className = 'feedback no'; }
      nextBtn.style.display = 'block';
    }

    var nextBtn = el('button', {
      class: 'btn btn-primary btn-block', text: '下一个', style: 'margin-top:12px; display:none;',
      onclick: function () {
        t.spellingIndex++;
        if (t.spellingIndex >= t.poolIds.length) S.finishTestSpelling();
        render(view);
      }
    });

    view.appendChild(el('div', { class: 'card' }, [
      el('div', { class: 'hint', text: '拼写阶段（' + (idx + 1) + ' / ' + t.poolIds.length + '）— 可选，可跳过' }),
      el('div', { class: 'big-word', text: word.translation }),
      el('div', { class: 'spell-read' }, [
        el('span', { class: 'muted', text: '英文发音：' }),
        UI.speakerBtn(word.word, 'en-US')
      ]),
      el('div', { class: 'hint', text: '根据以上释义拼写对应英文单词：' }),
      input,
      el('div', { class: 'row', style: 'margin-top:10px;' }, [
        el('button', { class: 'btn', text: '确定', onclick: check }),
        el('button', { class: 'btn btn-ghost', text: '跳过本阶段', onclick: function () { S.skipTestSpelling(); render(view); } })
      ]),
      fb, nextBtn
    ]));
    setTimeout(function () { input.focus(); }, 50);
  }

  /* ----------------- 复习阶段 ----------------- */
  function renderReview(view, t) {
    if (!t.reviewQueue || t.reviewQueue.length === 0) {
      S.finishTestReview();
      return render(view);
    }
    var idx = t.reviewIndex;
    var id = t.reviewQueue[idx];
    var word = testWord(id);
    if (!word) {
      t.reviewIndex++;
      if (t.reviewIndex >= t.reviewQueue.length) S.finishTestReview();
      return render(view);
    }
    autoSpeak(word);
    var options = buildOptions(word.translation, distractorPool(id));
    var answered = false;
    var fb = el('div', { class: 'feedback' });
    var optBox = el('div', { class: 'options' });
    var nextBtn = el('button', {
      class: 'btn btn-primary btn-block', text: '下一个', style: 'margin-top:12px; display:none;',
      onclick: function () {
        t.reviewIndex++;
        if (t.reviewIndex >= t.reviewQueue.length) S.finishTestReview();
        render(view);
      }
    });

    options.forEach(function (opt) {
      var b = el('button', { class: 'option', text: opt.text });
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        var correct = opt.correct;
        S.answerTestReview(id, correct);
        if (!correct) S.recordTestWrong(id);
        Array.prototype.forEach.call(optBox.children, function (c) {
          if (c.textContent === opt.text) c.classList.add(correct ? 'correct' : 'wrong');
          c.disabled = true;
        });
        if (correct) { fb.textContent = '✓ 回答正确'; fb.className = 'feedback ok'; }
        else {
          fb.innerHTML = '✗ 回答错误，正确答案：' + UI.escapeHtml(word.translation);
          fb.className = 'feedback no';
          Array.prototype.forEach.call(optBox.children, function (c) {
            if (c.textContent === word.translation) c.classList.add('correct');
          });
        }
        nextBtn.style.display = 'block';
      });
      optBox.appendChild(b);
    });

    var now = Date.now();
    var due = word.nextReviewAt && now >= word.nextReviewAt;
    view.appendChild(el('div', { class: 'card' }, [
      el('div', {
        class: 'hint',
        text: '复习阶段（' + (idx + 1) + ' / ' + t.reviewQueue.length + '）'
          + (due ? ' · 该词已到复习周期' : '')
          + (word.errorCount ? ' · 历史错误 ' + word.errorCount + ' 次' : '')
          + (word.correctStreak ? ' · 连续答对 ' + word.correctStreak + ' 次' : '')
          + (word.wrongStreak ? ' · 连续答错 ' + word.wrongStreak + ' 次' : '')
      }),
      wordHead(word),
      el('div', { class: 'hint', text: '请选择正确的中文释义：' }),
      optBox, fb, nextBtn
    ]));
  }

  /* ----------------- 易错重测阶段（本次测试答错的词，追加到末尾再测一次） ----------------- */
  function renderRetry(view, t) {
    if (!t.wrongQueue || t.wrongIndex >= t.wrongQueue.length) {
      S.finishTestRetry();
      return render(view);
    }
    var idx = t.wrongIndex;
    var id = t.wrongQueue[idx];
    var word = testWord(id);
    if (!word) {
      t.wrongIndex++;
      if (t.wrongIndex >= t.wrongQueue.length) S.finishTestRetry();
      return render(view);
    }
    autoSpeak(word);
    var options = buildOptions(word.translation, distractorPool(id));
    var answered = false;
    var fb = el('div', { class: 'feedback' });
    var optBox = el('div', { class: 'options' });
    var nextBtn = el('button', {
      class: 'btn btn-primary btn-block', text: '下一个', style: 'margin-top:12px; display:none;',
      onclick: function () {
        t.wrongIndex++;
        if (t.wrongIndex >= t.wrongQueue.length) S.finishTestRetry();
        render(view);
      }
    });

    options.forEach(function (opt) {
      var b = el('button', { class: 'option', text: opt.text });
      b.addEventListener('click', function () {
        if (answered) return;
        answered = true;
        var correct = opt.correct;
        S.answerTestRetry(id, correct);
        Array.prototype.forEach.call(optBox.children, function (c) {
          if (c.textContent === opt.text) c.classList.add(correct ? 'correct' : 'wrong');
          c.disabled = true;
        });
        if (correct) { fb.textContent = '✓ 回答正确'; fb.className = 'feedback ok'; }
        else {
          fb.innerHTML = '✗ 仍答错，正确答案：' + UI.escapeHtml(word.translation);
          fb.className = 'feedback no';
          Array.prototype.forEach.call(optBox.children, function (c) {
            if (c.textContent === word.translation) c.classList.add('correct');
          });
        }
        nextBtn.style.display = 'block';
      });
      optBox.appendChild(b);
    });

    view.appendChild(el('div', { class: 'card' }, [
      el('div', {
        class: 'hint',
        text: '易错重测（' + (idx + 1) + ' / ' + t.wrongQueue.length + '）— 刚才答错的词，再巩固一次'
      }),
      wordHead(word),
      el('div', { class: 'hint', text: '请选择正确的中文释义：' }),
      optBox, fb, nextBtn
    ]));
  }

  /* ----------------- 完成 ----------------- */
  function renderDone(view, t) {
    var detCorrect = 0, detTotal = 0, spellCorrect = 0, spellTotal = 0, revCorrect = 0, revCount = 0, retryCorrect = 0, retryTotal = 0;
    Object.keys(t.detectionResults).forEach(function (k) { detTotal++; if (t.detectionResults[k].correct) detCorrect++; });
    if (S.getSettings().enableSpelling) {
      Object.keys(t.spellingResults).forEach(function (k) { spellTotal++; if (t.spellingResults[k]) spellCorrect++; });
    }
    Object.keys(t.reviewResults).forEach(function (k) { revCount++; if (t.reviewResults[k]) revCorrect++; });
    Object.keys(t.retryResults).forEach(function (k) { retryTotal++; if (t.retryResults[k]) retryCorrect++; });

    var detRate = detTotal ? Math.round(100 * detCorrect / detTotal) : 0;
    var spellRate = spellTotal ? Math.round(100 * spellCorrect / spellTotal) : 0;
    var revRate = revCount ? Math.round(100 * revCorrect / revCount) : 0;
    var retryRate = retryTotal ? Math.round(100 * retryCorrect / retryTotal) : 0;
    var totalQ = detTotal + spellTotal + revCount + retryTotal;
    var totalC = detCorrect + spellCorrect + revCorrect + retryCorrect;
    var overall = totalQ ? Math.round(100 * totalC / totalQ) : 0;
    var poem = POEMS[(detTotal + revCount) % POEMS.length];
    var isTask = t.source === 'task';

    var children = [
      el('div', { class: 'big-word', text: '测试完成 🎉' }),
      isTask ? el('div', { class: 'hint', text: '（已作为今日任务的一部分完成）' }) : null,
      el('div', { class: 'kv' }, [el('span', { text: '检测正确率' }), el('span', { text: detRate + '%（' + detCorrect + '/' + detTotal + '）' })]),
    ];
    if (S.getSettings().enableSpelling) {
      children.push(el('div', { class: 'kv' }, [el('span', { text: '拼写正确率' }), el('span', { text: spellRate + '%（' + spellCorrect + '/' + spellTotal + '）' })]));
    }
    children.push(el('div', { class: 'kv' }, [el('span', { text: '复习正确率' }), el('span', { text: revRate + '%（' + revCorrect + '/' + revCount + '）' })]));
    if (retryTotal > 0) {
      children.push(el('div', { class: 'kv' }, [el('span', { text: '易错重测正确率' }), el('span', { text: retryRate + '%（' + retryCorrect + '/' + retryTotal + '）' })]));
    }
    children.push(el('div', { class: 'kv' }, [el('span', { text: '综合正确率' }), el('span', { text: String(overall) + '%' })]));
    children.push(el('div', { class: 'poem' }, [
      el('div', { class: 'line', text: poem.line }),
      el('div', { class: 'src', text: poem.src })
    ]));
    children.push(el('div', { class: 'row', style: 'margin-top:14px;' }, [
      isTask
        ? el('button', { class: 'btn btn-primary', text: '返回每日任务', onclick: function () { global.switchTab('task'); } })
        : el('button', { class: 'btn btn-primary', text: '再次测试', onclick: function () { S.startTest('standalone'); render(view); } }),
      el('button', { class: 'btn', text: '返回', onclick: function () { S.resetTest(); render(view); } })
    ]));
    view.appendChild(el('div', { class: 'card center' }, children));
  }

  global.TestModule = { render: render, startSession: startSession };
})(window);

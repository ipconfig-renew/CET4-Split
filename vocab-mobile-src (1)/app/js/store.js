/* =====================================================================
 * store.js —— 全局状态管理与本地持久化
 * ---------------------------------------------------------------------
 * 职责：
 *   1. 维护所有词库（支持多词库、仅一个启用）
 *   2. 维护每日任务进度（按天重置，中途退出可续做）
 *   3. 维护用户设置（每日新学/复习数量、是否启用拼写阶段）
 *   4. 所有写操作自动调用 save()，数据写入 localStorage，永久保存
 *
 * 设计说明：
 *   - 整个应用状态保存在单一 localStorage 键下，便于整体读写与导出。
 *   - 单词对象字段：
 *       id            唯一标识
 *       word          英文单词（用户输入原样保存）
 *       translation   中文释义
 *       addedAt       录入时间戳(ms)
 *       errorCount    累计错误次数（每次做错 +1）
 *       reviewCount   被复习/检测的次数
 *       lastReviewedAt最后一次复习时间戳
 *       correctStreak 连续答对次数（用于艾宾浩斯推进）
 *       nextReviewAt  下次应复习时间戳(ms)，由艾宾浩斯曲线推算
 * ===================================================================== */

(function (global) {
  'use strict';

  var STORAGE_KEY = 'vocab_app_state_v1';

  // 艾宾浩斯遗忘曲线复习间隔（单位：毫秒）
  // 经典节点：5分钟、30分钟、12小时、1天、2天、4天、7天、15天、1月、3月、6月
  var EBBINGHAUS_INTERVALS = [
    5 * 60 * 1000,
    30 * 60 * 1000,
    12 * 60 * 60 * 1000,
    24 * 60 * 60 * 1000,
    2 * 24 * 60 * 60 * 1000,
    4 * 24 * 60 * 60 * 1000,
    7 * 24 * 60 * 60 * 1000,
    15 * 24 * 60 * 60 * 1000,
    30 * 24 * 60 * 60 * 1000,
    90 * 24 * 60 * 60 * 1000,
    180 * 24 * 60 * 60 * 1000
  ];

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayStr(d) {
    d = d || new Date();
    var y = d.getFullYear();
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function defaultState() {
    return {
      version: 1,
      libraries: [],
      activeLibraryId: null,
      settings: { newGoal: 50, reviewGoal: 150, enableSpelling: true },
      task: null,
      test: emptyTest(),
      testDay: todayStr()
    };
  }

  // 空测试会话（检测 + 可选拼写 + 复习）。day 跨天后重置。
  function emptyTest() {
    return {
      active: false,
      source: 'standalone',        // standalone（独立运行） | task（作为每日任务的一部分）
      phase: 'idle',               // idle | detectConfirm | detection | spelling | review | done
      poolIds: [],                 // 检测/拼写 词 id（今日单词，可能跨多个词库）
      poolLibMap: {},              // wordId -> 归属词库 id
      detectionIndex: 0,
      detectionResults: {},        // wordId -> { correct:bool, wrongTries:number }
      spellingIndex: 0,
      spellingResults: {},         // wordId -> bool
      spellingSkipped: false,
      reviewQueue: [],             // 复习 词 id（旧词，来自启用词库）
      reviewIndex: 0,
      reviewResults: {},           // wordId -> bool
      wrongQueue: [],              // 本次测试中答错的词 id（追加到末尾再次测试）
      wrongIndex: 0,
      retryResults: {},            // wordId -> bool（易错重测阶段作答）
      startedAt: null,
      completedAt: null
    };
  }

  function emptyTask(date) {
    return {
      date: date,
      phase: 'idle',          // idle | recording | detectConfirm | detection | spelling | review | done
      newGoal: 50,
      reviewGoal: 150,
      recordedIds: [],        // 今日新学单词 id 列表
      detectionQueue: [],     // 待检测单词 id（= 新学单词）
      detectionIndex: 0,
      detectionResults: {},   // wordId -> { correct: bool, wrongTries: number }
      spellingQueue: [],
      spellingIndex: 0,
      spellingResults: {},    // wordId -> bool（是否拼写正确）
      spellingSkipped: false,
      reviewQueue: [],        // 待复习单词 id
      reviewIndex: 0,
      reviewResults: {},
      completedAt: null
    };
  }

  var state = defaultState();
  var listeners = [];

  function notify() {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { /* 忽略单个监听器异常 */ }
    }
  }

  function save() {
    writeRaw(JSON.stringify(state));
    notify();
  }

  function load() {
    var raw = readRaw();
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          state = Object.assign(defaultState(), parsed);
          state.settings = Object.assign({ newGoal: 50, reviewGoal: 150, enableSpelling: true }, parsed.settings || {});
          // 兼容旧存档：补齐测试会话字段
          if (!state.test || typeof state.test !== 'object') {
            state.test = emptyTest();
          } else {
            var et = emptyTest();
            state.test = Object.assign(et, state.test);
            if (!Array.isArray(state.test.wrongQueue)) state.test.wrongQueue = [];
            if (typeof state.test.wrongIndex !== 'number') state.test.wrongIndex = 0;
            if (!state.test.retryResults || typeof state.test.retryResults !== 'object') state.test.retryResults = {};
          }
          // 兼容旧存档：补齐单词的掌握度字段
          state.libraries.forEach(function (lib) {
            lib.words.forEach(function (w) {
              if (typeof w.errorCount !== 'number') w.errorCount = 0;
              if (typeof w.reviewCount !== 'number') w.reviewCount = 0;
              if (typeof w.correctStreak !== 'number') w.correctStreak = 0;
              if (typeof w.wrongStreak !== 'number') w.wrongStreak = 0;
            });
          });
        }
      } catch (e) {
        console.error('读取失败，使用默认状态：', e);
        state = defaultState();
      }
    }
    // 若当天任务不存在或与今天不符，则重置每日任务
    ensureTodayTask();
    // 跨天后重置「测试」模块状态（避免沿用前一天的测试进度/词池）
    var td = todayStr();
    if (!state.testDay || state.testDay !== td) { state.test = emptyTest(); state.testDay = td; }
    return state;
  }

  // 持久化读写：优先使用 Electron 原生文件桥接（保证永久保存），
  // 否则回退到浏览器 localStorage（网页/移动端通用）。
  function readRaw() {
    try {
      if (global.NativeStore && typeof global.NativeStore.initial !== 'undefined') {
        return global.NativeStore.initial;
      }
    } catch (e) { /* 忽略 */ }
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }
  function writeRaw(s) {
    if (global.NativeStore && typeof global.NativeStore.write === 'function') {
      try { global.NativeStore.write(s); return; } catch (e) { /* 回退 */ }
    }
    try { localStorage.setItem(STORAGE_KEY, s); } catch (e) { console.error('保存失败：', e); }
  }

  /* ---------------------- 词库相关 ---------------------- */

  function ensureLibrary() {
    if (state.libraries.length === 0) {
      var lib = createLibrary('我的词库');
      return lib;
    }
    if (!state.activeLibraryId || !getLibrary(state.activeLibraryId)) {
      state.activeLibraryId = state.libraries[0].id;
      save();
    }
    return getLibrary(state.activeLibraryId);
  }

  function getLibraries() {
    return state.libraries;
  }

  function getLibrary(id) {
    for (var i = 0; i < state.libraries.length; i++) {
      if (state.libraries[i].id === id) return state.libraries[i];
    }
    return null;
  }

  function getActiveLibrary() {
    if (!state.activeLibraryId) return null;
    return getLibrary(state.activeLibraryId);
  }

  function createLibrary(name) {
    var lib = {
      id: uid(),
      name: name || ('词库 ' + (state.libraries.length + 1)),
      createdAt: Date.now(),
      words: []
    };
    state.libraries.push(lib);
    if (!state.activeLibraryId) state.activeLibraryId = lib.id;
    save();
    return lib;
  }

  function renameLibrary(id, name) {
    var lib = getLibrary(id);
    if (lib) { lib.name = name; save(); }
  }

  function deleteLibrary(id) {
    if (state.libraries.length <= 1) {
      // 至少保留一个词库：清空内容而非删除最后一个
      var only = state.libraries[0];
      only.words = [];
      if (state.activeLibraryId === id) state.activeLibraryId = only.id;
      save();
      return { ok: false, msg: '至少需保留一个词库，已清空其内容' };
    }
    state.libraries = state.libraries.filter(function (l) { return l.id !== id; });
    if (state.activeLibraryId === id) {
      state.activeLibraryId = state.libraries[0] ? state.libraries[0].id : null;
    }
    save();
    return { ok: true };
  }

  function setActiveLibrary(id) {
    if (getLibrary(id)) { state.activeLibraryId = id; save(); }
  }

  function addWord(libId, word, translation) {
    var lib = getLibrary(libId);
    if (!lib) return null;
    var w = (word || '').trim();
    if (!w) return null;
    var existing = findWord(lib, w);
    if (existing) {
      // 已存在则更新释义，不重复添加
      existing.translation = (translation || '').trim();
      save();
      return existing;
    }
    var now = Date.now();
    var rec = {
      id: uid(),
      word: w,
      translation: (translation || '').trim(),
      addedAt: now,
      errorCount: 0,
      reviewCount: 0,
      lastReviewedAt: null,
      correctStreak: 0,        // 连续答对次数（掌握度正向指标）
      wrongStreak: 0,          // 连续答错次数（掌握度负向指标，用于提升抽取概率）
      nextReviewAt: now + EBBINGHAUS_INTERVALS[0]
    };
    lib.words.push(rec);
    save();
    return rec;
  }

  function findWord(lib, word) {
    var w = (word || '').trim().toLowerCase();
    for (var i = 0; i < lib.words.length; i++) {
      if (lib.words[i].word.toLowerCase() === w) return lib.words[i];
    }
    return null;
  }

  function deleteWord(libId, wordId) {
    var lib = getLibrary(libId);
    if (!lib) return;
    lib.words = lib.words.filter(function (x) { return x.id !== wordId; });
    save();
  }

  function updateWord(libId, wordId, fields) {
    var lib = getLibrary(libId);
    if (!lib) return;
    var rec = null;
    for (var i = 0; i < lib.words.length; i++) {
      if (lib.words[i].id === wordId) { rec = lib.words[i]; break; }
    }
    if (!rec) return;
    if (fields.word !== undefined) rec.word = fields.word.trim();
    if (fields.translation !== undefined) rec.translation = fields.translation.trim();
    save();
  }

  /* ---------------------- 设置 ---------------------- */

  function getSettings() { return state.settings; }

  function setSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    save();
  }

  /* ---------------------- 每日任务（录入） + 测试模块 ---------------------- */

  function ensureTodayTask() {
    var t = todayStr();
    if (!state.task || state.task.date !== t) {
      var s = state.settings;
      state.task = emptyTask(t);
      state.task.newGoal = s.newGoal;
      state.task.reviewGoal = s.reviewGoal;
    } else {
      // 设置可能已变更，任务进行中保持已设目标，新一天会重新读取
      state.task.newGoal = state.settings.newGoal;
      state.task.reviewGoal = state.settings.reviewGoal;
    }
  }

  function getTask() {
    ensureTodayTask();
    return state.task;
  }

  // 开始任务：进入录入阶段
  function startTask() {
    ensureTodayTask();
    var task = state.task;
    if (task.phase === 'done' || task.phase === 'testing') return task; // 已完成或正在测试则不再重复
    task.phase = 'recording';
    task.recordedIds = [];
    task.completedAt = null;
    save();
    return task;
  }

  // 录入一个单词：写入启用词库，并记录到今日新学列表
  function recordNewWord(word, translation) {
    var lib = ensureLibrary();
    var rec = addWord(lib.id, word, translation);
    if (rec) {
      var task = state.task;
      if (task.recordedIds.indexOf(rec.id) === -1) task.recordedIds.push(rec.id);
      save();
    }
    return rec;
  }

  // 录入完成：仅做收尾；检测 / 拼写 / 复习交由「测试」模块接管
  function finishRecording() {
    save();
    return state.task;
  }

  function resetTodayTask() {
    state.task = emptyTask(todayStr());
    state.task.newGoal = state.settings.newGoal;
    state.task.reviewGoal = state.settings.reviewGoal;
    state.test = emptyTest();
    save();
    return state.task;
  }

  /* ---- 今日单词（检测/拼写 的测试对象） ---- */
  // 返回所有 addedAt 落在“今天”的单词（跨全部词库），含其归属词库 id。
  // 覆盖：每日任务录入、词库手动录入、导入/合并中时间戳为今日的单词。
  function getTodayWords() {
    var now = Date.now();
    var start = new Date(); start.setHours(0, 0, 0, 0);
    var startMs = start.getTime();
    var map = {};
    state.libraries.forEach(function (lib) {
      lib.words.forEach(function (w) {
        if (w.addedAt && w.addedAt >= startMs && w.addedAt <= now) {
          if (!map[w.id]) map[w.id] = { word: w, libId: lib.id };
        }
      });
    });
    var arr = Object.keys(map).map(function (k) { return map[k]; });
    arr.sort(function (a, b) { return a.word.addedAt - b.word.addedAt; });
    return arr;
  }

  // 跨词库按 id 查找单词，返回单词与其归属库
  function findWordAnywhere(wordId) {
    for (var i = 0; i < state.libraries.length; i++) {
      for (var j = 0; j < state.libraries[i].words.length; j++) {
        if (state.libraries[i].words[j].id === wordId) {
          return { word: state.libraries[i].words[j], lib: state.libraries[i], libId: state.libraries[i].id };
        }
      }
    }
    return null;
  }

  // 错误计数 +1（定位到所属词库写入）
  function bumpErrorAnywhere(wordId) {
    var found = findWordAnywhere(wordId);
    if (found) {
      found.word.errorCount = (found.word.errorCount || 0) + 1;
      save();
    }
  }

  /* ---- 测试模块状态机（检测 + 可选拼写 + 复习） ---- */
  function getTest() { return state.test; }

  function resetTest() {
    state.test = emptyTest();
    save();
    return state.test;
  }

  // 开启一次测试：构建 检测/拼写 词池（今日单词）+ 复习词池（旧词，艾宾浩斯/错误优先）
  function startTest(source) {
    ensureTodayTask();
    var today = getTodayWords();
    var poolIds = today.map(function (p) { return p.word.id; });
    var poolLibMap = {};
    today.forEach(function (p) { poolLibMap[p.word.id] = p.libId; });
    var lib = getActiveLibrary();
    var exclude = {};
    poolIds.forEach(function (id) { exclude[id] = true; });
    var reviewQueue = lib ? selectReviewWords(lib, exclude, state.settings.reviewGoal).map(function (w) { return w.id; }) : [];

    var phase;
    if (poolIds.length > 0) phase = (source === 'task') ? 'detectConfirm' : 'detection';
    else if (reviewQueue.length > 0) phase = 'review';
    else phase = 'done';

    state.test = {
      active: true,
      source: source || 'standalone',
      phase: phase,
      poolIds: poolIds,
      poolLibMap: poolLibMap,
      detectionIndex: 0,
      detectionResults: {},
      spellingIndex: 0,
      spellingResults: {},
      spellingSkipped: false,
      reviewQueue: reviewQueue,
      reviewIndex: 0,
      reviewResults: {},
      wrongQueue: [],
      wrongIndex: 0,
      retryResults: {},
      startedAt: Date.now(),
      completedAt: null
    };
    if (source === 'task') state.task.phase = 'testing';
    if (phase === 'done' && source === 'task') {
      state.task.phase = 'done';
      state.task.completedAt = Date.now();
    }
    save();
    return state.test;
  }

  function startTestDetection() {
    var t = state.test;
    t.phase = 'detection';
    t.detectionIndex = 0;
    save();
    return t;
  }

  // 记录一次检测作答（错误则累加错误次数）
  function answerTestDetection(wordId, isCorrect) {
    var t = state.test;
    var r = t.detectionResults[wordId] || { correct: false, wrongTries: 0 };
    if (isCorrect) r.correct = true;
    else { r.wrongTries += 1; bumpErrorAnywhere(wordId); }
    t.detectionResults[wordId] = r;
    save();
    return r;
  }

  function finishTestDetection() {
    var t = state.test;
    t.spellingIndex = 0;
    t.spellingResults = {};
    t.spellingSkipped = false;
    if (state.settings.enableSpelling && t.poolIds.length > 0) {
      t.phase = 'spelling';
    } else if (t.reviewQueue && t.reviewQueue.length > 0) {
      // 检测后进入复习阶段（考察达到复习周期的旧词）
      t.phase = 'review';
      t.reviewIndex = 0;
    } else {
      finishTestReview();
    }
    save();
    return t;
  }

  function skipTestSpelling() {
    var t = state.test;
    t.spellingSkipped = true;
    if (t.reviewQueue && t.reviewQueue.length > 0) {
      t.phase = 'review';
      t.reviewIndex = 0;
    } else {
      finishTestReview();
    }
    save();
    return t;
  }

  function answerTestSpelling(wordId, isCorrect) {
    var t = state.test;
    t.spellingResults[wordId] = isCorrect;
    if (!isCorrect) bumpErrorAnywhere(wordId);
    save();
    return t;
  }

  function finishTestSpelling() {
    var t = state.test;
    if (t.reviewQueue && t.reviewQueue.length > 0) {
      // 拼写后进入复习阶段（考察达到复习周期的旧词）
      t.phase = 'review';
      t.reviewIndex = 0;
    } else {
      finishTestReview();
    }
    save();
    return state.test;
  }

  // 记录一次“测试中答错”：将单词追加到本次测试末尾的易错重测队列（去重）。
  function recordTestWrong(wordId) {
    var t = state.test;
    if (!t || !t.active) return;
    if (!t.wrongQueue) t.wrongQueue = [];
    if (t.wrongQueue.indexOf(wordId) === -1) t.wrongQueue.push(wordId);
    save();
  }

  // 结束复习：若本次测试有答错的词，进入“易错重测”阶段；否则直接完成。
  function finishTestReview() {
    var t = state.test;
    if (t.wrongQueue && t.wrongIndex < t.wrongQueue.length) {
      t.phase = 'retry';
      t.wrongIndex = 0;
      save();
      return t;
    }
    return finishTestDone();
  }

  // 易错重测阶段作答：按复习逻辑更新单词掌握度（连对推进、连错归零并提升优先级）。
  function answerTestRetry(wordId, isCorrect) {
    var t = state.test;
    t.retryResults[wordId] = isCorrect;
    var found = findWordAnywhere(wordId);
    if (found) {
      var rec = found.word;
      rec.reviewCount = (rec.reviewCount || 0) + 1;
      rec.lastReviewedAt = Date.now();
      if (isCorrect) {
        rec.correctStreak = (rec.correctStreak || 0) + 1;
        rec.wrongStreak = 0;
        var idx = Math.min(rec.correctStreak, EBBINGHAUS_INTERVALS.length - 1);
        rec.nextReviewAt = Date.now() + EBBINGHAUS_INTERVALS[idx];
      } else {
        rec.correctStreak = 0;
        rec.wrongStreak = (rec.wrongStreak || 0) + 1;
        rec.nextReviewAt = Date.now() + EBBINGHAUS_INTERVALS[0];
        bumpErrorAnywhere(wordId);
      }
    }
    save();
    return t;
  }

  // 结束测试：标记完成。task 来源则同时标记每日任务完成。
  function finishTestDone() {
    var t = state.test;
    t.phase = 'done';
    t.completedAt = Date.now();
    if (t.source === 'task') {
      state.task.phase = 'done';
      state.task.completedAt = t.completedAt;
    }
    save();
    return t;
  }

  // 结束易错重测（到末尾）后收尾完成。
  function finishTestRetry() {
    return finishTestDone();
  }

  function answerTestReview(wordId, isCorrect) {
    var t = state.test;
    t.reviewResults[wordId] = isCorrect;
    var found = findWordAnywhere(wordId);
    if (found) {
      var rec = found.word;
      rec.reviewCount = (rec.reviewCount || 0) + 1;
      rec.lastReviewedAt = Date.now();
      if (isCorrect) {
        rec.correctStreak = (rec.correctStreak || 0) + 1;
        rec.wrongStreak = 0;
        var idx = Math.min(rec.correctStreak, EBBINGHAUS_INTERVALS.length - 1);
        rec.nextReviewAt = Date.now() + EBBINGHAUS_INTERVALS[idx];
      } else {
        rec.correctStreak = 0;
        rec.wrongStreak = (rec.wrongStreak || 0) + 1;
        rec.nextReviewAt = Date.now() + EBBINGHAUS_INTERVALS[0];
        bumpErrorAnywhere(wordId);
      }
    }
    save();
    return t;
  }

  // 复习词优先级评分（掌握度维度）：分数越高越需要被复习。
  // 在“艾宾浩斯到期优先”的基础上，叠加：
  //   - 连续答错(wrongStreak) 大幅加分 → 提升抽取概率
  //   - 累计错误(errorCount) 加分
  //   - 连续答对(correctStreak) 大幅减分 → 降低抽取概率，把池子留给未掌握单词
  //   - 复习次数多且已掌握，轻微减分
  function reviewPriority(w, now) {
    var overdue = now - (w.nextReviewAt || 0);          // 到期词 >=0，越逾期越大
    var due = overdue >= 0;
    var score = 0;
    if (due) score += 100000 + overdue / (3600 * 1000); // 到期词整体优先于未到期
    score += (w.errorCount || 0) * 120;                // 累计错误越多越优先
    score += (w.wrongStreak || 0) * 200;               // 连续做错 → 强烈优先
    score -= (w.correctStreak || 0) * 160;             // 连续答对（掌握度高）→ 降低概率
    score -= (w.reviewCount || 0) * 8;                 // 已复习多次 → 轻微降低
    return score;
  }

  // 核心挑选算法：艾宾浩斯到期优先 + 掌握度（错误/连错加分、连对减分）
  function selectReviewWords(lib, excludeMap, count) {
    var now = Date.now();
    var candidates = lib.words.filter(function (w) { return !excludeMap[w.id]; });
    if (candidates.length === 0) return [];
    candidates.sort(function (a, b) {
      var da = (now >= (a.nextReviewAt || 0)) ? 1 : 0;
      var db = (now >= (b.nextReviewAt || 0)) ? 1 : 0;
      if (da !== db) return db - da;                  // 到期词整体排在前面
      var sa = reviewPriority(a, now), sb = reviewPriority(b, now);
      if (sb !== sa) return sb - sa;                  // 掌握度/错误维度排序
      return (a.reviewCount || 0) - (b.reviewCount || 0); // 复习少的靠前
    });
    return candidates.slice(0, count);
  }

  /* ---------------------- 导入 / 导出 / 合并 ---------------------- */

  // 导出当前启用词库为 JSON 字符串
  function exportActiveLibrary() {
    var lib = getActiveLibrary();
    if (!lib) return null;
    return JSON.stringify({
      version: 1,
      name: lib.name,
      exportedAt: Date.now(),
      words: lib.words.map(function (w) {
        return {
          word: w.word,
          translation: w.translation,
          errorCount: w.errorCount,
          addedAt: w.addedAt,
          nextReviewAt: w.nextReviewAt
        };
      })
    }, null, 2);
  }

  // 从 JSON 字符串导入为【新词库】（不覆盖现有）
  function importAsNewLibrary(jsonStr, nameOverride) {
    var data = parseLibraryJSON(jsonStr);
    if (!data) return { ok: false, msg: '文件格式无法识别' };
    var lib = createLibrary(nameOverride || data.name || ('导入词库 ' + new Date().toLocaleString()));
    data.words.forEach(function (w) {
      var rec = addWord(lib.id, w.word, w.translation);
      if (rec) {
        if (w.errorCount) rec.errorCount = w.errorCount;
        if (typeof w.reviewCount === 'number') rec.reviewCount = w.reviewCount;
        if (w.addedAt) rec.addedAt = w.addedAt;
        if (w.nextReviewAt) rec.nextReviewAt = w.nextReviewAt; // 保留到期时间，便于直接复习
      }
    });
    save();
    return { ok: true, id: lib.id, count: data.words.length };
  }

  // 与现有【启用词库】合并：相同单词更新释义，不同单词追加
  function mergeIntoActiveLibrary(jsonStr) {
    var lib = ensureLibrary();
    var data = parseLibraryJSON(jsonStr);
    if (!data) return { ok: false, msg: '文件格式无法识别' };
    var added = 0, updated = 0;
    data.words.forEach(function (w) {
      var existing = findWord(lib, w.word);
      if (existing) {
        if (w.translation) existing.translation = w.translation;
        if (w.errorCount) existing.errorCount = (existing.errorCount || 0) + w.errorCount;
        if (w.nextReviewAt) existing.nextReviewAt = w.nextReviewAt;
        updated++;
      } else {
        var rec = addWord(lib.id, w.word, w.translation);
        if (rec) {
          if (w.errorCount) rec.errorCount = w.errorCount;
          if (w.addedAt) rec.addedAt = w.addedAt;
          if (w.nextReviewAt) rec.nextReviewAt = w.nextReviewAt;
        }
        added++;
      }
    });
    save();
    return { ok: true, added: added, updated: updated };
  }

  function parseLibraryJSON(jsonStr) {
    try {
      var data = JSON.parse(jsonStr);
      if (!data || !Array.isArray(data.words)) return null;
      return data;
    } catch (e) {
      return null;
    }
  }

  /* ---------------------- 工具 ---------------------- */
  function getState() { return state; }
  function onChange(fn) { listeners.push(fn); }

  global.VocabStore = {
    load: load,
    save: save,
    getState: getState,
    onChange: onChange,
    // 词库
    getLibraries: getLibraries,
    getLibrary: getLibrary,
    getActiveLibrary: getActiveLibrary,
    createLibrary: createLibrary,
    renameLibrary: renameLibrary,
    deleteLibrary: deleteLibrary,
    setActiveLibrary: setActiveLibrary,
    ensureLibrary: ensureLibrary,
    addWord: addWord,
    deleteWord: deleteWord,
    updateWord: updateWord,
    findWord: findWord,
    // 设置
    getSettings: getSettings,
    setSettings: setSettings,
    // 任务（录入）
    getTask: getTask,
    startTask: startTask,
    recordNewWord: recordNewWord,
    finishRecording: finishRecording,
    resetTodayTask: resetTodayTask,
    // 测试模块（检测 + 可选拼写 + 复习）
    getTest: getTest,
    resetTest: resetTest,
    startTest: startTest,
    startTestDetection: startTestDetection,
    answerTestDetection: answerTestDetection,
    finishTestDetection: finishTestDetection,
    skipTestSpelling: skipTestSpelling,
    answerTestSpelling: answerTestSpelling,
    finishTestSpelling: finishTestSpelling,
    answerTestReview: answerTestReview,
    finishTestReview: finishTestReview,
    recordTestWrong: recordTestWrong,
    answerTestRetry: answerTestRetry,
    finishTestRetry: finishTestRetry,
    getTodayWords: getTodayWords,
    findWordAnywhere: findWordAnywhere,
    selectReviewWords: selectReviewWords,
    // 导入导出
    exportActiveLibrary: exportActiveLibrary,
    importAsNewLibrary: importAsNewLibrary,
    mergeIntoActiveLibrary: mergeIntoActiveLibrary,
    // 常量
    EBBINGHAUS_INTERVALS: EBBINGHAUS_INTERVALS
  };
})(window);

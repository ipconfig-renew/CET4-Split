/* =====================================================================
 * spell.js —— 英文拼写校验
 * ---------------------------------------------------------------------
 * 依赖 dict-data.js 注入的 window.DICT_TEXT（换行分隔的单词表）。
 * 录入单词时用于实时判断拼写是否“疑似错误”，从而给出红色下划线提示。
 *
 * 说明：词典来自通用英语词表（约 27 万词），覆盖绝大多数常见/派生词。
 * 个别专业词或新词若不在词典中会被判为“疑似错误”，用户可在点击
 * “下一个”时选择“仍要提交”，不影响使用。
 * ===================================================================== */

(function (global) {
  'use strict';

  var DICT_SET = null;

  function buildSet() {
    if (DICT_SET) return DICT_SET;
    var text = global.DICT_TEXT || '';
    DICT_SET = new Set(text.split('\n'));
    return DICT_SET;
  }

  // 判断是否为词典中的合法单词（忽略大小写）
  function isValid(word) {
    if (!word) return false;
    var w = word.trim().toLowerCase();
    if (!w) return false;
    buildSet();
    return DICT_SET.has(w);
  }

  // 计算 Levenshtein 编辑距离，用于轻微纠偏提示（可选）
  function editDistance(a, b) {
    a = (a || '').toLowerCase();
    b = (b || '').toLowerCase();
    var m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    var prev = new Array(n + 1);
    var cur = new Array(n + 1);
    for (var j = 0; j <= n; j++) prev[j] = j;
    for (var i = 1; i <= m; i++) {
      cur[0] = i;
      for (var j2 = 1; j2 <= n; j2++) {
        var cost = (a[i - 1] === b[j2 - 1]) ? 0 : 1;
        cur[j2] = Math.min(prev[j2] + 1, cur[j2 - 1] + 1, prev[j2 - 1] + cost);
      }
      var tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  global.Spell = {
    isValid: isValid,
    editDistance: editDistance,
    // 返回 { valid: bool }，valid=false 表示疑似拼写错误
    check: function (word) {
      return { valid: isValid(word) };
    }
  };
})(window);

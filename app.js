// =============================================================
// 听写应用逻辑 (Supabase 动态加载版)
// =============================================================

// ---------- Supabase 配置 ----------
const SUPABASE_URL = 'https://whqpuzxfheqwaniuqbbz.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_REAL_ANON_KEY_HERE'; // 替换为你的真实 anon key
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 全局数据结构（从数据库动态组装）
let spellingData = {};

const AUTO_DOWNLOAD = true;

let selectedGrades = new Set([1]);
let selectedWeeks = new Set([1]);

let displayItems = [];

// 每个目标词的勾选状态（是否写对）
const checkboxStateMap = new Map();
// 每个目标词是否被判定过
const touchedMap = new Map();
// 每个已学词的勾选状态：key = `${targetKey}::${learnedWord}` -> boolean (true=对, false=错)
const learnedCheckboxMap = new Map();
// 每个已学词是否被判定过
const learnedTouchedMap = new Map();

// 单词 -> 来源索引
let wordSourceIndex = new Map();

// ---------- DOM ----------
const gradeChipsEl = document.getElementById('gradeChips');
const weekChipsEl = document.getElementById('weekChips');
const wordsContainer = document.getElementById('wordsContainer');
const downloadBtn = document.getElementById('downloadBtn');
const statsBtn = document.getElementById('statsBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const statusMsg = document.getElementById('statusMsg');
const toggleAllGrades = document.getElementById('toggleAllGrades');
const toggleAllWeeks = document.getElementById('toggleAllWeeks');

const statsModal = document.getElementById('statsModal');
const statsClose = document.getElementById('statsClose');
const statsBody = document.getElementById('statsBody');
const statsDownload = document.getElementById('statsDownload');

// =============================================================
// 从 Supabase 加载所有单词数据并组装成 spellingData
// =============================================================
async function loadDataFromSupabase() {
  try {
    updateStatusMessage('正在从数据库加载单词...');
    
    // 从 words 表中获取所有记录，按 grade 和 week 排序
    const { data, error } = await supabaseClient
      .from('words')
      .select('*')
      .order('grade', { ascending: true })
      .order('week', { ascending: true });

    if (error) throw error;

    spellingData = {};

    // 将平铺的数据库行组装回嵌套的 spellingData 结构
    data.forEach(row => {
      const g = row.grade;
      const w = row.week;

      if (!spellingData[g]) {
        spellingData[g] = {};
      }
      if (!spellingData[g][w]) {
        spellingData[g][w] = {
          subtitle: `Week ${w} 练习`, // 如果数据库有 subtitle 字段可改为 row.subtitle
          words: []
        };
      }

      spellingData[g][w].words.push({
        id: row.id,
        word: row.word,
        sentence: row.sentence,
        related_word_ids: row.related_word_ids || []
      });
    });

    updateStatusMessage('');
    return true;
  } catch (err) {
    console.error('加载 Supabase 数据失败:', err);
    updateStatusMessage('❌ 加载数据库失败，请检查控制台');
    return false;
  }
}

// =============================================================
// 构建"单词 -> 来源"索引
// =============================================================
function buildWordSourceIndex() {
  wordSourceIndex = new Map();
  for (const gradeStr of Object.keys(spellingData)) {
    const grade = Number(gradeStr);
    const gradeData = spellingData[grade];
    for (const weekStr of Object.keys(gradeData)) {
      const week = Number(weekStr);
      const weekData = gradeData[week];
      if (!weekData || !weekData.words) continue;
      weekData.words.forEach(item => {
        const w = item.word.toLowerCase().trim();
        if (!wordSourceIndex.has(w)) wordSourceIndex.set(w, []);
        wordSourceIndex.get(w).push({ grade, week });
      });
    }
  }
}

// =============================================================
// 从例句中找出所有学过的词
// =============================================================
function tokenizeSentence(sentence) {
  return sentence.split(/[^a-zA-Z']+/).filter(t => t.length > 0);
}

function findLearnedWords(sentence) {
  const tokens = tokenizeSentence(sentence);
  const seen = new Set();
  const result = [];
  tokens.forEach(token => {
    const lower = token.toLowerCase();
    if (lower.length < 2) return;
    if (seen.has(lower)) return;
    if (wordSourceIndex.has(lower)) {
      seen.add(lower);
      result.push({
        word: token,
        sources: wordSourceIndex.get(lower)
      });
    }
  });
  return result;
}

// =============================================================
// 选择器渲染
// =============================================================
function renderGradeChips() {
  const grades = Object.keys(spellingData).map(Number).sort();
  gradeChipsEl.innerHTML = '';
  grades.forEach(g => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (selectedGrades.has(g) ? ' selected' : '');
    chip.innerHTML = `<span class="tick">✓</span> ${g}年级`;
    chip.addEventListener('click', () => toggleGrade(g));
    gradeChipsEl.appendChild(chip);
  });
}

function renderWeekChips() {
  const allWeeks = new Set();
  Object.values(spellingData).forEach(gradeData => {
    Object.keys(gradeData).forEach(w => allWeeks.add(Number(w)));
  });
  const weeks = Array.from(allWeeks).sort((a, b) => a - b);

  weekChipsEl.innerHTML = '';
  weeks.forEach(w => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (selectedWeeks.has(w) ? ' selected' : '');
    chip.innerHTML = `<span class="tick">✓</span> W${w}`;
    chip.addEventListener('click', () => toggleWeek(w));
    weekChipsEl.appendChild(chip);
  });
}

function toggleGrade(g) {
  if (selectedGrades.has(g)) {
    if (selectedGrades.size === 1) return;
    selectedGrades.delete(g);
  } else {
    selectedGrades.add(g);
  }
  renderGradeChips();
  rebuildDisplay();
}

function toggleWeek(w) {
  if (selectedWeeks.has(w)) {
    if (selectedWeeks.size === 1) return;
    selectedWeeks.delete(w);
  } else {
    selectedWeeks.add(w);
  }
  renderWeekChips();
  rebuildDisplay();
}

toggleAllGrades.addEventListener('click', () => {
  const allGrades = Object.keys(spellingData).map(Number);
  if (selectedGrades.size === allGrades.length) {
    selectedGrades = new Set([allGrades[0]]);
  } else {
    selectedGrades = new Set(allGrades);
  }
  renderGradeChips();
  rebuildDisplay();
});

toggleAllWeeks.addEventListener('click', () => {
  const allWeeksSet = new Set();
  Object.values(spellingData).forEach(gradeData => {
    Object.keys(gradeData).forEach(w => allWeeksSet.add(Number(w)));
  });
  const allWeeks = Array.from(allWeeksSet).sort((a, b) => a - b);
  if (selectedWeeks.size === allWeeks.length) {
    selectedWeeks = new Set([allWeeks[0]]);
  } else {
    selectedWeeks = new Set(allWeeks);
  }
  renderWeekChips();
  rebuildDisplay();
});

// =============================================================
// 重建显示
// =============================================================
function rebuildDisplay() {
  displayItems = [];

  const combos = [];
  for (const g of Array.from(selectedGrades).sort()) {
    for (const w of Array.from(selectedWeeks).sort((a, b) => a - b)) {
      if (spellingData[g] && spellingData[g][w]) {
        combos.push({ grade: g, week: w });
      }
    }
  }

  if (combos.length === 0) {
    wordsContainer.innerHTML = '<div class="empty-state">请至少选择一个年级和一个 Week</div>';
    updateStatusMessage('');
    return;
  }

  combos.forEach(({ grade, week }) => {
    const weekData = spellingData[grade][week];
    weekData.words.forEach((item, idx) => {
      displayItems.push({
        grade,
        week,
        wordIndex: idx,
        word: item.word,
        sentence: item.sentence,
        subtitle: weekData.subtitle,
        learnedWords: findLearnedWords(item.sentence)
      });
    });
  });

  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    if (!checkboxStateMap.has(key)) checkboxStateMap.set(key, false);
    if (!touchedMap.has(key)) touchedMap.set(key, false);

    item.learnedWords.forEach(lw => {
      const lwKey = `${key}::${lw.word.toLowerCase()}`;
      if (!learnedCheckboxMap.has(lwKey)) learnedCheckboxMap.set(lwKey, false);
      if (!learnedTouchedMap.has(lwKey)) learnedTouchedMap.set(lwKey, false);
    });
  });

  renderWords();
}

// =============================================================
// 渲染单词列表
// =============================================================
function renderWords() {
  if (displayItems.length === 0) return;

  const groups = new Map();
  displayItems.forEach(item => {
    const gKey = `${item.grade}-${item.week}`;
    if (!groups.has(gKey)) {
      groups.set(gKey, {
        grade: item.grade,
        week: item.week,
        subtitle: item.subtitle,
        items: []
      });
    }
    groups.get(gKey).items.push(item);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.week - b.week;
  });

  wordsContainer.innerHTML = '';

  sortedGroups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'week-group';

    const header = document.createElement('div');
    header.className = 'group-header';

    const title = document.createElement('span');
    title.className = 'group-title';
    title.textContent = `${group.grade}年级 · Week ${group.week}`;

    const sub = document.createElement('span');
    sub.className = 'group-sub';
    sub.textContent = group.subtitle;

    const progress = document.createElement('span');
    progress.className = 'group-progress';
    progress.dataset.groupKey = `${group.grade}-${group.week}`;

    header.appendChild(title);
    header.appendChild(sub);
    header.appendChild(progress);

    groupEl.appendChild(header);

    const list = document.createElement('div');
    list.className = 'word-list';

    group.items.forEach(item => {
      const key = `${item.grade}-${item.week}-${item.wordIndex}`;
      const card = createWordCard(item, key);
      list.appendChild(card);
    });

    groupEl.appendChild(list);
    wordsContainer.appendChild(groupEl);

    updateGroupProgress(`${group.grade}-${group.week}`, group.items);
  });
}

// =============================================================
// 创建单词卡片
// =============================================================
function createWordCard(item, key) {
  const card = document.createElement('div');
  card.className = 'word-card';
  card.dataset.key = key;

  const isCorrect = checkboxStateMap.get(key) === true;
  if (isCorrect) card.classList.add('correct');

  const mainDiv = document.createElement('div');
  mainDiv.className = 'word-main';

  const wordSpan = document.createElement('span');
  wordSpan.className = 'word-text';
  wordSpan.textContent = item.word;

  const sentenceSpan = document.createElement('span');
  sentenceSpan.className = 'sentence';
  sentenceSpan.textContent = item.sentence;

  mainDiv.appendChild(wordSpan);
  mainDiv.appendChild(sentenceSpan);

  // ---------- 已学词区域 ----------
  if (item.learnedWords && item.learnedWords.length > 0) {
    const learnedBox = document.createElement('div');
    learnedBox.className = 'learned-words';

    const learnedTitle = document.createElement('div');
    learnedTitle.className = 'learned-words-title';
    learnedTitle.textContent = '📖 已学词汇（点击勾选对/错）';
    learnedBox.appendChild(learnedTitle);

    const learnedList = document.createElement('div');
    learnedList.className = 'learned-words-list';

    item.learnedWords.forEach(lw => {
      const lwKey = `${key}::${lw.word.toLowerCase()}`;
      const lwItem = document.createElement('div');
      lwItem.className = 'learned-word-item';
      lwItem.dataset.learnedKey = lwKey;

      if (learnedTouchedMap.get(lwKey) === true) {
        if (learnedCheckboxMap.get(lwKey) === true) {
          lwItem.classList.add('correct');
        } else {
          lwItem.classList.add('incorrect');
        }
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'learned-word-text';
      textSpan.textContent = lw.word;

      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'learned-word-source';
      sourceSpan.textContent = lw.sources
        .slice(0, 2)
        .map(s => `G${s.grade}W${s.week}`)
        .join('·') + (lw.sources.length > 2 ? '…' : '');

      const checkSpan = document.createElement('span');
      checkSpan.className = 'learned-word-check';
      if (learnedTouchedMap.get(lwKey) === true) {
        checkSpan.textContent = learnedCheckboxMap.get(lwKey) ? '✓' : '✗';
      }

      lwItem.appendChild(textSpan);
      lwItem.appendChild(sourceSpan);
      lwItem.appendChild(checkSpan);

      lwItem.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleLearnedCheckbox(lwKey, lwItem);
      });

      learnedList.appendChild(lwItem);
    });

    learnedBox.appendChild(learnedList);
    mainDiv.appendChild(learnedBox);
  }

  // ---------- 目标单词的勾选 ----------
  const checkWrapper = document.createElement('div');
  checkWrapper.className = 'check-wrapper';

  const label = document.createElement('label');
  label.textContent = '✔️对';

  const checkBox = document.createElement('div');
  checkBox.className = 'check-box';
  checkBox.textContent = isCorrect ? '✓' : '';
  checkBox.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleCheckboxByKey(key);
  });

  checkWrapper.appendChild(label);
  checkWrapper.appendChild(checkBox);

  card.appendChild(mainDiv);
  card.appendChild(checkWrapper);
  return card;
}

// =============================================================
// 切换已学词勾选
// =============================================================
function toggleLearnedCheckbox(lwKey, element) {
  const touched = learnedTouchedMap.get(lwKey) === true;
  const isCorrect = learnedCheckboxMap.get(lwKey) === true;

  let newTouched, newCorrect;
  if (!touched) {
    newTouched = true; newCorrect = true;
  } else if (isCorrect) {
    newTouched = true; newCorrect = false;
  } else {
    newTouched = false; newCorrect = false;
  }

  learnedTouchedMap.set(lwKey, newTouched);
  learnedCheckboxMap.set(lwKey, newCorrect);

  element.classList.remove('correct', 'incorrect');
  const checkSpan = element.querySelector('.learned-word-check');
  if (!newTouched) {
    checkSpan.textContent = '';
  } else if (newCorrect) {
    element.classList.add('correct');
    checkSpan.textContent = '✓';
  } else {
    element.classList.add('incorrect');
    checkSpan.textContent = '✗';
  }

  updateStatusMessage('');
  checkAutoDownload();
}

// =============================================================
// 切换目标词勾选
// =============================================================
function toggleCheckboxByKey(key) {
  const newVal = !checkboxStateMap.get(key);
  checkboxStateMap.set(key, newVal);
  touchedMap.set(key, true);

  const card = document.querySelector(`.word-card[data-key="${key}"]`);
  if (card) {
    if (newVal) {
      card.classList.add('correct');
      card.querySelector('.check-box').textContent = '✓';
    } else {
      card.classList.remove('correct');
      card.querySelector('.check-box').textContent = '';
    }
  }

  const parts = key.split('-');
  const groupKey = `${parts[0]}-${parts[1]}`;
  updateGroupProgressByKey(groupKey);

  updateStatusMessage('');
  checkAutoDownload();
}

// =============================================================
// 自动下载检查
// =============================================================
function checkAutoDownload() {
  if (!AUTO_DOWNLOAD) return;
  const allTargetTouched = displayItems.every(item => {
    const k = `${item.grade}-${item.week}-${item.wordIndex}`;
    return touchedMap.get(k) === true;
  });
  const allLearnedTouched = Array.from(learnedTouchedMap.keys()).every(k =>
    learnedTouchedMap.get(k) === true
  );
  if (allTargetTouched && allLearnedTouched && displayItems.length > 0) {
    downloadResults(true);
    updateStatusMessage('✅ 全部判定完成，已自动下载！');
    displayItems.forEach(item => {
      const k = `${item.grade}-${item.week}-${item.wordIndex}`;
      touchedMap.set(k, false);
    });
    learnedTouchedMap.forEach((_, k) => learnedTouchedMap.set(k, false));
  }
}

// =============================================================
// 进度
// =============================================================
function updateGroupProgress(groupKey, items) {
  const total = items.length;
  let correct = 0;
  let touched = 0;
  items.forEach(item => {
    const k = `${item.grade}-${item.week}-${item.wordIndex}`;
    if (checkboxStateMap.get(k)) correct++;
    if (touchedMap.get(k)) touched++;
  });
  const progressEl = document.querySelector(`.group-progress[data-group-key="${groupKey}"]`);
  if (progressEl) {
    progressEl.textContent = `✓${correct}/${total} · 已判定${touched}/${total}`;
  }
}

function updateGroupProgressByKey(groupKey) {
  const [g, w] = groupKey.split('-').map(Number);
  const items = displayItems.filter(item => item.grade === g && item.week === w);
  if (items.length) {
    updateGroupProgress(groupKey, items);
  }
}

// =============================================================
// 统计与弹窗相关函数
// =============================================================
function computeStats() {
  const stats = new Map();

  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    item.learnedWords.forEach(lw => {
      const lwKey = `${key}::${lw.word.toLowerCase()}`;
      const lower = lw.word.toLowerCase();
      if (!stats.has(lower)) {
        stats.set(lower, {
          word: lw.word,
          sources: lw.sources,
          appear: 0,
          correct: 0,
          wrong: 0,
          touched: 0
        });
      }
      const s = stats.get(lower);
      s.appear++;
      if (learnedTouchedMap.get(lwKey) === true) {
        s.touched++;
        if (learnedCheckboxMap.get(lwKey) === true) s.correct++;
        else s.wrong++;
      }
    });
  });

  return Array.from(stats.values()).sort((a, b) => {
    if (b.wrong !== a.wrong) return b.wrong - a.wrong;
    return b.appear - a.appear;
  });
}

function showStats() {
  const stats = computeStats();

  if (stats.length === 0) {
    statsBody.innerHTML = '<div class="stats-empty">当前选择没有已学词汇</div>';
    statsModal.classList.add('show');
    return;
  }

  let totalAppear = 0, totalCorrect = 0, totalWrong = 0, totalTouched = 0;
  stats.forEach(s => {
    totalAppear += s.appear;
    totalCorrect += s.correct;
    totalWrong += s.wrong;
    totalTouched += s.touched;
  });

  let html = '';
  html += `<div class="stats-summary">
    <div class="stat-card yellow">
      <div class="stat-value">${stats.length}</div>
      <div class="stat-label">不同已学词</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalAppear}</div>
      <div class="stat-label">总出现次数</div>
    </div>
    <div class="stat-card green">
      <div class="stat-value">${totalCorrect}</div>
      <div class="stat-label">对</div>
    </div>
    <div class="stat-card red">
      <div class="stat-value">${totalWrong}</div>
      <div class="stat-label">错</div>
    </div>
  </div>`;

  html += `<table class="stats-table">
    <thead>
      <tr>
        <th>单词</th>
        <th>来源</th>
        <th style="text-align:center">出现</th>
        <th style="text-align:center">对</th>
        <th style="text-align:center">错</th>
        <th style="text-align:center">未判</th>
      </tr>
    </thead>
    <tbody>`;

  stats.forEach(s => {
    const sourceStr = s.sources
      .slice(0, 3)
      .map(x => `G${x.grade}W${x.week}`)
      .join('·') + (s.sources.length > 3 ? '…' : '');
    const notTouched = s.appear - s.touched;
    html += `<tr>
      <td class="word-cell">${escapeHtml(s.word)}</td>
      <td><span class="source-cell">${sourceStr}</span></td>
      <td class="num-cell">${s.appear}</td>
      <td class="num-cell green-cell">${s.correct}</td>
      <td class="num-cell red-cell">${s.wrong}</td>
      <td class="num-cell">${notTouched}</td>
    </tr>`;
  });

  html += `</tbody></table>`;

  statsBody.innerHTML = html;
  statsModal.classList.add('show');
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function downloadStats() {
  const stats = computeStats();
  if (stats.length === 0) {
    updateStatusMessage('没有已学词可统计');
    return;
  }

  const lines = [];
  lines.push(`已学词汇统计报告`);
  lines.push(`生成时间: ${new Date().toLocaleString()}`);
  lines.push(`年级: ${Array.from(selectedGrades).sort().join(', ')}`);
  lines.push(`Week: ${Array.from(selectedWeeks).sort((a, b) => a - b).join(', ')}`);
  lines.push('========================================');
  lines.push('');
  lines.push('单词'.padEnd(16) + '来源'.padEnd(24) + '出现  对  错  未判');
  lines.push('------------------------------------------------');

  let totalAppear = 0, totalCorrect = 0, totalWrong = 0;
  stats.forEach(s => {
    totalAppear += s.appear;
    totalCorrect += s.correct;
    totalWrong += s.wrong;
    const sourceStr = s.sources.map(x => `G${x.grade}W${x.week}`).join(',');
    const notTouched = s.appear - s.touched;
    lines.push(
      s.word.padEnd(16) +
      sourceStr.substring(0, 22).padEnd(24) +
      String(s.appear).padStart(4) + '  ' +
      String(s.correct).padStart(2) + '  ' +
      String(s.wrong).padStart(2) + '  ' +
      String(notTouched).padStart(4)
    );
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `已学词统计_${new Date().toISOString().slice(0,10)}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadResults(isAuto = false) {
  if (displayItems.length === 0) {
    updateStatusMessage('没有可下载的单词');
    return;
  }

  let correctCount = 0;
  let learnedCorrectCount = 0;
  let learnedWrongCount = 0;
  let learnedTotal = 0;

  const lines = [];
  lines.push(`听写结果 - 多选组合`);
  lines.push(`生成时间: ${new Date().toLocaleString()}`);
  lines.push(`年级: ${Array.from(selectedGrades).sort().join(', ')}`);
  lines.push(`Week: ${Array.from(selectedWeeks).sort((a, b) => a - b).join(', ')}`);
  lines.push('========================================');

  const groups = new Map();
  displayItems.forEach(item => {
    const gKey = `${item.grade}-${item.week}`;
    if (!groups.has(gKey)) {
      groups.set(gKey, {
        grade: item.grade,
        week: item.week,
        subtitle: item.subtitle,
        items: []
      });
    }
    groups.get(gKey).items.push(item);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    return a.week - b.week;
  });

  sortedGroups.forEach(group => {
    lines.push('');
    lines.push(`--- ${group.grade}年级 Week ${group.week} (${group.subtitle}) ---`);
    lines.push('');

    group.items.forEach(item => {
      const key = `${item.grade}-${item.week}-${item.wordIndex}`;
      const isCorrect = checkboxStateMap.get(key) === true;
      if (isCorrect) correctCount++;

      const result = isCorrect ? '✓ 正确' : '✗ 错误';
      lines.push(`【${item.word}】 ${result}`);
      lines.push(`  例句: ${item.sentence}`);

      if (item.learnedWords && item.learnedWords.length > 0) {
        lines.push(`  已学词判定:`);
        item.learnedWords.forEach(lw => {
          const lwKey = `${key}::${lw.word.toLowerCase()}`;
          const lwTouched = learnedTouchedMap.get(lwKey) === true;
          const lwCorrect = learnedCheckboxMap.get(lwKey) === true;
          learnedTotal++;
          if (lwTouched) {
            if (lwCorrect) learnedCorrectCount++;
            else learnedWrongCount++;
          }
          const lwResult = !lwTouched ? '—' : (lwCorrect ? '✓' : '✗');
          const sourceStr = lw.sources.map(s => `G${s.grade}W${s.week}`).join(', ');
          lines.push(`    ${lwResult} ${lw.word}  [来源: ${sourceStr}]`);
        });
      }
      lines.push('');
    });
  });

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const gradeStr = Array.from(selectedGrades).sort().join('-');
  const weekStr = Array.from(selectedWeeks).sort((a, b) => a - b).join('-');
  a.download = `Grade${gradeStr}_Week${weekStr}_听写结果.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  if (!isAuto) {
    updateStatusMessage('📥 下载成功！');
    setTimeout(() => updateStatusMessage(''), 2500);
  }
}

// =============================================================
// 事件绑定
// =============================================================
function updateStatusMessage(msg) {
  statusMsg.textContent = msg || '';
}

downloadBtn.addEventListener('click', () => downloadResults(false));
statsBtn.addEventListener('click', showStats);
statsClose.addEventListener('click', () => statsModal.classList.remove('show'));
statsModal.addEventListener('click', (e) => {
  if (e.target === statsModal) statsModal.classList.remove('show');
});
statsDownload.addEventListener('click', downloadStats);

clearAllBtn.addEventListener('click', () => {
  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    checkboxStateMap.set(key, false);
    touchedMap.set(key, false);
    item.learnedWords.forEach(lw => {
      const lwKey = `${key}::${lw.word.toLowerCase()}`;
      learnedCheckboxMap.set(lwKey, false);
      learnedTouchedMap.set(lwKey, false);
    });
  });

  document.querySelectorAll('.word-card').forEach(card => {
    card.classList.remove('correct');
    const cb = card.querySelector('.check-box');
    if (cb) cb.textContent = '';
    card.querySelectorAll('.learned-word-item').forEach(lwItem => {
      lwItem.classList.remove('correct', 'incorrect');
      const lwc = lwItem.querySelector('.learned-word-check');
      if (lwc) lwc.textContent = '';
    });
  });

  const groupKeys = new Set();
  displayItems.forEach(item => {
    groupKeys.add(`${item.grade}-${item.week}`);
  });
  groupKeys.forEach(gk => updateGroupProgressByKey(gk));
  updateStatusMessage('已清空所有勾选');
  setTimeout(() => updateStatusMessage(''), 1500);
});

// =============================================================
// 初始化入口（异步）
// =============================================================
async function init() {
  const success = await loadDataFromSupabase();
  if (success) {
    buildWordSourceIndex();
    renderGradeChips();
    renderWeekChips();
    rebuildDisplay();
  }
}

init();

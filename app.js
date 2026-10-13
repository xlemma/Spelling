// =============================================================
// 听写应用逻辑 (年级 & Week 动态联动下拉 + 动态加载版)
// =============================================================

const SUPABASE_URL = 'https://whqpuzxfheqwaniuqbbz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8eE1_U1jpk5G_tHcVtAjFg_Pz7lG9Q_';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 存储所有可用元数据：{ grade: [weeks...] }
let gradeWeekMap = {};

const AUTO_DOWNLOAD = true;

let displayItems = [];
let spellingData = {}; // 用于本地已学词统计索引

// 状态映射
const checkboxStateMap = new Map();
const touchedMap = new Map();
const learnedCheckboxMap = new Map();
const learnedTouchedMap = new Map();

let wordSourceIndex = new Map();

// ---------- DOM ----------
const gradeSelect = document.getElementById('gradeSelect');
const weekSelect = document.getElementById('weekSelect');
const wordsContainer = document.getElementById('wordsContainer');
const downloadBtn = document.getElementById('downloadBtn');
const submitBtn = document.getElementById('submitBtn');
const statsBtn = document.getElementById('statsBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const statusMsg = document.getElementById('statusMsg');

const statsModal = document.getElementById('statsModal');
const statsClose = document.getElementById('statsClose');
const statsBody = document.getElementById('statsBody');
const statsDownload = document.getElementById('statsDownload');

// =============================================================
// 1. 初始化：加载所有年级和 Week 的对应关系结构
// =============================================================
async function initMetadata() {
  try {
    updateStatusMessage('正在初始化菜单...');
    
    // 只拉取 grade 和 week 字段构建联动目录
    let allRows = [];
    let page = 0;
    let pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseClient
        .from('words')
        .select('grade, week')
        .order('grade', { ascending: true })
        .order('week', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;
      if (data && data.length > 0) {
        allRows = allRows.concat(data);
        if (data.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    gradeWeekMap = {};
    allRows.forEach(row => {
      const g = row.grade;
      const w = row.week;
      if (!gradeWeekMap[g]) gradeWeekMap[g] = new Set();
      gradeWeekMap[g].add(w);
    });

    // 转换为排序后的数组结构
    Object.keys(gradeWeekMap).forEach(g => {
      gradeWeekMap[g] = Array.from(gradeWeekMap[g]).sort((a, b) => a - b);
    });

    renderGradeOptions();
    updateStatusMessage('');
  } catch (err) {
    console.error('初始化菜单失败:', err);
    updateStatusMessage('❌ 初始化失败，请检查控制台');
  }
}

// 渲染年级下拉项
function renderGradeOptions() {
  gradeSelect.innerHTML = '<option value="">请选择年级</option>';
  const grades = Object.keys(gradeWeekMap).sort((a, b) => a - b);
  
  grades.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = `${g} 年级`;
    gradeSelect.appendChild(opt);
  });

  // 如果有年级，默认选中第一个
  if (grades.length > 0) {
    gradeSelect.value = grades[0];
    onGradeChange();
  }
}

// 年级改变时，动态更新 Week 下拉菜单
function onGradeChange() {
  const selectedGrade = gradeSelect.value;
  weekSelect.innerHTML = '<option value="">请选择 Week</option>';

  if (!selectedGrade || !gradeWeekMap[selectedGrade]) {
    weekSelect.disabled = true;
    return;
  }

  weekSelect.disabled = false;
  const weeks = gradeWeekMap[selectedGrade];

  weeks.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w;
    opt.textContent = `Week ${w}`;
    weekSelect.appendChild(opt);
  });

  // 默认选中第一个 Week 并加载数据
  if (weeks.length > 0) {
    weekSelect.value = weeks[0];
    loadWordsForCurrentSelection();
  }
}

// =============================================================
// 2. 根据当前选中的 Grade 和 Week 动态从数据库取单词
// =============================================================
async function loadWordsForCurrentSelection() {
  const grade = gradeSelect.value;
  const week = weekSelect.value;

  if (!grade || !week) {
    wordsContainer.innerHTML = '<div class="empty-state">请完整选择年级和 Week</div>';
    return;
  }

  try {
    updateStatusMessage(`正在加载 ${grade}年级 Week ${week} 单词...`);

    const { data, error } = await supabaseClient
      .from('words')
      .select('*')
      .eq('grade', grade)
      .eq('week', week)
      .order('id', { ascending: true });

    if (error) throw error;

    // 组装当前显示的单词项
    displayItems = data.map((row, idx) => ({
      id: row.id,
      grade: Number(grade),
      week: Number(week),
      wordIndex: idx,
      word: row.word,
      sentence: row.sentence,
      subtitle: `Week ${week} 练习`,
      learnedWords: [] // 稍后通过索引计算
    }));

    // 同时也为了已学词统计完整性，构建全局/轻量词汇索引
    await buildGlobalWordIndexForStats();

    // 计算例句中包含的已学词
    displayItems.forEach(item => {
      item.learnedWords = findLearnedWords(item.sentence);
    });

    // 初始化状态映射
    checkboxStateMap.clear();
    touchedMap.clear();
    learnedCheckboxMap.clear();
    learnedTouchedMap.clear();

    displayItems.forEach(item => {
      const key = `${item.grade}-${item.week}-${item.wordIndex}`;
      checkboxStateMap.set(key, 0);
      touchedMap.set(key, false);

      item.learnedWords.forEach(lw => {
        const lwKey = `${key}::${lw.word.toLowerCase()}`;
        learnedCheckboxMap.set(lwKey, false);
        learnedTouchedMap.set(lwKey, false);
      });
    });

    renderWords();
    updateStatusMessage('');
  } catch (err) {
    console.error('加载单词失败:', err);
    updateStatusMessage('❌ 加载单词失败');
  }
}

// 构建用于已学词匹配的词汇索引
async function buildGlobalWordIndexForStats() {
  const { data, error } = await supabaseClient
    .from('words')
    .select('grade, week, word');

  if (error) return;

  spellingData = {};
  wordSourceIndex = new Map();

  data.forEach(row => {
    const g = row.grade;
    const w = row.week;
    if (!spellingData[g]) spellingData[g] = {};
    if (!spellingData[g][w]) spellingData[g][w] = { words: [] };
    spellingData[g][w].words.push({ word: row.word });

    const token = row.word.toLowerCase().trim();
    if (!wordSourceIndex.has(token)) wordSourceIndex.set(token, []);
    wordSourceIndex.get(token).push({ grade: g, week: w });
  });
}

// =============================================================
// 例句分析
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
// 渲染单词列表与交互
// =============================================================
function renderWords() {
  if (displayItems.length === 0) {
    wordsContainer.innerHTML = '<div class="empty-state">当前选择没有单词</div>';
    return;
  }

  const grade = gradeSelect.value;
  const week = weekSelect.value;

  wordsContainer.innerHTML = '';
  const groupEl = document.createElement('div');
  groupEl.className = 'week-group';

  const header = document.createElement('div');
  header.className = 'group-header';

  const title = document.createElement('span');
  title.className = 'group-title';
  title.textContent = `${grade}年级 · Week ${week}`;

  const progress = document.createElement('span');
  progress.className = 'group-progress';
  progress.dataset.groupKey = `${grade}-${week}`;

  header.appendChild(title);
  header.appendChild(progress);
  groupEl.appendChild(header);

  const list = document.createElement('div');
  list.className = 'word-list';

  displayItems.forEach((item, idx) => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    const card = createWordCard(item, key);
    list.appendChild(card);
  });

  groupEl.appendChild(list);
  wordsContainer.appendChild(groupEl);

  updateGroupProgress(`${grade}-${week}`);
}

function createWordCard(item, key) {
  const card = document.createElement('div');
  card.className = 'word-card';
  card.dataset.key = key;

  const state = checkboxStateMap.get(key) || 0;
  if (state === 1) card.classList.add('correct');
  if (state === 2) card.classList.add('incorrect');

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

  // 已学词
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

      if (learnedTouchedMap.get(lwKey) === true) {
        if (learnedCheckboxMap.get(lwKey) === true) lwItem.classList.add('correct');
        else lwItem.classList.add('incorrect');
      }

      const textSpan = document.createElement('span');
      textSpan.className = 'learned-word-text';
      textSpan.textContent = lw.word;

      const sourceSpan = document.createElement('span');
      sourceSpan.className = 'learned-word-source';
      sourceSpan.textContent = lw.sources.slice(0, 2).map(s => `G${s.grade}W${s.week}`).join('·');

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

  // 目标单词状态按钮
  const checkWrapper = document.createElement('div');
  checkWrapper.className = 'check-wrapper';

  const label = document.createElement('label');
  label.textContent = '判定';

  const checkBox = document.createElement('div');
  checkBox.className = 'check-box';
  if (state === 1) checkBox.textContent = '✓';
  else if (state === 2) checkBox.textContent = '✗';
  else checkBox.textContent = '';

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

function toggleLearnedCheckbox(lwKey, element) {
  const touched = learnedTouchedMap.get(lwKey) === true;
  const isCorrect = learnedCheckboxMap.get(lwKey) === true;

  let newTouched, newCorrect;
  if (!touched) { newTouched = true; newCorrect = true; }
  else if (isCorrect) { newTouched = true; newCorrect = false; }
  else { newTouched = false; newCorrect = false; }

  learnedTouchedMap.set(lwKey, newTouched);
  learnedCheckboxMap.set(lwKey, newCorrect);

  element.classList.remove('correct', 'incorrect');
  const checkSpan = element.querySelector('.learned-word-check');
  if (!newTouched) checkSpan.textContent = '';
  else if (newCorrect) { element.classList.add('correct'); checkSpan.textContent = '✓'; }
  else { element.classList.add('incorrect'); checkSpan.textContent = '✗'; }

  checkAutoDownload();
}

function toggleCheckboxByKey(key) {
  let currentState = checkboxStateMap.get(key) || 0;
  let newState = (currentState + 1) % 3; // 0 -> 1 -> 2 -> 0
  
  checkboxStateMap.set(key, newState);
  touchedMap.set(key, newState !== 0);

  const card = document.querySelector(`.word-card[data-key="${key}"]`);
  if (card) {
    card.classList.remove('correct', 'incorrect');
    const checkBox = card.querySelector('.check-box');
    if (newState === 1) { card.classList.add('correct'); checkBox.textContent = '✓'; }
    else if (newState === 2) { card.classList.add('incorrect'); checkBox.textContent = '✗'; }
    else { checkBox.textContent = ''; }
  }

  const grade = gradeSelect.value;
  const week = weekSelect.value;
  updateGroupProgress(`${grade}-${week}`);
  checkAutoDownload();
}

function updateGroupProgress(groupKey) {
  const total = displayItems.length;
  let correct = 0;
  let touched = 0;
  displayItems.forEach(item => {
    const k = `${item.grade}-${item.week}-${item.wordIndex}`;
    const state = checkboxStateMap.get(k) || 0;
    if (state === 1) correct++;
    if (state !== 0) touched++;
  });
  const progressEl = document.querySelector(`.group-progress[data-group-key="${groupKey}"]`);
  if (progressEl) {
    progressEl.textContent = `✓${correct}/${total} · 已判定${touched}/${total}`;
  }
}

// =============================================================
// Supabase 统计提交
// =============================================================
async function submitResultsToSupabase() {
  const testedIds = [];
  const correctIds = [];

  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    const state = checkboxStateMap.get(key) || 0;
    if (state !== 0 && item.id) {
      testedIds.push(item.id);
      if (state === 1) correctIds.push(item.id);
    }
  });

  if (testedIds.length === 0) return;

  try {
    const { error } = await supabaseClient.rpc('update_word_stats', {
      p_tested_ids: testedIds,
      p_correct_ids: correctIds
    });
    if (error) throw error;
    console.log(`✅ 统计数据已同步：测试 ${testedIds.length} 词，正确 ${correctIds.length} 词。`);
  } catch (err) {
    console.error('❌ 同步统计到 Supabase 失败:', err);
  }
}

// 自动下载判定
function checkAutoDownload() {
  if (!AUTO_DOWNLOAD) return;
  const allTargetTouched = displayItems.every(item => {
    const k = `${item.grade}-${item.week}-${item.wordIndex}`;
    return touchedMap.get(k) === true;
  });
  const allLearnedTouched = Array.from(learnedTouchedMap.keys()).every(k => learnedTouchedMap.get(k) === true);
  
  if (allTargetTouched && allLearnedTouched && displayItems.length > 0) {
    downloadResults(true);
    updateStatusMessage('✅ 全部判定完成，已自动下载并同步！');
  }
}

// =============================================================
// 事件绑定
// =============================================================
if (gradeSelect) gradeSelect.addEventListener('change', onGradeChange);
if (weekSelect) weekSelect.addEventListener('change', loadWordsForCurrentSelection);
if (downloadBtn) downloadBtn.addEventListener('click', () => downloadResults(false));

if (submitBtn) {
  submitBtn.addEventListener('click', async () => {
    await submitResultsToSupabase();
    updateStatusMessage('✅ 进度已成功提交至 Supabase 数据库！');
    setTimeout(() => updateStatusMessage(''), 2500);
  });
}

if (statsBtn) statsBtn.addEventListener('click', () => { if (statsModal) statsModal.classList.add('show'); });
if (statsClose) statsClose.addEventListener('click', () => { if (statsModal) statsModal.classList.remove('show'); });
if (statsModal) {
  statsModal.addEventListener('click', (e) => {
    if (e.target === statsModal) statsModal.classList.remove('show');
  });
}
if (statsDownload) statsDownload.addEventListener('click', downloadStats);

if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
    displayItems.forEach(item => {
      const key = `${item.grade}-${item.week}-${item.wordIndex}`;
      checkboxStateMap.set(key, 0);
      touchedMap.set(key, false);
    });
    renderWords();
    updateStatusMessage('已清空所有勾选');
    setTimeout(() => updateStatusMessage(''), 1500);
  });
}
gradeSelect.addEventListener('change', () => {
  onGradeChange();
});

weekSelect.addEventListener('change', () => {
  loadWordsForCurrentSelection();
});

downloadBtn.addEventListener('click', () => downloadResults(false));

submitBtn.addEventListener('click', async () => {
  await submitResultsToSupabase();
  updateStatusMessage('✅ 进度已成功提交至 Supabase 数据库！');
  setTimeout(() => updateStatusMessage(''), 2500);
});

statsBtn.addEventListener('click', () => {
  // 统计弹窗逻辑保持
  statsModal.classList.add('show');
});
statsClose.addEventListener('click', () => statsModal.classList.remove('show'));
statsModal.addEventListener('click', (e) => { if (e.target === statsModal) statsModal.classList.remove('show'); });

clearAllBtn.addEventListener('click', () => {
  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    checkboxStateMap.set(key, 0);
    touchedMap.set(key, false);
  });
  renderWords();
  updateStatusMessage('已清空所有勾选');
  setTimeout(() => updateStatusMessage(''), 1500);
});

function updateStatusMessage(msg) {
  statusMsg.textContent = msg || '';
}

function downloadResults(isAuto = false) {
  if (displayItems.length === 0) return;
  submitResultsToSupabase();
  
  const grade = gradeSelect.value;
  const week = weekSelect.value;
  const lines = [`听写结果 - Grade ${grade} Week ${week}`, `生成时间: ${new Date().toLocaleString()}`, '========================================'];
  
  displayItems.forEach(item => {
    const key = `${item.grade}-${item.week}-${item.wordIndex}`;
    const state = checkboxStateMap.get(key) || 0;
    const res = state === 1 ? '✓ 正确' : (state === 2 ? '✗ 错误' : '— 未判');
    lines.push(`【${item.word}】 ${res}`);
    lines.push(`  例句: ${item.sentence}\n`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Grade${grade}_Week${week}_听写结果.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// 启动入口
initMetadata();

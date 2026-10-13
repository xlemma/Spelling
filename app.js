// =============================================================
// 听写应用逻辑 (年级 Week 动态联动 + 单字分页 + 30秒自动提交 + Excel 导出)
// =============================================================

const SUPABASE_URL = 'https://whqpuzxfheqwaniuqbbz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8eE1_U1jpk5G_tHcVtAjFg_Pz7lG9Q_';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let gradeWeekMap = {};
const AUTO_DOWNLOAD = true;

let displayItems = [];
let spellingData = {}; 
let isWrongWordsView = false;
let currentWordIndex = 0; // 单字分页索引

// 状态映射
const checkboxStateMap = new Map();
const touchedMap = new Map();
const learnedCheckboxMap = new Map();
const learnedTouchedMap = new Map();
let wordSourceIndex = new Map();

// ---------- DOM 元素安全获取 ----------
const gradeSelect = document.getElementById('gradeSelect');
const weekSelect = document.getElementById('weekSelect');
const wordsContainer = document.getElementById('wordsContainer');
const downloadBtn = document.getElementById('downloadBtn');
const submitBtn = document.getElementById('submitBtn');
const statsBtn = document.getElementById('statsBtn');
const clearAllBtn = document.getElementById('clearAllBtn');
const wrongWordsBtn = document.getElementById('wrongWordsBtn');
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

function renderGradeOptions() {
  if (!gradeSelect) return;
  gradeSelect.innerHTML = '<option value="">请选择年级</option>';
  const grades = Object.keys(gradeWeekMap).sort((a, b) => a - b);
  
  grades.forEach(g => {
    const opt = document.createElement('option');
    opt.value = g;
    opt.textContent = `${g} 年级`;
    gradeSelect.appendChild(opt);
  });

  if (grades.length > 0) {
    gradeSelect.value = grades[0];
    onGradeChange();
  }
}

function onGradeChange() {
  if (!weekSelect || !gradeSelect) return;
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

  if (weeks.length > 0) {
    weekSelect.value = weeks[0];
    isWrongWordsView = false;
    currentWordIndex = 0;
    loadWordsForCurrentSelection();
  }
}

// =============================================================
// 2. 动态加载单词
// =============================================================
async function loadWordsForCurrentSelection() {
  if (!gradeSelect || !weekSelect) return;
  const grade = gradeSelect.value;
  const week = weekSelect.value;

  if (!grade || !week) return;

  currentWordIndex = 0;

  try {
    updateStatusMessage(`正在加载 ${grade}年级 Week ${week} 单词...`);

    const { data, error } = await supabaseClient
      .from('words')
      .select('*')
      .eq('grade', grade)
      .eq('week', week)
      .order('id', { ascending: true });

    if (error) throw error;

    displayItems = data.map((row, idx) => ({
      id: row.id,
      grade: Number(grade),
      week: Number(week),
      wordIndex: idx,
      word: row.word,
      sentence: row.sentence,
      subtitle: `Week ${week} 练习`,
      learnedWords: []
    }));

    await buildGlobalWordIndexForStats();

    displayItems.forEach(item => {
      item.learnedWords = findLearnedWords(item.sentence);
    });

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

// =============================================================
// 3. 错词本视图
// =============================================================
async function showWrongWordsList() {
  try {
    updateStatusMessage('正在获取错词本...');
    isWrongWordsView = true;
    currentWordIndex = 0;

    let allWrongWords = [];
    let page = 0;
    let pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseClient
        .from('words')
        .select('*')
        .gt('test_time', 0)
        .order('grade', { ascending: true })
        .order('week', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        const wrongs = data.filter(row => (row.correct_time || 0) < (row.test_time || 0));
        allWrongWords = allWrongWords.concat(wrongs);

        if (data.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    updateStatusMessage('');

    if (allWrongWords.length === 0) {
      wordsContainer.innerHTML = '<div class="empty-state">🎉 太棒了！目前没有错词记录。</div>';
      return;
    }

    displayItems = allWrongWords.map((row, idx) => ({
      id: row.id,
      grade: row.grade,
      week: row.week,
      wordIndex: idx,
      word: row.word,
      sentence: row.sentence,
      subtitle: `G${row.grade} W${row.week} (错 ${(row.test_time || 0) - (row.correct_time || 0)}次)`,
      learnedWords: []
    }));

    await buildGlobalWordIndexForStats();

    displayItems.forEach(item => {
      item.learnedWords = findLearnedWords(item.sentence);
    });

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
  } catch (err) {
    console.error('获取错词失败:', err);
    updateStatusMessage('❌ 获取错词失败');
  }
}

async function buildGlobalWordIndexForStats() {
  let allRows = [];
  let page = 0;
  let pageSize = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabaseClient
      .from('words')
      .select('id, grade, week, word')
      .range(page * pageSize, (page + 1) * pageSize - 1);

    if (error) return;
    if (data && data.length > 0) {
      allRows = allRows.concat(data);
      if (data.length < pageSize) hasMore = false;
      else page++;
    } else {
      hasMore = false;
    }
  }

  spellingData = {};
  wordSourceIndex = new Map();

  allRows.forEach(row => {
    const g = row.grade;
    const w = row.week;
    if (!spellingData[g]) spellingData[g] = {};
    if (!spellingData[g][w]) spellingData[g][w] = { words: [] };
    spellingData[g][w].words.push({ id: row.id, word: row.word });

    const token = row.word.toLowerCase().trim();
    if (!wordSourceIndex.has(token)) wordSourceIndex.set(token, []);
    wordSourceIndex.get(token).push({ id: row.id, grade: g, week: w });
  });
}

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
// 4. 单字分页渲染
// =============================================================
function renderWords() {
  if (!wordsContainer) return;
  if (displayItems.length === 0) {
    wordsContainer.innerHTML = '<div class="empty-state">当前没有单词</div>';
    return;
  }

  if (currentWordIndex >= displayItems.length) currentWordIndex = displayItems.length - 1;
  if (currentWordIndex < 0) currentWordIndex = 0;

  const item = displayItems[currentWordIndex];
  const key = `${item.grade}-${item.week}-${item.wordIndex}`;

  wordsContainer.innerHTML = '';
  const groupEl = document.createElement('div');
  groupEl.className = 'week-group';

  const header = document.createElement('div');
  header.className = 'group-header';

  const title = document.createElement('span');
  title.className = 'group-title';

  const progress = document.createElement('span');
  progress.className = 'group-progress';

  if (isWrongWordsView) {
    title.textContent = '⚠️ 错题本';
    progress.textContent = `第 ${currentWordIndex + 1} / ${displayItems.length} 个`;
  } else {
    const grade = gradeSelect.value;
    const week = weekSelect.value;
    title.textContent = `${grade}年级 · Week ${week}`;
    progress.textContent = `第 ${currentWordIndex + 1} / ${displayItems.length} 个`;
  }

  header.appendChild(title);
  header.appendChild(progress);
  groupEl.appendChild(header);

  const list = document.createElement('div');
  list.className = 'word-list';
  const card = createWordCard(item, key);
  list.appendChild(card);
  groupEl.appendChild(list);

  // 翻页导航栏
  const navContainer = document.createElement('div');
  navContainer.style.cssText = 'display: flex; gap: 10px; margin-top: 14px; width: 100%;';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'btn';
  prevBtn.textContent = '⬅️ 上一个';
  prevBtn.disabled = currentWordIndex === 0;
  prevBtn.style.opacity = currentWordIndex === 0 ? '0.5' : '1';
  prevBtn.addEventListener('click', () => {
    if (currentWordIndex > 0) {
      currentWordIndex--;
      renderWords();
    }
  });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'btn btn-primary';
  nextBtn.textContent = '下一个 ➡️';
  nextBtn.disabled = currentWordIndex === displayItems.length - 1;
  nextBtn.style.opacity = currentWordIndex === displayItems.length - 1 ? '0.5' : '1';
  nextBtn.addEventListener('click', () => {
    if (currentWordIndex < displayItems.length - 1) {
      currentWordIndex++;
      renderWords();
    }
  });

  prevBtn.style.flex = '1';
  nextBtn.style.flex = '1';
  navContainer.appendChild(prevBtn);
  navContainer.appendChild(nextBtn);
  groupEl.appendChild(navContainer);

  wordsContainer.appendChild(groupEl);
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

  if (isWrongWordsView && item.subtitle) {
    const subSpan = document.createElement('span');
    subSpan.style.cssText = 'font-size: 0.75rem; color: #c62828; font-weight: 600;';
    subSpan.textContent = `来源: ${item.subtitle}`;
    mainDiv.appendChild(subSpan);
  }

  mainDiv.appendChild(wordSpan);
  mainDiv.appendChild(sentenceSpan);

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
  let newState = (currentState + 1) % 3;
  
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

  checkAutoDownload();
}

// =============================================================
// 5. 数据库同步与自动提交
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

    if (item.learnedWords && item.learnedWords.length > 0) {
      item.learnedWords.forEach(lw => {
        const lwKey = `${key}::${lw.word.toLowerCase()}`;
        const isTouched = learnedTouchedMap.get(lwKey) === true;
        const isCorrect = learnedCheckboxMap.get(lwKey) === true;

        if (isTouched && lw.sources && lw.sources.length > 0) {
          lw.sources.forEach(source => {
            if (source.id) {
              testedIds.push(source.id);
              if (isCorrect) correctIds.push(source.id);
            }
          });
        }
      });
    }
  });

  if (testedIds.length === 0) return;

  try {
    const { error } = await supabaseClient.rpc('update_word_stats', {
      p_tested_ids: testedIds,
      p_correct_ids: correctIds
    });
    if (error) throw error;
  } catch (err) {
    console.error('❌ 同步统计到 Supabase 失败:', err);
  }
}

// 每半分钟（30秒）自动提交一次进度
setInterval(async () => {
  if (displayItems && displayItems.length > 0) {
    try {
      await submitResultsToSupabase();
      updateStatusMessage('⚡ 进度已自动同步至数据库');
      setTimeout(() => {
        if (statusMsg && statusMsg.textContent.includes('自动同步')) {
          updateStatusMessage('');
        }
      }, 3000);
    } catch (err) {
      console.error('自动提交失败:', err);
    }
  }
}, 30 * 1000);

function checkAutoDownload() {
  if (!AUTO_DOWNLOAD) return;
  const allTargetTouched = displayItems.every(item => {
    const k = `${item.grade}-${item.week}-${item.wordIndex}`;
    return touchedMap.get(k) === true;
  });
  const allLearnedTouched = Array.from(learnedTouchedMap.keys()).every(k => learnedTouchedMap.get(k) === true);
  
  if (allTargetTouched && allLearnedTouched && displayItems.length > 0) {
    submitResultsToSupabase();
    updateStatusMessage('✅ 本组全部判定完成，已同步！');
  }
}

// =============================================================
// 6. 导出 Excel（下载所有测试过的单词）
// =============================================================
async function downloadResults() {
  try {
    updateStatusMessage('正在从数据库获取所有已学单词数据...');
    
    let allTestedWords = [];
    let page = 0;
    let pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabaseClient
        .from('words')
        .select('*')
        .gt('test_time', 0)
        .order('grade', { ascending: true })
        .order('week', { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (error) throw error;

      if (data && data.length > 0) {
        allTestedWords = allTestedWords.concat(data);
        if (data.length < pageSize) hasMore = false;
        else page++;
      } else {
        hasMore = false;
      }
    }

    updateStatusMessage('');

    if (allTestedWords.length === 0) {
      updateStatusMessage('没有找到任何已测试过的单词记录');
      setTimeout(() => updateStatusMessage(''), 2500);
      return;
    }

    const excelData = allTestedWords.map((item, index) => {
      const testTime = item.test_time || 0;
      const correctTime = item.correct_time || 0;
      const wrongTime = testTime - correctTime;

      return {
        "序号": index + 1,
        "年级": item.grade,
        "Week": item.week,
        "单词": item.word,
        "例句": item.sentence,
        "测试次数": testTime,
        "正确次数": correctTime,
        "错误次数": wrongTime
      };
    });

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "已学单词统计");

    worksheet['!cols'] = [
      {wch: 6}, {wch: 6}, {wch: 8}, {wch: 15}, {wch: 45}, {wch: 10}, {wch: 10}, {wch: 10}
    ];

    const fileName = `已学单词统计报告_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    updateStatusMessage('📥 Excel 表格下载成功！');
    setTimeout(() => updateStatusMessage(''), 2500);

  } catch (err) {
    console.error('导出 Excel 失败:', err);
    updateStatusMessage('❌ 导出 Excel 失败');
  }
}

// =============================================================
// 事件绑定
// =============================================================
if (gradeSelect) gradeSelect.addEventListener('change', onGradeChange);
if (weekSelect) weekSelect.addEventListener('change', () => {
  isWrongWordsView = false;
  loadWordsForCurrentSelection();
});

if (wrongWordsBtn) wrongWordsBtn.addEventListener('click', showWrongWordsList);
if (downloadBtn) downloadBtn.addEventListener('click', downloadResults);

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

if (clearAllBtn) {
  clearAllBtn.addEventListener('click', () => {
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
    updateStatusMessage('已清空当前勾选');
    setTimeout(() => updateStatusMessage(''), 1500);
  });
}

function updateStatusMessage(msg) {
  if (statusMsg) statusMsg.textContent = msg || '';
}

// 启动入口
initMetadata();

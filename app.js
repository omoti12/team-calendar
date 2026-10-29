// 現場管理: 合言葉を入れるとクラウド（cloud.js）に保存してチームで共有する。
// クラウドが使えない環境（ファイルを直接開いた時など）は、この端末のブラウザ (localStorage) に保存
const STORAGE_KEY = 'genba-kanri-v1';

// 地域ごとの項目セット（現場を作る時に選ぶ）
const TEMPLATES = {
  'さいたま市': [
    '申請・日程決め',
    'ダンプ',
    'カッター',
    '警備',
    '道路占用 受取',
    '道路使用 提出',
    'PR',
    '道路使用 受取',
    '事前打合せ',
    'メーター受取',
  ],
  '川口市': [
    '事前打合せ',
    '預かり',
    '申請',
    '道路使用 受取',
    '道路使用 提出',
    '道路使用 受取',
    '日程決め',
    'PR',
    'ダンプ',
    '警備',
    'カッター',
  ],
  '東京都': [
    '申請',
    '道路占用 受取',
    '日程決め',
    'ダンプ',
    '警備',
    'カッター',
    '道路使用 提出',
    '道路使用 受取',
    'PR',
  ],
  'なし（自分で追加）': [],
};

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// 以前の項目名 → 今の項目名（1行を複数行に分けたもの、[] は削除した項目）
const RENAMED_TASKS = {
  '申請・施工日日程決め（カッター・ダンプ・ケイビ）': ['カッター', 'ダンプ', '警備'],
  '申請・施工日日程決め（カッター）': ['カッター'],
  '申請・施工日日程決め（ダンプ）': ['ダンプ'],
  '申請・施工日日程決め（警備）': ['警備'],
};

// 'cloud'（チームで共有）か 'local'（この端末だけ）
let mode = 'local';
let state = load();
let currentId = null;
let filter = 'all';

function migrate(data) {
  for (const site of data.sites) {
    site.tasks = site.tasks.flatMap((t) =>
      RENAMED_TASKS[t.title] ? RENAMED_TASKS[t.title].map((title) => ({ ...t, id: uid(), title })) : [t]);
  }
  return data;
}

// 台数・人数欄のヒント（警備は人、カッター・ダンプは台）
function qtyHint(title) {
  if (/警備|ケイビ|ガードマン/.test(title)) return '人';
  if (/カッター|ダンプ|重機|車/.test(title)) return '台';
  return '';
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.sites)) return migrate(data);
  } catch (e) { /* 読めなければ空で開始 */ }
  return { sites: [] };
}

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    notify('保存できませんでした: ' + e.message);
  }
}

// ブラウザ標準の confirm/alert が使えない環境もあるので自前の確認ダイアログ
function ask(message, okLabel = 'OK', cancel = true) {
  return new Promise((resolve) => {
    $('dialogMsg').textContent = message;
    $('dialogOk').textContent = okLabel;
    $('dialogOk').classList.toggle('is-danger', okLabel === '削除');
    $('dialogCancel').hidden = !cancel;
    $('dialog').hidden = false;
    $('dialogOk').focus();
    const done = (v) => {
      $('dialog').hidden = true;
      $('dialogOk').onclick = $('dialogCancel').onclick = null;
      resolve(v);
    };
    $('dialogOk').onclick = () => done(true);
    $('dialogCancel').onclick = () => done(false);
  });
}
const notify = (message) => ask(message, 'OK', false);

// 画面の真ん中に大きく出して、少ししたら消えるお知らせ（タップでもすぐ消える）
let toastTimer;
function toast(title, text = '', kind = 'done') {
  $('toastTitle').textContent = title;
  $('toastText').textContent = text;
  $('toastText').hidden = !text;
  $('toast').dataset.kind = kind;
  $('toast').hidden = false;
  $('toast').classList.remove('is-show');
  void $('toast').offsetWidth; // アニメーションを毎回最初から
  $('toast').classList.add('is-show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2000);
}
$('toast').addEventListener('click', () => { $('toast').hidden = true; });

function cheerDone(site, task) {
  if (isAllDone(site)) toast('全部完了です！', `「${site.name}」お疲れ様でした`, 'done');
  else toast('お疲れ様です！', `「${task.title || '項目'}」を完了にしました`, 'done');
}

// 担当者名はこの端末に覚えておき、次に現場を作る時に最初から入れておく
const OWNER_KEY = 'genba-kanri-owner';
const lastOwner = () => { try { return localStorage.getItem(OWNER_KEY) || ''; } catch (e) { return ''; } };
const rememberOwner = (name) => { try { localStorage.setItem(OWNER_KEY, name); } catch (e) { /* 覚えられなくても困らない */ } };

function newSite(name, area, owner = '') {
  return {
    id: uid(),
    name,
    owner,
    area: area in TEMPLATES && TEMPLATES[area].length ? area : '',
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: (TEMPLATES[area] || []).map((title) => ({ id: uid(), title, date: '', qty: '', doneDate: '', note: '', done: false })),
  };
}

// 1現場分の変更を保存する
function persistSite(site, immediate = false) {
  if (mode === 'cloud') Cloud.saveSite(site, immediate);
  else save();
}

function removeSite(id) {
  state.sites = state.sites.filter((s) => s.id !== id);
  if (mode === 'cloud') Cloud.deleteSite(id).catch(() => {});
  else save();
}

function touch(site) {
  site.updatedAt = new Date().toISOString();
  persistSite(site);
  showSaveStatus('自動保存済み', false);
}

let saveStatusTimer;
function showSaveStatus(text, highlight) {
  const el = $('saveStatus');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-saved', highlight);
  clearTimeout(saveStatusTimer);
  if (highlight) saveStatusTimer = setTimeout(() => showSaveStatus('', false), 2500);
}

const getSite = (id) => state.sites.find((s) => s.id === id);
const doneCount = (site) => site.tasks.filter((t) => t.done).length;
const isAllDone = (site) => site.tasks.length > 0 && doneCount(site) === site.tasks.length;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 期限チェック: 期限の1週間前になっても未完了なら警告
const WARN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysUntil(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((Date.UTC(y, m - 1, d) - today) / DAY_MS);
}

// null（問題なし） / { level: 'soon' | 'overdue', days, label }
function taskAlert(task) {
  if (task.done || !task.date) return null;
  const days = daysUntil(task.date);
  if (days > WARN_DAYS) return null;
  if (days < 0) return { level: 'overdue', days, label: `期限切れ（${-days}日過ぎ）` };
  if (days === 0) return { level: 'soon', days, label: '今日が期限' };
  return { level: 'soon', days, label: `期限まであと${days}日` };
}

const siteAlerts = (site) => site.tasks.map(taskAlert).filter(Boolean);

function workDateLabel(site) {
  if (!site.workDate) return '';
  const days = daysUntil(site.workDate);
  const rel = days > 0 ? `あと${days}日` : days === 0 ? '今日' : '実施済み';
  return `${formatDate(site.workDate)}（${rel}）`;
}

// 次にやる（未完了で一番上の）項目
function nextTask(site) {
  return site.tasks.find((t) => !t.done);
}

/* ---------- 一覧 ---------- */
function renderList() {
  const q = $('searchInput').value.trim().toLowerCase();
  const list = $('siteList');
  list.innerHTML = '';

  const sites = state.sites
    .filter((s) => [s.name, s.area, s.owner].join(' ').toLowerCase().includes(q))
    .filter((s) => filter === 'all'
      || (filter === 'warn' ? siteAlerts(s).length > 0 : filter === 'done' ? isAllDone(s) : !isAllDone(s)))
    // 警告のある現場を上に、その中は更新が新しい順
    .sort((a, b) => (siteAlerts(b).length > 0) - (siteAlerts(a).length > 0) || b.updatedAt.localeCompare(a.updatedAt));

  for (const site of sites) {
    const li = document.createElement('li');
    const done = isAllDone(site);
    const next = nextTask(site);
    const total = site.tasks.length;
    const alerts = siteAlerts(site);
    const overdue = alerts.some((a) => a.level === 'overdue');
    li.className = 'folder' + (done ? ' is-done' : '') + (alerts.length ? ' is-warn' : '');
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="folder-tab">${alerts.length
        ? `⚠️ ${overdue ? '期限切れ' : '期限間近'} ${alerts.length}件`
        : done ? '✓ 完了' : '未完了'}</div>
      <div class="folder-body">
        <div class="area"></div>
        <div class="name"></div>
        <div class="owner"></div>
        <div class="work"></div>
        <div class="sub"></div>
        <div class="folder-foot">
          <div class="bar"><span style="width:${total ? (doneCount(site) / total) * 100 : 0}%"></span></div>
          <span class="count">${doneCount(site)}/${total}</span>
        </div>
      </div>`;
    li.querySelector('.name').textContent = site.name;
    li.querySelector('.area').textContent = site.area || '';
    li.querySelector('.area').hidden = !site.area;
    li.querySelector('.owner').textContent = site.owner ? '担当：' + site.owner : '担当：未入力';
    li.querySelector('.owner').classList.toggle('is-unset', !site.owner);
    li.querySelector('.work').textContent = site.workDate ? '工事 ' + workDateLabel(site) : '工事実行日 未定';
    li.querySelector('.work').classList.toggle('is-unset', !site.workDate);
    li.querySelector('.sub').textContent = !total ? '項目なし'
      : done ? 'すべて完了'
      : `次: ${next.title}${next.date ? '（期限 ' + formatDate(next.date) + '）' : ''}`;
    li.addEventListener('click', () => openSite(site.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSite(site.id); });
    list.appendChild(li);
  }

  $('countText').textContent = `${sites.length} 件`;

  const empty = $('emptyMsg');
  if (!$('cloudLoading').hidden) {
    empty.hidden = true;
  } else if (state.sites.length === 0) {
    empty.textContent = 'まだ現場がありません。上の欄に現場名を入れて「追加」を押してください。';
    empty.hidden = false;
  } else if (sites.length === 0) {
    empty.textContent = '該当する現場がありません。';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
}

/* ---------- 詳細 ---------- */
function openSite(id) {
  currentId = id;
  location.hash = id;
  showDetail();
}

function showList() {
  if (mode === 'cloud') Cloud.flush().catch(() => {});
  if (typeof SiteDocs !== 'undefined') SiteDocs.close();
  currentId = null;
  history.replaceState(null, '', location.pathname);
  $('detailView').hidden = true;
  $('listView').hidden = false;
  $('crumbSep').hidden = true;
  $('pageTitle').hidden = true;
  renderList();
}

function showDetail(keepScroll = false) {
  const site = getSite(currentId);
  if (!site) return showList();
  showSaveStatus('', false);
  $('listView').hidden = true;
  $('detailView').hidden = false;
  $('crumbSep').hidden = false;
  $('pageTitle').hidden = false;
  $('pageTitle').textContent = site.name;
  $('siteNameInput').value = site.name;
  $('ownerInput').value = site.owner || '';
  $('siteArea').textContent = site.area || '';
  $('siteArea').hidden = !site.area;
  $('siteNotes').value = site.notes || '';
  $('workDateInput').value = site.workDate || '';
  renderWorkDate(site);
  renderTasks(site);
  if (typeof SiteDocs !== 'undefined') SiteDocs.open(site);
  if (!keepScroll) window.scrollTo(0, 0);
}

function renderWorkDate(site) {
  const days = site.workDate ? daysUntil(site.workDate) : null;
  $('workDateLeft').textContent = days === null ? '未定' : days > 0 ? `あと${days}日` : days === 0 ? '今日' : '実施済み';
}

function renderProgress(site) {
  const total = site.tasks.length;
  const done = doneCount(site);
  $('progressBar').style.width = total ? (done / total) * 100 + '%' : '0';
  $('progressText').textContent = `${done} / ${total} 完了`;

  const alerts = siteAlerts(site);
  const overdue = alerts.filter((a) => a.level === 'overdue').length;
  $('alertBanner').hidden = alerts.length === 0;
  $('alertBanner').textContent = overdue
    ? `⚠️ 期限切れの項目が ${overdue} 件${alerts.length > overdue ? `、期限間近が ${alerts.length - overdue} 件` : ''}あります`
    : `⚠️ 期限まで1週間を切った未完了の項目が ${alerts.length} 件あります`;
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function renderTasks(site) {
  const body = $('taskBody');
  body.innerHTML = '';
  const tpl = $('taskRow');

  site.tasks.forEach((task) => {
    const row = tpl.content.firstElementChild.cloneNode(true);
    const title = row.querySelector('.task-title');
    const note = row.querySelector('.task-note');
    const date = row.querySelector('.task-date');
    const qty = row.querySelector('.task-qty');
    const doneDate = row.querySelector('.task-done-date');
    const status = row.querySelector('.status-btn');

    title.value = task.title;
    note.value = task.note || '';
    date.value = task.date || '';
    qty.value = task.qty || '';
    doneDate.value = task.doneDate || '';
    const paintQtyHint = () => { qty.placeholder = qtyHint(title.value); };
    paintQtyHint();

    const warn = row.querySelector('.task-warn');
    const paintStatus = () => {
      status.textContent = task.done ? '✓ 完了' : '未完了';
      status.className = 'status-btn ' + (task.done ? 'done' : 'open');
      row.classList.toggle('is-done', task.done);
      const alert = taskAlert(task);
      row.classList.toggle('is-warn', !!alert);
      row.classList.toggle('is-overdue', alert?.level === 'overdue');
      warn.hidden = !alert;
      warn.textContent = alert ? '⚠️ ' + alert.label : '';
    };
    paintStatus();

    title.addEventListener('input', () => { task.title = title.value; autoGrow(title); paintQtyHint(); touch(site); });
    qty.addEventListener('input', () => { task.qty = qty.value; touch(site); });
    note.addEventListener('input', () => { task.note = note.value; touch(site); });
    date.addEventListener('change', () => { task.date = date.value; paintStatus(); renderProgress(site); touch(site); });
    doneDate.addEventListener('change', () => {
      task.doneDate = doneDate.value;
      // 完了日を入れたら完了扱いにする
      const becameDone = doneDate.value && !task.done;
      if (becameDone) task.done = true;
      paintStatus();
      if (becameDone) cheerDone(site, task);
      renderProgress(site);
      touch(site);
    });
    status.addEventListener('click', () => {
      task.done = !task.done;
      // 完了にしたら今日の日付を完了日に入れる（あとで変更可）。未完了に戻したら消す
      task.doneDate = task.done ? (task.doneDate || todayISO()) : '';
      doneDate.value = task.doneDate;
      paintStatus();
      renderProgress(site);
      touch(site);
      if (task.done) cheerDone(site, task);
    });
    row.querySelector('.del-btn').addEventListener('click', async () => {
      if (task.title && !(await ask(`「${task.title}」を削除しますか？`, '削除'))) return;
      site.tasks = site.tasks.filter((t) => t !== task);
      touch(site);
      renderTasks(site);
    });

    body.appendChild(row);
    requestAnimationFrame(() => autoGrow(title));
  });

  renderProgress(site);
}

/* ---------- イベント ---------- */
$('searchInput').addEventListener('input', renderList);

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    filter = chip.dataset.filter;
    renderList();
  });
});

$('newSiteOwner').value = lastOwner();

$('templatePicker').innerHTML = Object.keys(TEMPLATES).map((area, i) => `
  <label class="template-option">
    <input type="radio" name="template" value="${area}"${i === 0 ? ' checked' : ''}>
    <span>${area}</span>
  </label>`).join('');

$('addSiteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('newSiteName').value.trim();
  if (!name) return;
  const area = document.querySelector('input[name="template"]:checked')?.value;
  const owner = $('newSiteOwner').value.trim();
  if (owner) rememberOwner(owner);
  const site = newSite(name, area, owner);
  state.sites.push(site);
  persistSite(site, true);
  $('newSiteName').value = '';
  openSite(site.id);
});

$('backBtn').addEventListener('click', showList);
$('backToListBtn').addEventListener('click', showList);

$('saveBtn').addEventListener('click', () => {
  const site = getSite(currentId);
  if (site) {
    site.updatedAt = new Date().toISOString();
    persistSite(site, true);
  }
  const offline = mode === 'cloud' && !navigator.onLine;
  showSaveStatus(offline ? '✓ 保存しました（電波が戻ったら送信）' : '✓ 保存しました', true);
  toast('保存しました', offline ? '電波が戻ったら、チームに送信します' : (mode === 'cloud' ? 'チームのみんなにも反映されます' : ''), 'save');
});

$('siteNameInput').addEventListener('input', (e) => {
  const site = getSite(currentId);
  site.name = e.target.value;
  $('pageTitle').textContent = site.name || '（無題）';
  touch(site);
});

$('ownerInput').addEventListener('input', (e) => {
  const site = getSite(currentId);
  site.owner = e.target.value;
  touch(site);
});

$('workDateInput').addEventListener('change', (e) => {
  const site = getSite(currentId);
  site.workDate = e.target.value;
  renderWorkDate(site);
  touch(site);
});

$('siteNotes').addEventListener('input', (e) => {
  const site = getSite(currentId);
  site.notes = e.target.value;
  touch(site);
});

$('addTaskBtn').addEventListener('click', () => {
  const site = getSite(currentId);
  site.tasks.push({ id: uid(), title: '', date: '', qty: '', doneDate: '', note: '', done: false });
  touch(site);
  renderTasks(site);
  const titles = document.querySelectorAll('#taskBody .task-title');
  titles[titles.length - 1].focus();
});

$('deleteSiteBtn').addEventListener('click', async () => {
  const site = getSite(currentId);
  if (!(await ask(`現場「${site.name}」を削除しますか？\n${mode === 'cloud' ? 'チーム全員の画面から消え、' : ''}元に戻せません。`, '削除'))) return;
  removeSite(site.id);
  showList();
});

/* メニュー */
$('menuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('menu').hidden = !$('menu').hidden;
});
document.addEventListener('click', (e) => {
  if (!$('menu').contains(e.target)) $('menu').hidden = true;
});

$('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `genba-kanri-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

$('importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.sites)) throw new Error('形式が違います');
    if (mode === 'cloud') {
      if (!(await ask(`${data.sites.length} 件の現場をチームのデータに追加します（同じ現場は上書き）。よろしいですか？`, '読み込む'))) return;
      for (const site of migrate(data).sites) {
        const i = state.sites.findIndex((s) => s.id === site.id);
        if (i === -1) state.sites.push(site); else state.sites[i] = site;
        persistSite(site, true);
      }
    } else {
      if (!(await ask(`${data.sites.length} 件の現場を読み込みます。今のデータは置き換わります。よろしいですか？`, '読み込む'))) return;
      state = migrate(data);
      save();
    }
    showList();
  } catch (err) {
    notify('読み込めませんでした: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

$('printBtn').addEventListener('click', () => {
  $('menu').hidden = true;
  window.print();
});

/* ホーム画面に追加（PWA） */
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
if (isStandalone()) $('installBtn').hidden = true;

$('installBtn').addEventListener('click', async () => {
  $('menu').hidden = true;
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  notify(ios
    ? 'Safari の下にある共有ボタン（□に↑）を押して、\n「ホーム画面に追加」を選んでください。'
    : 'ブラウザのメニュー（︙）から\n「ホーム画面に追加」または「アプリをインストール」を選んでください。');
});

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* 使えない環境ではそのまま動かす */ });
}

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && getSite(id)) { currentId = id; showDetail(); } else if (!id) showList();
});

/* ---------- クラウド共有 ---------- */
const cloudAvailable = () => typeof Cloud !== 'undefined' && Cloud.enabled;
let detailNeedsRefresh = false;

function showCloudStatus(status, err) {
  const el = $('syncStatus');
  if (!el) return;
  const labels = {
    synced: '● 共有中',
    saving: '⏳ 送信中…',
    offline: '📴 オフライン',
    error: '⚠️ クラウドに接続できません',
  };
  el.hidden = false;
  el.textContent = labels[status] || '';
  el.dataset.status = status;
  $('cloudError').hidden = status !== 'error';
  if (status === 'error') {
    const settingsProblem = err && /permission-denied|configuration-not-found|operation-not-allowed|admin-restricted|not-found|failed-precondition|unauthorized-domain/.test(err.code || '');
    $('cloudError').textContent = '⚠️ クラウドに接続できませんでした。' + (settingsProblem
      ? 'Firebase の設定（データベース・ルール）に問題がある可能性があります。'
      : '電波を確認して、もう一度開いてください。') + (err ? `（${err.code || err.message}）` : '');
  }
}

// 他の人の変更が届いた時に画面を更新する（入力中の欄は邪魔しない）
function applyRemoteSites(sites, changedByOthers) {
  state = migrate({ sites });
  $('cloudLoading').hidden = true;
  if (!$('listView').hidden) return renderList();
  if ($('detailView').hidden || !currentId) return;
  if (!getSite(currentId)) {
    notify('この現場は他の人が削除しました。');
    return showList();
  }
  if (!changedByOthers.includes(currentId)) return;
  const typing = $('detailView').contains(document.activeElement)
    && /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (typing) detailNeedsRefresh = true;
  else showDetail(true);
}

$('detailView').addEventListener('focusout', () => {
  setTimeout(() => {
    if (!detailNeedsRefresh || $('detailView').contains(document.activeElement)) return;
    detailNeedsRefresh = false;
    if (!$('detailView').hidden && currentId) showDetail(true);
  }, 0);
});

// アプリを閉じる・切り替える時は、待たせている変更をすぐ送る
const flushNow = () => { if (mode === 'cloud') Cloud.flush().catch(() => {}); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushNow(); });
window.addEventListener('pagehide', flushNow);

async function startCloud(teamId) {
  mode = 'cloud';
  state = { sites: [] };
  $('cloudLoading').hidden = false;
  try {
    await Cloud.start(teamId, applyRemoteSites, showCloudStatus);
  } catch (err) {
    $('cloudLoading').hidden = true;
    showCloudStatus('error', err);
  }
}

// この端末に残っている、クラウドに上げていないデータ
function localOnlySites() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return data && Array.isArray(data.sites) ? migrate(data).sites : [];
  } catch (e) { return []; }
}

async function offerUploadLocal() {
  const sites = localOnlySites();
  if (!sites.length) return;
  const ok = await ask(`このスマホに保存されている現場が ${sites.length} 件あります。\nチームのデータに移しますか？`, '移す');
  if (!ok) return;
  for (const site of sites) {
    if (!state.sites.some((s) => s.id === site.id)) state.sites.push(site);
    persistSite(site, true);
  }
  // 念のため元のデータは消さずに別名で残しておく
  try {
    localStorage.setItem(STORAGE_KEY + '-backup', localStorage.getItem(STORAGE_KEY));
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) { /* 残っていても次回また聞くだけ */ }
  renderList();
}

$('passForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('passInput').value.trim();
  if (code.length < 4) return notify('合言葉は4文字以上にしてください。');
  const teamId = await Cloud.teamIdFor(code);
  Cloud.setTeam(teamId);
  $('passInput').value = '';
  $('passView').hidden = true;
  document.querySelector('.app-header').hidden = false;
  await startCloud(teamId);
  startApp();
  await offerUploadLocal();
  refreshPushUI();
});

/* ---------- プッシュ通知（期限の2週間前のお昼） ---------- */
const PUSH_LATER_KEY = 'genba-kanri-push-later';
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const onIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const runningAsApp = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

// 通知の公開鍵（base64url）を、ブラウザが受け取れる形に変える
function base64UrlToBytes(text) {
  const b64 = (text + '='.repeat((4 - (text.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

async function pushSubscription() {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function refreshPushUI() {
  const btn = $('pushBtn');
  if (mode !== 'cloud' || !pushSupported()) {
    btn.hidden = true;
    $('pushBanner').hidden = true;
    return;
  }
  // 通知の送り役の準備ができるまでは出さない
  const key = await Cloud.pushPublicKey().catch(() => null);
  if (!key) {
    btn.hidden = true;
    $('pushBanner').hidden = true;
    return;
  }
  const sub = await pushSubscription().catch(() => null);
  const on = !!sub && Notification.permission === 'granted';
  btn.hidden = false;
  btn.textContent = on ? '通知をオフにする' : '通知をオンにする';
  let later = false;
  try { later = localStorage.getItem(PUSH_LATER_KEY) === '1'; } catch (e) { /* 読めなければ出す */ }
  $('pushBanner').hidden = on || later || Notification.permission === 'denied';
  // 開くたびに登録し直しておく（宛先が変わっても届くように）
  if (on) Cloud.saveDevice(sub).catch(() => {});
}

async function enablePush() {
  if (onIOS() && !runningAsApp()) {
    return notify('iPhone では、ホーム画面に追加したアプリから通知をオンにしてください。');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return notify('通知が許可されませんでした。\nスマホの設定で、このアプリ（またはブラウザ）の通知を許可してから、もう一度お試しください。');
  }
  try {
    const key = await Cloud.pushPublicKey();
    if (!key) return notify('通知の準備がまだ終わっていません。しばらくしてからもう一度お試しください。');
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(key) }));
    await Cloud.saveDevice(sub);
    notify('通知をオンにしました。\n期限の2週間前のお昼にお知らせします。');
  } catch (err) {
    notify('通知をオンにできませんでした。電波を確認して、もう一度お試しください。（' + (err.code || err.message) + '）');
  }
  refreshPushUI();
}

async function disablePush() {
  if (!(await ask('このスマホへの通知をオフにしますか？', 'オフにする'))) return;
  const sub = await pushSubscription().catch(() => null);
  if (sub) {
    await Cloud.deleteDevice(sub).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  refreshPushUI();
}

$('pushBtn').addEventListener('click', async () => {
  $('menu').hidden = true;
  const sub = await pushSubscription().catch(() => null);
  if (sub && Notification.permission === 'granted') disablePush();
  else enablePush();
});
$('pushBannerOn').addEventListener('click', enablePush);
$('pushBannerLater').addEventListener('click', () => {
  try { localStorage.setItem(PUSH_LATER_KEY, '1'); } catch (e) { /* 次回また出るだけ */ }
  $('pushBanner').hidden = true;
});

$('logoutBtn').addEventListener('click', async () => {
  $('menu').hidden = true;
  if (!(await ask('合言葉を入れ直しますか？\n（データはクラウドに残ります）', '入れ直す'))) return;
  await Cloud.flush().catch(() => {});
  // 前のチームの通知は止める
  const sub = await pushSubscription().catch(() => null);
  if (sub) await Cloud.deleteDevice(sub).catch(() => {});
  Cloud.setTeam(null);
  location.reload();
});

/* 起動 */
function startApp() {
  const initial = location.hash.slice(1);
  if (initial && getSite(initial)) { currentId = initial; showDetail(); } else showList();
}

async function boot() {
  if (typeof SiteDocs !== 'undefined') SiteDocs.init();
  if (!cloudAvailable()) {
    $('logoutBtn').hidden = true;
    $('pushBtn').hidden = true;
    return startApp();
  }
  const teamId = Cloud.getTeam();
  if (!teamId) {
    document.querySelector('.app-header').hidden = true;
    $('listView').hidden = true;
    $('passView').hidden = false;
    return;
  }
  await startCloud(teamId);
  startApp();
  await offerUploadLocal();
  refreshPushUI();
}
boot();

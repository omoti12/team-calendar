// 現場管理（仮版）: データはこの端末のブラウザ (localStorage) に保存
const STORAGE_KEY = 'genba-kanri-v1';

// 紙の枠と同じ初期項目
const DEFAULT_TASKS = [
  '申請・施工日日程決め（カッター・ダンプ・ケイビ）',
  '道路占用 受取り',
  '道路使用 提出',
  '道路使用 受取り',
  'PR',
  '事前打合せ（施工日前日）',
  '組合にメーター取りに行く',
];

const $ = (id) => document.getElementById(id);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

let state = load();
let currentId = null;
let filter = 'all';

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.sites)) return data;
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

function newSite(name) {
  return {
    id: uid(),
    name,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    tasks: DEFAULT_TASKS.map((title) => ({ id: uid(), title, date: '', note: '', done: false })),
  };
}

function touch(site) {
  site.updatedAt = new Date().toISOString();
  save();
}

const getSite = (id) => state.sites.find((s) => s.id === id);
const doneCount = (site) => site.tasks.filter((t) => t.done).length;
const isAllDone = (site) => site.tasks.length > 0 && doneCount(site) === site.tasks.length;

function formatDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${Number(m)}/${Number(d)}`;
}

// 次にやる（未完了で一番上の）項目
function nextTask(site) {
  return site.tasks.find((t) => !t.done);
}

/* ---------- 一覧 ---------- */
function renderList() {
  const q = $('searchInput').value.trim().toLowerCase();
  const list = $('siteList');
  const newTile = list.querySelector('.folder-new');
  list.querySelectorAll('.folder:not(.folder-new)').forEach((el) => el.remove());

  const sites = state.sites
    .filter((s) => s.name.toLowerCase().includes(q))
    .filter((s) => filter === 'all' || (filter === 'done' ? isAllDone(s) : !isAllDone(s)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  for (const site of sites) {
    const li = document.createElement('li');
    const done = isAllDone(site);
    const next = nextTask(site);
    const total = site.tasks.length;
    li.className = 'folder' + (done ? ' is-done' : '');
    li.tabIndex = 0;
    li.innerHTML = `
      <div class="folder-tab"></div>
      <div class="folder-body">
        <div class="folder-paper"></div>
        <div class="name"></div>
        <div class="sub"></div>
        <div class="folder-foot">
          <div class="mini-progress"><span style="width:${total ? (doneCount(site) / total) * 100 : 0}%"></span></div>
          <span class="badge ${done ? 'done' : 'open'}">${done ? '✓ 完了' : doneCount(site) + '/' + total}</span>
        </div>
      </div>`;
    li.querySelector('.name').textContent = site.name;
    li.querySelector('.sub').textContent = !total ? '項目なし'
      : done ? 'すべて完了'
      : `次: ${next.title}${next.date ? '（' + formatDate(next.date) + '）' : ''}`;
    li.addEventListener('click', () => openSite(site.id));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openSite(site.id); });
    list.insertBefore(li, newTile);
  }

  $('countText').textContent = `${sites.length} 件`;

  const empty = $('emptyMsg');
  if (state.sites.length === 0) {
    empty.textContent = 'まだ現場がありません。「＋」のフォルダから追加してください。';
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
  currentId = null;
  history.replaceState(null, '', location.pathname);
  $('detailView').hidden = true;
  $('listView').hidden = false;
  $('crumbSep').hidden = true;
  $('pageTitle').hidden = true;
  renderList();
}

function showDetail() {
  const site = getSite(currentId);
  if (!site) return showList();
  $('listView').hidden = true;
  $('detailView').hidden = false;
  $('crumbSep').hidden = false;
  $('pageTitle').hidden = false;
  $('pageTitle').textContent = site.name;
  $('tabName').textContent = site.name;
  $('siteNameInput').value = site.name;
  $('siteNotes').value = site.notes || '';
  renderTasks(site);
  window.scrollTo(0, 0);
}

function renderProgress(site) {
  const total = site.tasks.length;
  const done = doneCount(site);
  $('progressBar').style.width = total ? (done / total) * 100 + '%' : '0';
  $('progressText').textContent = `${done} / ${total} 完了`;
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
    const status = row.querySelector('.status-btn');

    title.value = task.title;
    note.value = task.note || '';
    date.value = task.date || '';

    const paintStatus = () => {
      status.textContent = task.done ? '完了' : '未完了';
      status.className = 'status-btn ' + (task.done ? 'done' : 'open');
      row.classList.toggle('is-done', task.done);
    };
    paintStatus();

    title.addEventListener('input', () => { task.title = title.value; autoGrow(title); touch(site); });
    note.addEventListener('input', () => { task.note = note.value; touch(site); });
    date.addEventListener('change', () => { task.date = date.value; touch(site); });
    status.addEventListener('click', () => {
      task.done = !task.done;
      paintStatus();
      renderProgress(site);
      touch(site);
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

$('addSiteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('newSiteName').value.trim();
  if (!name) return;
  const site = newSite(name);
  state.sites.push(site);
  save();
  $('newSiteName').value = '';
  openSite(site.id);
});

$('backBtn').addEventListener('click', showList);

$('siteNameInput').addEventListener('input', (e) => {
  const site = getSite(currentId);
  site.name = e.target.value;
  $('pageTitle').textContent = site.name || '（無題）';
  $('tabName').textContent = site.name || '（無題）';
  touch(site);
});

$('siteNotes').addEventListener('input', (e) => {
  const site = getSite(currentId);
  site.notes = e.target.value;
  touch(site);
});

$('addTaskBtn').addEventListener('click', () => {
  const site = getSite(currentId);
  site.tasks.push({ id: uid(), title: '', date: '', note: '', done: false });
  touch(site);
  renderTasks(site);
  const titles = document.querySelectorAll('#taskBody .task-title');
  titles[titles.length - 1].focus();
});

$('deleteSiteBtn').addEventListener('click', async () => {
  const site = getSite(currentId);
  if (!(await ask(`現場「${site.name}」を削除しますか？\n元に戻せません。`, '削除'))) return;
  state.sites = state.sites.filter((s) => s.id !== site.id);
  save();
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
    if (!(await ask(`${data.sites.length} 件の現場を読み込みます。今のデータは置き換わります。よろしいですか？`, '読み込む'))) return;
    state = data;
    save();
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

window.addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (id && getSite(id)) { currentId = id; showDetail(); } else if (!id) showList();
});

/* 起動 */
const initial = location.hash.slice(1);
if (initial && getSite(initial)) { currentId = initial; showDetail(); } else showList();

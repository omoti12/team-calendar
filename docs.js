// 現場資料: 現場ごとの写真を保存し、名前を付けたフォルダで整理する
//
// 写真はチームで共有するためクラウド（Firestore）に保存する。
//   teams/{チーム}/sites/{現場}/photos/{写真ID}    … 一覧用の小さい画像と情報
//   teams/{チーム}/sites/{現場}/photoData/{写真ID} … 大きい画像（開いた時だけ読む）
// フォルダの一覧（名前）は現場のデータ（site.photoFolders）に入れる。
//
// app.js の $, getSite, touch, ask, notify, toast, uid, mode, lastOwner を使う。
const PHOTO_MAX_PX = 1600;
const THUMB_MAX_PX = 320;
const PHOTO_MAX_CHARS = 900000; // Firestore の1件の上限（約1MB）に収まるように

const SiteDocs = {
  siteId: null,
  folderId: null, // 開いているフォルダ（null は一番上）
  photos: [],
  selecting: false,
  selected: new Set(),
  unsubscribe: null,
  viewerIndex: -1,
  viewerList: [],

  el: (id) => document.getElementById(id),

  init() {
    const el = this.el;
    el('docsRoot').addEventListener('click', () => this.openFolder(null));
    el('photoInput').addEventListener('change', (e) => {
      const files = [...e.target.files];
      e.target.value = '';
      this.addPhotos(files);
    });
    el('newFolderBtn').addEventListener('click', () => this.createFolder());
    el('renameFolderBtn').addEventListener('click', () => this.renameFolder());
    el('deleteFolderBtn').addEventListener('click', () => this.deleteFolder());
    el('selectBtn').addEventListener('click', () => this.setSelecting(true));
    el('cancelSelectBtn').addEventListener('click', () => this.setSelecting(false));
    el('toFolderBtn').addEventListener('click', () => this.moveSelected());
    el('unfileBtn').addEventListener('click', () => this.moveTo([...this.selected], null));
    el('deletePhotosBtn').addEventListener('click', () => this.deleteSelected());

    el('viewerClose').addEventListener('click', () => this.closeViewer());
    el('viewerPrev').addEventListener('click', () => this.showInViewer(this.viewerIndex - 1));
    el('viewerNext').addEventListener('click', () => this.showInViewer(this.viewerIndex + 1));
    el('viewerDelete').addEventListener('click', () => this.deleteFromViewer());
    el('viewerMove').addEventListener('click', () => this.moveFromViewer());
    document.addEventListener('keydown', (e) => {
      if (el('photoViewer').hidden) return;
      if (e.key === 'Escape') this.closeViewer();
      if (e.key === 'ArrowLeft') this.showInViewer(this.viewerIndex - 1);
      if (e.key === 'ArrowRight') this.showInViewer(this.viewerIndex + 1);
    });
  },

  site() {
    return getSite(this.siteId);
  },

  folders() {
    return (this.site() && this.site().photoFolders) || [];
  },

  // 現場の画面を開いた時（他の人の変更で描き直す時も呼ばれる）
  open(site) {
    const cloud = mode === 'cloud';
    this.el('docsLocalNote').hidden = cloud;
    this.el('docsBody').hidden = !cloud;
    if (!cloud) return;
    if (this.siteId !== site.id) {
      this.close();
      this.siteId = site.id;
      this.folderId = null;
      this.photos = [];
      this.unsubscribe = Cloud.watchPhotos(site.id, (photos, err) => {
        if (err) return this.showStatus('写真を読み込めませんでした（' + (err.code || err.message) + '）');
        this.photos = photos;
        this.render();
      });
    }
    // 開いていたフォルダが他の人に消された時は一番上に戻る
    if (this.folderId && !this.folders().some((f) => f.id === this.folderId)) this.folderId = null;
    this.render();
  },

  close() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    this.siteId = null;
    this.setSelecting(false, true);
    this.closeViewer();
  },

  photosIn(folderId) {
    const known = new Set(this.folders().map((f) => f.id));
    return this.photos.filter((p) => (folderId ? p.folderId === folderId : !p.folderId || !known.has(p.folderId)));
  },

  render() {
    if (!this.siteId || !this.site()) return;
    const el = this.el;
    const folder = this.folders().find((f) => f.id === this.folderId);
    el('docsCrumbSep').hidden = !folder;
    el('docsFolderName').textContent = folder ? folder.name : '';
    el('docsRoot').classList.toggle('is-link', !!folder);
    el('newFolderBtn').hidden = !!folder;
    el('renameFolderBtn').hidden = !folder;
    el('deleteFolderBtn').hidden = !folder;
    el('unfileBtn').hidden = !folder;
    el('docsCount').textContent = `写真 ${this.photos.length}枚`;

    const grid = el('docsGrid');
    grid.innerHTML = '';
    if (!folder && !this.selecting) {
      for (const f of this.folders()) grid.appendChild(this.folderTile(f));
    }
    const list = this.photosIn(this.folderId);
    list.forEach((p) => grid.appendChild(this.photoTile(p, list)));

    const empty = grid.children.length === 0;
    el('docsEmpty').hidden = !empty;
    el('docsEmpty').textContent = folder
      ? 'このフォルダにはまだ写真がありません。「＋ 写真を追加」で入れるか、一つ上で写真を選んで「フォルダに入れる」を押してください。'
      : 'まだ写真がありません。「＋ 写真を追加」で、カメラで撮るか写真を選んでください。';
    el('selectBtn').hidden = list.length === 0;
    this.renderSelectBar();
  },

  folderTile(f) {
    const inside = this.photosIn(f.id);
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'doc-folder';
    tile.innerHTML = '<span class="doc-folder-cover"></span><span class="doc-folder-name"></span><span class="doc-folder-count"></span>';
    const cover = tile.querySelector('.doc-folder-cover');
    if (inside[0]) cover.style.backgroundImage = `url("${inside[0].thumb}")`;
    else cover.classList.add('is-empty');
    tile.querySelector('.doc-folder-name').textContent = f.name;
    tile.querySelector('.doc-folder-count').textContent = `${inside.length}枚`;
    tile.addEventListener('click', () => this.openFolder(f.id));
    return tile;
  },

  photoTile(p, list) {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'doc-photo' + (this.selected.has(p.id) ? ' is-selected' : '');
    tile.setAttribute('aria-label', '写真 ' + (p.createdAt || '').slice(0, 10));
    const img = document.createElement('img');
    img.src = p.thumb;
    img.alt = '';
    img.loading = 'lazy';
    tile.appendChild(img);
    if (this.selecting) {
      const mark = document.createElement('span');
      mark.className = 'doc-check';
      mark.textContent = this.selected.has(p.id) ? '✓' : '';
      tile.appendChild(mark);
    }
    tile.addEventListener('click', () => {
      if (this.selecting) {
        if (this.selected.has(p.id)) this.selected.delete(p.id);
        else this.selected.add(p.id);
        this.render();
      } else {
        this.openViewer(list, list.indexOf(p));
      }
    });
    return tile;
  },

  openFolder(folderId) {
    this.folderId = folderId;
    this.setSelecting(false, true);
    this.render();
  },

  /* ---------- 写真の追加 ---------- */
  async addPhotos(files) {
    const images = files.filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
    if (!images.length) return;
    let done = 0;
    let failed = 0;
    for (const file of images) {
      this.showStatus(`写真を保存中… ${done + failed + 1} / ${images.length}`);
      try {
        const [data, thumb] = [await compressImage(file, PHOTO_MAX_PX, PHOTO_MAX_CHARS), await compressImage(file, THUMB_MAX_PX, 80000)];
        const id = uid();
        // 電波がない時も先に画面へ出し、つながった時に送る
        Cloud.addPhoto(this.siteId, {
          id,
          folderId: this.folderId || null,
          thumb,
          createdAt: new Date().toISOString(),
          by: lastOwner(),
        }, data).catch((err) => this.showStatus('送信できなかった写真があります（' + (err.code || err.message) + '）'));
        done++;
      } catch (err) {
        failed++;
      }
    }
    this.showStatus('');
    if (failed) notify(`${failed}枚の写真を読み込めませんでした。別の写真でお試しください。`);
    if (done) toast('写真を追加しました', `${done}枚${this.folderId ? '（このフォルダに入れました）' : ''}`, 'save');
  },

  showStatus(text) {
    this.el('uploadStatus').textContent = text;
    this.el('uploadStatus').hidden = !text;
  },

  /* ---------- フォルダ ---------- */
  saveFolders(folders) {
    const site = this.site();
    site.photoFolders = folders;
    touch(site);
  },

  async createFolder(photoIds = []) {
    const name = await askText(photoIds.length ? `選んだ${photoIds.length}枚を入れる新しいフォルダの名前` : '新しいフォルダの名前', '例：着工前、配管、完了写真');
    if (!name) return null;
    const folder = { id: uid(), name, createdAt: new Date().toISOString() };
    this.saveFolders([...this.folders(), folder]);
    if (photoIds.length) await this.moveTo(photoIds, folder.id, true);
    else toast('フォルダを作りました', `「${name}」`, 'save');
    this.render();
    return folder;
  },

  async renameFolder() {
    const folder = this.folders().find((f) => f.id === this.folderId);
    if (!folder) return;
    const name = await askText('フォルダの名前を変更', '', folder.name);
    if (!name || name === folder.name) return;
    this.saveFolders(this.folders().map((f) => (f.id === folder.id ? { ...f, name } : f)));
    this.render();
  },

  async deleteFolder() {
    const folder = this.folders().find((f) => f.id === this.folderId);
    if (!folder) return;
    const inside = this.photosIn(folder.id).map((p) => p.id);
    const ok = await ask(`フォルダ「${folder.name}」を削除しますか？` + (inside.length ? `\n中の写真${inside.length}枚は消さずに、一つ上に戻します。` : ''), '削除');
    if (!ok) return;
    if (inside.length) Cloud.updatePhotos(this.siteId, inside, { folderId: null }).catch(() => {});
    this.saveFolders(this.folders().filter((f) => f.id !== folder.id));
    this.openFolder(null);
  },

  /* ---------- 選択 ---------- */
  setSelecting(on, silent = false) {
    this.selecting = on;
    this.selected.clear();
    if (!silent) this.render();
    else this.renderSelectBar();
  },

  renderSelectBar() {
    const el = this.el;
    el('selectBar').hidden = !this.selecting;
    el('docsToolbar').hidden = this.selecting;
    el('selectCount').textContent = this.selected.size ? `${this.selected.size}枚選択中` : '写真をタップして選択';
    for (const id of ['toFolderBtn', 'unfileBtn', 'deletePhotosBtn']) el(id).disabled = this.selected.size === 0;
  },

  async moveSelected() {
    const ids = [...this.selected];
    if (!ids.length) return;
    const choice = await pickFolder(this.folders().filter((f) => f.id !== this.folderId));
    if (choice === undefined) return;
    if (choice === 'new') await this.createFolder(ids);
    else await this.moveTo(ids, choice.id);
  },

  async moveTo(ids, folderId, created = false) {
    if (!ids.length) return;
    Cloud.updatePhotos(this.siteId, ids, { folderId }).catch((err) => notify('移動できませんでした（' + (err.code || err.message) + '）'));
    // 画面はすぐ変える（クラウドからの反映を待たない）
    this.photos = this.photos.map((p) => (ids.includes(p.id) ? { ...p, folderId } : p));
    const folder = this.folders().find((f) => f.id === folderId);
    this.setSelecting(false);
    toast(created ? 'フォルダを作りました' : '移動しました',
      folder ? `${ids.length}枚を「${folder.name}」に入れました` : `${ids.length}枚をフォルダから出しました`, 'save');
  },

  async deleteSelected() {
    const ids = [...this.selected];
    if (!ids.length) return;
    if (!(await ask(`選んだ写真${ids.length}枚を削除しますか？\nチーム全員の画面から消え、元に戻せません。`, '削除'))) return;
    Cloud.deletePhotos(this.siteId, ids).catch((err) => notify('削除できませんでした（' + (err.code || err.message) + '）'));
    this.photos = this.photos.filter((p) => !ids.includes(p.id));
    this.setSelecting(false);
  },

  /* ---------- 写真を大きく見る ---------- */
  openViewer(list, index) {
    this.viewerList = list;
    this.el('photoViewer').hidden = false;
    this.showInViewer(index);
  },

  async showInViewer(index) {
    const list = this.viewerList;
    if (index < 0 || index >= list.length) return;
    this.viewerIndex = index;
    const p = list[index];
    const img = this.el('viewerImg');
    img.src = p.thumb; // 先に小さい画像を出してから、大きい画像に差し替える
    this.el('viewerPrev').disabled = index === 0;
    this.el('viewerNext').disabled = index === list.length - 1;
    const date = p.createdAt ? new Date(p.createdAt) : null;
    this.el('viewerCaption').textContent = `${index + 1} / ${list.length}`
      + (date ? `　${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` : '')
      + (p.by ? `　${p.by}` : '');
    try {
      const data = await Cloud.getPhotoData(this.siteId, p.id);
      if (data && this.viewerIndex === index && !this.el('photoViewer').hidden) img.src = data;
    } catch (err) { /* 電波がない時は小さい画像のまま */ }
  },

  closeViewer() {
    this.el('photoViewer').hidden = true;
    this.el('viewerImg').removeAttribute('src');
    this.viewerIndex = -1;
  },

  async deleteFromViewer() {
    const p = this.viewerList[this.viewerIndex];
    if (!p || !(await ask('この写真を削除しますか？\nチーム全員の画面から消え、元に戻せません。', '削除'))) return;
    Cloud.deletePhotos(this.siteId, [p.id]).catch(() => {});
    this.photos = this.photos.filter((x) => x.id !== p.id);
    this.viewerList = this.viewerList.filter((x) => x.id !== p.id);
    if (!this.viewerList.length) this.closeViewer();
    else this.showInViewer(Math.min(this.viewerIndex, this.viewerList.length - 1));
    this.render();
  },

  async moveFromViewer() {
    const p = this.viewerList[this.viewerIndex];
    if (!p) return;
    const choice = await pickFolder(this.folders().filter((f) => f.id !== p.folderId), !!p.folderId);
    if (choice === undefined) return;
    this.closeViewer();
    if (choice === 'new') await this.createFolder([p.id]);
    else await this.moveTo([p.id], choice ? choice.id : null);
  },
};

// 写真を JPEG に縮めて data URL にする（向きは写真の情報どおりに直す）
async function compressImage(file, maxPx, maxChars) {
  const source = await loadImage(file);
  let size = maxPx;
  let quality = 0.82;
  for (let i = 0; i < 8; i++) {
    const scale = Math.min(1, size / Math.max(source.width, source.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL('image/jpeg', quality);
    if (url.length <= maxChars) return url;
    if (quality > 0.5) quality -= 0.12;
    else size = Math.round(size * 0.8);
  }
  throw new Error('写真が大きすぎます');
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* 下の方法で読む */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 名前を入力してもらうダイアログ（キャンセルなら null）
function askText(message, placeholder = '', value = '') {
  return new Promise((resolve) => {
    const el = (id) => document.getElementById(id);
    el('nameDialogMsg').textContent = message;
    el('nameDialogInput').value = value;
    el('nameDialogInput').placeholder = placeholder;
    el('nameDialog').hidden = false;
    el('nameDialogInput').focus();
    const done = (v) => {
      el('nameDialog').hidden = true;
      el('nameDialogForm').onsubmit = el('nameDialogCancel').onclick = null;
      resolve(v);
    };
    el('nameDialogForm').onsubmit = (e) => {
      e.preventDefault();
      const name = el('nameDialogInput').value.trim();
      if (name) done(name.slice(0, 40));
    };
    el('nameDialogCancel').onclick = () => done(null);
  });
}

// 入れ先のフォルダを選んでもらう（'new' = 新しく作る、null = フォルダから出す、undefined = やめる）
function pickFolder(folders, allowUnfile = false) {
  return new Promise((resolve) => {
    const el = (id) => document.getElementById(id);
    const list = el('folderSheetList');
    list.innerHTML = '';
    const done = (v) => {
      el('folderSheet').hidden = true;
      resolve(v);
    };
    const add = (label, value, cls = '') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'folder-choice ' + cls;
      btn.textContent = label;
      btn.addEventListener('click', () => done(value));
      list.appendChild(btn);
    };
    add('＋ 新しいフォルダを作って入れる', 'new', 'is-new');
    for (const f of folders) add('📁 ' + f.name, f);
    if (allowUnfile) add('フォルダから出す', null, 'is-unfile');
    el('folderSheetCancel').onclick = () => done(undefined);
    el('folderSheet').hidden = false;
  });
}

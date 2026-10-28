// クラウド保存（Firebase）: 同じ合言葉を入れた人どうしで同じデータを見る
// データは teams/{合言葉のハッシュ}/sites/{現場ID} に1現場1ドキュメントで保存する
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDUYTW814BA_TKts1sYE4cGGF2yxrwXnYQ',
  authDomain: 'genba-kanri-842b7.firebaseapp.com',
  projectId: 'genba-kanri-842b7',
  storageBucket: 'genba-kanri-842b7.firebasestorage.app',
  messagingSenderId: '43765969270',
  appId: '1:43765969270:web:570ad98103ced914ff0a57',
};

const TEAM_KEY = 'genba-kanri-team';
const SAVE_DELAY_MS = 600;

const Cloud = {
  enabled: typeof firebase !== 'undefined',
  db: null,
  teamId: null,
  timers: new Map(),
  pending: new Map(),

  getTeam() {
    try { return localStorage.getItem(TEAM_KEY); } catch (e) { return null; }
  },

  setTeam(teamId) {
    try {
      if (teamId) localStorage.setItem(TEAM_KEY, teamId);
      else localStorage.removeItem(TEAM_KEY);
    } catch (e) { /* 保存できなくても今回は使える */ }
  },

  // 合言葉そのものは保存も送信もせず、ハッシュだけを使う
  async teamIdFor(passcode) {
    const bytes = new TextEncoder().encode('genba-kanri:' + passcode.trim());
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
  },

  // onSites(sites, changedByOthers): 一覧が変わるたびに呼ばれる
  // onStatus(status, error): 'synced' | 'saving' | 'offline' | 'error'
  async start(teamId, onSites, onStatus) {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
      this.db = firebase.firestore();
      // 電波がない時も前回のデータを表示し、入力はつながった時に送る
      try { await this.db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* 使えない端末ではネットのみ */ }
    }
    this.teamId = teamId;

    await new Promise((resolve, reject) => {
      const stop = firebase.auth().onAuthStateChanged((user) => {
        stop();
        if (user) resolve();
        else firebase.auth().signInAnonymously().then(resolve, reject);
      }, reject);
    });

    this.col().onSnapshot({ includeMetadataChanges: true }, (snap) => {
      const changedByOthers = snap.docChanges()
        .filter((c) => !c.doc.metadata.hasPendingWrites)
        .map((c) => c.doc.id);
      onSites(snap.docs.map((d) => d.data()), changedByOthers);
      onStatus(snap.metadata.hasPendingWrites ? 'saving' : snap.metadata.fromCache ? 'offline' : 'synced');
    }, (err) => onStatus('error', err));
  },

  col() {
    return this.db.collection('teams').doc(this.teamId).collection('sites');
  },

  // 入力のたびに送ると多すぎるので、少し待ってまとめて送る
  saveSite(site, immediate = false) {
    this.pending.set(site.id, site);
    clearTimeout(this.timers.get(site.id));
    if (immediate) return this.write(site.id);
    this.timers.set(site.id, setTimeout(() => this.write(site.id), SAVE_DELAY_MS));
    return Promise.resolve();
  },

  write(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const site = this.pending.get(id);
    this.pending.delete(id);
    if (!site) return Promise.resolve();
    // undefined を含むと保存できないので JSON で整える
    return this.col().doc(id).set(JSON.parse(JSON.stringify(site)));
  },

  flush() {
    return Promise.all([...this.pending.keys()].map((id) => this.write(id)));
  },

  deleteSite(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.pending.delete(id);
    return this.col().doc(id).delete();
  },
};

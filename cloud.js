// クラウド保存（Firebase）: 同じ合言葉を入れた人どうしで同じデータを見る
// データは teams/{合言葉のハッシュ}/sites/{現場ID} に1現場1ドキュメントで保存する。
// ログインは使わず、合言葉のハッシュを知っていることを鍵にする（firestore.rules 参照）
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

// Firebase 側の設定（データベース・ルール）が終わるまでは false にしておく。
// false の間は今まで通りこの端末だけに保存する（テスト時は localStorage の genba-kanri-cloud-test を '1' に）
const CLOUD_READY = true;
const cloudTest = (() => { try { return localStorage.getItem('genba-kanri-cloud-test') === '1'; } catch (e) { return false; } })();

const Cloud = {
  enabled: typeof firebase !== 'undefined' && (CLOUD_READY || cloudTest),
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

  /* ---------- プッシュ通知 ---------- */
  // 通知用の公開鍵（通知の送り役が作って置いておく）
  async pushPublicKey() {
    try {
      const snap = await this.db.doc('config/push').get();
      return snap.exists ? snap.data().publicKey : null;
    } catch (err) {
      if (err.code === 'permission-denied') return null; // 送り役の準備（ルール反映）がまだ
      throw err;
    }
  },

  // 端末ごとの登録。ID は通知の宛先 URL から作るので、同じ端末を何度登録しても1件になる
  async deviceId(subscription) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subscription.endpoint));
    return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
  },

  async saveDevice(subscription) {
    const id = await this.deviceId(subscription);
    await this.db.collection('teams').doc(this.teamId).collection('devices').doc(id).set({
      subscription: subscription.toJSON(),
      updatedAt: new Date().toISOString(),
      userAgent: navigator.userAgent.slice(0, 200),
    });
  },

  async deleteDevice(subscription) {
    const id = await this.deviceId(subscription);
    await this.db.collection('teams').doc(this.teamId).collection('devices').doc(id).delete();
  },
};

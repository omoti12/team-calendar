// 現場管理アプリのプッシュ通知（GitHub Actions から実行）
//
//   node index.js setup   … Firestore のルールを反映し、通知用の鍵（VAPID）がなければ作る
//   node index.js notify  … 期限が2週間後・3日後〜今日で未完了の項目があるチームに通知する（毎日お昼）
//   node index.js test    … 通知をオンにしている全端末にテスト通知を送る
//
// 環境変数 FIREBASE_SERVICE_ACCOUNT に Firebase のサービスアカウント鍵（JSON）を入れて実行する。
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const webpush = require('web-push');

// 期限の何日前に知らせるか（2週間前と、3日前〜当日は毎日）
const NOTIFY_DAYS_BEFORE = [14, 3, 2, 1, 0];
const APP_URL = 'https://omoti12.github.io/team-calendar/';
const CONTACT = 'mailto:noreply@example.com';

// 貼り付けの時に前後へ余分な文字が入っても読めるように、最初の { … } だけを取り出して読む
function parseServiceAccount(raw) {
  const text = (raw || '').trim();
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      if (start > 0 || i < text.length - 1) console.warn('鍵の前後に余分な文字があったので、鍵の部分だけを使います');
      return JSON.parse(text.slice(start, i + 1));
    }
  }
  return null;
}

let serviceAccount = null;
try {
  serviceAccount = parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT);
} catch (err) {
  console.error('FIREBASE_SERVICE_ACCOUNT を読み取れませんでした（中身が壊れている可能性があります）:', err.message);
  process.exit(1);
}
if (!serviceAccount || !serviceAccount.private_key || !serviceAccount.project_id) {
  console.error('FIREBASE_SERVICE_ACCOUNT に Firebase の鍵（JSON）が入っていません');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const projectId = serviceAccount.project_id;

// 秘密鍵はアプリから読めない場所、公開鍵はアプリが読む場所に置く（firestore.rules 参照）
async function ensureVapidKeys() {
  const privateRef = db.doc('_private/push');
  let keys = (await privateRef.get()).data();
  if (!keys) {
    keys = webpush.generateVAPIDKeys();
    await privateRef.set(keys);
    console.log('通知用の鍵を作成しました');
  }
  await db.doc('config/push').set({ publicKey: keys.publicKey });
  return keys;
}

async function deployRules() {
  const source = fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8');
  const { access_token: token } = await admin.app().options.credential.getAccessToken();
  const api = `https://firebaserules.googleapis.com/v1/projects/${projectId}`;
  const call = async (url, method, body) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(`${method} ${url}: ${JSON.stringify(json)}`);
    return json;
  };
  const ruleset = await call(`${api}/rulesets`, 'POST', { source: { files: [{ name: 'firestore.rules', content: source }] } });
  await call(`${api}/releases/cloud.firestore`, 'PATCH', {
    release: { name: `projects/${projectId}/releases/cloud.firestore`, rulesetName: ruleset.name },
  });
  console.log('ルールを反映しました:', ruleset.name);
}

// 日本時間の今日から days 日後の日付（YYYY-MM-DD）
function jstDate(days) {
  return new Date(Date.now() + 9 * 3600 * 1000 + days * 86400 * 1000).toISOString().slice(0, 10);
}

// 通知をオンにしている端末を、チームごとにまとめる
async function devicesByTeam() {
  const snap = await db.collectionGroup('devices').get();
  const teams = new Map();
  for (const doc of snap.docs) {
    const teamId = doc.ref.parent.parent.id;
    if (!teams.has(teamId)) teams.set(teamId, []);
    teams.get(teamId).push(doc);
  }
  return teams;
}

async function send(devices, payload) {
  let sent = 0;
  for (const device of devices) {
    try {
      await webpush.sendNotification(device.get('subscription'), JSON.stringify(payload), { TTL: 6 * 3600 });
      sent++;
    } catch (err) {
      // 通知を解除した・アプリを消した端末は登録を消す
      if (err.statusCode === 404 || err.statusCode === 410) await device.ref.delete();
      else console.warn('送信できませんでした:', err.statusCode || err.message);
    }
  }
  return sent;
}

function daysLabel(days) {
  if (days === 0) return '今日が期限';
  if (days === 14) return 'あと2週間';
  return `あと${days}日`;
}

// 現場ごとに1行: 「港区 芝：カッター（あと2日）、ダンプ（あと2週間）」
function summarize(items) {
  const bySite = new Map();
  for (const { site, task, days } of items) {
    if (!bySite.has(site.name)) bySite.set(site.name, []);
    bySite.get(site.name).push(`${task.title || '（無題）'}（${daysLabel(days)}）`);
  }
  return [...bySite].map(([name, titles]) => `${name}：${titles.join('、')}`).join('\n');
}

async function notify() {
  const targets = new Map(NOTIFY_DAYS_BEFORE.map((days) => [jstDate(days), days]));
  console.log('期限が', [...targets.keys()].join(', '), 'の未完了項目を探します');
  const teams = await devicesByTeam();
  for (const [teamId, devices] of teams) {
    const sites = (await db.collection(`teams/${teamId}/sites`).get()).docs.map((d) => d.data());
    const items = [];
    for (const site of sites) {
      for (const task of site.tasks || []) {
        if (!task.done && targets.has(task.date)) items.push({ site, task, days: targets.get(task.date) });
      }
    }
    if (!items.length) continue;
    // 期限の近い順に並べ、一番近いものを題名にする
    items.sort((x, y) => x.days - y.days);
    const nearest = items[0].days;
    const sent = await send(devices, {
      title: nearest === 0 ? `⚠️ 今日が期限の項目があります（${items.length}件）`
        : nearest <= 3 ? `⚠️ 期限が近い項目があります（${items.length}件）`
        : `期限まであと2週間の項目があります（${items.length}件）`,
      body: summarize(items),
      url: APP_URL,
      tag: `deadline-${jstDate(0)}`,
    });
    console.log(`チーム ${teamId.slice(0, 8)}…: ${items.length}件の項目を ${sent}台に通知`);
  }
}

async function testPush() {
  const teams = await devicesByTeam();
  for (const [teamId, devices] of teams) {
    const sent = await send(devices, {
      title: '現場管理：テスト通知',
      body: '通知が届くようになりました。期限の2週間前のお昼にお知らせします。',
      url: APP_URL,
      tag: 'test-' + Date.now(),
    });
    console.log(`チーム ${teamId.slice(0, 8)}…: ${sent}台に送信`);
  }
}

(async () => {
  const mode = process.argv[2] || 'notify';
  if (mode === 'setup') {
    await deployRules();
    await ensureVapidKeys();
    return;
  }
  const keys = await ensureVapidKeys();
  webpush.setVapidDetails(CONTACT, keys.publicKey, keys.privateKey);
  if (mode === 'test') await testPush();
  else await notify();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

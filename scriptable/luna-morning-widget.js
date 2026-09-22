const API_URLS = [
  'https://luna-core.kita0905-game.workers.dev/morning/current',
  'https://luna-core.kita0905-game.workers.dev/morning/widget',
];
const TOKEN_KEY = 'LUNA_MORNING_WIDGET_TOKEN';
const CACHE_FILE = 'luna-morning-current-cache.json';

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), CACHE_FILE);

function makeMessageWidget(title, message) {
  const w = new ListWidget();
  w.setPadding(14, 14, 14, 14);
  w.backgroundColor = Color.dynamic(new Color('#F7F7F7'), new Color('#151515'));
  const t = w.addText(title);
  t.font = Font.boldSystemFont(14);
  w.addSpacer(8);
  const m = w.addText(message);
  m.font = Font.systemFont(12);
  m.textColor = Color.dynamic(new Color('#444444'), new Color('#D0D0D0'));
  m.lineLimit = 5;
  return w;
}

async function getToken() {
  if (Keychain.contains(TOKEN_KEY)) return Keychain.get(TOKEN_KEY);
  if (config.runsInWidget) return null;

  const alert = new Alert();
  alert.title = 'LUNA MORNING 初回設定';
  alert.message = 'Luna Core のWidget用トークンを入力します。端末のKeychainに保存されます。';
  alert.addSecureTextField('Widget token');
  alert.addAction('保存');
  alert.addCancelAction('キャンセル');
  const result = await alert.present();
  if (result === -1) return null;

  const token = alert.textFieldValue(0).trim();
  if (!token) return null;
  Keychain.set(TOKEN_KEY, token);
  return token;
}

async function fetchMorning(token) {
  let lastError = null;
  for (const url of API_URLS) {
    try {
      const req = new Request(url);
      req.method = 'GET';
      req.timeoutInterval = 10;
      req.headers = { Authorization: `Bearer ${token}` };
      const data = await req.loadJSON();
      const status = req.response?.statusCode ?? 0;
      if (status < 200 || status >= 300 || !data?.ok || !data?.payload) {
        const reason = data?.error || `HTTP ${status}`;
        throw new Error(reason);
      }
      fm.writeString(cachePath, JSON.stringify(data));
      return { data, stale: false };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('morning_fetch_failed');
}

function readCache() {
  if (!fm.fileExists(cachePath)) return null;
  try {
    const data = JSON.parse(fm.readString(cachePath));
    if (!data?.payload) return null;
    return { data, stale: true };
  } catch {
    return null;
  }
}

function formatDate(dateText) {
  const d = new Date(`${dateText}T00:00:00+09:00`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()} (${weekdays[d.getDay()]})`;
}

function formatGeneratedAt(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function addText(parent, text, size, bold = false, lineLimit = 0) {
  const node = parent.addText(text);
  node.font = bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  node.textColor = Color.dynamic(new Color('#202020'), new Color('#F0F0F0'));
  if (lineLimit > 0) node.lineLimit = lineLimit;
  return node;
}

function addMutedText(parent, text, size, lineLimit = 0) {
  const node = parent.addText(text);
  node.font = Font.systemFont(size);
  node.textColor = Color.dynamic(new Color('#666666'), new Color('#B8B8B8'));
  if (lineLimit > 0) node.lineLimit = lineLimit;
  return node;
}

function weatherText(weather = {}) {
  const icon = weather.icon || '☀️';
  const high = weather.high ?? '–';
  const low = weather.low ?? '–';
  const am = weather.rain_am ?? '–';
  const pm = weather.rain_pm ?? '–';
  return `${icon} ${low}–${high}℃  雨 AM ${am}% / PM ${pm}%`;
}

function buildWidget(result) {
  const { data, stale } = result;
  const p = data.payload;
  const family = config.widgetFamily || 'large';
  const isSmall = family === 'small';
  const isLarge = family === 'large' || family === 'extraLarge';

  const w = new ListWidget();
  w.setPadding(13, 14, 12, 14);
  w.backgroundColor = Color.dynamic(new Color('#F7F7F7'), new Color('#151515'));

  const header = w.addStack();
  header.centerAlignContent();
  addText(header, 'LUNA MORNING', 14, true, 1);
  header.addSpacer();
  addMutedText(header, formatDate(p.date), 11, 1);

  w.addSpacer(7);
  addText(w, weatherText(p.weather), isSmall ? 12 : 13, true, 1);

  if (p.commute?.status && !isSmall) {
    w.addSpacer(4);
    addMutedText(w, `🚃 ${p.commute.status}`, 11, 1);
  }

  if (Array.isArray(p.today_events) && p.today_events.length > 0 && !isSmall) {
    w.addSpacer(5);
    addText(w, `📅 ${p.today_events[0]}`, 11, false, 1);
  }

  if (p.comment) {
    w.addSpacer(7);
    addText(w, p.comment, isSmall ? 11 : 12, false, isSmall ? 4 : 3);
  }

  if (!isSmall && Array.isArray(p.news) && p.news.length > 0) {
    w.addSpacer(8);
    addMutedText(w, 'NEWS', 9, 1);
    const maxNews = isLarge ? 2 : 1;
    for (const item of p.news.slice(0, maxNews)) {
      addText(w, `• ${item}`, 10, false, isLarge ? 2 : 1);
      w.addSpacer(3);
    }
  }

  if (!isSmall && p.bookkeeping) {
    w.addSpacer(5);
    addMutedText(w, '簿記', 9, 1);
    addText(w, p.bookkeeping, 10, false, isLarge ? 2 : 1);
  }

  w.addSpacer();
  const generated = formatGeneratedAt(p.generated_at);
  const footer = `${stale ? '前回データ' : '更新'}${generated ? ` ${generated}` : ''}`;
  addMutedText(w, footer, 9, 1);

  // iOS側の再取得希望時刻。実行時刻はOS判断なので、確実な更新はショートカット自動化で行う。
  w.refreshAfterDate = new Date(Date.now() + 60 * 60 * 1000);
  return w;
}

async function main() {
  const token = await getToken();
  if (!token) {
    const widget = makeMessageWidget('LUNA MORNING', 'Scriptableアプリでこのスクリプトを1回実行して、Widget用トークンを設定してください。');
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentLarge();
    Script.complete();
  } else {
    let result;
    try {
      result = await fetchMorning(token);
    } catch (error) {
      result = readCache();
      if (!result) {
        const widget = makeMessageWidget('LUNA MORNING', `朝刊を取得できませんでした。\n${String(error.message || error)}`);
        Script.setWidget(widget);
        if (!config.runsInWidget) await widget.presentLarge();
        Script.complete();
        return;
      }
    }

    const widget = buildWidget(result);
    Script.setWidget(widget);
    if (!config.runsInWidget) await widget.presentLarge();
    Script.complete();
  }
}

await main();

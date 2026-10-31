// 閲覧サイトと登録補助ツールで共通に使う定数・関数
window.VSN = (function () {
  const LABELS = {
    side: { attack: "攻め", defense: "守り" },
    purpose: {
      entry: "エントリー",
      retake: "リテイク",
      postplant: "設置後",
      oneway: "ワンウェイ",
      other: "その他",
    },
    agent: { Omen: "オーメン", Clove: "クローブ" },
  };

  // base: index.html から見たデータの場所（ツールからは "../"）
  async function loadJson(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`${path} を読み込めませんでした (${res.status})`);
    return res.json();
  }

  async function loadAll(base = "") {
    const [maps, pool, smokes] = await Promise.all([
      loadJson(base + "data/maps.json"),
      loadJson(base + "data/pool.json"),
      loadJson(base + "data/smokes.json"),
    ]);
    return { maps: maps.maps, pool, smokes };
  }

  // YouTube の URL から動画IDと開始秒を取り出す
  function parseYouTube(url) {
    if (!url) return null;
    let u;
    try {
      u = new URL(url.trim());
    } catch {
      return null;
    }
    let id = null;
    if (u.hostname === "youtu.be") id = u.pathname.slice(1);
    else if (u.searchParams.get("v")) id = u.searchParams.get("v");
    else {
      const m = u.pathname.match(/\/(shorts|embed|live)\/([^/?]+)/);
      if (m) id = m[2];
    }
    if (!id) return null;
    return { youtubeId: id, start: parseTime(u.searchParams.get("t") || u.searchParams.get("start")) };
  }

  // "83", "83s", "1m23s" -> 83
  function parseTime(t) {
    if (!t) return 0;
    if (/^\d+$/.test(t)) return Number(t);
    const m = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?/);
    if (!m) return 0;
    return Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  // localStorage は使えない環境もあるので失敗しても止まらないようにする
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* 保存できなくても動作には影響なし */
      }
    },
  };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    for (const c of [].concat(children)) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  return { LABELS, loadJson, loadAll, parseYouTube, parseTime, formatTime, store, el };
})();

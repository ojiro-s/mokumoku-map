// 登録補助ツール：ミニマップをクリックして座標を取り、smokes.json に貼る1件分を作る
(function () {
  const { LABELS, loadAll, parseYouTube, el } = window.VSN;
  const $ = (id) => document.getElementById(id);
  const BASE = "../"; // tools/ から見たプロジェクトのルート

  const state = { maps: [], smokes: [], pool: {}, mode: "target", target: null, stand: null };

  init();

  async function init() {
    try {
      const data = await loadAll(BASE);
      Object.assign(state, { maps: data.maps, smokes: data.smokes, pool: data.pool });
    } catch (e) {
      document.querySelector(".picker").replaceChildren(
        el("p", { text: `データを読み込めませんでした：${e.message}` }),
        el("p", { text: "README の手順（ミニマップ取得と簡易サーバー起動）を確認してください。" })
      );
      return;
    }

    // マップの選択肢（プール内を先頭に）
    const poolSet = new Set(state.pool.pool || []);
    const sorted = [...state.maps].sort((a, b) => Number(poolSet.has(b.slug)) - Number(poolSet.has(a.slug)));
    $("map").replaceChildren(
      ...sorted.map((m) => el("option", { value: m.slug, text: m.nameJa + (poolSet.has(m.slug) ? "" : "（プール外）") }))
    );
    $("purpose").replaceChildren(
      ...Object.entries(LABELS.purpose).map(([k, v]) => el("option", { value: k, text: v }))
    );
    $("patch").value = state.pool.patch || "";

    document.querySelectorAll("[data-mode]").forEach((b) =>
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode;
        document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("is-active", x === b));
      })
    );

    $("minimap").addEventListener("click", onMapClick);
    $("map").addEventListener("change", () => {
      state.target = state.stand = null;
      renderMap();
      update();
    });
    $("show-callouts").addEventListener("change", renderMap);
    $("youtube").addEventListener("input", () => {
      const yt = parseYouTube($("youtube").value);
      if (yt) $("start").value = yt.start;
      update();
    });
    document.querySelectorAll(".form input, .form select, .form textarea").forEach((x) => {
      if (x.id !== "output") x.addEventListener("input", update);
    });
    $("copy").addEventListener("click", copyOutput);

    renderMap();
    update();
  }

  function currentMap() {
    return state.maps.find((m) => m.slug === $("map").value);
  }

  function onMapClick(e) {
    const rect = $("minimap").getBoundingClientRect();
    const p = {
      x: round((e.clientX - rect.left) / rect.width),
      y: round((e.clientY - rect.top) / rect.height),
    };
    state[state.mode] = p;
    // 配置位置を決めたら、次は立ち位置を入力しやすいように自動で切り替える
    if (state.mode === "target") document.querySelector('[data-mode="stand"]').click();
    renderMap();
    update();
  }

  function round(v) {
    return Math.round(Math.min(1, Math.max(0, v)) * 1000) / 1000;
  }

  function pos(p) {
    return `left:${p.x * 100}%;top:${p.y * 100}%`;
  }

  function renderMap() {
    const map = currentMap();
    if (!map) return;
    $("minimap-img").src = BASE + map.minimap;
    $("minimap-img").alt = `${map.nameJa}のミニマップ`;

    $("site").replaceChildren(
      ...[...map.sites, "Mid"].map((s) => el("option", { value: s, text: s === "Mid" ? "ミッド" : `${s}サイト` }))
    );

    $("minimap-callouts").replaceChildren(
      ...($("show-callouts").checked ? map.callouts : []).map((c) =>
        el("span", { class: "callout", style: pos(c), text: c.name })
      )
    );

    const pins = state.smokes
      .filter((s) => s.map === map.slug)
      .map((s) => el("span", { class: "pin ghost", style: pos(s.target), title: s.title, text: "・" }));
    if (state.target) pins.push(el("span", { class: "pin is-selected", style: pos(state.target), text: "★" }));
    if (state.stand) pins.push(el("span", { class: "stand", style: pos(state.stand) }));
    $("minimap-pins").replaceChildren(...pins);

    const lines = [];
    if (state.target && state.stand) {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", state.stand.x);
      line.setAttribute("y1", state.stand.y);
      line.setAttribute("x2", state.target.x);
      line.setAttribute("y2", state.target.y);
      lines.push(line);
    }
    $("minimap-lines").replaceChildren(...lines);
  }

  function makeId(entry) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 12); // 年月日時分
    return `${entry.map}-${entry.side}-${entry.site}-${stamp}`.toLowerCase();
  }

  function update() {
    const map = currentMap();
    $("target-text").textContent = state.target ? `x=${state.target.x}, y=${state.target.y}` : "未設定";
    $("stand-text").textContent = state.stand ? `x=${state.stand.x}, y=${state.stand.y}` : "未設定";

    const yt = parseYouTube($("youtube").value);
    const entry = {
      id: "",
      map: map?.slug,
      agent: $("agent").value,
      side: $("side").value,
      site: $("site").value,
      purpose: $("purpose").value,
      title: $("title").value.trim(),
      target: state.target,
      stand: state.stand,
      comment: $("comment").value.trim(),
      images: $("images").value.split(",").map((s) => s.trim()).filter(Boolean),
      video: yt ? { youtubeId: yt.youtubeId, start: Number($("start").value) || 0 } : null,
      source: $("source").value.trim(),
      patch: $("patch").value.trim(),
    };
    entry.id = makeId(entry);

    const missing = [];
    if (!entry.target) missing.push("配置位置（ミニマップをクリック）");
    if (!entry.title) missing.push("タイトル");
    $("output").value = missing.length
      ? `まだ入力が足りません：${missing.join("、")}`
      : JSON.stringify(entry, null, 2);
    $("copy").disabled = missing.length > 0;
  }

  async function copyOutput() {
    try {
      await navigator.clipboard.writeText($("output").value);
      $("copy").textContent = "コピーしました";
    } catch {
      $("output").select();
      $("copy").textContent = "選択しました（Ctrl+Cでコピー）";
    }
    setTimeout(() => ($("copy").textContent = "コピーする"), 2000);
  }
})();

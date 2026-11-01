// 登録補助ツール：ミニマップをクリックして座標を取り、smokes.json に貼る1件分を作る
(function () {
  const { LABELS, MAIN_AGENTS, COMMON_AGENT, agentLabel, smokeStyle, loadAll, parseYouTube, el } = window.VSN;
  const $ = (id) => document.getElementById(id);
  const BASE = "../"; // tools/ から見たプロジェクトのルート

  const state = {
    maps: [],
    smokes: [],
    notes: {},
    pool: {},
    mode: "target",
    target: null,
    stand: null,
    canSave: false, // scripts/serve.py で開いていて直接保存できるか
    changedNotes: new Set(), // コツを書き換えて未保存のマップ
  };

  init();

  async function init() {
    try {
      const data = await loadAll(BASE);
      Object.assign(state, { maps: data.maps, smokes: data.smokes, notes: data.notes, pool: data.pool });
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
    // エージェントの選択肢（全キャラ共通と普段使う分を先頭に、他はグループにまとめる）
    const agentOption = (a) => el("option", { value: a, text: agentLabel(a) });
    $("agent").replaceChildren(
      agentOption(COMMON_AGENT),
      ...MAIN_AGENTS.map(agentOption),
      el(
        "optgroup",
        { label: "その他" },
        Object.keys(LABELS.agent).filter((a) => !MAIN_AGENTS.includes(a)).map(agentOption)
      )
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
      showMapNote();
      update();
    });
    $("map-note").addEventListener("input", () => {
      state.notes[$("map").value] = $("map-note").value;
      state.changedNotes.add($("map").value);
      updateNotesOutput();
    });
    $("show-callouts").addEventListener("change", renderMap);
    $("agent").addEventListener("change", renderMap); // エージェントでスモークの大きさが変わる
    $("youtube").addEventListener("input", () => {
      const yt = parseYouTube($("youtube").value);
      if (yt) $("start").value = yt.start;
      update();
    });
    document.querySelectorAll(".form input, .form select, .form textarea").forEach((x) => {
      if (x.id !== "output") x.addEventListener("input", update);
    });
    $("copy").addEventListener("click", () => copyText($("output"), $("copy")));
    $("copy-notes").addEventListener("click", () => copyText($("notes-output"), $("copy-notes")));
    $("save-notes").addEventListener("click", saveNotes);
    $("save-smoke").addEventListener("click", saveSmoke);

    await setupSaving();
    renderMap();
    showMapNote();
    update();
  }

  // scripts/serve.py で開いているときだけ、コピーの代わりに保存ボタンを出す
  async function setupSaving() {
    // ?test は確認用データを読んでいるので、本物のファイルへ保存させない
    if (new URLSearchParams(location.search).has("test")) return;
    try {
      const res = await fetch(`${BASE}api/status`);
      state.canSave = res.ok;
    } catch {
      state.canSave = false;
    }
    if (!state.canSave) return;
    document.querySelectorAll(".copy-only").forEach((x) => (x.hidden = true));
    document.querySelectorAll(".save-only").forEach((x) => (x.hidden = false));
  }

  async function postJson(path, body) {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `保存に失敗しました (${res.status})`);
    return data;
  }

  // 結果を2秒だけボタンに出して元に戻す
  function flash(button, text) {
    const label = button.dataset.label || (button.dataset.label = button.textContent);
    button.textContent = text;
    setTimeout(() => (button.textContent = label), 2000);
  }

  async function saveNotes() {
    const changes = Object.fromEntries([...state.changedNotes].map((slug) => [slug, state.notes[slug] || ""]));
    try {
      await postJson("api/notes", { notes: changes });
      state.changedNotes.clear();
      updateNotesOutput();
      flash($("save-notes"), "保存しました");
    } catch (e) {
      flash($("save-notes"), e.message);
    }
  }

  async function saveSmoke() {
    const entry = JSON.parse($("output").value);
    try {
      await postJson("api/smokes", entry);
      state.smokes.push(entry);
      clearSmokeForm();
      flash($("save-smoke"), "保存しました");
    } catch (e) {
      flash($("save-smoke"), e.message);
    }
  }

  // 続けて登録しやすいよう、マップなどの選択は残して入力だけ空にする
  function clearSmokeForm() {
    state.target = state.stand = null;
    ["title", "comment", "youtube", "images", "source"].forEach((id) => ($(id).value = ""));
    $("start").value = 0;
    document.querySelector('[data-mode="target"]').click();
    renderMap();
    update();
  }

  function showMapNote() {
    $("map-note").value = state.notes[$("map").value] || "";
    updateNotesOutput();
  }

  // 空の欄を除き、マップ名の順に並べて全文を作る
  function updateNotesOutput() {
    const entries = Object.entries(state.notes)
      .map(([slug, note]) => [slug, note.trim()])
      .filter(([, note]) => note)
      .sort(([a], [b]) => a.localeCompare(b));
    $("notes-output").value = JSON.stringify(Object.fromEntries(entries), null, 2);
    $("save-notes").disabled = state.changedNotes.size === 0;
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
      .map((s) => el("span", { class: "pin ghost", style: smokeStyle(s.target, s.agent, map), title: s.title, text: "・" }));
    if (state.target) {
      pins.push(el("span", { class: "pin is-selected", style: smokeStyle(state.target, $("agent").value, map), text: "★" }));
    }
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
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14); // 年月日時分秒
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
    $("save-smoke").disabled = missing.length > 0;
  }

  async function copyText(source, button) {
    const label = button.textContent;
    try {
      await navigator.clipboard.writeText(source.value);
      button.textContent = "コピーしました";
    } catch {
      source.select();
      button.textContent = "選択しました（Ctrl+Cでコピー）";
    }
    setTimeout(() => (button.textContent = label), 2000);
  }
})();

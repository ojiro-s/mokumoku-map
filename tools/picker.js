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
    mode: "target", // クリックで設定する位置（target か stand）
    points: [newPoint()], // スモークの組。同時に焚く定点は2組以上になる
    active: 0, // クリックで位置を設定する組の番号
    canSave: false, // scripts/serve.py で開いていて直接保存できるか
    editingId: null, // 編集中の定点の id（新規登録のときは null）
    deleteArmedId: null, // 削除ボタンを1回押した定点の id。別の定点に切り替えると押していない状態に戻る
    changedNotes: new Set(), // コツを書き換えて未保存のマップ
  };

  init();

  function newPoint() {
    return { target: null, stand: null };
  }

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

    document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
    $("add-point").addEventListener("click", () => {
      state.points.push(newPoint());
      selectPoint(state.points.length - 1);
    });

    $("minimap").addEventListener("click", onMapClick);
    $("map").addEventListener("change", () => {
      const wasEditing = state.editingId !== null;
      state.editingId = null;
      resetPoints();
      renderMap();
      showMapNote();
      renderEditList();
      if (wasEditing) clearSmokeForm();
      update();
    });
    $("edit-target").addEventListener("change", (e) => startEditing(e.target.value));
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
    $("delete-smoke").addEventListener("click", deleteSmoke);

    await setupSaving();
    renderMap();
    showMapNote();
    renderEditList();
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
  function flash(button, text, idleLabel) {
    button.textContent = text;
    setTimeout(() => (button.textContent = idleLabel()), 2000);
  }

  const notesButtonLabel = () => "コツを保存する";
  const smokeButtonLabel = () => (state.editingId ? "定点を更新する" : "定点を保存する");

  async function saveNotes() {
    const changes = Object.fromEntries([...state.changedNotes].map((slug) => [slug, state.notes[slug] || ""]));
    try {
      await postJson("api/notes", { notes: changes });
      state.changedNotes.clear();
      updateNotesOutput();
      flash($("save-notes"), "保存しました", notesButtonLabel);
    } catch (e) {
      flash($("save-notes"), e.message, notesButtonLabel);
    }
  }

  async function saveSmoke() {
    const entry = JSON.parse($("output").value);
    const editing = state.editingId !== null;
    try {
      await postJson(editing ? "api/smokes/update" : "api/smokes", entry);
      if (editing) state.smokes[state.smokes.findIndex((s) => s.id === entry.id)] = entry;
      else state.smokes.push(entry);
      state.editingId = null;
      clearSmokeForm();
      renderEditList();
      flash($("save-smoke"), editing ? "更新しました" : "保存しました", smokeButtonLabel);
    } catch (e) {
      flash($("save-smoke"), e.message, smokeButtonLabel);
    }
  }

  // 押し間違いを防ぐため、1回目は確認の表示に変えるだけにし、2回目で削除する
  async function deleteSmoke() {
    const id = state.editingId;
    if (!id) return;
    if (state.deleteArmedId !== id) {
      state.deleteArmedId = id;
      updateDeleteButton();
      return;
    }
    try {
      await postJson("api/smokes/delete", { id });
      state.smokes = state.smokes.filter((s) => s.id !== id);
      state.editingId = state.deleteArmedId = null;
      clearSmokeForm();
      renderEditList();
      flash($("save-smoke"), "削除しました", smokeButtonLabel);
    } catch (e) {
      state.deleteArmedId = null;
      updateDeleteButton();
      flash($("save-smoke"), e.message, smokeButtonLabel);
    }
  }

  function updateDeleteButton() {
    const button = $("delete-smoke");
    // 別の定点へ切り替えたら、戻ってきても押していない状態から始める
    if (state.deleteArmedId !== state.editingId) state.deleteArmedId = null;
    const armed = state.editingId !== null && state.deleteArmedId === state.editingId;
    button.hidden = !(state.canSave && state.editingId);
    button.classList.toggle("is-armed", armed);
    button.textContent = armed ? "もう一度押すと削除します" : "この定点を削除する";
  }

  // 編集できる定点の一覧（選んでいるマップの分だけ）
  function renderEditList() {
    const list = state.smokes.filter((s) => s.map === $("map").value);
    $("edit-target").replaceChildren(
      el("option", { value: "", text: "新規登録" }),
      ...list.map((s) =>
        el("option", {
          value: s.id,
          text: `${s.title}（${LABELS.side[s.side] || s.side}・${agentLabel(s.agent)}）`,
          selected: s.id === state.editingId,
        })
      )
    );
  }

  // 登録済みの定点を入力欄へ読み込む。空の値が来たら新規登録に戻す
  function startEditing(id) {
    const smoke = state.smokes.find((s) => s.id === id);
    state.editingId = smoke ? smoke.id : null;
    if (!smoke) {
      clearSmokeForm();
      return;
    }
    state.points = smoke.points.map((p) => ({ target: p.target, stand: p.stand ?? null }));
    state.active = 0;
    setMode("target");
    $("agent").value = smoke.agent;
    $("side").value = smoke.side;
    $("purpose").value = smoke.purpose;
    $("title").value = smoke.title;
    $("comment").value = smoke.comment || "";
    $("youtube").value = smoke.video ? `https://youtu.be/${smoke.video.youtubeId}?t=${smoke.video.start || 0}` : "";
    $("start").value = smoke.video?.start || 0;
    $("images").value = (smoke.images || []).join(", ");
    $("source").value = smoke.source || "";
    $("patch").value = smoke.patch || "";
    renderMap();
    $("site").value = smoke.site;
    update();
  }

  // 続けて登録しやすいよう、マップなどの選択は残して入力だけ空にする
  function clearSmokeForm() {
    resetPoints();
    ["title", "comment", "youtube", "images", "source"].forEach((id) => ($(id).value = ""));
    $("start").value = 0;
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
    state.points[state.active][state.mode] = p;
    renderMap();
    update();
  }

  function setMode(mode) {
    state.mode = mode;
    document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("is-active", x.dataset.mode === mode));
  }

  function resetPoints() {
    state.points = [newPoint()];
    state.active = 0;
    setMode("target");
  }

  // 組を選ぶと、まず配置位置から設定できるようにする
  function selectPoint(index) {
    state.active = index;
    setMode("target");
    renderMap();
    update();
  }

  function removePoint(index) {
    state.points.splice(index, 1);
    if (state.points.length === 0) state.points.push(newPoint());
    state.active = Math.min(state.active > index ? state.active - 1 : state.active, state.points.length - 1);
    renderMap();
    update();
  }

  function coordText(p) {
    return p ? `x=${p.x}, y=${p.y}` : "未設定";
  }

  function renderPoints() {
    $("points").replaceChildren(
      ...state.points.map((p, i) =>
        el("div", { class: "point-row" + (i === state.active ? " is-active" : ""), onclick: () => selectPoint(i) }, [
          el("span", { class: "point-name", text: `組${i + 1}` }),
          el("span", { class: "coord", text: `配置位置: ${coordText(p.target)} / 立ち位置: ${coordText(p.stand)}` }),
          el("button", {
            type: "button",
            class: "chip",
            text: "組を削除",
            "aria-label": `組${i + 1}を削除`,
            onclick: (e) => {
              e.stopPropagation(); // 行のクリック（組の選択）を起こさない
              removePoint(i);
            },
          }),
        ])
      )
    );
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

    // 選択肢を作り直しても、選んでいるサイトは残す
    const site = $("site").value;
    $("site").replaceChildren(
      ...[...map.sites, "Mid"].map((s) => el("option", { value: s, text: s === "Mid" ? "ミッド" : `${s}サイト` }))
    );
    if ([...$("site").options].some((o) => o.value === site)) $("site").value = site;

    $("minimap-callouts").replaceChildren(
      ...($("show-callouts").checked ? map.callouts : []).map((c) =>
        el("span", { class: "callout", style: pos(c), text: c.name })
      )
    );

    const pins = state.smokes
      .filter((s) => s.map === map.slug && s.id !== state.editingId)
      .flatMap((s) =>
        s.points.map((p) => el("span", { class: "pin ghost", style: smokeStyle(p.target, s.agent, map), title: s.title, text: "・" }))
      );
    // 入力中の組は番号で描き、クリックで設定する組だけを強調する
    const lines = [];
    state.points.forEach((p, i) => {
      const active = i === state.active;
      if (p.target) {
        pins.push(
          el("span", {
            class: "pin" + (active ? " is-selected" : ""),
            style: smokeStyle(p.target, $("agent").value, map),
            text: state.points.length > 1 ? String(i + 1) : "★",
          })
        );
      }
      if (p.stand) pins.push(el("span", { class: "stand", style: pos(p.stand) }));
      if (p.target && p.stand) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", p.stand.x);
        line.setAttribute("y1", p.stand.y);
        line.setAttribute("x2", p.target.x);
        line.setAttribute("y2", p.target.y);
        lines.push(line);
      }
    });
    $("minimap-pins").replaceChildren(...pins);
    $("minimap-lines").replaceChildren(...lines);
  }

  function makeId(entry) {
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14); // 年月日時分秒
    return `${entry.map}-${entry.side}-${entry.site}-${stamp}`.toLowerCase();
  }

  function update() {
    const map = currentMap();
    renderPoints();

    const yt = parseYouTube($("youtube").value);
    const entry = {
      id: "",
      map: map?.slug,
      agent: $("agent").value,
      side: $("side").value,
      site: $("site").value,
      purpose: $("purpose").value,
      title: $("title").value.trim(),
      points: state.points.map((p) => ({ target: p.target, stand: p.stand })),
      comment: $("comment").value.trim(),
      images: $("images").value.split(",").map((s) => s.trim()).filter(Boolean),
      video: yt ? { youtubeId: yt.youtubeId, start: Number($("start").value) || 0 } : null,
      source: $("source").value.trim(),
      patch: $("patch").value.trim(),
    };
    entry.id = state.editingId || makeId(entry);

    const missing = [];
    state.points.forEach((p, i) => {
      if (!p.target) missing.push(`組${i + 1}の配置位置（ミニマップをクリック）`);
    });
    if (!entry.title) missing.push("タイトル");
    $("output").value = missing.length
      ? `まだ入力が足りません：${missing.join("、")}`
      : JSON.stringify(entry, null, 2);
    $("copy").disabled = missing.length > 0;
    $("save-smoke").disabled = missing.length > 0;
    $("save-smoke").textContent = smokeButtonLabel();
    updateDeleteButton();
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

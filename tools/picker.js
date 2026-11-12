// 登録補助ツール：ミニマップをクリックして座標を取り、smokes.json に貼る1件分を作る
(function () {
  const { LABELS, MAIN_AGENTS, COMMON_AGENT, agentLabel, smokeStyle, loadAll, parseYouTube, store, el } = window.VSN;
  const $ = (id) => document.getElementById(id);
  const BASE = "../"; // tools/ から見たプロジェクトのルート
  const DRAFTS_KEY = "vsn.drafts"; // 取り込んだ下書きの一覧（ページを閉じても残す）

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
    drafts: store.get(DRAFTS_KEY, []), // LLM の下書き。取り込み時に key を付ける
    draftKey: null, // 入力欄に読み込んでいる下書きの key
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
      const wasEditing = state.editingId !== null || state.draftKey !== null;
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
    $("copy-prompt").addEventListener("click", copyPrompt);
    $("import-drafts").addEventListener("click", importDrafts);

    await setupSaving();
    renderMap();
    showMapNote();
    renderEditList();
    renderDrafts();
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
    const draftKey = state.draftKey;
    try {
      await postJson(editing ? "api/smokes/update" : "api/smokes", entry);
      if (editing) state.smokes[state.smokes.findIndex((s) => s.id === entry.id)] = entry;
      else state.smokes.push(entry);
      state.editingId = null;
      // 下書きから保存したときは、その下書きを消して次の下書きを読み込む
      if (draftKey) removeDraft(draftKey);
      else clearSmokeForm();
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
    setDraftKey(null);
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
    setDraftKey(null);
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
    const point = state.points[state.active];
    point[state.mode] = p;
    if (point.tentative) point.tentative[state.mode] = false; // クリックした位置は確定にする
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

  function coordText(p, tentative) {
    return p ? `x=${p.x}, y=${p.y}${tentative ? "（仮）" : ""}` : "未設定";
  }

  function rowButton(text, label, onPick) {
    return el("button", {
      type: "button",
      class: "chip",
      text,
      "aria-label": label,
      onclick: (e) => {
        e.stopPropagation(); // 行のクリック（組や下書きの選択）を起こさない
        onPick();
      },
    });
  }

  function renderPoints() {
    $("points").replaceChildren(
      ...state.points.map((p, i) =>
        el("div", { class: "point-row" + (i === state.active ? " is-active" : ""), onclick: () => selectPoint(i) }, [
          el("span", { class: "point-name", text: `スモーク${i + 1}` }),
          el("span", {
            class: "coord",
            text: `配置位置: ${coordText(p.target, p.tentative?.target)} / 立ち位置: ${coordText(p.stand, p.tentative?.stand)}`,
          }),
          // 下書きの立ち位置が違っていたときに外せるようにする
          p.stand
            ? rowButton("立ち位置を消す", `スモーク${i + 1}の立ち位置を消す`, () => {
                p.stand = null;
                if (p.tentative) p.tentative.stand = false;
                renderMap();
                update();
              })
            : null,
          rowButton("削除", `スモーク${i + 1}を削除`, () => removePoint(i)),
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
            class: "pin" + (active ? " is-selected" : "") + (p.tentative?.target ? " tentative" : ""),
            style: smokeStyle(p.target, $("agent").value, map),
            text: state.points.length > 1 ? String(i + 1) : "★",
          })
        );
      }
      if (p.stand) pins.push(el("span", { class: "stand" + (p.tentative?.stand ? " tentative" : ""), style: pos(p.stand) }));
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
    // 下書きの値が選択肢になかった項目は空になるので、選び直すまで保存させない
    if (!entry.agent) missing.push("エージェント");
    if (!entry.side) missing.push("攻め・守り");
    if (!entry.site) missing.push("サイト");
    if (!entry.purpose) missing.push("目的");
    state.points.forEach((p, i) => {
      if (!p.target) missing.push(`スモーク${i + 1}の配置位置（ミニマップをクリック）`);
      else if (p.tentative?.target) missing.push(`スモーク${i + 1}の配置位置の確定（仮の位置をクリックで直す）`);
      if (p.stand && p.tentative?.stand) missing.push(`スモーク${i + 1}の立ち位置の確定（クリックで直すか消す）`);
    });
    if (!entry.title) missing.push("タイトル");
    $("output").value = missing.length
      ? `まだ入力が足りません：${missing.join("、")}`
      : JSON.stringify(entry, null, 2);
    $("copy").disabled = missing.length > 0;
    $("save-smoke").disabled = missing.length > 0;
    $("save-smoke").textContent = smokeButtonLabel();
    updateDeleteButton();

    // 開始秒を確かめやすいよう、入力中の秒数から動画を開けるようにする
    $("open-video").hidden = !yt;
    if (yt) $("open-video").href = `https://www.youtube.com/watch?v=${encodeURIComponent(yt.youtubeId)}&t=${entry.video.start}s`;
  }

  // ---------- LLM の下書き ----------

  // 場所の名前の書き方。同じマップ内で名前が重なるものだけ英語名を添えて区別する。
  // 依頼文と、下書きから座標への変換の両方でこの書き方を使う
  function calloutKeys(map) {
    const count = {};
    map.callouts.forEach((c) => (count[c.name] = (count[c.name] || 0) + 1));
    return map.callouts.map((c) => ({ key: count[c.name] > 1 ? `${c.name}（${c.nameEn}）` : c.name, callout: c }));
  }

  // 全角・半角や空白の違いでは外れないようにそろえる
  function normalizeName(name) {
    return String(name).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  }

  // 場所の名前を座標にする。一覧の書き方のほか、マップ内で重ならない英語名も受け付ける
  function resolveCallout(map, name) {
    if (!map || typeof name !== "string" || !name.trim()) return null;
    const wanted = normalizeName(name);
    const keys = calloutKeys(map);
    const byKey = keys.find((k) => normalizeName(k.key) === wanted);
    if (byKey) return byKey.callout;
    const byEn = keys.filter((k) => k.callout.nameEn && normalizeName(k.callout.nameEn) === wanted);
    return byEn.length === 1 ? byEn[0].callout : null;
  }

  // maps.json と LABELS から毎回作るので、マップやエージェントを足しても依頼文を直さずに済む
  async function buildPrompt() {
    const res = await fetch("draft-prompt.txt", { cache: "no-cache" });
    if (!res.ok) throw new Error(`draft-prompt.txt を読み込めませんでした (${res.status})`);
    const template = await res.text();
    const list = (entries) => entries.map(([k, v]) => `  - ${k}（${v}）`).join("\n");
    const maps = state.maps
      .map((m) => {
        const names = calloutKeys(m).map(({ key, callout }) =>
          key === callout.name && callout.nameEn ? `${key} (${callout.nameEn})` : key
        );
        return [`### ${m.slug}（${m.nameJa}）`, `- site: ${[...m.sites, "Mid"].join(", ")}`, `- 場所の名前: ${names.join("、")}`].join("\n");
      })
      .join("\n\n");
    return template
      .replace("{{AGENTS}}", list([[COMMON_AGENT, agentLabel(COMMON_AGENT)], ...Object.entries(LABELS.agent)]))
      .replace("{{SIDES}}", list(Object.entries(LABELS.side)))
      .replace("{{PURPOSES}}", list(Object.entries(LABELS.purpose)))
      .replace("{{MAPS}}", maps);
  }

  async function copyPrompt() {
    const button = $("copy-prompt");
    const label = () => "依頼文をコピー";
    try {
      const prompt = await buildPrompt();
      try {
        await navigator.clipboard.writeText(prompt);
        flash(button, "コピーしました", label);
      } catch {
        // クリップボードが使えないときは、貼り付け欄に出して選択しておく
        $("draft-input").value = prompt;
        $("draft-input").select();
        flash(button, "貼り付け欄に出しました（Ctrl+Cでコピー）", label);
      }
    } catch (e) {
      flash(button, e.message, label);
    }
  }

  function showImportMessage(text) {
    $("import-message").hidden = !text;
    $("import-message").textContent = text || "";
  }

  function importDrafts() {
    // LLM がコードブロックの記号を付けて返しても読めるようにする
    const text = $("draft-input").value.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      showImportMessage(`JSON として読めません：${e.message}`);
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const videoUrl = $("draft-video").value.trim();
    const yt = parseYouTube(videoUrl);
    if (videoUrl && !yt) {
      showImportMessage("動画の URL から動画 ID を読み取れません。URL を確かめてください。");
      return;
    }

    const stamp = Date.now();
    const added = [];
    const rejected = [];
    items.forEach((item, i) => {
      if (!item || typeof item !== "object" || !state.maps.some((m) => m.slug === item.map)) {
        rejected.push(`「${item?.title ?? `${i + 1}件目`}」（map: ${item?.map ?? "なし"}）`);
        return;
      }
      const { id, patch, video, ...rest } = item; // id と patch は保存時にツールが付ける
      added.push({ ...rest, key: `d${stamp}-${i}`, youtubeId: yt ? yt.youtubeId : null });
    });

    state.drafts.push(...added);
    store.set(DRAFTS_KEY, state.drafts);
    const messages = [`${added.length}件を取り込みました。`];
    if (rejected.length) {
      messages.push(`map が maps.json にない${rejected.length}件は取り込みませんでした：${rejected.join("、")}`);
    }
    showImportMessage(messages.join(" "));
    if (added.length) $("draft-input").value = "";
    // 何も読み込んでいないときだけ、取り込んだ先頭の下書きを読み込む（入力中の内容を消さない）
    if (!state.draftKey && state.editingId === null && added.length) loadDraft(added[0].key);
    else renderDrafts();
  }

  // 下書きの値のうち、そのままでは使えないものを挙げる
  function draftWarnings(draft) {
    const map = state.maps.find((m) => m.slug === draft.map);
    const warnings = [];
    if (draft.agent !== COMMON_AGENT && !(draft.agent in LABELS.agent)) {
      warnings.push(`エージェント「${draft.agent ?? ""}」は選択肢にありません`);
    }
    if (!(draft.side in LABELS.side)) warnings.push(`攻め・守り「${draft.side ?? ""}」は選択肢にありません`);
    if (map && ![...map.sites, "Mid"].includes(draft.site)) warnings.push(`サイト「${draft.site ?? ""}」は${map.nameJa}にありません`);
    if (!(draft.purpose in LABELS.purpose)) warnings.push(`目的「${draft.purpose ?? ""}」は選択肢にありません`);
    if (draft.start !== undefined && !(Number.isInteger(draft.start) && draft.start >= 0)) {
      warnings.push(`開始秒「${draft.start}」は0以上の整数ではありません`);
    }
    const points = Array.isArray(draft.points) ? draft.points : [];
    if (points.length === 0) warnings.push("points がありません");
    points.forEach((p, i) => {
      if (!resolveCallout(map, p?.targetCallout)) {
        warnings.push(`スモーク${i + 1}の配置位置「${p?.targetCallout ?? ""}」は場所の名前の一覧にありません`);
      }
      if (p?.standCallout != null && !resolveCallout(map, p.standCallout)) {
        warnings.push(`スモーク${i + 1}の立ち位置「${p.standCallout}」は場所の名前の一覧にありません`);
      }
    });
    return warnings;
  }

  function renderDrafts() {
    const mapName = (slug) => state.maps.find((m) => m.slug === slug)?.nameJa || slug;
    $("draft-list").replaceChildren(
      ...state.drafts.map((d) => {
        const count = draftWarnings(d).length;
        return el("li", { class: "draft-item" + (d.key === state.draftKey ? " is-active" : ""), onclick: () => loadDraft(d.key) }, [
          el("span", {
            class: "draft-title",
            text: `${mapName(d.map)}：${d.title || "（タイトルなし）"}（${LABELS.side[d.side] || d.side}・${agentLabel(d.agent)}）`,
          }),
          count ? el("span", { class: "draft-warn", text: `注意 ${count}件` }) : null,
          rowButton("破棄", `下書き「${d.title}」を破棄`, () => removeDraft(d.key)),
        ]);
      })
    );
    $("drafts-summary").textContent = state.drafts.length
      ? `LLM の下書きを取り込む（残り${state.drafts.length}件）`
      : "LLM の下書きを取り込む";

    const current = state.drafts.find((d) => d.key === state.draftKey);
    const warnings = current ? draftWarnings(current) : [];
    $("draft-warnings").hidden = warnings.length === 0;
    $("draft-warnings").replaceChildren(
      ...(warnings.length ? [el("strong", { text: "この下書きの注意" }), el("ul", {}, warnings.map((w) => el("li", { text: w })))] : [])
    );
  }

  function setDraftKey(key) {
    state.draftKey = key;
    renderDrafts();
  }

  // 下書きを入力欄へ読み込む。場所の名前は座標に変え、仮のピンとして置く
  function loadDraft(key) {
    const draft = state.drafts.find((d) => d.key === key);
    if (!draft) return;
    const map = state.maps.find((m) => m.slug === draft.map);
    state.editingId = null;
    $("map").value = draft.map;
    renderMap();
    showMapNote();
    renderEditList();

    // 選択肢にない値は空にして、選び直すまで保存できないようにする
    const choose = (id, value) => {
      $(id).value = value ?? "";
      if ($(id).value !== value) $(id).selectedIndex = -1;
    };
    choose("agent", draft.agent);
    choose("side", draft.side);
    choose("purpose", draft.purpose);
    const start = Number.isInteger(draft.start) && draft.start >= 0 ? draft.start : 0;
    $("title").value = draft.title || "";
    $("comment").value = draft.comment || "";
    $("source").value = draft.source || "";
    $("youtube").value = draft.youtubeId ? `https://youtu.be/${draft.youtubeId}?t=${start}` : "";
    $("start").value = start;
    $("images").value = "";
    $("patch").value = state.pool.patch || "";

    const points = (Array.isArray(draft.points) ? draft.points : []).map((p) => {
      const target = resolveCallout(map, p?.targetCallout);
      const stand = resolveCallout(map, p?.standCallout);
      return {
        target: target && { x: target.x, y: target.y },
        stand: stand && { x: stand.x, y: stand.y },
        tentative: { target: !!target, stand: !!stand },
      };
    });
    state.points = points.length ? points : [newPoint()];
    state.active = 0;
    setMode("target");
    renderMap(); // サイトの選択肢はマップで変わるので、作り直してから選ぶ
    choose("site", draft.site);
    setDraftKey(key);
    update();
  }

  // 一覧から消し、読み込み中の下書きだったときは次の下書きを読み込む（保存と破棄の両方で使う）
  function removeDraft(key) {
    state.drafts = state.drafts.filter((d) => d.key !== key);
    store.set(DRAFTS_KEY, state.drafts);
    if (state.draftKey !== key) {
      renderDrafts();
      return;
    }
    if (state.drafts.length) loadDraft(state.drafts[0].key);
    else clearSmokeForm();
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

// 閲覧サイトの本体
(function () {
  const { LABELS, DEFAULT_AGENT, COMMON_AGENT, agentLabel, smokeStyle, loadAll, formatTime, store, el } = window.VSN;
  const $ = (id) => document.getElementById(id);

  const state = {
    maps: [],
    pool: { pool: [], patch: "" },
    smokes: [],
    notes: {}, // マップの slug ごとのコツ
    map: null, // マップの slug
    side: store.get("vsn.side", "attack"),
    site: "all",
    agent: DEFAULT_AGENT, // 開くたびにこのエージェントから始める
    selected: null, // 選択中の定点 id
    showCallouts: store.get("vsn.callouts", false),
  };

  init();

  async function init() {
    try {
      const data = await loadAll("");
      state.maps = data.maps;
      state.pool = data.pool;
      state.smokes = data.smokes;
      state.notes = data.notes;
    } catch (e) {
      showSetupMessage(e);
      return;
    }

    const poolSlugs = state.pool.pool || [];
    const saved = store.get("vsn.map", null);
    const exists = (slug) => state.maps.some((m) => m.slug === slug);
    state.map = exists(saved) ? saved : poolSlugs.find(exists) || state.maps[0]?.slug;

    $("act-label").textContent = state.pool.act ? `${state.pool.act} / パッチ ${state.pool.patch}` : "";
    $("show-callouts").checked = state.showCallouts;
    $("show-callouts").addEventListener("change", (e) => {
      state.showCallouts = e.target.checked;
      store.set("vsn.callouts", state.showCallouts);
      renderMinimap();
    });

    // メニューは、外側のクリックと Esc で閉じる
    document.addEventListener("click", (e) => {
      if (!e.target.closest(".chip-menu")) closeMenus();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenus();
    });

    renderAll();
  }

  function currentMap() {
    return state.maps.find((m) => m.slug === state.map);
  }

  // 攻め・守りとエージェントの条件に合うか（マップをまたいで使う条件）
  function matchesSideAndAgent(s) {
    const sideOk = state.side === "all" || s.side === state.side;
    const agentOk = state.agent === "all" || s.agent === state.agent || s.agent === COMMON_AGENT;
    return sideOk && agentOk;
  }

  // 今の絞り込み条件に合う定点
  function filteredSmokes() {
    return state.smokes.filter(
      (s) => s.map === state.map && matchesSideAndAgent(s) && (state.site === "all" || s.site === state.site)
    );
  }

  function renderAll() {
    renderMapChips();
    renderSideToggle();
    renderSiteChips();
    renderAgentMenu();
    renderMinimap();
    renderMapNote();
    renderCards();
  }

  // ---------- マップのコツ ----------

  function renderMapNote() {
    const map = currentMap();
    const note = map && state.notes[map.slug];
    const box = $("map-note");
    box.hidden = !note;
    box.replaceChildren(
      ...(note ? [el("h2", { text: `${map.nameJa}のコツ` }), el("p", { text: note })] : [])
    );
  }

  // ---------- 絞り込みUI ----------

  function chip(label, active, onClick, extra) {
    return el(
      "button",
      { type: "button", class: "chip" + (active ? " is-active" : ""), role: "radio", "aria-checked": String(active), onclick: onClick },
      [label, extra ? el("span", { class: "chip-count", text: extra }) : null]
    );
  }

  function renderMapChips() {
    const poolSet = new Set(state.pool.pool || []);
    // サイトはマップごとに違うので、件数には攻め・守りとエージェントの条件だけ反映する
    const countFor = (slug) => state.smokes.filter((s) => s.map === slug && matchesSideAndAgent(s)).length || null;
    const make = (m) =>
      chip(m.nameJa, m.slug === state.map, () => selectMap(m.slug), countFor(m.slug));

    const inPool = state.maps.filter((m) => poolSet.has(m.slug));
    const outPool = state.maps.filter((m) => !poolSet.has(m.slug));
    $("pool-maps").replaceChildren(...inPool.map(make));

    // プール外のマップはメニューにまとめる。選んでいるときはボタンにマップ名を出す
    const current = outPool.find((m) => m.slug === state.map);
    $("other-maps-menu").replaceChildren(
      ...(outPool.length === 0
        ? []
        : [
            chipMenu({
              label: current ? current.nameJa : "プール外のマップ",
              toggleClass: current ? "is-active" : "",
              items: outPool.map((m) => ({
                label: m.nameJa,
                active: m.slug === state.map,
                count: countFor(m.slug),
                onPick: () => selectMap(m.slug),
              })),
            }),
          ])
    );
  }

  function selectMap(slug) {
    state.map = slug;
    state.site = "all";
    state.selected = null;
    store.set("vsn.map", slug);
    renderAll();
  }

  function renderSideToggle() {
    const buttons = [...Object.entries(LABELS.side), ["all", "両方"]].map(([key, label]) =>
      el("button", {
        type: "button",
        class: state.side === key ? "is-active" : "",
        role: "radio",
        "aria-checked": String(state.side === key),
        text: label,
        onclick: () => {
          state.side = key;
          state.selected = null;
          store.set("vsn.side", key);
          renderAll();
        },
      })
    );
    $("side-toggle").replaceChildren(...buttons);
  }

  function renderSiteChips() {
    const map = currentMap();
    const sites = ["all", ...(map?.sites || []), "Mid"];
    $("site-chips").replaceChildren(
      ...sites.map((s) =>
        chip(s === "all" ? "すべて" : s === "Mid" ? "ミッド" : `${s}サイト`, state.site === s, () => {
          state.site = s;
          state.selected = null;
          renderAll();
        })
      )
    );
  }

  function renderAgentMenu() {
    const pick = (a) => {
      state.agent = a;
      state.selected = null;
      renderAll();
    };
    const registered = state.smokes.map((s) => s.agent).filter((a) => a !== COMMON_AGENT);
    const agents = [...new Set([...Object.keys(LABELS.agent), ...registered])];
    const label = state.agent === "all" ? "全員" : agentLabel(state.agent);
    $("agent-menu").replaceChildren(
      chipMenu({
        label,
        // いつものエージェント以外を見ているときは、枠の色で気づけるようにする
        toggleClass: state.agent === DEFAULT_AGENT ? "" : "is-outlined",
        items: [
          { label: "全員", active: state.agent === "all", onPick: () => pick("all") },
          ...agents.map((a) => ({ label: agentLabel(a), active: state.agent === a, onPick: () => pick(a) })),
        ],
      })
    );
  }

  // 標準の select は開いた一覧の角を丸くできないので、ボタンと一覧で作る
  function chipMenu({ label, toggleClass, items }) {
    const list = el(
      "div",
      { class: "chip-menu-list", role: "menu", hidden: true },
      items.map((item) =>
        el(
          "button",
          { type: "button", class: item.active ? "is-active" : "", role: "menuitem", onclick: item.onPick },
          [item.label, item.count ? el("span", { class: "chip-count", text: item.count }) : null]
        )
      )
    );
    const toggle = el("button", {
      type: "button",
      class: `chip chip-menu-toggle ${toggleClass}`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      text: label,
      onclick: () => {
        const opening = list.hidden;
        closeMenus();
        if (!opening) return;
        list.hidden = false;
        toggle.setAttribute("aria-expanded", "true");
        // 右端で画面からはみ出すときは、ボタンの右端に揃えて開く
        list.classList.toggle("align-right", list.getBoundingClientRect().right > document.documentElement.clientWidth - 8);
      },
    });
    return el("div", { class: "chip-menu" }, [toggle, list]);
  }

  function closeMenus() {
    document.querySelectorAll(".chip-menu-list").forEach((list) => (list.hidden = true));
    document.querySelectorAll(".chip-menu-toggle").forEach((b) => b.setAttribute("aria-expanded", "false"));
  }

  // ---------- ミニマップ ----------

  function renderMinimap() {
    const map = currentMap();
    const img = $("minimap-img");
    if (!map) return;
    if (img.getAttribute("src") !== map.minimap) {
      img.src = map.minimap;
      img.alt = `${map.nameJa}のミニマップ`;
    }

    // 場所の名前
    $("minimap-callouts").replaceChildren(
      ...(state.showCallouts ? map.callouts : []).map((c) =>
        el("span", { class: "callout", style: pos(c), text: c.name, title: c.nameEn })
      )
    );

    // ピン（番号付き）と、選択中なら立ち位置との線。1件の定点の円はすべて同じ番号で描く
    const smokes = filteredSmokes();
    const pins = [];
    const lines = [];
    smokes.forEach((s, i) => {
      const selected = s.id === state.selected;
      s.points.forEach((p, j) => {
        const nth = s.points.length > 1 ? `（${j + 1}/${s.points.length}）` : "";
        pins.push(
          el("button", {
            type: "button",
            class: "pin" + (selected ? " is-selected" : ""),
            style: smokeStyle(p.target, s.agent, map, state.agent === "all" ? undefined : state.agent),
            "aria-label": `${i + 1}. ${s.title}${nth}`,
            text: String(i + 1),
            onclick: () => selectSmoke(s.id, true),
          })
        );
        if (selected && p.stand) {
          pins.push(el("span", { class: "stand", style: pos(p.stand), "aria-hidden": "true" }));
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", p.stand.x);
          line.setAttribute("y1", p.stand.y);
          line.setAttribute("x2", p.target.x);
          line.setAttribute("y2", p.target.y);
          lines.push(line);
        }
      });
    });
    $("minimap-pins").replaceChildren(...pins);
    $("minimap-lines").replaceChildren(...lines);
  }

  function pos(p) {
    return `left:${p.x * 100}%;top:${p.y * 100}%`;
  }

  function selectSmoke(id, scrollToCard) {
    state.selected = state.selected === id ? null : id;
    renderMinimap();
    renderCards();
    if (scrollToCard && state.selected) {
      document.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  // ---------- カード ----------

  function renderCards() {
    const smokes = filteredSmokes();
    const map = currentMap();
    const sideLabel = state.side === "all" ? "両方" : LABELS.side[state.side];
    $("result-count").textContent = map ? `${map.nameJa} / ${sideLabel}：${smokes.length}件` : "";

    if (smokes.length === 0) {
      $("cards").replaceChildren(
        el("li", { class: "empty", text: "まだ登録がありません。登録補助ツール（tools/picker.html）から追加できます。" })
      );
      return;
    }
    $("cards").replaceChildren(...smokes.map((s, i) => card(s, i + 1)));
  }

  function card(s, number) {
    const selected = s.id === state.selected;
    const oldPatch = s.patch && state.pool.patch && s.patch !== state.pool.patch;

    const badges = el("div", { class: "badges" }, [
      // 両方を表示しているときは、どちらの定点か分かるようにする
      state.side === "all" ? el("span", { class: "badge badge-agent", text: LABELS.side[s.side] }) : null,
      el("span", { class: "badge", text: s.site === "Mid" ? "ミッド" : `${s.site}サイト` }),
      el("span", { class: "badge", text: LABELS.purpose[s.purpose] || s.purpose }),
      el("span", { class: "badge badge-agent", text: agentLabel(s.agent) }),
      oldPatch ? el("span", { class: "badge badge-warn", text: `パッチ ${s.patch} の情報` }) : null,
    ]);

    const images = (s.images || []).map((src) =>
      el("img", { class: "card-image", src, alt: "照準・立ち位置の画像", loading: "lazy" })
    );

    return el("li", { class: "card" + (selected ? " is-selected" : ""), "data-id": s.id }, [
      el("button", { type: "button", class: "card-head", onclick: () => selectSmoke(s.id, false), "aria-expanded": String(selected) }, [
        el("span", { class: "card-number", text: String(number) }),
        el("span", { class: "card-title", text: s.title }),
      ]),
      badges,
      s.comment ? el("p", { class: "card-comment", text: s.comment }) : null,
      ...images,
      s.video ? videoBlock(s.video) : null,
      s.source ? el("p", { class: "card-source", text: `情報元：${s.source}` }) : null,
    ]);
  }

  // 動画はタップされてから読み込む（ページを軽く保つため）
  function videoBlock(video) {
    const start = video.start || 0;
    const wrap = el("div", { class: "video" });
    const button = el("button", {
      type: "button",
      class: "video-button",
      text: `▶ 動画を見る（${formatTime(start)}〜）`,
      onclick: () => {
        const iframe = el("iframe", {
          src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.youtubeId)}?start=${start}&autoplay=1&playsinline=1`,
          title: "YouTube動画",
          allow: "autoplay; encrypted-media; picture-in-picture",
          allowfullscreen: true,
          loading: "lazy",
        });
        wrap.replaceChildren(iframe);
      },
    });
    wrap.append(button);
    return wrap;
  }

  // ---------- 初期設定がまだのとき ----------

  function showSetupMessage(error) {
    $("app").hidden = true;
    const box = $("setup-message");
    box.hidden = false;
    box.replaceChildren(
      el("h2", { text: "データを読み込めませんでした" }),
      el("p", { text: String(error.message || error) }),
      el("p", { text: "次の2点を確認してください。" }),
      el("ol", {}, [
        el("li", {}, ["ミニマップを取得したか：", el("code", { text: "python3 scripts/fetch_minimaps.py" })]),
        el("li", {}, ["開発用サーバー経由で開いているか：", el("code", { text: "python3 scripts/serve.py" }), " を実行して http://localhost:8000 を開く"]),
      ])
    );
  }
})();

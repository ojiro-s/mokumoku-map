// 閲覧サイトの本体
(function () {
  const { LABELS, MAIN_AGENTS, smokeStyle, loadAll, formatTime, store, el } = window.VSN;
  const $ = (id) => document.getElementById(id);

  const state = {
    maps: [],
    pool: { pool: [], patch: "" },
    smokes: [],
    map: null, // マップの slug
    side: store.get("vsn.side", "attack"),
    site: "all",
    agent: "all",
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

    renderAll();
  }

  function currentMap() {
    return state.maps.find((m) => m.slug === state.map);
  }

  // 今の絞り込み条件に合う定点
  function filteredSmokes() {
    return state.smokes.filter(
      (s) =>
        s.map === state.map &&
        s.side === state.side &&
        (state.site === "all" || s.site === state.site) &&
        (state.agent === "all" || s.agent === state.agent)
    );
  }

  function renderAll() {
    renderMapChips();
    renderSideToggle();
    renderSiteChips();
    renderAgentChips();
    renderMinimap();
    renderCards();
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
    const countFor = (slug) => state.smokes.filter((s) => s.map === slug).length || null;
    const make = (m) =>
      chip(m.nameJa, m.slug === state.map, () => selectMap(m.slug), countFor(m.slug));

    const inPool = state.maps.filter((m) => poolSet.has(m.slug));
    const outPool = state.maps.filter((m) => !poolSet.has(m.slug));
    $("pool-maps").replaceChildren(...inPool.map(make));
    $("other-maps").replaceChildren(...outPool.map(make));
    const details = document.querySelector(".other-maps");
    details.hidden = outPool.length === 0;
    // プール外のマップを選んでいるときは開いておく
    if (!poolSet.has(state.map)) details.open = true;
  }

  function selectMap(slug) {
    state.map = slug;
    state.site = "all";
    state.selected = null;
    store.set("vsn.map", slug);
    renderAll();
  }

  function renderSideToggle() {
    const buttons = Object.entries(LABELS.side).map(([key, label]) =>
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

  function renderAgentChips() {
    const agents = [...new Set(state.smokes.filter((s) => s.map === state.map).map((s) => s.agent))];
    // エージェントが1人分しか登録されていなければ絞り込みは出さない
    if (agents.length < 2) {
      $("agent-chips").replaceChildren();
      state.agent = "all";
      return;
    }
    const pick = (a) => {
      state.agent = a;
      state.selected = null;
      renderAll();
    };
    const label = (a) => LABELS.agent[a] || a;
    const items = ["all", ...agents.filter((a) => MAIN_AGENTS.includes(a))];
    const others = agents.filter((a) => !MAIN_AGENTS.includes(a));
    const chips = items.map((a) => chip(a === "all" ? "全員" : label(a), state.agent === a, () => pick(a)));

    // 普段使わないエージェントは、登録があるときだけプルダウン1つにまとめる
    if (others.length) {
      const isActive = others.includes(state.agent);
      chips.push(
        el(
          "select",
          {
            class: "chip-select" + (isActive ? " is-active" : ""),
            "aria-label": "他のエージェント",
            onchange: (e) => pick(e.target.value || "all"),
          },
          [
            el("option", { value: "", text: "他のエージェント" }),
            ...others.map((a) => el("option", { value: a, text: label(a), selected: state.agent === a })),
          ]
        )
      );
    }
    $("agent-chips").replaceChildren(...chips);
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

    // ピン（番号付き）と、選択中なら立ち位置との線
    const smokes = filteredSmokes();
    const pins = [];
    const lines = [];
    smokes.forEach((s, i) => {
      const selected = s.id === state.selected;
      pins.push(
        el("button", {
          type: "button",
          class: "pin" + (selected ? " is-selected" : ""),
          style: smokeStyle(s.target, s.agent, map),
          "aria-label": `${i + 1}. ${s.title}`,
          text: String(i + 1),
          onclick: () => selectSmoke(s.id, true),
        })
      );
      if (selected && s.stand) {
        pins.push(el("span", { class: "stand", style: pos(s.stand), "aria-hidden": "true" }));
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", s.stand.x);
        line.setAttribute("y1", s.stand.y);
        line.setAttribute("x2", s.target.x);
        line.setAttribute("y2", s.target.y);
        lines.push(line);
      }
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
    $("result-count").textContent = map
      ? `${map.nameJa} / ${LABELS.side[state.side]}：${smokes.length}件`
      : "";

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
      el("span", { class: "badge", text: s.site === "Mid" ? "ミッド" : `${s.site}サイト` }),
      el("span", { class: "badge", text: LABELS.purpose[s.purpose] || s.purpose }),
      el("span", { class: "badge badge-agent", text: LABELS.agent[s.agent] || s.agent }),
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
        el("li", {}, ["簡易サーバー経由で開いているか：", el("code", { text: "python3 -m http.server 8000" }), " を実行して http://localhost:8000 を開く"]),
      ])
    );
  }
})();

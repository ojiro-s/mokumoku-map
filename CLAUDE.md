# CLAUDE.md

このファイルは、このリポジトリで作業するときの Claude Code 向けの案内です。

## 概要

VALORANT のスモーク定点を試合前にスマホで確認するための、自分用の静的 Web ページです。HTML・CSS・JavaScript と JSON だけで動き、ビルドは不要です。GitHub Pages で公開する想定です。セットアップやデータの書き方は `README.md` を参照してください。

## コマンド

```
python3 scripts/serve.py              # 開発用サーバー（http://localhost:8000）。登録補助ツールから data/ へ保存できる
python3 scripts/fetch_minimaps.py     # 未取得のミニマップ画像を取得し、data/maps.json を生成する
```

`index.html` を直接開くと JSON を読み込めないので、必ずサーバー経由で開きます。

## 構成

- `index.html` + `js/app.js`：閲覧ページ。`state` を更新して `renderAll()` で描き直す構成です。
- `tools/picker.html` + `tools/picker.js`：定点とコツの登録補助ツール（PC用）。`scripts/serve.py` で開くと `data/smokes.json` と `data/notes.json` へ直接保存し、定点の編集と削除もできます。それ以外のサーバーではコピーと貼り付けの手順になります。
- `js/common.js`：両ページの共通処理を `window.VSN` として公開します（ラベル、JSON の読み込み、YouTube URL の解析、localStorage、DOM 生成の `el()`）。
- `css/style.css`：両ページで共有します。変更したら `tools/picker.html` の表示も確認します。スマホ基準で書き、`min-width: 900px` で2列に広げます。
- `data/notes.json`：マップごとのコツ（slug と本文の組）。`tools/picker.html` で書きます。
- `data/pool.json`：現在のアクト、パッチ、マッププールを手で管理します。
- `data/maps.json`：`scripts/fetch_minimaps.py` が生成します。手で編集しません。

## 注意点

- 定点の座標はミニマップ画像に対する 0〜1 の比率です。画像が変わるとピンの位置がずれるので、`--force` で取り直したときはそのマップの定点を見直します。
- Riot のファンコンテンツポリシーを守ります。リポジトリ名や URL に Riot の商標やキャラクター名を入れない、広告や有料化をしない、他の人の動画の画像を切り出さない、試合中のオーバーレイにしない。フッターの英語の定型文は変更しません。

## 運用ルール

### 環境
- 技術スタック: HTML / CSS / JavaScript と JSON（ビルド不要）、`scripts/` は Python 3
- 起動: `python3 scripts/serve.py`
- テスト: なし（テストの仕組みは未導入）
- 型チェックとlint: なし（未導入）
- 依存の導入: パッケージの追加は私が実行する。

### 開発中の確認
- UIを変更したら、実際に動く画面で確認する。テストの成功だけで完了としない。
- 実環境で確認できなかった項目は、未検証と明記する。

### 再開時の情報
- ここには「次の1手」と決定事項だけを書く。完了したタスクの経緯は書かない。
- 次にやること: 1件の定点に複数のスモーク位置を持たせる（smokes.json の target と stand を points 配列にする）。その後、LLM が作った下書きの取り込みを登録補助ツールに追加する。別途、スマホ実機で公開ページの表示を確認する。

### 決定事項(再検討しない)
検証して「変更しない」と決めたことは、理由を添えてここに書く。
- ピンの円の半径は `SMOKE_RADIUS_M` の現在の値のままにする — ゲーム内のアビス Aブリッジで比べると円がわずかに大きい程度で、違和感がないため。より正しい半径の情報が取れたときだけ更新する。

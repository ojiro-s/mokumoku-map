# スモーク定点ノート

VALORANT のスモーク定点を、試合前にスマホで確認するための自分用 Web ページです。
HTML・CSS・JavaScript と JSON だけで動きます（ビルド不要）。

## フォルダ構成

```
index.html            閲覧ページ（スマホ基準）
tools/picker.html     登録補助ツール（PC用・ミニマップをクリックして座標を取る）
data/smokes.json      定点データ（自分で追記していく）
data/pool.json        今のマッププール（アクトが変わったら書き換える）
data/maps.json        マップ情報（スクリプトで自動生成）
assets/minimaps/      ミニマップ画像（スクリプトで自動取得）
images/               自分で撮った照準・立ち位置のスクショ置き場
scripts/fetch_minimaps.py  ミニマップ取得スクリプト
```

## はじめにやること（1回だけ）

1. ミニマップを取得する

   ```
   python3 scripts/fetch_minimaps.py
   ```

   全標準マップのミニマップ画像と、場所の名前（コールアウト）を取得して `data/maps.json` を作ります。
   取得元は valorant-api.com（コミュニティ運営の非公式API）です。

2. 簡易サーバーを起動して開く

   ```
   python3 -m http.server 8000
   ```

   ブラウザで http://localhost:8000 を開きます。
   VSCode の拡張機能「Live Server」を使っても構いません。
   ※ index.html をダブルクリックで開くと、ブラウザの制限で JSON を読み込めません。

## 定点を追加する手順

1. 簡易サーバーを起動した状態で http://localhost:8000/tools/picker.html を開く
2. マップを選び、ミニマップ上で「スモークの配置位置」をクリック（オーメンは続けて「立ち位置」もクリック）
3. エージェント（最初は「全キャラ共通」）、攻め・守り、サイト、目的、タイトル、コツを入力
4. 解説動画があれば YouTube の URL を貼る（共有ボタンの「開始位置」をオンにした URL なら開始秒も入ります）
5. 「コピーする」を押して、`data/smokes.json` の最後に貼り付ける（前の項目の `}` の後ろに `,` を付ける）
6. 最初に入っている【サンプル】の項目は削除する

照準のスクショを載せたいときは `images/マップ名/` に画像を置き、ツールの「画像のパス」欄にパスを書きます。

## データの項目（data/smokes.json）

| 項目 | 内容 | 例 |
|---|---|---|
| id | 重複しない名前（ツールが自動で付けます） | `bind-attack-a-2611011234` |
| map | マップ（maps.json の slug） | `bind` |
| agent | エージェント（`js/common.js` の `LABELS.agent` にある名前）。`All` は全キャラ共通で、どのエージェントを選んでいても表示されます | `All` / `Omen` / `Clove` / `Viper` など |
| side | 攻め・守り | `attack` / `defense` |
| site | サイト | `A` / `B` / `C` / `Mid` |
| purpose | 目的 | `entry` / `retake` / `postplant` / `oneway` / `other` |
| title | タイトル | `Aショートを焚く` |
| target | スモークの配置位置（ミニマップに対する0〜1の比率） | `{"x": 0.42, "y": 0.31}` |
| stand | 立ち位置（任意） | `{"x": 0.40, "y": 0.70}` または `null` |
| comment | コツ（改行可） | |
| images | 画像のパスの配列（任意） | `["images/bind/a-short.jpg"]` |
| video | YouTube 動画（任意） | `{"youtubeId": "xxxx", "start": 83}` または `null` |
| source | 情報元（任意） | `〇〇さん` |
| patch | 登録したときのパッチ | `13.08` |

`patch` が `data/pool.json` のパッチと違うと、カードに「パッチ ○○ の情報」と表示されます。
マップ改修で位置が変わっていないか確認する目安にしてください。

ピンの円はスモークの実寸です。半径は `js/common.js` の `SMOKE_RADIUS_M`、マップごとの縮尺は `data/maps.json` の `meterRatio`（`scripts/fetch_minimaps.py` が生成）から計算します。
パッチで半径が変わったら `SMOKE_RADIUS_M` を直してください。エージェントを追加するときは、ここに半径を、`LABELS.agent` に表示名を足します。
閲覧ページを開いたときのエージェントは `DEFAULT_AGENT`（オーメン）で、マップの下のメニューから変えられます。全キャラ共通の定点は、表示中のエージェントのスモークの大きさで描きます。
登録補助ツールの選択肢で先頭に並べるエージェントは `MAIN_AGENTS` で指定します。

表示を確認したいときは、URL に `?test` を付けて開きます（例：`http://localhost:8000/?test`）。`data/smokes.json` の代わりに、エージェント9人分の確認用データ `data/smokes.test.json` を読み込みます。本物のデータには影響しません。

## アクトが変わったら

`data/pool.json` の `act`・`patch`・`pool`（マップの slug の一覧）を書き換えるだけです。
新マップが追加されたときは、もう一度 `python3 scripts/fetch_minimaps.py` を実行します。

既存のミニマップ画像は上書きしません。画像が変わると登録済みのピンの位置がずれるためです。
マップ改修で画像を取り直したいときだけ `--force` を付けて実行し、そのマップの定点を見直してください。

## GitHub Pages で公開する

1. GitHub に公開リポジトリを作って、このフォルダの中身をすべて push する（`data/maps.json` と `assets/minimaps/` も含める）
2. リポジトリの Settings → Pages で、公開するブランチ（例：main）とフォルダ（/root）を選ぶ
3. 表示された URL をスマホで開く（ホーム画面に追加しておくと試合前にすぐ開けます）

### 公開する前に必ずやること

- `index.html` のフッターにある案内コメントの位置に、Riot Games の「Legal Jibber Jabber」第6項の英語の定型文を貼る
  （https://www.riotgames.com/en/legal ）
- リポジトリ名や URL に「valorant」やエージェント名など Riot の商標・キャラクター名を入れない
- 広告や有料化はしない（無料・非営利のファンプロジェクトとして公開する）
- 他の人の動画の画像を切り出して載せない（動画は埋め込み再生だけにする）

## 注意

- 試合中にゲーム画面へ重ねて使うものではありません（Riot のポリシー上、リアルタイムに行動を指示するオーバーレイは認められていません）
- ミニマップ画像とマップ名の権利は Riot Games にあります

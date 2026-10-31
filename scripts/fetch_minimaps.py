"""
ミニマップ画像とコールアウト（場所の呼び名）を取得して data/maps.json を作るスクリプト。

使い方（プロジェクトのフォルダで実行）:
    python3 scripts/fetch_minimaps.py           # 未取得の画像だけダウンロード
    python3 scripts/fetch_minimaps.py --force   # 画像を取り直す（ピンがずれる可能性あり）

取得元: valorant-api.com（コミュニティ運営の非公式API。画像の権利はRiot Gamesにあります）
外部ライブラリは不要です（Python 3.8以上の標準機能だけで動きます）。
"""

import argparse
import json
import re
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

API_URL = "https://valorant-api.com/v1/maps?language={lang}"
ROOT = Path(__file__).resolve().parent.parent
MINIMAP_DIR = ROOT / "assets" / "minimaps"
OUT_JSON = ROOT / "data" / "maps.json"
USER_AGENT = "valo-smoke-notes/1.0 (personal fan project)"


def fetch_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.load(res)


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as res:
        dest.write_bytes(res.read())


def slugify(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def parse_sites(tactical_description):
    """'A/B/C Sites' -> ['A', 'B', 'C']"""
    if not tactical_description:
        return []
    head = tactical_description.split()[0]
    return [s for s in head.split("/") if re.fullmatch(r"[A-Z]", s)]


def is_standard_map(m):
    """爆破ルールの標準マップだけ残す（チームデスマッチ用マップや射撃場は除外）"""
    return bool(m.get("tacticalDescription")) and bool(m.get("displayIcon")) and bool(m.get("callouts"))


def to_normalized(location, m, swap):
    """ゲーム内座標 -> ミニマップ画像上の 0〜1 の比率"""
    gx, gy = location["x"], location["y"]
    if swap:
        gx, gy = gy, gx
    x = gx * m["xMultiplier"] + m["xScalarToAdd"]
    y = gy * m["yMultiplier"] + m["yScalarToAdd"]
    return x, y


def choose_swap(m):
    """
    座標変換で x と y を入れ替えるかどうかを自動判定する。
    コールアウトがミニマップの範囲（0〜1）に多く収まる方を採用する。
    """
    def inside_ratio(swap):
        pts = [to_normalized(c["location"], m, swap) for c in m["callouts"]]
        ok = sum(1 for x, y in pts if -0.05 <= x <= 1.05 and -0.05 <= y <= 1.05)
        return ok / len(pts)

    r_swap, r_plain = inside_ratio(True), inside_ratio(False)
    return (True, r_swap) if r_swap >= r_plain else (False, r_plain)


def build_callouts(m_en, m_ja, swap):
    ja_list = m_ja.get("callouts") or []
    result = []
    for i, c in enumerate(m_en["callouts"]):
        cj = ja_list[i] if i < len(ja_list) else c
        x, y = to_normalized(c["location"], m_en, swap)
        result.append({
            "nameEn": f'{c.get("superRegionName", "")} {c.get("regionName", "")}'.strip(),
            "name": f'{cj.get("superRegionName", "")} {cj.get("regionName", "")}'.strip(),
            "x": round(x, 4),
            "y": round(y, 4),
        })
    return result


def main():
    parser = argparse.ArgumentParser(description="ミニマップ画像とコールアウトを取得します")
    parser.add_argument("--force", action="store_true", help="既存の画像も取り直す")
    args = parser.parse_args()

    print("マップ情報を取得中...")
    try:
        en = fetch_json(API_URL.format(lang="en-US"))["data"]
        ja = fetch_json(API_URL.format(lang="ja-JP"))["data"]
    except Exception as e:  # ネットワークエラーなど
        print(f"取得に失敗しました: {e}", file=sys.stderr)
        sys.exit(1)

    ja_by_uuid = {m["uuid"]: m for m in ja}
    MINIMAP_DIR.mkdir(parents=True, exist_ok=True)

    maps_out = []
    kept_existing = False
    for m in en:
        if not is_standard_map(m):
            continue
        mj = ja_by_uuid.get(m["uuid"], m)
        slug = slugify(m["displayName"])
        img_path = MINIMAP_DIR / f"{slug}.png"

        if img_path.exists() and not args.force:
            status = "既存の画像を使用"
            kept_existing = True
        else:
            download(m["displayIcon"], img_path)
            status = "ダウンロード"

        swap, ratio = choose_swap(m)
        maps_out.append({
            "uuid": m["uuid"],
            "slug": slug,
            "name": m["displayName"],
            "nameJa": mj.get("displayName") or m["displayName"],
            "sites": parse_sites(m["tacticalDescription"]),
            "minimap": f"assets/minimaps/{slug}.png",
            "callouts": build_callouts(m, mj, swap),
        })
        warn = "" if ratio >= 0.8 else "  ※コールアウト位置がずれている可能性があります"
        print(f"  {m['displayName']:<10} {status}（コールアウト {len(m['callouts'])}件）{warn}")

    maps_out.sort(key=lambda x: x["name"])
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    OUT_JSON.write_text(json.dumps({
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "valorant-api.com",
        "maps": maps_out,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n{len(maps_out)}マップを {OUT_JSON.relative_to(ROOT)} に書き出しました。")
    if kept_existing:
        print("（既存の画像は上書きしていません。登録済みのピンの位置を守るためです）")


if __name__ == "__main__":
    main()

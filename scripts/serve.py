"""
登録補助ツールから data/ の JSON へ直接保存できる開発用サーバー。

使い方:
    python3 scripts/serve.py          # http://localhost:8000 で開く
    python3 scripts/serve.py 8080     # ポートを変える

自分の PC の中だけで動きます（127.0.0.1 にのみ接続を受け付けます）。
外部ライブラリは不要です。公開先の GitHub Pages では動かないので、
公開ページの登録補助ツールには保存ボタンが出ません。
"""

import json
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NOTES_PATH = ROOT / "data" / "notes.json"
SMOKES_PATH = ROOT / "data" / "smokes.json"
MAX_BODY_BYTES = 1024 * 1024
SLUG = re.compile(r"[a-z0-9-]+")
SMOKE_REQUIRED = ("id", "map", "agent", "side", "site", "title", "points")


class BadRequest(Exception):
    """保存の依頼の内容が正しくないときに使う"""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def write_json(path, data):
    """書き込みの途中で失敗しても元のファイルが壊れないよう、別名で書いてから置き換える"""
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, path)


def save_notes(body):
    """変更のあったマップだけ反映する。空の本文はそのマップのコツを消す"""
    changes = body.get("notes")
    if not isinstance(changes, dict) or not changes:
        raise BadRequest(400, "notes がありません")
    notes = json.loads(NOTES_PATH.read_text(encoding="utf-8"))
    for slug, note in changes.items():
        if not SLUG.fullmatch(slug) or not isinstance(note, str):
            raise BadRequest(400, f"正しくない項目です: {slug}")
        if note.strip():
            notes[slug] = note.strip()
        else:
            notes.pop(slug, None)
    write_json(NOTES_PATH, dict(sorted(notes.items())))
    return {"saved": len(changes)}


def check_smoke(body):
    """必須項目と、points の各組に配置位置があるかを確かめる"""
    missing = [k for k in SMOKE_REQUIRED if not body.get(k)]
    if missing:
        raise BadRequest(400, f"足りない項目があります: {', '.join(missing)}")
    points = body["points"]
    if not isinstance(points, list):
        raise BadRequest(400, "points は配列にしてください")
    for i, point in enumerate(points, 1):
        if not isinstance(point, dict) or not isinstance(point.get("target"), dict):
            raise BadRequest(400, f"{i}組目に配置位置（target）がありません")


def save_smoke(body):
    """定点を1件、一覧の最後に追加する"""
    check_smoke(body)
    smokes = json.loads(SMOKES_PATH.read_text(encoding="utf-8"))
    if any(s.get("id") == body["id"] for s in smokes):
        raise BadRequest(409, f"同じ id が登録済みです: {body['id']}")
    smokes.append(body)
    write_json(SMOKES_PATH, smokes)
    return {"count": len(smokes)}


def update_smoke(body):
    """同じ id の定点を、一覧の位置を保ったまま置き換える"""
    check_smoke(body)
    smokes = json.loads(SMOKES_PATH.read_text(encoding="utf-8"))
    for i, smoke in enumerate(smokes):
        if smoke.get("id") == body["id"]:
            smokes[i] = body
            write_json(SMOKES_PATH, smokes)
            return {"count": len(smokes)}
    raise BadRequest(404, f"この id の定点がありません: {body['id']}")


def delete_smoke(body):
    """同じ id の定点を一覧から取り除く"""
    smoke_id = body.get("id")
    if not smoke_id:
        raise BadRequest(400, "id がありません")
    smokes = json.loads(SMOKES_PATH.read_text(encoding="utf-8"))
    remaining = [s for s in smokes if s.get("id") != smoke_id]
    if len(remaining) == len(smokes):
        raise BadRequest(404, f"この id の定点がありません: {smoke_id}")
    write_json(SMOKES_PATH, remaining)
    return {"count": len(remaining)}


ROUTES = {
    "/api/notes": save_notes,
    "/api/smokes": save_smoke,
    "/api/smokes/update": update_smoke,
    "/api/smokes/delete": delete_smoke,
}


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # 修正した JS や CSS が古いまま残らないよう、毎回確認させる
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_GET(self):
        if self.path == "/api/status":
            self.send_json(200, {"canSave": True})
            return
        super().do_GET()

    def do_POST(self):
        try:
            handler = ROUTES.get(self.path)
            if handler is None:
                raise BadRequest(404, "保存先がありません")
            self.check_request()
            self.send_json(200, handler(self.read_body()))
        except BadRequest as e:
            self.send_json(e.status, {"error": e.message})
        except (OSError, ValueError) as e:
            self.send_json(500, {"error": f"保存に失敗しました: {e}"})

    def check_request(self):
        """閲覧中の別サイトから、この PC のファイルを書き換えられないようにする"""
        port = self.server.server_address[1]
        allowed = {f"localhost:{port}", f"127.0.0.1:{port}"}
        if self.headers.get("Host") not in allowed:
            raise BadRequest(403, "接続元が正しくありません")
        origin = self.headers.get("Origin")
        if origin is not None and origin.removeprefix("http://") not in allowed:
            raise BadRequest(403, "接続元が正しくありません")
        # application/json は別サイトから事前確認なしで送れない
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise BadRequest(415, "Content-Type が正しくありません")

    def read_body(self):
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            raise BadRequest(411, "Content-Length がありません") from None
        if length > MAX_BODY_BYTES:
            raise BadRequest(413, "データが大きすぎます")
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except ValueError:
            raise BadRequest(400, "JSON として読めません") from None
        if not isinstance(body, dict):
            raise BadRequest(400, "JSON の形が正しくありません")
        return body

    def send_json(self, status, data):
        payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    handler = partial(Handler, directory=str(ROOT))
    with ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"http://localhost:{port} で起動しました（Ctrl+C で停止）")
        print(f"登録補助ツール: http://localhost:{port}/tools/picker.html")
        server.serve_forever()


if __name__ == "__main__":
    main()

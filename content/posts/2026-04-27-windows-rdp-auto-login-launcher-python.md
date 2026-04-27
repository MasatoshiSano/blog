---
title: "接続先PCに設定不要で自動ログインするRDPランチャをPythonで作る — cmdkey + .rdp動的生成"
emoji: "🖥️"
type: "tech"
topics: ["Python", "Windows", "RDP", "customtkinter", "PyInstaller", "Desktop"]
published: true
category: "HowTo"
date: "2026-04-27"
description: "複数の社内PCへ毎回IDとパスワードを手入力する手間を、cmdkeyとmstscの組み合わせで自動化する。接続先PCには一切手を入れずに動作するRDPランチャをPythonで実装し、単一exeで配布する手順をまとめた。"
coverImage: "/images/posts/windows-rdp-auto-login-launcher-python-cover.jpg"
---

## 概要

社内に点在する複数台のサーバ・作業用PCへ、毎回 `mstsc` を起動して資格情報を入力するのは退屈な作業です。Microsoft純正の方法では「資格情報を保存」にチェックを入れる必要があり、配布もできません。

本記事では、**接続先PC側に一切設定を加えず**に複数PCへワンクリック自動ログインできるRDPランチャを Python + customtkinter で作り、PyInstallerで単一exeとして配布するまでの実装パターンを共有します。

仕組みのコアは `cmdkey` による資格情報の一時注入と `.rdp` ファイルの動的生成です。接続後はバックグラウンドスレッドで資格情報を自動削除するため、認証情報がWindows資格情報マネージャに残らない点も特徴です。

## こんな人向け

- 複数の社内サーバや検証PCへ毎回パスワードを入力していて辛い
- 「RDP 自動ログイン」「cmdkey TERMSRV Python」「mstsc パスワード 自動入力」で検索して、どれもしっくりこなかった
- 接続先PCを触らずに済ませたい(エンタープライズ環境で再現性が欲しい)
- Python製GUIアプリを単一exeで配布したい
- AIコーディングで「mstsc /v」や「.rdpファイルにパスワードハッシュ埋め込み」を提案されて違和感があった

## 前提条件

- Windows 10/11
- Python 3.11+
- 接続先PCで「リモートデスクトップ接続を許可する」が有効になっていること（これは前提）
- 接続元PCで `cmdkey` と `mstsc` が使えること（標準搭載）

## 仕組み

最初に全体像を整理します。

```
┌────────────────────────────────────────────┐
│ 1. cmdkey /generic:TERMSRV/<host> ...      │  資格情報を一時登録
├────────────────────────────────────────────┤
│ 2. temp.rdp を生成 (host のみ書き込み)     │  認証情報はファイルに含めない
├────────────────────────────────────────────┤
│ 3. mstsc temp.rdp を起動                   │  Windowsが資格情報マネージャを参照
├────────────────────────────────────────────┤
│ 4. 5秒後に cmdkey /delete で削除 (別Thread)│  資格情報を残さない
└────────────────────────────────────────────┘
```

ポイントは2点です。

1. **`.rdp` にパスワードを埋めない**: 古いネット記事には「`password 51:b:<暗号化パスワード>`」を `.rdp` に書く方法が紹介されていますが、これは **同じユーザー・同じPC** でしか復号できないハッシュであり、配布できません。
2. **Windows資格情報マネージャを経由する**: `cmdkey /generic:TERMSRV/<host>` で登録すると、`mstsc` がそのホスト宛接続時に自動で参照します。これが「接続先に手を入れない」を成立させる中核です。

## 最小実装(標準ライブラリのみ)

GUIを作る前に、標準ライブラリだけで動くコアロジックを作ります。これだけで自動ログインは成立します。

```python
# rdp.py
import os
import subprocess
import tempfile
import threading
import time
from pathlib import Path

CREATE_NO_WINDOW = 0x08000000  # subprocess に黒いコンソールを出させない


def _run_hidden(args: list[str]) -> None:
    subprocess.run(args, creationflags=CREATE_NO_WINDOW, capture_output=True, text=True)


def _store_credential(host: str, user: str, password: str) -> None:
    target = f"TERMSRV/{host}"
    _run_hidden(["cmdkey", f"/generic:{target}", f"/user:{user}", f"/pass:{password}"])


def _delete_credential(host: str) -> None:
    _run_hidden(["cmdkey", f"/delete:TERMSRV/{host}"])


def _write_rdp_file(host: str) -> Path:
    content = "\r\n".join([
        "screen mode id:i:2",
        f"full address:s:{host}",
        "prompt for credentials:i:0",
        "authentication level:i:0",
        "",
    ])
    fd, path = tempfile.mkstemp(prefix="rdp_", suffix=".rdp", text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(content)
    return Path(path)


def _cleanup_later(host: str, rdp_path: Path, delay: float = 5.0) -> None:
    def worker() -> None:
        time.sleep(delay)
        _delete_credential(host)
        rdp_path.unlink(missing_ok=True)
    threading.Thread(target=worker, daemon=True).start()


def connect(host: str, user: str, password: str) -> None:
    _store_credential(host, user, password)
    rdp_path = _write_rdp_file(host)
    subprocess.Popen(["mstsc", str(rdp_path)], creationflags=CREATE_NO_WINDOW)
    _cleanup_later(host, rdp_path)


if __name__ == "__main__":
    connect("192.168.1.10", "admin", "P@ssw0rd")
```

これを `python rdp.py` で実行すると、認証画面なしでリモートデスクトップが開きます。

### なぜ `.rdp` を一時ファイルにするのか

`mstsc /v:<host>` という直接指定もできます。しかし、画面サイズ・クリップボード共有・認証レベルなどの細かい挙動を制御したくなった瞬間に行き詰まります。`.rdp` ファイル経由なら全オプションを宣言的に書けるので、最初からこちらを推奨します。

### なぜ5秒待ってから資格情報を削除するのか

`mstsc` は起動直後に資格情報マネージャを参照しますが、その参照タイミングは非同期です。即座に `cmdkey /delete` すると、**接続が確立する前に資格情報が消えて認証ダイアログが出る** ことがあります。経験的には2〜3秒で十分ですが、安全マージンとして5秒に設定しています。

## customtkinter でGUI化

複数PCを管理したいので、登録・選択・接続のGUIを乗せます。`customtkinter` はモダンな見た目を `tkinter` 互換APIで提供してくれるライブラリで、依存も軽量です。

```python
# ui.py (抜粋)
import customtkinter as ctk
import tkinter.messagebox as mb
from rdp import connect

class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Remote PC Manager")
        self.geometry("760x560")
        ctk.set_appearance_mode("system")

        # PC一覧をカード表示するスクロール領域
        self.list_frame = ctk.CTkScrollableFrame(self, fg_color="transparent")
        self.list_frame.pack(fill="both", expand=True, padx=16, pady=16)

    def render_card(self, pc):
        card = ctk.CTkFrame(self.list_frame, corner_radius=10)
        card.pack(fill="x", pady=6)
        ctk.CTkLabel(card, text=pc["name"], font=ctk.CTkFont(size=15, weight="bold")).pack(side="left", padx=14)
        ctk.CTkButton(card, text="接続", width=72,
                      command=lambda: self._connect(pc)).pack(side="right", padx=10, pady=10)

    def _connect(self, pc):
        try:
            connect(pc["host"], pc["user"], pc["password"])
        except Exception as e:
            mb.showerror("接続エラー", str(e), parent=self)

App().mainloop()
```

PCの永続化は `pcs.json` に平文で書き出すだけで十分です（信頼環境前提）。マスターパスワードを入れたい場合は `cryptography` で AES 暗号化する選択肢もありますが、要件次第で省きます。YAGNI です。

## PyInstaller で単一exe化(ここがハマりどころ)

`pyinstaller --onefile --windowed main.py` を素直に走らせると、**起動直後に customtkinter のテーマファイルが見つからずクラッシュ** します。

### ❌ よくあるエラー

```
FileNotFoundError: [Errno 2] No such file or directory:
'...\\customtkinter\\assets\\themes\\blue.json'
```

これは PyInstaller が `customtkinter/assets/` 配下の JSON テーマや TCL ウィジェット定義をデフォルトでバンドルしてくれないためです。

### ✅ 正しい呼び出し

`--add-data` で customtkinter のパッケージディレクトリを丸ごと同梱します。

```bat
@echo off
for /f "delims=" %%i in ('python -c "import customtkinter, os; print(os.path.dirname(customtkinter.__file__))"') do set CTK_PATH=%%i

pyinstaller --noconfirm --onefile --windowed ^
  --name RemotePC ^
  --add-data "%CTK_PATH%;customtkinter" ^
  main.py
```

ポイント:
- `--add-data` の区切り文字は **Windowsはセミコロン `;`**、Linux/Macはコロン `:`
- `customtkinter` のパスは Python 側に聞く（venv のパスがハードコードにならない）
- `--onefile` の場合、起動時に一時ディレクトリへ展開されるため、`pcs.json` 等のデータファイルは `sys.executable` のディレクトリ基準で読み書きする

### データファイルの保存先を切り替える

`--onefile` 時の作業ディレクトリは `_MEIxxxx` という一時フォルダです。設定ファイルをここに書くと毎回消えるので、exe と同じ場所に保存するよう切り替えます。

```python
# storage.py
import sys
from pathlib import Path

def get_data_dir() -> Path:
    if getattr(sys, "frozen", False):       # PyInstallerで固められた状態
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent  # 開発実行時
```

これで `dist/RemotePC.exe` を任意のフォルダに置けば、その場所で `pcs.json` を作り続ける配布形態が成立します。

## ポイント・注意点

| 項目 | 落とし穴 | 正解 |
|------|---------|------|
| 資格情報の登録キー | `host` だけだと参照されない | `TERMSRV/<host>` 形式が必須 |
| `.rdp` の改行コード | LF だと読み込まれない場合がある | CRLF (`\r\n`) で書く |
| `cmdkey /delete` のタイミング | 即削除すると認証ダイアログが出る | 5秒程度のマージンを取る |
| customtkinter の同梱 | `--onefile` だけでは不足 | `--add-data` で `customtkinter/` を丸ごと指定 |
| 永続化の場所 | `_MEIxxxx` に書くと消える | `Path(sys.executable).parent` を使う |
| パスワード保管 | `.rdp` に直接書く方式は古い | `cmdkey` 経由に統一 |

## まとめ

- 接続先に手を入れずに自動ログインRDPを実装するなら、`cmdkey /generic:TERMSRV/<host>` + `.rdp` 動的生成 + 接続後削除の3点セット
- `.rdp` にパスワードハッシュを埋める方式は配布できないので捨てる
- customtkinter を PyInstaller で固めるときは `--add-data` でアセット同梱を忘れない
- `--onefile` でデータファイルを使うなら `sys.executable` 基準のパスに切り替える

完成品のソースは [MasatoshiSano/remote-pc](https://github.com/MasatoshiSano/remote-pc) に置いてあります。

## バイブコーディングで実装する

この記事の内容をAIコーディングアシスタントに実装させるためのプロンプト:

> Windows用のリモートPC接続マネージャを Python + customtkinter で作ってください。要件:
>
> 1. **接続先PCに一切設定を加えない**こと。`cmdkey /generic:TERMSRV/<host> /user:<user> /pass:<password>` でWindows資格情報マネージャに資格情報を一時登録し、`.rdp`ファイルを動的生成して `mstsc` を起動する方式を使う。`.rdp`ファイルにパスワードハッシュを埋める古い方式は使わない。
> 2. 接続後5秒経過したらバックグラウンドスレッドで `cmdkey /delete:TERMSRV/<host>` を実行して資格情報を削除する。あわせて一時 `.rdp` ファイルも削除する。
> 3. PCは複数登録可能。各PCに「PC名 / IP or ホスト / ユーザー / パスワード / 任意のリンク(URL or UNC)」を保持する。
> 4. データは exe と同じディレクトリの `pcs.json` に平文JSONで保存する。`getattr(sys, "frozen", False)` で実行環境を判定し、PyInstallerでバンドルされた場合は `Path(sys.executable).parent` を使う。
> 5. UIは customtkinter を使い、PCをカード形式で並べて「接続/リンクを開く/編集/削除」ボタンを持たせる。
> 6. PyInstaller で `--onefile --windowed` で単一exe化する build.bat を用意する。**customtkinter のアセットを `--add-data "<customtkinter_dir>;customtkinter"` で同梱**しないとテーマファイル不足で起動失敗するので必ず含めること。
> 7. `subprocess.run` / `subprocess.Popen` の呼び出しには `creationflags=0x08000000` (CREATE_NO_WINDOW) を付与し、コンソール窓を出さない。
>
> 構成:
> - main.py / app/models.py / app/storage.py / app/rdp.py / app/dialog.py / app/ui.py / build.bat / requirements.txt

### AIに指示するときのポイント

- **「.rdpにパスワードを埋め込む」方式を選ばせない**: 古い記事を学習しているAIは `password 51:b:...` をRDPファイルに書く方式を提案しがちです。「`cmdkey` で資格情報マネージャ経由」を最初に明示してください。
- **資格情報のキーは `TERMSRV/<host>` を明示する**: ただの `<host>` では `mstsc` が参照しないので、必ず `TERMSRV/` プレフィックスを付けることを伝えます。
- **`--onefile` のデータパス問題を先回りする**: AIに任せると `Path(__file__).parent` を使われて、exe実行時に一時ディレクトリ `_MEIxxxx` 配下に書かれて消える事故が起きます。`sys.executable` 基準を最初から指示してください。
- **`--add-data` のOS差異を明示する**: 「Windowsなのでセミコロン区切り」と書かないとコロン区切り版を生成されてビルドが壊れます。
- **削除タイミングのマージンを伝える**: 「即削除でなく5秒後」と数値で書かないと、AIは即削除のクリーンなコードを書きがちで認証ダイアログが出る不具合になります。

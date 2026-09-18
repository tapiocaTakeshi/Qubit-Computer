# QubitOS デスクトップ版（Electron）

`app/` の Web ビルドをそのまま Electron のウィンドウに載せた**デスクトップ版**です。Windows 向けには
インストーラ（NSIS の `.exe`）とインストール不要の portable 版を生成します。中身はブラウザ版と同一で、
カーネル・qsh・QubitFS・qpm もそのまま動きます。

```text
desktop/
├── main.js                 ウィンドウ生成と qubitos:// スキームのハンドラ
├── electron-builder.yml    パッケージング設定（win: nsis + portable, mac: dmg, linux: AppImage）
├── scripts/sync-web.mjs    ../app/dist → desktop/web のコピー
├── build/icon.ico|png      インストーラとアプリのアイコン
├── web/                    同期された Web ビルド（生成物・git 管理外）
└── release/                ビルドされたインストーラ（生成物・git 管理外）
```

## ビルド

```bash
cd desktop
npm install

npm run prepare:app      # ../app を export して desktop/web に同期
npm start                # Electron で起動して確認

npm run dist:win         # Windows インストーラ + portable（Windows 上で実行すること）
npm run pack             # 現在の OS 向けに展開ビルドのみ（動作確認用）
```

`npm run dist:win` は `release/` に次を出力します。

| ファイル | 内容 |
| :--- | :--- |
| `QubitOS-<version>-windows-x64-setup.exe` | インストーラ。インストール先を選べ、スタートメニューとデスクトップにショートカットを作ります |
| `QubitOS-<version>-windows-arm64-setup.exe` | Arm 版 Windows 向けインストーラ |
| `QubitOS-<version>-windows-x64-portable.exe` | インストールせずにそのまま起動する版 |

GitHub Actions の **Windows App (QubitOS)** ワークフローが同じ手順を `windows-latest` で実行します。
手動実行ではインストーラがアーティファクトとして残り、`v*` タグを push するとそのリリースに添付されます。

コード署名はしていないので、初回起動時に Windows SmartScreen の警告が出ます（「詳細情報」→「実行」）。
署名する場合は electron-builder の `win.certificateFile` / `CSC_LINK` を設定してください。

## 作りの要点

- **Web ビルドは `EXPO_WEB_BASE_URL` なしで export する**こと。バンドルが絶対パスで参照されるため、
  アプリ自身のオリジン直下に置く必要があります（`npm run build:web` はその形で実行します）。
- 画面は `file://` ではなく **`qubitos://app/` という専用スキーム**で配信します。絶対パスが解決でき、
  オリジンが安定するので、QubitFS の保存先（AsyncStorage → localStorage）が再起動後も残ります。
- レンダラは `contextIsolation` と `sandbox` を有効にしたうえで Node API を持ちません。外部リンクと
  アプリ外への遷移は OS のブラウザに渡します。
- QubitOS が自前でメニューバーを描くので、Electron のメニューは非表示にしています。

# QubitOS for React Native

QVM32/QVM64・ターミナル拡張・TextEdit・Calculator の仕様は [スマホ版ガイド](../docs/MOBILE_COMPUTER.md) を参照してください。QubitOS はホスト型の実行環境で、macOS / zsh の完全互換ではありません。

**Qubit Computer / QubitOS の React Native（Expo）アプリ版。** APQB 量子コンピュータのシミュレータと OS カーネルを TypeScript に移植し、UI 自体を QubitOS の **デスクトップ環境**（メニューバー・ウィンドウ・ドック）として動かします。開いた各ウィンドウはカーネルのサービスプロセスで、シェルの `ps` / `kill` / `open` / `windows` / `close` から見えます。ネットワークスタックとパッケージマネージャ `qpm` を備え、インターネット上のレジストリ（この リポジトリの `registry/`）や任意の URL からアプリをインストールできます。ネイティブ依存には AsyncStorage（仮想ファイルシステムの永続化）、Slider、WebView があります。見た目は macOS Sonoma 風のフロステッドガラス・デザインです（メッシュグラデーションの壁紙、すりガラスのメニューバーとフローティング Dock、多層のソフトシャドウ、インディゴ／バイオレットのアクセント、Web では Inter / JetBrains Mono を読み込み。ターミナルはダークガラス調）。トークンは `src/ui/theme.ts` にまとめてあります。

```text
app/
├── App.tsx                  カーネル起動 → デスクトップ
├── src/core/                ハードウェア層（純 TypeScript）
│   ├── apqb.ts              θ ↔ r ↔ η ↔ z=e^{i2θ}, tanh/sech 潜在パラメータ化, Chebyshev 特徴
│   ├── gates.ts             ゲート行列（APQB(θ)=RY(2θ), apqb_r, apqb_a, capqb を含む）
│   ├── state.ts             Float64Array 状態ベクトル, Born 測定, APQB 読み出し, concurrence / three-tangle
│   ├── circuit.ts           回路ビルダー（JSON 入出力, 逆回路, ASCII 描画）
│   ├── computer.ts          QubitComputer.run(circuit, shots, seed)
│   ├── algorithms.ts        Bell/GHZ（APQB 版）, テレポーテーション, Grover, QFT, Deutsch–Jozsa
│   └── qbnn.ts              QBNN 層（K 次乗算ゲート）, φ_S / Φ_S, η → 制御信号, XOR/parity 学習
├── src/os/                  QubitOS
│   ├── kernel.ts            syscalls, 量子ビットメモリ, プロセス表, APQB スケジューラ, dmesg, sysctl
│   ├── fs.ts                QubitFS（スナップショットを AsyncStorage に保存）
│   ├── programs.ts          /bin のプログラム表（UI 用のパラメータ定義付き）
│   ├── wm.ts                ウィンドウマネージャ（ウィンドウ = カーネルのサービスプロセス）
│   ├── net.ts               ネットワークスタック（fetch ラッパー, 履歴, 再試行, sysctl net.*）
│   ├── webinstall.ts        アプリ自体のインストール（beforeinstallprompt, 起動ショートカット）
│   ├── pkg.ts               qpm パッケージマネージャ（レジストリ, インストール, /etc/apps.json）
│   └── shell.ts             qsh シェル（open / windows / close / curl / wget / qpm を含む）
├── src/ui/                  デスクトップとアプリ
│   ├── Desktop.tsx          起動画面, メニューバー, ドラッグ可能なウィンドウ, ドック
│   ├── TerminalScreen.tsx   Terminal（qsh, クイックコマンド, 履歴）
│   ├── FinderApp.tsx        Finder（QubitFS ブラウザ, プレビュー, スクリプト実行, 回路実行）
│   ├── ProgramsScreen.tsx   Programs（ヒストグラム, 状態, APQB 読み出し, もつれ, 回路図）
│   ├── MemoryScreen.tsx     Qubit Memory（alloc / gate / measure / readout / free）
│   ├── APQBScreen.tsx       APQB（θ スライダー, Bloch 大円, r²+η²=1, η → 制御信号）
│   ├── StoreApp.tsx         App Store（レジストリ検索, Get / Open / Remove, URL からインストール, Web アプリ追加）
│   ├── BrowserApp.tsx       Browser（ネイティブは WebView, Web は iframe。「Add to Dock」で Web アプリ化）
│   ├── ScriptApp.tsx        インストールしたスクリプトアプリのウィンドウ（main.qsh を実行して出力表示）
│   ├── QBNNApp.tsx          QBNN Lab（XOR / parity 学習, 損失グラフ）
│   ├── ActivityApp.tsx      Activity Monitor（プロセス表, スケジューラ, dmesg）
│   └── SettingsApp.tsx      System Settings（About, sysctl スライダー, ファイルシステム初期化）
├── public/                  Web ビルドにそのままコピーされる静的ファイル
│   ├── index.html           HTML テンプレート（manifest / Service Worker / install の捕捉）
│   ├── manifest.webmanifest Web アプリマニフェスト（アイコン, standalone, ショートカット）
│   ├── sw.js                Service Worker（オフライン起動のためのキャッシュ）
│   └── icons/               インストール時のアイコン（192 / 512 / maskable / apple-touch）
└── __tests__/               jest（コア + OS, node 環境で実行）
```

## 起動

```bash
cd app
npm install
npx expo start          # Expo Go または開発ビルドで開く
npx expo start --web    # ブラウザ
npm test                # jest（コア・OS・QVM・シェル・インストーラのテスト）
npm run typecheck       # tsc --noEmit
npm run export:web      # 静的 Web ビルド（dist/）
```

## Web 版のデプロイ

`main` への push（`app/` 配下の変更）で `.github/workflows/deploy-web.yml` が自動的に
`npm test` → `npm run typecheck` → `expo export --platform web` を実行し、GitHub Pages に
デプロイします。GitHub Pages を「GitHub Actions」ソースで有効化しておいてください。

リポジトリ名のサブパス（`https://<owner>.github.io/<repo>/`）で配信するため、CI では
`EXPO_WEB_BASE_URL` 環境変数（`app.config.js` が `expo.experiments.baseUrl` に反映）を
`/<repo名>` に設定してエクスポートします。ローカルの `expo start --web` /
`npm run export:web` はこの変数を設定しないので、ルートパス（サブパスなし）のままです。

サブパスへのデプロイを手元で確認する場合：

```bash
EXPO_WEB_BASE_URL=/Qubit-Computer npx expo export --platform web
```

## Web アプリとしてインストールする（PWA）

デプロイした Web 版は **インストール可能な Web アプリ**です。インストールするとブラウザの UI が消えて
独立したウィンドウで起動し、Dock / スタートメニュー / ホーム画面にアイコンが並び、Service Worker が
シェルをキャッシュするのでオフラインでも起動します。QubitFS は今までどおりこの端末に残ります。

インストールの入口は 4 つあります。

| 入口 | 場所 |
| :--- | :--- |
| メニューバーの **Install** ボタン | ブラウザがインストールを提案しているときだけ右上に出ます |
| **System Settings → Install QubitOS** | About の下 |
| **App Store → Install QubitOS** | 一番上のカード |
| `install` コマンド | Terminal。`install --status` で状態だけ表示 |

```text
qubitos:/$ install --status
install: available — run `install` or use System Settings
supported=true promptable=true installed=false standalone=false offline=true browser=chromium
qubitos:/$ install
installing QubitOS — it will appear with your other apps
```

ブラウザが `beforeinstallprompt` を出さない場合（Safari / iOS / Firefox）は、カードとコマンドが
その環境での手順（共有 → ホーム画面に追加、ファイル → Dock に追加 など）を案内します。
`public/index.html` のブートスクリプトが React のマウント前に `beforeinstallprompt` を捕まえて
`window.__qubitos` に預け、カーネルの `WebInstaller`（`src/os/webinstall.ts`）がそれを再生します。

インストール済みのアイコンを右クリック（長押し）すると、マニフェストの **ショートカット**から
Terminal / Finder / App Store / QBNN Lab を直接開けます。これは `?app=<id>` というクエリで、
ブックマークからも使えます（例：`…/?app=qbnn`）。

`public/` の中身はビルド時に `dist/` へそのままコピーされ、URL はすべて相対なので、
ルート配信（`http://localhost:8081/`）でもサブパス配信（`https://…/Qubit-Computer/`）でも
同じファイルで動きます。

> ネイティブ（iOS / Android ビルド）や `desktop/` の Electron 版では、アプリは既にインストール済みなので
> カードはその旨を表示するだけになります。

---

## スマホアプリ版（Android APK）

`app.config.js` にはすでに `ios.bundleIdentifier` / `android.package` と EAS のプロジェクト ID が
設定済みで、このコードはそのままネイティブアプリとしてビルドできます。GitHub Actions の
**Android App (QubitOS)** ワークフローが `expo prebuild --platform android` でネイティブプロジェクトを
生成し、Gradle でデバッグ署名の APK（`app-debug.apk`）をビルドしてアーティファクトに残します
（`app/` を変更した push / PR、および `workflow_dispatch` で走ります）。ストア配布用の署名は行って
いないので、この APK は「提供元不明のアプリ」として端末に直接インストールする用途向けです。

手元でビルドする場合：

```bash
cd app
npm install
npx expo prebuild --platform android   # ./android を生成（.gitignore 対象、コミットしない）
cd android && ./gradlew assembleDebug  # Android SDK が必要
```

実機・エミュレータに直接インストールして動作確認するだけなら `npm run android`
（`expo run:android`、Android SDK が必要）でも起動できます。iOS も同様に
`npx expo prebuild --platform ios` → Xcode でビルド、または `npm run ios`（macOS が必要）です。
Play Store / App Store 向けのリリースビルドと提出には `eas build` / `eas submit`（`eas.json` に
プロファイル設定済み）を使ってください。

---

## デスクトップ版（Electron / Windows インストーラ）

同じ Web ビルドを Electron で包んだデスクトップ版が [`desktop/`](../desktop/README.md) です。
Windows 向けにはインストーラ（`QubitOS-<version>-windows-x64-setup.exe`）と portable 版を
GitHub Actions がビルドします。

```bash
cd desktop
npm install
npm run prepare:app   # ../app の Web ビルド → desktop/web
npm start             # Electron で起動
npm run dist:win      # Windows インストーラ（Windows 上で実行）
```

---

## デスクトップ

起動するとブートスプラッシュのあと QubitOS のデスクトップが表示され、Terminal が開きます。ドックのアイコンでアプリを開き（長押しで閉じる）、ウィンドウはタイトルバーでドラッグ、信号灯で閉じる・しまう・最大化できます。狭い画面ではウィンドウは自動的に全画面になります。

| アプリ | 内容 |
| :--- | :--- |
| **Terminal** | Python 版と同じコマンド体系の qsh。`open finder`、`open /lib/circuits`、`windows`、`close apqb` でウィンドウも操作可能 |
| **Finder** | QubitFS のブラウザ。パンくず、プレビュー、`.qsh` の実行、回路 JSON の実行、削除、フォルダ作成 |
| **Programs** | `/bin` のプログラムをフォームで実行。counts ヒストグラム、状態ベクトル、r / η / θ、concurrence / three-tangle、回路図 |
| **Qubit Memory** | シミュレートする量子ビットのプールとセグメント。ゲート適用・サンプリング・収縮測定・reset・free |
| **APQB** | θ スライダーで APQB を操作。Bloch 大円、r / η / P(0) / P(1) / エントロピー、Chebyshev 特徴、η → 温度・ドロップアウト・探索率 |
| **QBNN Lab** | XOR / 3-bit parity の学習（K, λ, epochs）、損失グラフ、η、予測。学習中はサービスプロセスとして `ps` に出ます |
| **App Store** | インターネット上のレジストリからアプリを検索・インストール（Get）、URL から直接インストール、任意の Web ページを Web アプリとして追加 |
| **Browser** | アドレスバー付きブラウザ。「Add to Dock」でその URL を Web アプリとしてインストール |
| **Activity Monitor** | プロセス表（GUI ウィンドウを含む）、Kill、APQB スケジューラの θ スライダー、Network（全リクエストの履歴・オンライン/オフライン切替）、dmesg |
| **System Settings** | About、Hardware Backend（CPU / GPU / Q-NPU 選択）、`apqb.theta` / `sched.p_max` / `run.shots` のスライダー、ネットワークの有効化とレジストリ URL、ファイルシステム初期化 |

ウィンドウは `gui:<app>` という名前のサービスプロセスとしてカーネルに登録されます。Terminal で `kill <pid>` するとウィンドウが閉じ、ウィンドウを閉じるとプロセスが killed になります。

## インターネットとアプリのインストール

```text
qubitos:/$ qpm update                 # レジストリを取得（sysctl net.registry, 複数可）
qubitos:/$ qpm search lab
qubitos:/$ qpm install bell-lab       # スクリプトアプリ → /apps/bell-lab/ と /bin/app:bell-lab
qubitos:/$ qpm install qubit-ai       # Web アプリ → Browser で開く
qubitos:/$ qpm install https://example.com/my-package.json
qubitos:/$ open bell-lab              # ドックにも追加される
qubitos:/$ run app:bell-lab           # 通常のプログラムとしても実行できる
qubitos:/$ curl https://raw.githubusercontent.com/tapiocaTakeshi/Qubit-Computer/main/registry/index.json
qubitos:/$ wget https://…/circuit.json /lib/circuits/mine.json
qubitos:/$ qpm remove bell-lab
qubitos:/$ install                    # QubitOS 自体をこの端末にインストール（Web 版）
```

パッケージの形式は 2 種類です（[registry/README.md](../registry/README.md)）。

- **script**：`/apps/<name>/` 以下に書き込む `.qsh` スクリプト・回路 JSON・QBNN 重みと、エントリポイント `main`。`/apps/` 以外への書き込みは拒否されます
- **web**：Browser で開く URL（macOS の Safari Web アプリのように、ドックから起動）

インストール済みアプリは `/etc/apps.json` に記録され、再起動後も残ります（AsyncStorage）。ネットワークは `sysctl net.enabled false` で無効化でき、失敗した転送は `net.retries` 回まで再試行します。

> 実際の macOS バイナリ（.app / .dmg）を React Native アプリ内で実行することはできません。QubitOS が扱うのは、上記の QubitOS パッケージと Web アプリです。

## Python 版との対応

Python パッケージ `qubit_computer` と同じ API 構成・同じ数式を実装しており、`tests/` と `__tests__/` は同じ関係式（C₂ = η, τ₃ = η², r² + η² = 1, 2ⁿ 部分集合特徴, λ=0 で通常 NN に帰着, テレポーテーションで θ 保存, Grover / Deutsch–Jozsa / QFT）を検証します。回路 JSON は両者で互換です。

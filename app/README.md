# QubitOS for React Native

**Qubit Computer / QubitOS の React Native（Expo）アプリ版。** APQB 量子コンピュータのシミュレータと OS カーネルを TypeScript に移植し、UI 自体を QubitOS の **デスクトップ環境**（メニューバー・ウィンドウ・ドック）として動かします。開いた各ウィンドウはカーネルのサービスプロセスで、シェルの `ps` / `kill` / `open` / `windows` / `close` から見えます。ネットワークスタックとパッケージマネージャ `qpm` を備え、インターネット上のレジストリ（この リポジトリの `registry/`）や任意の URL からアプリをインストールできます。ネイティブ依存は AsyncStorage（仮想ファイルシステムの永続化）と Slider だけです。見た目は macOS Sonoma 風のフロステッドガラス・デザインです（メッシュグラデーションの壁紙、すりガラスのメニューバーとフローティング Dock、多層のソフトシャドウ、インディゴ／バイオレットのアクセント、Web では Inter / JetBrains Mono を読み込み。ターミナルはダークガラス調）。トークンは `src/ui/theme.ts` にまとめてあります。

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
└── __tests__/               jest（コア + OS, node 環境で実行）
```

## 起動

```bash
cd app
npm install
npx expo start          # Expo Go または開発ビルドで開く
npx expo start --web    # ブラウザ
npm test                # jest（コア・OS の 32 テスト）
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

## デスクトップ

起動するとブートスプラッシュのあと QubitOS のデスクトップが表示され、Terminal が開きます。ドックのアイコンでアプリを開き（長押しで閉じる）、ウィンドウはタイトルバーでドラッグ、信号灯で閉じる・しまう・最大化できます。狭い画面ではウィンドウは自動的に全画面になります。

| アプリ | 内容 |
| :--- | :--- |
| **Terminal** | Python 版と同じコマンド体系の qsh。`open finder`、`open /lib/circuits`、`windows`、`close apqb` でウィンドウも操作可能 |
| **Finder** | QubitFS のブラウザ。パンくず、プレビュー、`.qsh` の実行、回路 JSON の実行、削除、フォルダ作成 |
| **Programs** | `/bin` のプログラムをフォームで実行。counts ヒストグラム、状態ベクトル、r / η / θ、concurrence / three-tangle、回路図 |
| **Qubit Memory** | 物理量子ビットのプールとセグメント。ゲート適用・サンプリング・収縮測定・reset・free |
| **APQB** | θ スライダーで APQB を操作。Bloch 大円、r / η / P(0) / P(1) / エントロピー、Chebyshev 特徴、η → 温度・ドロップアウト・探索率 |
| **QBNN Lab** | XOR / 3-bit parity の学習（K, λ, epochs）、損失グラフ、η、予測。学習中はサービスプロセスとして `ps` に出ます |
| **App Store** | インターネット上のレジストリからアプリを検索・インストール（Get）、URL から直接インストール、任意の Web ページを Web アプリとして追加 |
| **Browser** | アドレスバー付きブラウザ。「Add to Dock」でその URL を Web アプリとしてインストール |
| **Activity Monitor** | プロセス表（GUI ウィンドウを含む）、Kill、APQB スケジューラの θ スライダー、Network（全リクエストの履歴・オンライン/オフライン切替）、dmesg |
| **System Settings** | About、`apqb.theta` / `sched.p_max` / `run.shots` のスライダー、ネットワークの有効化とレジストリ URL、ファイルシステム初期化 |

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
```

パッケージの形式は 2 種類です（[registry/README.md](../registry/README.md)）。

- **script**：`/apps/<name>/` 以下に書き込む `.qsh` スクリプト・回路 JSON・QBNN 重みと、エントリポイント `main`。`/apps/` 以外への書き込みは拒否されます
- **web**：Browser で開く URL（macOS の Safari Web アプリのように、ドックから起動）

インストール済みアプリは `/etc/apps.json` に記録され、再起動後も残ります（AsyncStorage）。ネットワークは `sysctl net.enabled false` で無効化でき、失敗した転送は `net.retries` 回まで再試行します。

> 実際の macOS バイナリ（.app / .dmg）を React Native アプリ内で実行することはできません。QubitOS が扱うのは、上記の QubitOS パッケージと Web アプリです。

## Python 版との対応

Python パッケージ `qubit_computer` と同じ API 構成・同じ数式を実装しており、`tests/` と `__tests__/` は同じ関係式（C₂ = η, τ₃ = η², r² + η² = 1, 2ⁿ 部分集合特徴, λ=0 で通常 NN に帰着, テレポーテーションで θ 保存, Grover / Deutsch–Jozsa / QFT）を検証します。回路 JSON は両者で互換です。

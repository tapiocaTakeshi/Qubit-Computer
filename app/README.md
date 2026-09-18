# QubitOS for React Native

**Qubit Computer / QubitOS の React Native（Expo）アプリ版。** APQB 量子コンピュータのシミュレータと OS カーネルを TypeScript に移植し、UI 自体を QubitOS の **デスクトップ環境**（メニューバー・ウィンドウ・ドック）として動かします。開いた各ウィンドウはカーネルのサービスプロセスで、シェルの `ps` / `kill` / `open` / `windows` / `close` から見えます。ネイティブ依存は AsyncStorage（仮想ファイルシステムの永続化）と Slider だけです。見た目は macOS 風のシンプルなライトデザイン（システムフォント、白いパネル、ヘアライン境界、青いアクセント。ターミナルは macOS Terminal 風のウィンドウ）です。

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
│   └── shell.ts             qsh シェル（open / windows / close を含む）
├── src/ui/                  デスクトップとアプリ
│   ├── Desktop.tsx          起動画面, メニューバー, ドラッグ可能なウィンドウ, ドック
│   ├── TerminalScreen.tsx   Terminal（qsh, クイックコマンド, 履歴）
│   ├── FinderApp.tsx        Finder（QubitFS ブラウザ, プレビュー, スクリプト実行, 回路実行）
│   ├── ProgramsScreen.tsx   Programs（ヒストグラム, 状態, APQB 読み出し, もつれ, 回路図）
│   ├── MemoryScreen.tsx     Qubit Memory（alloc / gate / measure / readout / free）
│   ├── APQBScreen.tsx       APQB（θ スライダー, Bloch 大円, r²+η²=1, η → 制御信号）
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
| **Activity Monitor** | プロセス表（GUI ウィンドウを含む）、Kill、APQB スケジューラの θ スライダー、dmesg |
| **System Settings** | About、`apqb.theta` / `sched.p_max` / `run.shots` のスライダー、ファイルシステム初期化 |

ウィンドウは `gui:<app>` という名前のサービスプロセスとしてカーネルに登録されます。Terminal で `kill <pid>` するとウィンドウが閉じ、ウィンドウを閉じるとプロセスが killed になります。

## Python 版との対応

Python パッケージ `qubit_computer` と同じ API 構成・同じ数式を実装しており、`tests/` と `__tests__/` は同じ関係式（C₂ = η, τ₃ = η², r² + η² = 1, 2ⁿ 部分集合特徴, λ=0 で通常 NN に帰着, テレポーテーションで θ 保存, Grover / Deutsch–Jozsa / QFT）を検証します。回路 JSON は両者で互換です。

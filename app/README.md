# QubitOS for React Native

**Qubit Computer / QubitOS の React Native（Expo）アプリ版。** APQB 量子コンピュータのシミュレータと OS カーネルを TypeScript に移植し、スマートフォン上でそのまま動かします。ネイティブ依存は AsyncStorage（仮想ファイルシステムの永続化）と Slider だけです。見た目は macOS 風のシンプルなライトデザイン（システムフォント、白いパネル、ヘアライン境界、青いアクセント。ターミナルは macOS Terminal 風のウィンドウ）です。

```text
app/
├── App.tsx                  タブ UI（qsh / run / memory / APQB / system）
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
│   └── shell.ts             qsh シェル
├── src/ui/                  画面
│   ├── TerminalScreen.tsx   qsh ターミナル（クイックコマンド, 履歴）
│   ├── ProgramsScreen.tsx   プログラム実行（ヒストグラム, 状態, APQB 読み出し, もつれ, 回路図）
│   ├── MemoryScreen.tsx     alloc / gate / measure / readout / free をタップで操作
│   ├── APQBScreen.tsx       θ スライダー, Bloch 大円, r²+η²=1, η → 温度/ドロップアウト/探索率
│   └── SystemScreen.tsx     プロセス表, APQB スケジューラ, QBNN 学習, dmesg, ファイルシステム
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

## 画面

| タブ | 内容 |
| :--- | :--- |
| **qsh** | Python 版と同じコマンド体系のシェル。`run bell_apqb 0.4; ent last`、`alloc 2 --r 0.6,-0.2`、`sh /home/user/hello.qsh` など |
| **run** | `/bin` のプログラムをフォームで実行。counts ヒストグラム、状態ベクトル、各量子ビットの r / η / θ、concurrence / three-tangle、回路図 |
| **memory** | 物理量子ビットのプールとセグメント。ゲート適用・サンプリング・収縮測定・reset・free |
| **APQB** | θ スライダーで APQB を操作。Bloch 大円上の位置、r / η / P(0) / P(1) / エントロピー、Chebyshev 特徴、η を温度・ドロップアウト・スケジューラ探索率に写像。「システム APQB にする」で OS のスケジューラへ反映 |
| **system** | uname、`sysctl apqb.theta` スライダー、プロセス表（spawn / sched / kill）、QBNN 学習（XOR / parity, K, λ）、dmesg、QubitFS ツリー |

## Python 版との対応

Python パッケージ `qubit_computer` と同じ API 構成・同じ数式を実装しており、`tests/` と `__tests__/` は同じ関係式（C₂ = η, τ₃ = η², r² + η² = 1, 2ⁿ 部分集合特徴, λ=0 で通常 NN に帰着, テレポーテーションで θ 保存, Grover / Deutsch–Jozsa / QFT）を検証します。回路 JSON は両者で互換です。

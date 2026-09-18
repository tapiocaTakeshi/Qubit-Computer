# Qubit Computer / QubitOS

**Qubit AI の APQB（Adjustable Pseudo Quantum Bit：調整可能擬似量子ビット）を量子ビットの基本単位とする量子コンピュータと、その上で動くオペレーティングシステム QubitOS。**

依存ライブラリなしの純 Python 実装です（Python 3.9+）。[Qubit](https://github.com/tapiocaTakeshi/Qubit) リポジトリの APQB / QBNN 理論（`apqb_qbnn_v2.py`、および改訂論文 *「調整可能擬似量子ビット（APQB）に基づく量子インスパイア多重線形ニューラルネットワーク」v2*）の数式をそのまま実装し、数値的に検証しています。

```text
|ψ(θ)⟩ = cosθ|0⟩ + sinθ|1⟩        0 ≤ θ ≤ π/2             (Eq. 1)
r = cos2θ = ⟨Z⟩                    相関 / 確信度            (Eq. 6)
η = T = |sin2θ| = √(1 − r²)        不確実性振幅 / ゆらぎ    (Eq. 8)
r² + η² = 1                                                 (Eq. 9)
```

> 本プロジェクトは古典コンピュータ上の状態ベクトル・シミュレータです。物理的な量子ビットや量子優位性を主張するものではありません（論文 Sec. 3.3 / 7.2 の立場に従います）。

---

## 構成

```text
┌──────────────────────────── QubitOS ─────────────────────────────┐
│  qsh シェル      run / alloc / gate / measure / readout / ent ...  │
│  カーネル        syscalls・プロセス表・APQB スケジューラ・dmesg    │
│  メモリ管理      物理量子ビットのプール → セグメント(APQB レジスタ) │
│  QubitFS         /bin /etc /home /lib /var  (JSON で永続化可)       │
│  プログラム      bell, ghz, teleport, grover, qft, qbnn_train ...   │
├──────────────────────── Qubit Computer (HW) ──────────────────────┤
│  APQB            θ ↔ r ↔ η ↔ z=e^{i2θ}, tanh/sech 潜在パラメータ   │
│  ゲート          X Y Z H S T RX RY RZ U CX CZ SWAP CCX ... + APQB(θ)│
│  状態ベクトル    2^n 複素振幅, Born 測定, 部分トレース → APQB 読み出し│
│  もつれ尺度      concurrence (2 qubit), three-tangle (3 qubit)      │
│  QBNN            乗算的ゲーティング層 Eq. 23–32, 部分集合特徴 φ_S   │
└───────────────────────────────────────────────────────────────────┘
```

| モジュール | 内容 |
| :--- | :--- |
| `qubit_computer/apqb.py` | APQB 本体。`APQB(θ)`, `from_r`, `from_latent`, r / T / z / 密度行列 / エントロピー / Chebyshev 特徴 |
| `qubit_computer/gates.py` | ゲート行列。APQB 固有ゲート `apqb(θ)=RY(2θ)`, `apqb_r(r)`, `apqb_a(a)`, `capqb` |
| `qubit_computer/state.py` | 状態ベクトルエンジン、測定、縮約密度行列からの APQB 読み出し、`concurrence`, `three_tangle` |
| `qubit_computer/circuit.py` | 回路ビルダー（メソッドチェーン、JSON 入出力、逆回路、ASCII 描画） |
| `qubit_computer/computer.py` | `QubitComputer.run(circuit, shots, seed)` → `Result`（counts / state / APQB 読み出し） |
| `qubit_computer/algorithms.py` | Bell/GHZ（APQB 版含む）、テレポーテーション、Deutsch–Jozsa、Grover、QFT、相関レジスタ |
| `qubit_computer/qbnn.py` | QBNN 層（K 次ゲート）、φ_S / Φ_S、η → 制御信号、XOR / parity 学習 |
| `qubit_computer/os/` | QubitOS：`kernel.py`, `fs.py`, `programs.py`, `shell.py`, `boot.py` |
| `app/` | React Native（Expo）アプリ版。コアと OS を TypeScript に移植 |

---

## インストールと起動

```bash
git clone https://github.com/tapiocaTakeshi/Qubit-Computer.git
cd Qubit-Computer
pip install -e ".[test]"

qubitos                       # 対話シェルを起動
qubitos examples/demo.qsh     # スクリプト実行
qubitos -c "run bell; ent last"
qubitos --fs ~/.qubitos.json  # 仮想ファイルシステムを永続化
python -m qubit_computer      # 同じ
```

起動時のオプション：`-q/--qubits N`（物理量子ビット数、既定 16）、`--seed`、`--theta`（システム APQB の角度）、`--quiet`。

---

## QubitOS の設計

### カーネル

すべての操作はシステムコール（`Kernel.syscall(name, ...)`）を通り、`dmesg` に記録されます。

| 分類 | syscall |
| :--- | :--- |
| メモリ | `alloc(size, name, apqbs)` `free(sid)` `mem()` `reset(sid)` |
| レジスタ | `apply(sid, gate, targets, params)` `measure(sid, qubits, shots)` `readout(sid)` `entangle(sid)` |
| プロセス | `spawn(program, argv, priority)` `schedule()` `run(program, argv)` `kill(pid)` `ps()` `exec_circuit(circuit)` |
| システム | `sysctl(key, value)` `dmesg()` `uname()` |

### メモリ管理

物理量子ビットは有限のプール（既定 16）です。`alloc n` は連続した量子ビットを **セグメント**（独立した APQB レジスタ）として切り出し、`--theta` / `--r` / `--a` で初期 APQB 状態を指定できます。セグメントは状態ベクトルとして生きており、`gate` でゲートを 1 つずつ適用し、`measure` で収縮させ、`readout` で各量子ビットの r / η / θ / エントロピーを読み出せます。

### APQB スケジューラ

カーネルは 1 個の **システム APQB**（`sysctl apqb.theta`）を持ち、その不確実性振幅 η を論文 Eq. 11 / 32 の単調写像で探索率へ変換します。

```text
eps = sched.p_min + (sched.p_max − sched.p_min) · η(θ)
```

確率 `eps` でランダムな READY プロセスを選び（探索）、それ以外は最高優先度を選びます（活用）。`apqb.theta = 0` なら完全に決定論的な優先度スケジューリング、`apqb.theta = π/4` なら η = 1 で最大限の探索になります。OS の振る舞い自体が「確信度 r とゆらぎ η のトレードオフ」で制御される、というのが QubitOS の設計思想です。

### プロセスとプログラム

`/bin` のプログラムは 2 種類あります。

- **circuit プログラム**：引数から回路を組み立て、APQB ハードウェア上で実行（`bell`, `bell_apqb`, `ghz`, `ghz_apqb`, `encode`, `teleport`, `superdense`, `deutsch_jozsa`, `grover`, `qft`）
- **job プログラム**：Python ジョブ（`qbnn_train`, `qbnn_eval`, `features`）

各プロセスは PID・優先度・状態（ready / running / done / failed / killed）・ログを持ち、結果は `/var/results/<pid>_<name>.json` に保存されます。`Kernel.register_program()` で独自プログラムを追加できます。

### QubitFS

階層型の仮想ファイルシステム。`/bin`（プログラム）、`/etc/motd`、`/home/user/hello.qsh`、`/lib/circuits/*.json`（回路）、`/lib/qbnn/*.json`（学習済み QBNN 重み）、`/var/results`。`--fs PATH` を指定するとホスト上の JSON 1 ファイルに永続化されます。

---

## シェル (qsh) コマンド

```text
system     help uname uptime dmesg sysctl [key [value]] motd echo exit
processes  run <prog> [args] [--shots N --seed S --prio P] | spawn | sched | ps | kill <pid> | log <pid> | result <pid|last> | draw <prog>
memory     alloc <n> [--name x --theta t1,t2 | --r r1,r2 | --a a1,a2] | free <sid> | mem | reset <sid>
registers  gate <sid> <gate> <q..> [--p a,b] | measure <sid> [q..] [--shots N] | readout <sid> | state <sid> | ent <sid|last|pid>
apqb       apqb <theta> | apqb --r <r> | apqb --a <latent> | apqb --p1 <prob>
files      ls cat cd pwd mkdir rm write tree save <pid|last> <path> exec <circuit.json> sh <script.qsh> sync
```

角度は `0.25pi` のように `pi` 接尾辞が使えます。ビット列は **量子ビット 0 を左端** に表示します。

### セッション例

```text
qubitos:/$ run bell_apqb 0.4 --shots 512 --seed 7
== bell_apqb(θ=0.400): 2 qubits, 512 shots, seed=7
state : +0.9211|00> +0.3894|11>
  00     432   84.4% █████████████████████████████████
  11      80   15.6% ██████
APQB readout per qubit (r=<Z> confidence, T=|<X>| fluctuation):
  q0: r=+0.6967 T=0.0000 theta=0.4000 p1=0.1516 S_vn=0.6139 entangled
  q1: r=+0.6967 T=0.0000 theta=0.4000 p1=0.1516 S_vn=0.6139 entangled
qubitos:/$ ent last
  concurrence: 0.717356
  C2^2 + r^2: 1.000000
  (paper Eq. 13-14: C2 = η and C2² + r² = 1 hold for the |Psi2(θ)> family -- satisfied)

qubitos:/$ alloc 3 --name reg --theta 0.2,0.5,0.9
qubitos:/$ gate 1 cx 0 1
qubitos:/$ gate 1 cry 1 2 --p 0.8
qubitos:/$ measure 1 --shots 100
qubitos:/$ readout 1

qubitos:/$ run qbnn_train xor --K 2 --epochs 60
QBNN dims=[2, 4, 1] K=2 lam=1.0 params=39 task=xor
epoch   60  loss 0.000000  acc 1.00
saved weights to /lib/qbnn/xor_K2.json

qubitos:/$ sysctl apqb.theta 0.25pi     # η = 1 → 探索率 0.5
qubitos:/$ spawn bell --prio 1; spawn ghz 4 --prio 9; sched; ps
```

---

## Python API

```python
from qubit_computer import APQB, Circuit, QubitComputer, algorithms, concurrence, qbnn
from qubit_computer.os import Kernel, Shell

q = APQB.from_r(0.6)                 # θ = ½ arccos r
q.r, q.T, q.z, q.probabilities, q.features(K=3)

qc = QubitComputer()
c = Circuit(2).apqb(0, 0.4).cx(0, 1).measure()
res = qc.run(c, shots=1000, seed=42)
res.counts, res.state, res.apqb[0]["theta"]     # → 0.4
concurrence(res.state)                          # → |sin 0.8|

reg = qc.prepare([APQB.from_r(r) for r in (0.9, 0.0, -0.6)])   # 相関レジスタ (Eq. 18)
qc.run(algorithms.grover(3, "101"), shots=100).most_common()   # → "101"

net = qbnn.QBNN([2, 4, 1], K=2, lam=1.0)          # 乗算的 APQB ゲート (Eq. 23-30)
qbnn.train(net, qbnn.xor_dataset(), epochs=60)

kernel = Kernel(num_qubits=8, seed=1, theta=0.2)
seg = kernel.sys_alloc(2, apqbs=[APQB(0.3), APQB.zero()])
kernel.sys_apply(seg.sid, "cx", [0, 1])
kernel.sys_entanglement(seg.sid)
Shell(kernel).execute_line("run teleport 0.7 --shots 1; ps")
```

回路は JSON でも記述できます（`exec /lib/circuits/bell.json`）。

```json
{
  "name": "apqb_register", "num_qubits": 3,
  "initial_correlations": [0.9, 0.0, -0.6],
  "instructions": [{"gate": "cx", "targets": [0, 1]}, {"gate": "measure", "targets": [0, 1, 2]}]
}
```

---

## 論文との対応と数値検証

`tests/` の 56 テストで、以下の関係を float 精度で確認しています。

| 関係式 | 論文 | 検証内容 |
| :--- | :--- | :--- |
| P(0)=(1+r)/2, P(1)=(1−r)/2 | Eq. 2, 7 | APQB の Born 確率と相関 r の一致 |
| r² + η² = 1 | Eq. 9 | θ ∈ [0, π/2] 全域 |
| r = tanh a, η = sech a | Eq. 12 相当 (Sec. 5.4) | 潜在パラメータ化、\|a\| = 50 でも有限 |
| Re z^k = T_k(r), Im z^k = η U_{k−1}(r) | Prop. 2 | Chebyshev 特徴 |
| C₂ = η, C₂² + r² = 1 | Eq. 13–14 | `bell_apqb(θ)` の Wootters concurrence |
| τ₃ = η², τ₃ + r² = 1 | Eq. 16–17 | `ghz_apqb(θ)` の three-tangle |
| 2ⁿ 個の部分集合特徴 φ_S / Φ_S | Eq. 19, 22 | `qbnn.subset_features` |
| QBNN 層 = 通常 NN（λ=0） | Eq. 28 | λ=0 で線形+活性化に一致 |
| QBNN が XOR を学習（K=2） | Sec. 6 H1 | 精度 100% |
| テレポーテーションで θ が保存 | — | 送信 APQB の θ を q2 で読み出し |

`ent` コマンドは、状態が Bell 型 / GHZ 型の族に入っているかどうかも表示します（一般の状態では Eq. 14 / 17 は成立しません。論文 Sec. 3.1–3.2 の限定を反映）。

---

## React Native アプリ（app/）

同じ量子コンピュータと QubitOS を TypeScript に移植した **Expo / React Native アプリ**を `app/` に同梱しています。UI は QubitOS のデスクトップ環境（メニューバー・ドラッグ可能なウィンドウ・ドック）で、Terminal / Finder / Programs / Qubit Memory / APQB / QBNN Lab / Activity Monitor / System Settings をウィンドウとして開きます。各ウィンドウはカーネルのサービスプロセスとして `ps` / `kill` / `open` から扱え、仮想ファイルシステムは AsyncStorage に永続化されます。

```bash
cd app && npm install
npx expo start          # Expo Go / 開発ビルド
npx expo start --web    # ブラウザ
npm test && npm run typecheck
```

詳細は [app/README.md](app/README.md) を参照してください。

---

## テスト

```bash
python -m pytest -q          # 56 tests
qubitos examples/demo.qsh    # 一通りのデモ
python examples/python_api.py
```

## 制限事項

- 純 Python の状態ベクトル法のため、実用的な上限は 16〜18 量子ビット程度です（`--qubits` で変更可）。
- QBNN の学習は有限差分勾配です。論文 Sec. 6 の小規模タスク（XOR / parity / 多項式回帰）の検証を目的とし、大規模学習は [Qubit](https://github.com/tapiocaTakeshi/Qubit) の PyTorch 実装（`apqb_qbnn_v2.py`）を使ってください。
- 量子もつれの尺度は 2 量子ビット（concurrence）と 3 量子ビット（three-tangle）の純粋状態にのみ実装しています。

## License

MIT License — Copyright (c) tapiocaTakeshi

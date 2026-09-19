# スマホ上の APQB Computer と QubitOS

QubitOS は、スマホの CPU 上で動く APQB シミュレータと、ファイル・プロセス・ウィンドウ・アプリを管理するホスト型の実行環境です。組み立てたPCのCPUは独自の64ビット QVM です。iOS / Android を置き換えるベアメタル OS、物理量子コンピュータ、macOS エミュレータではありません。カーネルと GUI は TypeScript / React Native で実行され、カーネル全体を QVM 機械語で実行しているわけではありません。

## 起動と使い方

既存の Expo アプリに実装されています。新規サーバーや GPU は不要です。

```sh
cd app
npm ci
npm run web                 # ローカル Web 開発
npm run start               # 対応する Expo Go / 開発クライアント
npm run export:web          # 静的 Web ビルド
```

Web 版を HTTPS で配信すると、iPhone の Safari では共有メニューから「ホーム画面に追加」が使えます。変更を main にマージすると、既存の GitHub Pages ワークフローが Web 版をビルド・配信します。Android APK は既存の Android App ワークフローで生成します。iOS のネイティブ配布には既存の EAS / Xcode 構成と署名が必要です。この変更のローカル検証は型チェック・Jest・Web ビルドを対象とし、iPhone / Android 実機でのネイティブ動作確認は別途必要です。

QubitOS の Terminal で次を実行してください。

```sh
qvm /home/user/Examples/bell.qasm
open textedit /home/user/Examples/bell.qasm
open calculator
mkdir -p ~/Documents/work
printf "orange\nblue\norange\n" > ~/Documents/work/colors.txt
cat ~/Documents/work/colors.txt | sort | uniq > ~/Documents/colors.txt
open ~/Documents/colors.txt
cat /etc/qvm-boot.json
```

TextEdit は QubitFS のテキストファイルを編集・保存します。`.qasm` と `.qsh` は Save & Run で実行できます。編集中のドラフトも QubitFS に保存し、再度同じ文書を開くと復元します。Calculator は括弧・四則演算・剰余・指数表記を扱い、履歴を `~/Documents/Calculations.txt` に保存します。JavaScript の eval は使用しません。

## 計算基盤

起動時に QVM の ROM が整数演算（6 × 7）、RAM の STORE / LOAD、APQB(π/2) の測定を実行します。結果を検証してから既存の QubitOS サービスを初期化します。起動結果は `/etc/qvm-boot.json` と `dmesg` に表示されます。ユーザーの `.qasm` は `qvm` プログラムとしてカーネルのプロセス表と `/var/results` に記録されます。

| 項目 | 実装 |
| --- | --- |
| 仮想 CPU | QVM32 / QVM64。16 個の符号なし整数レジスタ R0–R15 |
| 組立PCのCPU | QVM64のみ。旧32-bitインタープリタは低レベルAPIの互換用であり、qshからは利用不可 |
| 整数精度 | BigInt。演算結果は指定ワード幅でラップ。JSON は十進文字列 |
| RAM | 4096 ワード。命令ごとにアドレス範囲を検証 |
| APQB | `cosθ\|0⟩ + sinθ\|1⟩`、`r = cos(2θ)`、`η = abs(sin(2θ))` |
| QPREP | RY(2θ) 回転。既存状態への回転であり、リセットではない |
| QMEASURE | Born 確率に従って測定し、状態を収縮 |
| QVM の量子レジスタ | 同時に 1 個、1–12 擬似量子ビット。QVM 終了時に解放 |
| 一般回路シミュレータ | 既定 16、上限 20 擬似量子ビット。16 × 2ⁿ バイトの振幅配列に加え作業メモリが必要 |
| 実行制限 | QVM 20,000 命令、1,000 出力行、APQB 作業量 2,000,000。一般回路にも作業量と shots の上限あり |

32/64 ビットは古典的な整数 CPU のワード幅です。32/64 量子ビットを完全状態ベクトルとしてスマホに確保する指定ではありません。添付の改訂論文 v2 に沿い、APQB の量子インスパイア表現と、物理的量子優位性を区別しています。QVM の ISA、メモリ、実行上限は論文に記載された仕様ではなく、このプロジェクトの実装設計です。

### QVM 命令

命令は大文字小文字を区別しません。ラベルは区別します。`#` から行末まではコメントです。整数は十進または `0x` 十六進、レジスタは R0–R15 です。θ はラジアンの数値リテラルです。

| 命令 | 動作 |
| --- | --- |
| `MOV R0 42` | 値をレジスタに設定 |
| `ADD / SUB / MUL / DIV / MOD R0 R1` | 整数演算。除算は切り捨て、ゼロ除算は失敗 |
| `STORE 0 R0` / `LOAD R1 0` | RAM の読み書き。アドレスにレジスタも使用可 |
| `READ R0 /path` / `WRITE /path R0` | QubitFS内の符号なし64-bit十進整数ファイルを読込/上書き。パスは空白なしの1トークン。ホストのファイルにはアクセスしない |
| `JMP loop` / `JNZ R0 loop` | 無条件分岐 / 非ゼロ分岐 |
| `PRINT R0` / `HALT` | 十進整数を出力 / 終了 |
| `QALLOC 2` / `QFREE` | APQB レジスタ確保 / 解放 |
| `QPREP 0 0.4` | 量子ビット 0 を APQB の θ で回転 |
| `QH 0` / `QX 0` / `QCX 0 1` | H / X / 制御 X |
| `QMEASURE R0 0` | 量子ビット 0 を測定し 0 または 1 を R0 に格納 |

同梱 Bell プログラムは 00 または 11 を出力します。独立に生成した二つの乱数ではなく、同一の状態ベクトルを逐次測定します。`qvm file.qasm`（または末尾に `64`）で64ビットCPUを使用します。`--seed 7` は既存のプログラム起動オプションとして使えます。

`qvm /home/user/Examples/pc-check.qasm` は6×7をRAMに書込み、APQB(π/2)の測定結果1を足し、`/home/user/Documents/pc-result.txt` に43を保存して読み戻します。QVMは毎回新しいCPUを作らず、APQB Computer画面が表示するCPU実体で実行します。整数RAMは実行開始時に初期化し、APQBレジスタはカーネルと同じプールから確保して、正常終了・例外とも解放します。通常の回路実行も同じプールを予約します。

## ターミナル互換性

macOS の標準シェルは zsh です（[Apple Terminal ガイド](https://support.apple.com/en-au/guide/terminal/trml113/mac)）。QubitOS は qsh の機能を実装しており、zsh のソースや macOS の UNIX ユーザーランドを同梱していません。「Mac と内部まで同じ」とは扱いません。

| 機能 | 対応状況 |
| --- | --- |
| パイプ・リダイレクト | `\|`、`>`、`>>`、`<`。メモリ内バッファ経由で順番に実行 |
| 条件・順次実行 | `&&`、`\|\|`、`;`、改行。非同期ネットワーク操作の完了も待機 |
| 引用・変数 | 単一/二重引用符、バックスラッシュ、`export NAME=value`、`$NAME`、`${NAME}`、`$?`、`~` |
| ファイル操作 | `pwd cd ls mkdir touch cat cp mv rm`。cp/mv はファイルのみ |
| テキスト | `echo printf grep head tail wc sort uniq` |
| 操作支援 | コマンド・パスの Tab 補完、上下の履歴ボタン、端末に保存する履歴 |
| 非対応 | glob、コマンド置換、関数、for/if、サブシェル、PTY、ジョブ制御、ネイティブ実行ファイル |
| Mac アプリ | `.app` / `.dmg` / Mach-O バイナリ、Apple 純正アプリは実行不可 |
| QubitOS アプリ | 内蔵アプリ、qpm の qsh パッケージ、Web アプリ |

各コマンドは意図的に限定したオプションだけを持ちます。`grep` はリテラル文字列検索（`-i -v -n -F`）、`ls -l` は仮想ファイルの種類・文字数表示、`wc` の既定出力は改行数・単語数・文字数です。`printf` は `%s %d %%` と `\n \t \r \\` を扱い、書式の繰り返しなどは未実装です。変数の単語分割と glob は行いません。パイプの終了ステータスは最後のコマンドです。上記のファイル・テキスト用ユーティリティは未対応オプションを拒否します。zsh/bash の呼び出しも未導入のエラーになります。全 POSIX / BSD / zsh 互換の主張はしません。

同期実行の `run app:<name>` ではネットワーク命令を拒否します。ネットワークを含むスクリプトは `sh <file.qsh>` またはスクリプトアプリのウィンドウから実行してください。

QubitOS の GUI アプリは Apple の実装を複製したものではなく、QubitFS・カーネル上で動く独自実装です。ブラウザ版ではサイトの iframe/CORS 制限も引き続き適用されます。

## 保存と検証

ファイルは端末の AsyncStorage に保存します。変更を直列化して書き込み、アプリがバックグラウンドになると保存を要求します。保存エラーは System Settings に表示します。読めないスナップショットを自動的に上書きせず、永続化しない一時セッションを選べます。ファイルシステムの初期化には画面上で削除の確認が必要です。

QubitFSはJSONスナップショットのUTF-8容量を計上し、既定64 MiBの論理上限を強制します。書込・追記・ディレクトリ作成が上限超過で失敗した場合、その操作は元の状態に戻ります。これは実SSD容量やAsyncStorageが64 MiBを必ず保存できる保証ではありません。端末側の保存上限・空き容量は別です。ファイルの直接変更も保存イベントを発行し、再起動時は過去の結果ファイルより大きいPIDから再開して履歴の上書きを防ぎます。実行結果の自動保存が失敗した場合はプロセスログとdmesgへ表示します。

```sh
cd app
npm run typecheck
npm test -- --runInBand
npm run export:web
```

テストは QVM の精度・分岐・メモリ・Bell 測定・実行上限、起動、シェルの引用・パイプ・ファイル・非同期実行、既存 APQB / QBNN / OS / インストーラを含みます。

390px 幅の Chromium で起動・QVM・パイプ・文書保存・電卓・再読込後の復元・ドラフト復元を操作確認し、1440px 幅の画面も確認しました。これは iOS Safari やネイティブ実機の検証を代替するものではありません。

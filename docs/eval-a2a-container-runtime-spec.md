# 評価パイプラインのA2Aサーバー コンテナ実行化 設計ドキュメント

`run-evaluation` スキル(`.claude/skills/run-evaluation/SKILL.md`)がA2Aサーバーを
`nohup uv run code-review-agent &` でローカルvenvプロセスとして起動していたのを、
公開コンテナイメージ `quay.io/kuju63/code-review-agent:latest` からのpodman起動に
切り替える設計を定義する。

---

## 1. 背景と問題

評価パイプラインは毎回ローカルの `.venv` から直接A2Aサーバーを起動していた。この方式では
評価環境が開発環境の `.venv` の状態(依存パッケージのバージョン、ローカルの未コミット変更)に
暗黙に依存しており、実際にリリースされるコンテナイメージ(`Dockerfile` でビルドされる
Red Hat Hardened Image ベースのランタイム)との差異を検出できない。

サーバー停止も、起動時に取得したPIDを `/tmp/a2a_eval.pid` に書き出し、
`run_agent_evaluation.py` の `--server-pid-file` 引数経由で `SIGTERM` を送る、という
実行時に判明する値(PID)をファイル経由で受け渡す方式だった。

## 2. 設計方針

### 2.1 コンテナ起動への切り替え

`.claude/skills/run-evaluation/scripts/start_a2a_container.sh` が
`podman pull quay.io/kuju63/code-review-agent:latest` でイメージを取得し、
`podman run -d --rm --replace --network=host --name code-review-agent-eval` で
起動する。イメージのdigestを起動時に出力し、どのビルドで評価したかを追跡できるようにする。

起動待機のポーリング先を `/docs` から `/health` に変更する。`/health` は
`src/code_review_agent/api/app.py` の `create_app()` が常に登録するエンドポイントであり、
`Dockerfile` の `HEALTHCHECK` も同エンドポイントを使っている。コンテナに対する外部からの
到達性チェックとして、実装が保証する正式なヘルスシグナルを使う方が、たまたま有効になっている
FastAPI自動docsに依存するより正確である。

コンテナ名(`code-review-agent-eval`)は固定の単一インスタンス名であり、同時に複数の
評価実行が同じホスト上で走ることは想定していない。`podman run --replace` は同名コンテナが
既に存在すれば無条件に強制停止・再作成するため、`start_a2a_container.sh` は `podman run`
の前に同名コンテナが**稼働中**かどうかを確認し、稼働中であれば(他セッションの評価が
進行中の可能性があるとみなして)`--replace` せず明示的に失敗する。稼働していない
(停止済み・`--rm`クリーンアップを経ていない残骸)場合のみ、従来通り`--replace`で
安全に置き換える。起動したコンテナの所有権は、それを起動したセッションのStep 5にある
(他セッションが起動したコンテナを停止すべきではない)。

このチェックは check-then-act であり、ホストロックを伴わないためアトミックではない
(2つの`start_a2a_container.sh`がほぼ同時に実行されると、両方が「稼働中でない」判定を
通過してから`podman run`に進む競合が理論上あり得る)。同時実行自体をサポート対象外と
している設計上、この残存レースは既知の制約として受け入れる。真に排除するにはホスト
ロック(`flock`等)が必要だが、`run-evaluation`スキルの各StepはClaude Codeの独立した
Bashツール呼び出しとして実行されるため、Step 3〜5をまたいで状態を共有するロック機構は
この実行単位の中では実装できない。同時実行を安全にサポートする必要が生じた場合は、
Step構成自体を単一のライフサイクルスクリプトへ統合する再設計が別途必要になる。

### 2.2 環境変数の転送方式: `--env-file` を使わない理由

`.env.example` が示す標準的な `.env` の書式は行末インラインコメントを含む
(例: `OPENAI_API_KEY=sk-...          # OpenAI 使用時。Ollama 等では...`)。bashの
`source`(Step 1が使う `set -a; source .env; set +a`)やpython-dotenvの `load_dotenv()`
(`code_review_agent.__init__.main()` が起動時に呼ぶ)はこのコメントを正しく剥がして値を
取り出すが、`podman run --env-file` はコメントを剥がさずファイルの右辺をそのまま値として
読み込む。結果、`OPENAI_API_KEY` にコメント文字列が混入し、LLM APIへの認証が原因不明のまま
失敗する。

このため `start_a2a_container.sh` は自前で `set -a; source .env; set +a` した上で、
`CODE_REVIEW_` プレフィックスの変数と `OPENAI_API_KEY` を値なし `-e KEY` 形式で
`podman run` に渡す。値なし `-e KEY` は「起動元シェルに既にある値をそのまま転送する」
動作のため、`.env` のコメント有無に関わらず安全に動く。

### 2.3 `GITHUB_TOKEN` はコンテナに渡さない

`src/code_review_agent/api/agents/common.py` の `verify_github_token` は、GitHub
トークンをサーバー側の環境変数からではなく、各リクエストの `Authorization: Bearer` ヘッダ
から取得する(送信元は `run_agent_evaluation.py` で、`.env` の `GITHUB_TOKEN` を読んで
リクエストごとに付与する)。したがってA2Aサーバーコンテナ自体は `GITHUB_TOKEN` を必要と
せず、意図的に転送対象から除外する。

### 2.4 `--network=host` が必須である理由

`.env.example` はOllama/LM Studioなどローカルモデルサーバーを使う設定例として
`CODE_REVIEW_LLM_BASE_URL=http://localhost:11434/v1` 等、ホスト上のlocalhostを指す
値を示している。コンテナがホストとネットワーク名前空間を共有していないと、コンテナ内から
見た `localhost` はコンテナ自身を指してしまい、この接続が壊れる。`-p 8000:8000` の
ポートマッピングではこの問題を解決できないため、`--network=host` を使う(Linux上のpodman
での標準的な選択で、このプロジェクトの実行環境と整合する)。

### 2.5 停止機構をSKILL.md側に一本化する

コンテナ名(`code-review-agent-eval`)は起動前から決まっている定数であり、PIDのように
実行時に判明する値ではない。したがって `/tmp/a2a_eval.pid` のような一時ファイル経由の
受け渡しはそもそも不要になる。

調査の結果、`--server-pid-file` は `SKILL.md` / `RUNBOOK.md` /
`docs/eval-sharded-execution-spec.md` / `test_run_agent_evaluation_shard.py` 以外から
参照されておらず、外部の呼び出し元やCIジョブは存在しない。そこで `run_agent_evaluation.py`
の `--server-pid-file` 引数・`_shutdown_server()` 関数・`main()` の
`shard_validation_ok` によるshutdown-skipゲートを丸ごと削除し、コンテナ停止は
`.claude/skills/run-evaluation/scripts/stop_a2a_container.sh` (`podman stop`) による
SKILL.md Step 5のみで行う。

この変更により、shard実行時の特別扱い(`docs/eval-sharded-execution-spec.md` 2.3節、
「shard実行中は自動停止をスキップする」)も不要になる。Python側がそもそも自動停止
しなくなるため、shardか否かによらずStep 5を全shard完了後に1回実行すればよい、という
単一の運用に統一される。

### 2.6 スクリプトの配置

コンテナの起動・停止コマンドはパラメータ化の余地がほぼない定型処理であり、SKILL.mdに
bashブロックとして埋め込むとスキル本体が肥大化する。呼び出すコマンド自体を
`.claude/skills/run-evaluation/scripts/` 配下のシェルスクリプト
(`common.sh` / `start_a2a_container.sh` / `stop_a2a_container.sh`)に切り出し、
SKILL.md側は `bash <script>` を呼ぶだけにする。

BashツールはCWDを呼び出しをまたいで保持するが、シェル変数・export状態は保持しない。
そのため「SKILL.md Step 1で `.env` をsourceしたから後続StepでもGITHUB_TOKEN等が見える」
という前提は成立しない(実際、既存の `run_agent_evaluation.py` もこれを前提とせず自前で
`load_dotenv()` している)。`start_a2a_container.sh` は自分自身で `.env` を読み込む。

変更の影響範囲(Python版): [docs/plan/eval-a2a-container-runtime-spec.md](plan/eval-a2a-container-runtime-spec.md)。
現行運用は`.claude/skills/run-evaluation/scripts/{start,stop}_a2a_container.sh`として維持されており、
`--env-file`を使わない値なし`-e KEY`転送・`GITHUB_TOKEN`非転送・`--network=host`必須という方針は
現行スクリプトと一致している。ただし`start_a2a_container.sh`が待ち受ける`http://localhost:8000/health`は
TS版サーバー(`packages/a2a-server/src/index.ts`)の待受ポート`3000`・`health`モジュールの未マウント状態
（[docs/a2a-api-design.md](a2a-api-design.md) §1「既知の未接続箇所」参照）と整合していない。
このポート/ヘルスエンドポイントの不一致は未解決事項であり、実際にコンテナを起動して起動待機が
成立するか確認してから前提とすること。

# Development environment setup

## 環境

**OS**: Mac or WSL(Ubuntu-24.04以降), Linux(Ubuntu or Debian)

## 開発環境の初期セットアップ

### リポジトリのクローン

```shell
git clone https://github.com/kuju63/code-review-agents.git
```

### Homebrewのインストール

全環境で同一の手順となるようにするため、[`Homebrew`](https://brew.sh/)のインストールを行う。
以降の手順で`brew`コマンドを使用するため、このセクションを最初に実施すること。

```shell
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

インストール後、`brew`コマンドをPATHに追加するために`brew shellenv`を実行する必要がある。パスはOS・アーキテクチャにより異なるため、インストール完了時に表示される案内に従うこと（代表例は以下の通り）。

```shell
# Linux/WSLの場合
echo 'eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"' >> ~/.bashrc
eval "$(/home/linuxbrew/.linuxbrew/bin/brew shellenv)"

# macOS(Apple Silicon)の場合
echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile
eval "$(/opt/homebrew/bin/brew shellenv)"
```

### GitHub CLIのインストール

GitHub MCPを使用する代わりにGitHub CLIを使用することでコンテキストの圧縮を行えるほか、PR作成やIssue作成をAIエージェントがコマンドから実行できるようになる

```shell
brew install gh

# GitHubにログイン
gh auth login
```

### Python環境のセットアップ

#### pyenvのインストール

Homebrewを使用してpyenvをインストールする。pyenvはPythonのバージョン管理を行うツールであり、プロジェクト毎にPythonバージョンを切り替えることができる

```shell
brew install pyenv
pyenv init --install
exec "$SHELL"
```

`pyenv install`はソースからPythonをビルドするため、Ubuntu/Debian/WSL環境では事前にビルド依存関係のインストールが必要となる（macOSはHomebrewのみで完結するため不要）。

```shell
# Ubuntu/Debian/WSLの場合のみ実行する
sudo apt-get update
sudo apt-get install -y build-essential libssl-dev zlib1g-dev libbz2-dev \
  libreadline-dev libsqlite3-dev libncursesw5-dev xz-utils tk-dev \
  libxml2-dev libxmlsec1-dev libffi-dev liblzma-dev
```

```shell
pyenv install 3.14.6
```

#### uvのインストール

[`uv`](https://docs.astral.sh/uv/)は`pip`と同様にパッケージ管理を行うツールである。非常に高速で動作することからプロジェクトではこれを採用している.

```shell
brew install uv

uv venv
source .venv/bin/activate
uv sync --frozen
```

#### pre-commitのインストール

[pre-commit](https://pre-commit.com/)はGitへのコミット都度、最低限のチェックを行い、品質を担保することができるツールである。

```shell
pre-commit install
```

### betterleaksのインストール

[`betterleaks`](https://github.com/betterleaks/betterleaks)はシークレットがソースコードに混入していないかをチェックするツールである。
gitleaksの後継であり、pre-commitとの相性がよいためにこれを採用している

```shell
brew install betterleaks
```

### shellcheckのインストール

[`shellcheck`](https://github.com/koalaman/shellcheck)は最も一般的なシェルのチェックツールである。本プロジェクトではシェルでヘルパーツールを作成することが多いため、脆弱性の発見対応を行いやすくするために導入している。

```shell
brew install shellcheck
```

### ローカルLLMのセットアップ

このプロジェクトではローカルLLMを使用してレビューができることが目的であるため、ローカルLLMの一種である`ollama`のインストールを推奨する.

```shell
curl -fsSL https://ollama.com/install.sh | sh
# レビュー実施用モデル
ollama pull ornith:latest
# Seed生成用モデル
ollama pull gpt-oss:latest
```

## Worktree作成後のセットアップ

開発は原則としてGitのWorktree上で行う。
そのため、Worktreeへ移動後は以下を行う必要がある。

1. venv環境の構成
2. Claude Codeのローカル設定の同期
3. .envの同期
4. 評価用データの同期

これらの処理は`scripts/setup-worktree.sh`を実行することで行うことができる

## Worktree作業終了後のクリーンアップ

作業が完了した場合、Worktreeの削除とローカルブランチの削除、mainブランチの更新、serenaプロジェクトの解除が必要となる。
そのため直接`git worktree remove`を実行するのではなく、リポジトリのmainに移動した上で以下のスクリプトを実行する。

```shell
scripts/remove-worktree.sh --force .claude/worktrees/<worktree-name>
```


## AIエージェント上でのシェルスクリプト実施時

AIエージェント上でシェルスクリプトを実行する場合、都度venv環境をactivateしないといけない。

```shell
source .venv/bin/activate; <任意のコマンド>
```

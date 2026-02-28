---
title: "WSL2でCDK deployが失敗する原因と対策 — cdk.outの書き込みエラー"
emoji: "🚧"
type: "tech"
topics: ["AWS", "CDK", "WSL2", "TypeScript", "Infra"]
published: true
category: "Debugging"
date: "2026-02-21"
---

## こんな人向け

- WSL2環境で `cdk deploy` 実行時に EACCES エラーが出て困っている
- Windowsファイルシステム（`/mnt/c/`）上でCDKを動かしている
- CDKの `cdk.out` ディレクトリに書き込めない原因がわからない

## 発生した問題

WSL2環境でAWS CDKのデプロイを実行すると、以下のエラーが発生してデプロイが完了しない。

```
Error: EACCES: permission denied, mkdir '/mnt/c/.../cdk.out'
```

CDK CLI v2.1106.0 がWindowsファイルシステム（`/mnt/c/...`）に `cdk.out` ディレクトリを作成しようとするが、WSL2の制限により書き込みに失敗する。

## 原因

WSL2はLinuxカーネル上で動作しているが、`/mnt/c/` 配下のWindowsファイルシステムへの書き込みには制限がある。CDKはデフォルトでプロジェクトディレクトリ内に `cdk.out` を生成しようとするため、プロジェクトがWindowsファイルシステム上にある場合に失敗する。

## 解決策

環境変数 `CDK_OUTDIR` でLinux側の一時ディレクトリを指定する。

```bash
# synthをLinux側のtmpに出力
CDK_OUTDIR=/tmp/cdk-output npx cdk synth

# その後アセットをS3にアップロード
npx cdk-assets publish --path /tmp/cdk-output/[StackName].assets.json

# CloudFormationでデプロイ
aws cloudformation deploy \
  --template-file /tmp/cdk-output/[StackName].template.json \
  --stack-name [StackName] \
  --s3-bucket cdk-hnb659fds-assets-[ACCOUNT_ID]-ap-northeast-1 \
  --capabilities CAPABILITY_IAM
```

スタックは依存関係の順番にデプロイすること：
Auth → Database → Storage → Api → WebSocket → Frontend → Monitoring

## 再発防止策

1. `.env` や `Makefile` に `CDK_OUTDIR=/tmp/cdk-output` を定義しておく
2. `package.json` のdeployスクリプトに環境変数を組み込む
   ```json
   "deploy": "CDK_OUTDIR=/tmp/cdk-output npx cdk synth && ..."
   ```
3. WSL2でCDKを使う場合は必ずLinuxファイルシステム側にoutputを逃がす

## 教訓

- WSL2の `/mnt/c/` はLinuxから見ると「外部マウント」であり、特定のファイル操作で制限がある
- CDKの出力先は環境変数で変更可能。デフォルトに縛られずに設定を見直す習慣を持つ
- ツールのバージョンが上がったときもこの問題は継続するため、チームに周知が必要

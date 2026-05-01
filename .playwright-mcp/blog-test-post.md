---
title: "Playwright E2E テスト投稿 — admin upload 動作確認"
icon: "test-tube"
type: "tech"
topics: ["test", "playwright", "blog"]
published: true
category: "Test"
date: "2026-04-30"
description: "管理 UI からの投稿が CloudFront 配信まで届くかをテストする目的の記事。動作確認後に削除予定。"
---

## 概要

これは Playwright + admin UI による E2E テスト投稿です。

- ログイン
- 記事プレビュー (AI 補正)
- 公開
- GitHub Actions 経由のビルド
- CloudFront 配信

の一連が機能していることを確認するための記事です。

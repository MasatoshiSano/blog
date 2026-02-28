---
title: "TypeScriptのユーティリティ型を使いこなす — Partial・Pick・Omitで型を自在に操る"
emoji: "🔧"
type: "tech"
topics: ["TypeScript"]
published: true
category: "Frontend"
date: "2025-01-10"
featured: true
description: "TypeScript組み込みのユーティリティ型（Partial, Required, Pick, Omit, Record等）の使い方と実践的な活用パターンを紹介。"
---

## ユーティリティ型とは

TypeScriptには、型変換を簡単に行うための組み込みユーティリティ型が多数用意されています。

## こんな人向け

- TypeScriptの型定義を毎回手書きしていて冗長に感じている
- `Partial`、`Pick`、`Omit`などの組み込み型を使いこなしたい
- 既存の型から派生型を効率的に作るパターンを知りたい

## よく使うユーティリティ型

### Partial<T>

すべてのプロパティをオプショナルにします。

```typescript
interface User {
  name: string;
  email: string;
  age: number;
}

type PartialUser = Partial<User>;
// { name?: string; email?: string; age?: number; }
```

### Pick<T, K>

特定のプロパティだけを抽出します。

```typescript
type UserName = Pick<User, "name" | "email">;
// { name: string; email: string; }
```

### Omit<T, K>

特定のプロパティを除外します。

```typescript
type UserWithoutAge = Omit<User, "age">;
// { name: string; email: string; }
```

## 高度なユーティリティ型

### Record<K, T>

キーと値の型を指定してオブジェクト型を作成します。

```typescript
type PageInfo = Record<string, { title: string; url: string }>;
```

### Extract と Exclude

ユニオン型からの型の抽出・除外に使います。

```typescript
type Status = "active" | "inactive" | "pending";
type ActiveStatus = Extract<Status, "active" | "pending">;
// "active" | "pending"
```

## まとめ

ユーティリティ型を活用することで、既存の型から新しい型を効率的に生成でき、コードの保守性が向上します。

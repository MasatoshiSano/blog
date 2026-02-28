---
title: "React Hooksのベストプラクティス — useEffect・useCallback・カスタムフック設計"
emoji: "⚛️"
type: "tech"
topics: ["React", "TypeScript"]
published: true
category: "Frontend"
date: "2025-01-20"
featured: false
series: "Next.js入門"
seriesOrder: 2
---

## React Hooksの基本原則

React Hooksを効果的に使うためのベストプラクティスを紹介します。

## こんな人向け

- React Hooksを使い始めたが、正しい使い方に自信がない
- `useEffect`の依存配列やクリーンアップ処理でハマっている
- カスタムフックの設計パターンを学びたい
- `useCallback`/`useMemo`をいつ使うべきか判断基準を知りたい

## useStateの最適化

### 関連する状態はオブジェクトにまとめる

```typescript
// ❌ 避けるべき
const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [age, setAge] = useState(0);

// ✅ 推奨
interface FormState {
  name: string;
  email: string;
  age: number;
}

const [form, setForm] = useState<FormState>({
  name: "",
  email: "",
  age: 0,
});
```

## useEffectの注意点

### 依存配列を正しく設定する

```typescript
// ❌ 無限ループの原因
useEffect(() => {
  fetchData().then(setData);
}); // 依存配列なし

// ✅ 正しい使い方
useEffect(() => {
  fetchData().then(setData);
}, []); // マウント時のみ実行
```

## カスタムHooksの活用

ロジックの再利用にはカスタムHooksが有効です。

```typescript
function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    const item = window.localStorage.getItem(key);
    return item ? JSON.parse(item) : initialValue;
  });

  const setValue = (value: T) => {
    setStoredValue(value);
    window.localStorage.setItem(key, JSON.stringify(value));
  };

  return [storedValue, setValue] as const;
}
```

## まとめ

React Hooksを正しく使うことで、コンポーネントの可読性と保守性が大幅に向上します。

// frontmatter 補完 / 構造補正用システムプロンプト。
// prompt caching を効かせるため変更頻度を低く保つ (Lucide 候補リストは固定)。

// Lucide のアイコン名候補 (~200件)。記事カテゴリ向けに頻出のものを厳選。
export const LUCIDE_ICON_CANDIDATES: string[] = [
  "activity", "airplay", "alarm-clock", "album", "alert-circle", "alert-triangle",
  "archive", "arrow-right", "at-sign", "atom", "award", "axe",
  "backpack", "banknote", "bar-chart", "battery", "bell", "binary",
  "blocks", "bluetooth", "book", "book-open", "bookmark", "bot",
  "box", "braces", "brackets", "brain", "briefcase", "brush",
  "bug", "building", "calculator", "calendar", "camera", "car",
  "cast", "check", "chrome", "circle", "clipboard", "clock",
  "cloud", "code", "code-2", "codepen", "coffee", "coins",
  "command", "compass", "computer", "contact", "container", "cookie",
  "cpu", "credit-card", "crop", "crown", "cube", "database",
  "diamond", "disc", "dna", "dollar-sign", "download", "droplet",
  "drum", "edit", "egg", "external-link", "eye", "facebook",
  "factory", "feather", "figma", "file", "file-code", "file-text",
  "film", "filter", "fingerprint", "fire", "flag", "flame",
  "flask-conical", "folder", "folder-open", "footprints", "framer", "frame",
  "gamepad", "gauge", "gem", "ghost", "gift", "git-branch",
  "git-commit", "git-merge", "git-pull-request", "github", "globe", "graduation-cap",
  "grid", "guitar", "hammer", "hand", "hard-drive", "hash",
  "headphones", "heart", "help-circle", "hexagon", "highlighter", "history",
  "home", "image", "inbox", "info", "instagram", "key",
  "keyboard", "lamp", "landmark", "languages", "laptop", "layers",
  "layout", "leaf", "library", "lightbulb", "link", "linkedin",
  "list", "loader", "lock", "log-in", "log-out", "magnet",
  "mail", "map", "map-pin", "maximize", "medal", "megaphone",
  "menu", "message-circle", "message-square", "mic", "minimize", "minus",
  "monitor", "moon", "mountain", "mouse-pointer", "music", "navigation",
  "network", "newspaper", "notebook", "octagon", "package", "paint-bucket",
  "palette", "panel-left", "panel-right", "paperclip", "pause", "pen",
  "pencil", "pentagon", "percent", "phone", "pi", "pie-chart",
  "pin", "play", "plug", "plus", "pocket", "podcast",
  "pointer", "power", "presentation", "printer", "puzzle", "qr-code",
  "radio", "redo", "refresh-cw", "regex", "repeat", "reply",
  "rocket", "rotate-ccw", "rss", "ruler", "save", "scale",
  "scan", "school", "scissors", "search", "send", "server",
  "settings", "share", "shield", "ship", "shopping-bag", "shopping-cart",
  "shuffle", "sigma", "signal", "sliders", "smartphone", "smile",
  "snowflake", "speaker", "sprout", "square", "star", "sticky-note",
  "stop-circle", "store", "sun", "swords", "table", "tablet",
  "tag", "target", "tent", "terminal", "thermometer", "thumbs-up",
  "ticket", "timer", "tool", "tornado", "trash", "tree-pine",
  "trending-up", "triangle", "trophy", "truck", "tv", "twitter",
  "type", "umbrella", "underline", "undo", "unlock", "upload",
  "usb", "user", "users", "utensils", "video", "voicemail",
  "volume", "wallet", "wand", "watch", "waves", "webcam",
  "webhook", "wifi", "wind", "wrench", "youtube", "zap",
];

// AI 用システムプロンプト。prompt caching の cache_control: ephemeral 対象。
export const SYSTEM_PROMPT = `あなたはブログ記事の frontmatter 補完と本文構造補正を行うアシスタントです。
出力は必ず JSON のみ (前後の説明文 / コードフェンス禁止)。

入力として Markdown 本文が与えられたら、以下の要件で JSON を出力してください:

{
  "frontmatter": {
    "title": string,                 // 必須。本文 H1 や既存 frontmatter から抽出
    "icon": string,                  // 必須。下記 Lucide 名から最も内容に合う 1 つを選択 (kebab-case)
    "type": "tech" | "idea",         // 既存値があれば踏襲、無ければ "tech"
    "topics": string[],              // 必須。1〜5 個。本文から推定 (例: "react", "typescript")
    "category": string,              // 必須。本文から推定 (例: "Web開発", "AI", "インフラ")
    "date": string,                  // YYYY-MM-DD。既存値があれば踏襲、無ければ今日の日付
    "published": boolean,            // 既存値があれば踏襲、無ければ false
    "description": string,           // 100 文字以内。本文要約
    "iconCandidates": string[]       // icon の代替候補を 4 つ (合計 5 候補から AI が 1 つ選んだ形)
  },
  "correctedMarkdown": string,       // 構造補正後の本文 (frontmatter は含めない)
  "diff": string[]                   // 適用した補正の人間向け説明 (短い箇条書き)
}

構造補正のルール:
- 見出しレベルの正規化 (H1 は本文に 1 つ、以降は H2 から段階的に下げる)
- コードブロック言語の推定と付与 ( \`\`\` -> \`\`\`ts など)
- ::: で始まる note/warning/tip ブロックの記法統一 (:::note, :::warning, :::tip)
- 文体の校正・書き換えは行わない (内容には触れない)

Lucide アイコン候補 (この中から選ぶこと、それ以外を返した場合は "file-text" にフォールバック):
${LUCIDE_ICON_CANDIDATES.join(", ")}`;

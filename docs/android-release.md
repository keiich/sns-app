# みんたつ Android（Google Play）リリース手順

みんたつはPWA対応済みなので、TWA（Trusted Web Activity）方式でGoogle Playに出せます。
Android Studioは不要で、[PWABuilder](https://www.pwabuilder.com/) でストア提出用パッケージを生成します。

このドキュメントの作業に対応するコードは1つのPRにまとまっているため、
Android対応をやめたくなった場合はそのPRをリバートするだけで戻せます。

## 事前に済んでいること（このリポジトリ側）

- PWA対応（`manifest.json` / `sw.js` / 各サイズのアイコン）
- Digital Asset Links の配信ルート（`/.well-known/assetlinks.json`）
  - 中身の `sha256_cert_fingerprints` は**手順4で必ず差し替える**（それまでプレースホルダー）
- 通報・ブロック・利用規約・プライバシーポリシー（PlayのUGCポリシー要件）

## 手順

### 1. Google Play Console に登録（あなたの作業・25ドル1回きり）

1. https://play.google.com/console にアクセスし、Googleアカウントでデベロッパー登録（個人）
2. 登録料 25 USD を支払い（買い切り）
3. 本人確認（身分証）を求められたら案内に従う

### 2. PWABuilder でパッケージ生成

1. https://www.pwabuilder.com/ に本番URL（https://〜.vercel.app または独自ドメイン）を入力
2. スコア確認後、「Package For Stores」→ **Android** を選択
3. 設定値:
   - **Package ID**: `app.mintatsu.twa`（`public/assetlinks.json` と一致させること。独自ドメイン取得後は `com.ドメイン名.mintatsu` などに変えてもよいが、その場合はassetlinks.jsonも変更）
   - **App name / Launcher name**: みんたつ
   - **Signing key**: 「Create new」でPWABuilderに新規作成させる（**ダウンロードされる署名鍵ファイルとパスワードは必ずバックアップ**。失くすと更新版を出せなくなる）
4. `.aab`（提出用）と署名鍵一式がダウンロードされる

### 3. Play Console にアプリを作成してアップロード

1. Play Console →「アプリを作成」→ 名前「みんたつ」、無料、アプリ
2. 「テスト」→「クローズドテスト」→ 新しいリリースを作成し、`.aab` をアップロード
3. ストア掲載情報を入力:
   - 簡単な説明: 「今日達成したいことを宣言して、チェックで達成管理。全部できたらミン・タツ・ツーが盛大にお祝い！」
   - スクリーンショット: スマホで撮ればOK（依頼してくれれば画像一式を生成します）
   - アイコン: `public/icon-512.png` をそのまま使用
   - プライバシーポリシーURL: `https://<本番ドメイン>/privacy.html`
4. コンテンツに関する申告:
   - ユーザー生成コンテンツ(UGC): **あり** →「通報機能・ブロック機能あり」と申告（実装済み）
   - 対象年齢・データセーフティ（収集データ: 投稿内容のみ、個人情報なし）を正直に回答

### 4. assetlinks.json の指紋を差し替え（重要）

これをやらないと、アプリを開いたときに上部にブラウザのバーが出てしまいます。

1. Play Console →「設定」→「アプリの署名」→ **「SHA-256 証明書のフィンガープリント」をコピー**
2. `public/assetlinks.json` の `REPLACE_WITH_PLAY_APP_SIGNING_SHA256_FINGERPRINT` をコピーした値に置き換えてデプロイ
   （Claudeに「assetlinksの指紋を◯◯に差し替えて」と言えば対応します）
3. 確認: `https://<本番ドメイン>/.well-known/assetlinks.json` で差し替え後の値が見えること

### 5. クローズドテスト（個人アカウントの必須要件）

新規の個人デベロッパーアカウントは、本番公開の前にクローズドテストの実施が必須です
（テスター十数名 × 14日間。人数などの要件は変わることがあるのでConsole上の表示に従ってください）。

1. クローズドテストのテスターリストに友人・知人のGmailアドレスを追加
2. 招待リンクを共有し、インストールして使ってもらう（14日間継続）
3. 条件を満たすと「製品版へのアクセスを申請」ボタンが有効になる

### 6. 本番公開

製品版リリースを作成して審査へ。Playの審査は通常数日で、以後の更新は
**Webを更新するだけでアプリ側も自動的に最新になる**（TWAはサイトをそのまま表示するため、
ストアに再提出が必要なのはアイコンやアプリ名など「殻」を変えるときだけ）。

## 将来Capacitorに移行する場合

プッシュ通知などネイティブ機能が欲しくなったら、同じPackage ID（`app.mintatsu.twa`）で
Capacitor製のアプリをビルドすれば、ストア上は同じアプリの更新として引き継げます
（署名鍵はPlay App Signingで管理されているため引き継ぎ可能）。

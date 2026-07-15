const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const app = express();
// Vercelのプロキシ背後でreq.protocolがhttpsになるようにする(OGPの絶対URL生成に必要)
app.set('trust proxy', true);
const PORT = process.env.PORT || 3000;
const MAX_CONTENT_LENGTH = 280;
const MAX_USERNAME_LENGTH = 30;

// 投稿本体はハッシュ(id -> post)、いいね数は別ハッシュ(id -> count)、
// 一覧の並び順はソート済みセット(member=id, score=createdAt)で管理する。
// レコード全体を読み書きしないことで、サーバーレス環境での同時リクエストによる上書きを避ける。
const POSTS_KEY = 'sns:posts';
const LIKES_KEY = 'sns:likes';
const SHARES_KEY = 'sns:shares';
const INDEX_KEY = 'sns:posts:index';
// 返信も投稿と同じハッシュ(POSTS_KEY)に保存し、親投稿ごとの並び順だけを
// 個別のソート済みセット(member=replyId, score=createdAt)で管理する
const REPLIES_INDEX_PREFIX = 'sns:replies:';

function replyIndexKey(postId) {
  return `${REPLIES_INDEX_PREFIX}${postId}`;
}

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

app.use(express.json());

const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');

// サーバー側でHTMLに埋め込む文字列のエスケープ(属性値にも使うためクォートも対象)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function absoluteBase(req) {
  return `${req.protocol}://${req.get('host')}`;
}

// og:image / og:url は絶対URLが必須で、デプロイ先ドメインは実行時にしか分からないため、
// トップページは静的配信ではなくリクエストのホスト名を使って埋め込んで返す
app.get('/', (req, res) => {
  const base = absoluteBase(req);
  const injected = INDEX_HTML.replace(
    '<link rel="icon"',
    `<meta property="og:url" content="${base}/" />\n<meta property="og:image" content="${base}/icon.png" />\n<link rel="icon"`
  );
  res.type('html').send(injected);
});

// 投稿ごとのシェア用パーマリンク。XなどのクローラーはJSを実行せず
// サーバーが返すHTMLのOGPタグだけを読むため、ここで投稿内容を埋め込んで返し、
// ブラウザで開いた人はタイムライン上の該当投稿へリダイレクトする。
app.get('/post/:id', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.redirect('/');
  }

  const base = absoluteBase(req);
  // 返信も自分自身にフォーカスさせる(タイムライン上で該当の返信がハイライトされる)
  const focusId = post.id;
  const title = `${post.username}さんの${post.parentId ? '返信' : '投稿'} | ぷちSNS`;
  // サロゲートペア(絵文字など)を壊さないようコードポイント単位で切り詰める
  const chars = [...post.content];
  const description = chars.length > 100 ? `${chars.slice(0, 99).join('')}…` : post.content;

  res.type('html').send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="ぷちSNS" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:url" content="${base}/post/${escapeHtml(post.id)}" />
<meta property="og:image" content="${base}/icon.png" />
<meta name="twitter:card" content="summary" />
<meta http-equiv="refresh" content="0;url=/?post=${encodeURIComponent(focusId)}" />
</head>
<body>
<p><a href="/?post=${encodeURIComponent(focusId)}">投稿へ移動しています…</a></p>
</body>
</html>`);
});

app.use(express.static(path.join(__dirname, 'public')));

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ownerTokenHashは投稿者本人しか持たない秘密情報なので、外部に返すレスポンスからは必ず除外する
function toPublicPost(post, likes, shares) {
  const { ownerTokenHash, ...publicPost } = post;
  return { ...publicPost, likes: likes || 0, shares: shares || 0 };
}

// 投稿と返信で共通の入力チェック。エラー時は { error }、成功時は { username, content } を返す
function validatePostInput(body) {
  const { username, content } = body;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return { error: '投稿内容を入力してください。' };
  }
  const trimmedContent = content.trim();
  if (trimmedContent.length > MAX_CONTENT_LENGTH) {
    return { error: `投稿内容は${MAX_CONTENT_LENGTH}文字以内で入力してください。` };
  }

  const trimmedUsername = typeof username === 'string' ? username.trim() : '';
  if (trimmedUsername.length > MAX_USERNAME_LENGTH) {
    return { error: `ユーザー名は${MAX_USERNAME_LENGTH}文字以内で入力してください。` };
  }

  return { username: trimmedUsername || '名無しさん', content: trimmedContent };
}

app.get('/api/posts', async (req, res) => {
  const ids = await redis.zrange(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) {
    return res.json([]);
  }

  // 各投稿の返信IDを取得し、本体・いいね数は投稿と返信をまとめて一括で引く
  const replyIdLists = await Promise.all(ids.map((id) => redis.zrange(replyIndexKey(id), 0, -1)));
  const allIds = [...ids, ...replyIdLists.flat()];

  const [postsData, likesData, sharesData] = await Promise.all([
    Promise.all(allIds.map((id) => redis.hget(POSTS_KEY, id))),
    Promise.all(allIds.map((id) => redis.hget(LIKES_KEY, id))),
    Promise.all(allIds.map((id) => redis.hget(SHARES_KEY, id))),
  ]);

  const publicById = new Map(
    allIds.map((id, i) => [id, postsData[i] ? toPublicPost(postsData[i], likesData[i], sharesData[i]) : null])
  );

  const posts = ids
    .map((id, i) => {
      const post = publicById.get(id);
      if (!post) return null;
      const replies = replyIdLists[i].map((rid) => publicById.get(rid)).filter(Boolean);
      return { ...post, replies };
    })
    .filter(Boolean);

  res.json(posts);
});

app.post('/api/posts', async (req, res) => {
  const input = validatePostInput(req.body);
  if (input.error) {
    return res.status(400).json({ error: input.error });
  }

  const id = crypto.randomUUID();
  const ownerToken = crypto.randomUUID();
  const post = {
    id,
    username: input.username,
    content: input.content,
    createdAt: Date.now(),
    ownerTokenHash: hashToken(ownerToken),
  };

  await Promise.all([
    redis.hset(POSTS_KEY, { [id]: post }),
    redis.hset(LIKES_KEY, { [id]: 0 }),
    redis.hset(SHARES_KEY, { [id]: 0 }),
    redis.zadd(INDEX_KEY, { score: post.createdAt, member: id }),
  ]);

  // 削除時の本人確認に使うトークンは、この作成レスポンスでのみ平文で返す
  res.status(201).json({ ...toPublicPost(post, 0, 0), ownerToken });
});

app.post('/api/posts/:id/replies', async (req, res) => {
  const parent = await redis.hget(POSTS_KEY, req.params.id);
  if (!parent) {
    return res.status(404).json({ error: '返信先の投稿が見つかりません。' });
  }
  // スレッドは1段階まで(返信への返信は不可)
  if (parent.parentId) {
    return res.status(400).json({ error: '返信に対しては返信できません。' });
  }

  const input = validatePostInput(req.body);
  if (input.error) {
    return res.status(400).json({ error: input.error });
  }

  const id = crypto.randomUUID();
  const ownerToken = crypto.randomUUID();
  const reply = {
    id,
    parentId: req.params.id,
    username: input.username,
    content: input.content,
    createdAt: Date.now(),
    ownerTokenHash: hashToken(ownerToken),
  };

  await Promise.all([
    redis.hset(POSTS_KEY, { [id]: reply }),
    redis.hset(LIKES_KEY, { [id]: 0 }),
    redis.hset(SHARES_KEY, { [id]: 0 }),
    redis.zadd(replyIndexKey(req.params.id), { score: reply.createdAt, member: id }),
  ]);

  res.status(201).json({ ...toPublicPost(reply, 0, 0), ownerToken });
});

app.post('/api/posts/:id/like', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }
  const [likes, shares] = await Promise.all([
    redis.hincrby(LIKES_KEY, req.params.id, 1),
    redis.hget(SHARES_KEY, req.params.id),
  ]);
  res.json(toPublicPost(post, likes, shares));
});

// いいねの取り消し。0未満にはならないように補正する
app.delete('/api/posts/:id/like', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }
  let likes = await redis.hincrby(LIKES_KEY, req.params.id, -1);
  if (likes < 0) {
    await redis.hset(LIKES_KEY, { [req.params.id]: 0 });
    likes = 0;
  }
  const shares = await redis.hget(SHARES_KEY, req.params.id);
  res.json(toPublicPost(post, likes, shares));
});

// 共有ボタンが実際に使われた(コピー成功・共有シート完了)タイミングでカウントする
app.post('/api/posts/:id/share', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }
  const [shares, likes] = await Promise.all([
    redis.hincrby(SHARES_KEY, req.params.id, 1),
    redis.hget(LIKES_KEY, req.params.id),
  ]);
  res.json(toPublicPost(post, likes, shares));
});

app.delete('/api/posts/:id', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }

  const ownerToken = req.get('X-Owner-Token') || '';
  if (!post.ownerTokenHash || hashToken(ownerToken) !== post.ownerTokenHash) {
    return res.status(403).json({ error: 'この投稿を削除する権限がありません。' });
  }

  if (post.parentId) {
    // 返信の削除: 本体・いいね数・共有数に加えて、親投稿の返信インデックスからも取り除く
    await Promise.all([
      redis.hdel(POSTS_KEY, req.params.id),
      redis.hdel(LIKES_KEY, req.params.id),
      redis.hdel(SHARES_KEY, req.params.id),
      redis.zrem(replyIndexKey(post.parentId), req.params.id),
    ]);
  } else {
    // 投稿の削除: ぶら下がっている返信も含めてまとめて消す
    const replyIds = await redis.zrange(replyIndexKey(req.params.id), 0, -1);
    await Promise.all([
      redis.hdel(POSTS_KEY, req.params.id, ...replyIds),
      redis.hdel(LIKES_KEY, req.params.id, ...replyIds),
      redis.hdel(SHARES_KEY, req.params.id, ...replyIds),
      redis.zrem(INDEX_KEY, req.params.id),
      redis.del(replyIndexKey(req.params.id)),
    ]);
  }
  res.status(204).end();
});

// JSONパースエラーなどをJSONで返す(デフォルトのHTMLエラーページ経由でのスタックトレース漏洩を防ぐ)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: 'サーバーでエラーが発生しました。' });
});

// Vercel上ではこのファイルはサーバーレス関数としてexportされたappを介して呼び出されるため、
// ローカル実行(`node server.js`)のときだけ待受を開始する。
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SNS app listening at http://localhost:${PORT}`);
  });
}

module.exports = app;

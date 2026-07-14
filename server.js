const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Redis } = require('@upstash/redis');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_CONTENT_LENGTH = 280;
const MAX_USERNAME_LENGTH = 30;

// 投稿本体はハッシュ(id -> post)、いいね数は別ハッシュ(id -> count)、
// 一覧の並び順はソート済みセット(member=id, score=createdAt)で管理する。
// レコード全体を読み書きしないことで、サーバーレス環境での同時リクエストによる上書きを避ける。
const POSTS_KEY = 'sns:posts';
const LIKES_KEY = 'sns:likes';
const INDEX_KEY = 'sns:posts:index';

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ownerTokenHashは投稿者本人しか持たない秘密情報なので、外部に返すレスポンスからは必ず除外する
function toPublicPost(post, likes) {
  const { ownerTokenHash, ...publicPost } = post;
  return { ...publicPost, likes };
}

app.get('/api/posts', async (req, res) => {
  const ids = await redis.zrange(INDEX_KEY, 0, -1, { rev: true });
  if (ids.length === 0) {
    return res.json([]);
  }

  const [postsData, likesData] = await Promise.all([
    Promise.all(ids.map((id) => redis.hget(POSTS_KEY, id))),
    Promise.all(ids.map((id) => redis.hget(LIKES_KEY, id))),
  ]);

  const posts = ids
    .map((id, i) => (postsData[i] ? toPublicPost(postsData[i], likesData[i] || 0) : null))
    .filter(Boolean);

  res.json(posts);
});

app.post('/api/posts', async (req, res) => {
  const { username, content } = req.body;

  if (typeof content !== 'string' || content.trim().length === 0) {
    return res.status(400).json({ error: '投稿内容を入力してください。' });
  }
  const trimmedContent = content.trim();
  if (trimmedContent.length > MAX_CONTENT_LENGTH) {
    return res.status(400).json({ error: `投稿内容は${MAX_CONTENT_LENGTH}文字以内で入力してください。` });
  }

  const trimmedUsername = typeof username === 'string' ? username.trim() : '';
  if (trimmedUsername.length > MAX_USERNAME_LENGTH) {
    return res.status(400).json({ error: `ユーザー名は${MAX_USERNAME_LENGTH}文字以内で入力してください。` });
  }

  const id = crypto.randomUUID();
  const ownerToken = crypto.randomUUID();
  const post = {
    id,
    username: trimmedUsername || '名無しさん',
    content: trimmedContent,
    createdAt: Date.now(),
    ownerTokenHash: hashToken(ownerToken),
  };

  await Promise.all([
    redis.hset(POSTS_KEY, { [id]: post }),
    redis.hset(LIKES_KEY, { [id]: 0 }),
    redis.zadd(INDEX_KEY, { score: post.createdAt, member: id }),
  ]);

  // 削除時の本人確認に使うトークンは、この作成レスポンスでのみ平文で返す
  res.status(201).json({ ...toPublicPost(post, 0), ownerToken });
});

app.post('/api/posts/:id/like', async (req, res) => {
  const post = await redis.hget(POSTS_KEY, req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }
  const likes = await redis.hincrby(LIKES_KEY, req.params.id, 1);
  res.json(toPublicPost(post, likes));
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

  await Promise.all([
    redis.hdel(POSTS_KEY, req.params.id),
    redis.hdel(LIKES_KEY, req.params.id),
    redis.zrem(INDEX_KEY, req.params.id),
  ]);
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

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'posts.json');
const MAX_CONTENT_LENGTH = 280;
const MAX_USERNAME_LENGTH = 30;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function readPosts() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  return JSON.parse(raw);
}

function writePosts(posts) {
  // 書き込み途中のプロセス終了でファイルが壊れないよう、一時ファイルに書いてからrenameする
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(posts, null, 2));
  fs.renameSync(tmpFile, DATA_FILE);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// ownerTokenHashは投稿者本人しか持たない秘密情報なので、外部に返すレスポンスからは必ず除外する
function toPublicPost(post) {
  const { ownerTokenHash, ...publicPost } = post;
  return publicPost;
}

app.get('/api/posts', (req, res) => {
  const posts = readPosts().sort((a, b) => b.createdAt - a.createdAt);
  res.json(posts.map(toPublicPost));
});

app.post('/api/posts', (req, res) => {
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

  const ownerToken = crypto.randomUUID();
  const posts = readPosts();
  const newPost = {
    id: crypto.randomUUID(),
    username: trimmedUsername || '名無しさん',
    content: trimmedContent,
    likes: 0,
    createdAt: Date.now(),
    ownerTokenHash: hashToken(ownerToken),
  };
  posts.push(newPost);
  writePosts(posts);

  // 削除時の本人確認に使うトークンは、この作成レスポンスでのみ平文で返す
  res.status(201).json({ ...toPublicPost(newPost), ownerToken });
});

app.post('/api/posts/:id/like', (req, res) => {
  const posts = readPosts();
  const post = posts.find((p) => p.id === req.params.id);
  if (!post) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }
  post.likes += 1;
  writePosts(posts);
  res.json(toPublicPost(post));
});

app.delete('/api/posts/:id', (req, res) => {
  const posts = readPosts();
  const index = posts.findIndex((p) => p.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ error: '投稿が見つかりません。' });
  }

  const post = posts[index];
  const ownerToken = req.get('X-Owner-Token') || '';
  if (!post.ownerTokenHash || hashToken(ownerToken) !== post.ownerTokenHash) {
    return res.status(403).json({ error: 'この投稿を削除する権限がありません。' });
  }

  posts.splice(index, 1);
  writePosts(posts);
  res.status(204).end();
});

// express.json()のパースエラーなどをJSONで返す(デフォルトのHTMLエラーページ経由でのスタックトレース漏洩を防ぐ)
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) {
    return next(err);
  }
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: 'サーバーでエラーが発生しました。' });
});

app.listen(PORT, () => {
  console.log(`SNS app listening at http://localhost:${PORT}`);
});

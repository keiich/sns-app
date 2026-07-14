const postForm = document.getElementById('post-form');
const usernameInput = document.getElementById('username-input');
const contentInput = document.getElementById('content-input');
const charCount = document.getElementById('char-count');
const errorMessage = document.getElementById('error-message');
const postList = document.getElementById('post-list');

const MAX_CONTENT_LENGTH = 280;
const MY_POST_TOKENS_KEY = 'sns-app:myPostTokens';
const LIKED_POST_IDS_KEY = 'sns-app:likedPostIds';

function getMyPostTokens() {
  return JSON.parse(localStorage.getItem(MY_POST_TOKENS_KEY) || '{}');
}

function addMyPostToken(id, ownerToken) {
  const tokens = getMyPostTokens();
  tokens[id] = ownerToken;
  localStorage.setItem(MY_POST_TOKENS_KEY, JSON.stringify(tokens));
}

function removeMyPostToken(id) {
  const tokens = getMyPostTokens();
  delete tokens[id];
  localStorage.setItem(MY_POST_TOKENS_KEY, JSON.stringify(tokens));
}

function getLikedPostIds() {
  return new Set(JSON.parse(localStorage.getItem(LIKED_POST_IDS_KEY) || '[]'));
}

function addLikedPostId(id) {
  const ids = getLikedPostIds();
  ids.add(id);
  localStorage.setItem(LIKED_POST_IDS_KEY, JSON.stringify([...ids]));
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderReply(reply, myPostTokens, likedPostIds) {
  const isMine = Object.prototype.hasOwnProperty.call(myPostTokens, reply.id);
  const isLiked = likedPostIds.has(reply.id);
  return `
    <li class="reply-item" data-id="${reply.id}">
      <div class="post-item-header">
        <span class="post-username">${escapeHtml(reply.username)}</span>
        <span class="post-time">${formatTime(reply.createdAt)}</span>
      </div>
      <div class="post-content">${escapeHtml(reply.content)}</div>
      <div class="post-actions">
        <button class="icon-button like-button ${isLiked ? 'liked' : ''}" data-action="like" ${isLiked ? 'disabled' : ''}>
          ♥ <span class="like-count">${reply.likes}</span>
        </button>
        ${isMine ? '<button class="icon-button delete-button" data-action="delete">削除</button>' : ''}
      </div>
    </li>
  `;
}

function renderPosts(posts) {
  if (posts.length === 0) {
    postList.innerHTML = '<li class="empty-state">まだ投稿がありません。最初の投稿をしてみましょう！</li>';
    return;
  }

  const myPostTokens = getMyPostTokens();
  const likedPostIds = getLikedPostIds();

  postList.innerHTML = posts
    .map((post) => {
      const isMine = Object.prototype.hasOwnProperty.call(myPostTokens, post.id);
      const isLiked = likedPostIds.has(post.id);
      const replies = post.replies || [];
      return `
        <li class="post-item" data-id="${post.id}">
          <div class="post-item-header">
            <span class="post-username">${escapeHtml(post.username)}</span>
            <span class="post-time">${formatTime(post.createdAt)}</span>
          </div>
          <div class="post-content">${escapeHtml(post.content)}</div>
          <div class="post-actions">
            <button class="icon-button like-button ${isLiked ? 'liked' : ''}" data-action="like" ${isLiked ? 'disabled' : ''}>
              ♥ <span class="like-count">${post.likes}</span>
            </button>
            <button class="icon-button reply-button" data-action="reply">
              💬 返信${replies.length > 0 ? ` <span class="reply-count">${replies.length}</span>` : ''}
            </button>
            ${isMine ? '<button class="icon-button delete-button" data-action="delete">削除</button>' : ''}
          </div>
          ${replies.length > 0 ? `<ul class="reply-list">${replies.map((r) => renderReply(r, myPostTokens, likedPostIds)).join('')}</ul>` : ''}
          <form class="reply-form" hidden>
            <input
              class="reply-username-input"
              type="text"
              placeholder="ユーザー名（省略可）"
              maxlength="30"
              autocomplete="off"
            />
            <textarea
              class="reply-content-input"
              placeholder="返信を書く…"
              maxlength="${MAX_CONTENT_LENGTH}"
              rows="2"
              required
            ></textarea>
            <div class="reply-form-footer">
              <button type="submit">返信する</button>
            </div>
            <p class="error-message reply-error" hidden></p>
          </form>
        </li>
      `;
    })
    .join('');
}

async function loadPosts() {
  const res = await fetch('/api/posts');
  const posts = await res.json();
  renderPosts(posts);
}

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.hidden = true;
  errorMessage.textContent = '';
}

contentInput.addEventListener('input', () => {
  charCount.textContent = `${contentInput.value.length} / ${MAX_CONTENT_LENGTH}`;
});

postForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();

  const username = usernameInput.value;
  const content = contentInput.value;

  if (content.trim().length === 0) {
    showError('投稿内容を入力してください。');
    return;
  }

  const submitButton = postForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const res = await fetch('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, content }),
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || '投稿に失敗しました。');
      return;
    }

    addMyPostToken(data.id, data.ownerToken);
    contentInput.value = '';
    charCount.textContent = `0 / ${MAX_CONTENT_LENGTH}`;
    await loadPosts();
  } catch (err) {
    showError('通信エラーが発生しました。');
  } finally {
    submitButton.disabled = false;
  }
});

postList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  // 返信内のボタンは返信自身のIDを使うため、post-item固定ではなく最も近いdata-id要素を参照する
  const targetItem = button.closest('[data-id]');
  const id = targetItem.dataset.id;
  const action = button.dataset.action;

  if (action === 'reply') {
    const form = button.closest('.post-item').querySelector('.reply-form');
    form.hidden = !form.hidden;
    if (!form.hidden) {
      form.querySelector('.reply-content-input').focus();
    }
  } else if (action === 'like') {
    // 連打で複数回いいねを送れないよう、応答を待つ前にボタンを無効化する
    button.disabled = true;
    const res = await fetch(`/api/posts/${id}/like`, { method: 'POST' });
    if (res.ok) {
      addLikedPostId(id);
      await loadPosts();
    } else {
      button.disabled = false;
    }
  } else if (action === 'delete') {
    const isReply = targetItem.classList.contains('reply-item');
    if (!confirm(isReply ? 'この返信を削除しますか？' : 'この投稿を削除しますか？')) return;
    const myPostTokens = getMyPostTokens();
    const res = await fetch(`/api/posts/${id}`, {
      method: 'DELETE',
      headers: { 'X-Owner-Token': myPostTokens[id] || '' },
    });
    if (res.ok || res.status === 204) {
      removeMyPostToken(id);
      await loadPosts();
    } else {
      const data = await res.json().catch(() => ({}));
      showError(data.error || '削除に失敗しました。');
    }
  }
});

// 返信フォームは投稿ごとに動的生成されるため、送信イベントはリスト側で委譲して受ける
postList.addEventListener('submit', async (event) => {
  const form = event.target.closest('.reply-form');
  if (!form) return;
  event.preventDefault();

  const postId = form.closest('.post-item').dataset.id;
  const username = form.querySelector('.reply-username-input').value;
  const content = form.querySelector('.reply-content-input').value;
  const replyError = form.querySelector('.reply-error');
  replyError.hidden = true;
  replyError.textContent = '';

  if (content.trim().length === 0) {
    replyError.textContent = '返信内容を入力してください。';
    replyError.hidden = false;
    return;
  }

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const res = await fetch(`/api/posts/${postId}/replies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, content }),
    });

    const data = await res.json();

    if (!res.ok) {
      replyError.textContent = data.error || '返信に失敗しました。';
      replyError.hidden = false;
      return;
    }

    addMyPostToken(data.id, data.ownerToken);
    await loadPosts();
  } catch (err) {
    replyError.textContent = '通信エラーが発生しました。';
    replyError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

loadPosts();

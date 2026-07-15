const postForm = document.getElementById('post-form');
const usernameInput = document.getElementById('username-input');
const contentInput = document.getElementById('content-input');
const charCount = document.getElementById('char-count');
const errorMessage = document.getElementById('error-message');
const postList = document.getElementById('post-list');

const MAX_CONTENT_LENGTH = 280;
const MY_POST_TOKENS_KEY = 'sns-app:myPostTokens';
const LIKED_POST_IDS_KEY = 'sns-app:likedPostIds';
const USERNAME_KEY = 'sns-app:username';
const AUTO_REFRESH_INTERVAL_MS = 30000;

function getSavedUsername() {
  return localStorage.getItem(USERNAME_KEY) || '';
}

function saveUsername(username) {
  localStorage.setItem(USERNAME_KEY, username.trim());
}

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

function removeLikedPostId(id) {
  const ids = getLikedPostIds();
  ids.delete(id);
  localStorage.setItem(LIKED_POST_IDS_KEY, JSON.stringify([...ids]));
}

function shareButtonHtml(count) {
  return `🔗 共有${count > 0 ? ` <span class="share-count">${count}</span>` : ''}`;
}

function replyButtonHtml(count) {
  return `💬 返信${count > 0 ? ` <span class="reply-count">${count}</span>` : ''}`;
}

function formatAbsoluteTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// SNSらしく「5分前」のような相対表示にする(正確な日時はtitle属性で補う)
function formatTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return formatAbsoluteTime(timestamp);
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
        <span class="post-time" title="${formatAbsoluteTime(reply.createdAt)}">${formatTime(reply.createdAt)}</span>
      </div>
      <div class="post-content">${escapeHtml(reply.content)}</div>
      <div class="post-actions">
        <button class="icon-button like-button ${isLiked ? 'liked' : ''}" data-action="like" ${isLiked ? 'disabled' : ''}>
          ♥ <span class="like-count">${reply.likes}</span>
        </button>
        <button class="icon-button share-button" data-action="share">${shareButtonHtml(reply.shares)}</button>
        ${isMine ? '<button class="icon-button delete-button" data-action="delete">削除</button>' : ''}
      </div>
    </li>
  `;
}

function renderPosts(posts, animate = false) {
  // ふわっと出す演出は初回表示のときだけ(30秒ごとの自動更新で毎回動くとうるさい)
  postList.classList.toggle('animate', animate);

  if (posts.length === 0) {
    postList.innerHTML = '<li class="empty-state">まだ投稿がありません。最初の投稿をしてみましょう！</li>';
    return;
  }

  const myPostTokens = getMyPostTokens();
  const likedPostIds = getLikedPostIds();

  postList.innerHTML = posts
    .map((post, index) => {
      const isMine = Object.prototype.hasOwnProperty.call(myPostTokens, post.id);
      const isLiked = likedPostIds.has(post.id);
      const replies = post.replies || [];
      return `
        <li class="post-item" data-id="${post.id}"${animate ? ` style="animation-delay:${Math.min(index * 45, 400)}ms"` : ''}>
          <div class="post-item-header">
            <span class="post-username">${escapeHtml(post.username)}</span>
            <span class="post-time" title="${formatAbsoluteTime(post.createdAt)}">${formatTime(post.createdAt)}</span>
          </div>
          <div class="post-content">${escapeHtml(post.content)}</div>
          <div class="post-actions">
            <button class="icon-button like-button ${isLiked ? 'liked' : ''}" data-action="like" ${isLiked ? 'disabled' : ''}>
              ♥ <span class="like-count">${post.likes}</span>
            </button>
            <button class="icon-button reply-button" data-action="reply">${replyButtonHtml(replies.length)}</button>
            <button class="icon-button share-button" data-action="share">${shareButtonHtml(post.shares)}</button>
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

  // 保存済みユーザー名を返信フォームにもあらかじめ入れておく
  const savedUsername = getSavedUsername();
  if (savedUsername) {
    postList.querySelectorAll('.reply-username-input').forEach((input) => {
      input.value = savedUsername;
    });
  }
}

// シェアリンク(/post/:id → /?post=<id>)から来た場合に、該当投稿へスクロールしてハイライトする
const focusPostId = new URLSearchParams(location.search).get('post');
let hasFocusedSharedPost = false;

function focusSharedPost() {
  if (!focusPostId || hasFocusedSharedPost) return;
  // 投稿だけでなく返信(reply-item)もシェアリンクの対象になる
  const item = postList.querySelector(`[data-id="${CSS.escape(focusPostId)}"]`);
  if (!item) return;
  hasFocusedSharedPost = true;
  item.classList.add('focused');
  item.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function loadPosts(animate = false) {
  const res = await fetch('/api/posts');
  const posts = await res.json();
  renderPosts(posts, animate);
  focusSharedPost();
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
  const length = contentInput.value.length;
  charCount.textContent = `${length} / ${MAX_CONTENT_LENGTH}`;
  charCount.classList.toggle('warn', length >= MAX_CONTENT_LENGTH - 20);
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
    saveUsername(username);
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
  } else if (action === 'share') {
    const shareUrl = `${location.origin}/post/${id}`;
    const newCount = Number(button.querySelector('.share-count')?.textContent || 0) + 1;
    let shared = false;
    if (navigator.share) {
      // モバイルではOSの共有シート(Xアプリなどに直接渡せる)を優先する
      try {
        await navigator.share({ title: 'ぷちSNS', url: shareUrl });
        shared = true;
        button.innerHTML = shareButtonHtml(newCount);
      } catch (err) {
        // 共有シートをキャンセルしただけの場合はカウントしない
      }
    } else {
      try {
        await navigator.clipboard.writeText(shareUrl);
        shared = true;
        button.innerHTML = 'コピーしました！';
        setTimeout(() => {
          button.innerHTML = shareButtonHtml(newCount);
        }, 1500);
      } catch (err) {
        shared = prompt('このリンクをコピーしてください', shareUrl) !== null;
        if (shared) button.innerHTML = shareButtonHtml(newCount);
      }
    }
    if (shared) {
      // 表示は先に更新済みなので、カウントの記録は裏で送るだけでよい
      fetch(`/api/posts/${id}/share`, { method: 'POST' }).catch(() => {});
    }
  } else if (action === 'like') {
    // サーバーの応答を待たずに即座に反映し(楽観的更新)、失敗したら巻き戻す
    button.disabled = true;
    button.classList.add('liked', 'pop');
    addLikedPostId(id);
    const countEl = button.querySelector('.like-count');
    countEl.textContent = Number(countEl.textContent) + 1;
    try {
      const res = await fetch(`/api/posts/${id}/like`, { method: 'POST' });
      if (!res.ok) throw new Error('like failed');
    } catch (err) {
      removeLikedPostId(id);
      button.classList.remove('liked', 'pop');
      button.disabled = false;
      countEl.textContent = Number(countEl.textContent) - 1;
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
      // 全体を再取得せず、その要素だけフェードアウトさせて取り除く
      const parentPostItem = isReply ? targetItem.closest('.post-item') : null;
      targetItem.classList.add('removing');
      setTimeout(() => {
        targetItem.remove();
        if (parentPostItem) {
          const replyList = parentPostItem.querySelector('.reply-list');
          if (replyList && replyList.children.length === 0) replyList.remove();
          const replyButton = parentPostItem.querySelector('button[data-action="reply"]');
          replyButton.innerHTML = replyButtonHtml(parentPostItem.querySelectorAll('.reply-item').length);
        }
        if (!postList.querySelector('.post-item')) {
          renderPosts([]);
        }
      }, 250);
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
    saveUsername(username);

    // 全体を再取得せず、返ってきた返信をその場に差し込む
    const postItem = form.closest('.post-item');
    let replyList = postItem.querySelector('.reply-list');
    if (!replyList) {
      replyList = document.createElement('ul');
      replyList.className = 'reply-list';
      postItem.insertBefore(replyList, form);
    }
    replyList.insertAdjacentHTML('beforeend', renderReply(data, getMyPostTokens(), getLikedPostIds()));
    replyList.lastElementChild.classList.add('animate-in');
    const replyButton = postItem.querySelector('button[data-action="reply"]');
    replyButton.innerHTML = replyButtonHtml(replyList.children.length);
    form.querySelector('.reply-content-input').value = '';
    form.hidden = true;
  } catch (err) {
    replyError.textContent = '通信エラーが発生しました。';
    replyError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

usernameInput.value = getSavedUsername();
loadPosts(true);

// 一定間隔でタイムラインを自動更新する。
// 返信フォームを開いている(入力中かもしれない)間と、タブが非表示の間は書き換えない。
function refreshIfIdle() {
  if (document.hidden) return;
  if (postList.querySelector('.reply-form:not([hidden])')) return;
  loadPosts().catch(() => {
    // 自動更新の失敗は次の周期で再試行するだけでよいので、エラー表示はしない
  });
}

setInterval(refreshIfIdle, AUTO_REFRESH_INTERVAL_MS);

// 別タブから戻ってきたときはすぐ最新化する
document.addEventListener('visibilitychange', refreshIfIdle);

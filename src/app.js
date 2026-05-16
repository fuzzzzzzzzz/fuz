let items = [];

const cardList = document.getElementById('cardList');
const searchInput = document.getElementById('searchInput');
const settingsBtn = document.getElementById('settingsBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsCancel = document.getElementById('settingsCancel');
const settingsSave = document.getElementById('settingsSave');
const retentionDays = document.getElementById('retentionDays');
const maxItems = document.getElementById('maxItems');
const autoStart = document.getElementById('autoStart');

async function init() {
  try {
    const [data, settings] = await Promise.all([
      window.clipboardAPI.getAll(),
      window.clipboardAPI.getSettings()
    ]);

    items = data;
    sortItems();
    applySettings(settings);
    render();
  } catch (e) {
    console.error('Init error:', e);
  }

  window.clipboardAPI.onNewItem((item) => {
    items.push(item);
    sortItems();
    render();
  });
}

function sortItems() {
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned - a.pinned;
    return new Date(b.created_at) - new Date(a.created_at);
  });
}

function applySettings(s) {
  if (s.retention_days) retentionDays.value = s.retention_days;
  if (s.max_items) maxItems.value = s.max_items;
  if (s.auto_start) autoStart.checked = s.auto_start === 'true';
}

function render() {
  const query = searchInput.value.toLowerCase().trim();
  const filtered = query
    ? items.filter(i => i.type === 'text' && i.content.toLowerCase().includes(query))
    : items;

  if (filtered.length === 0) {
    cardList.innerHTML = `
      <div class="empty-state">
        <p>${query ? '没有匹配的记录' : '还没有复制记录'}</p>
        <p class="hint">${query ? '试试其他关键词' : '试试复制一些文字或图片吧'}</p>
      </div>`;
    return;
  }

  cardList.innerHTML = filtered.map(item => createCard(item)).join('');
}

function createCard(item) {
  const time = new Date(item.created_at);
  const timeStr = formatTime(time);
  const pinnedClass = item.pinned ? ' pinned' : '';
  const pinIcon = item.pinned ? '📍' : '📌';
  const pinTitle = item.pinned ? '取消置顶' : '置顶';

  let contentHtml;
  if (item.type === 'image') {
    contentHtml = `<img src="${escapeAttr(item.content)}" alt="图片" />`;
  } else {
    contentHtml = escapeHtml(item.content);
  }

  return `
    <div class="card${pinnedClass}" data-id="${item.id}">
      <div class="card-content${item.type === 'image' ? ' image-preview' : ''}">${contentHtml}</div>
      <div class="card-meta">
        <span class="card-time">${timeStr}</span>
        <div class="card-actions">
          <button class="pin-btn" data-action="pin" data-id="${item.id}" title="${pinTitle}">${pinIcon}</button>
          <button class="delete-btn" data-action="delete" data-id="${item.id}" title="删除">🗑</button>
        </div>
      </div>
    </div>`;
}

function formatTime(date) {
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';

  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  if (date.getFullYear() === now.getFullYear()) {
    return `${month}月${day}日 ${hour}:${minute}`;
  }
  return `${date.getFullYear()}/${month}/${day} ${hour}:${minute}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text) {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Event delegation for card clicks
cardList.addEventListener('click', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;

  const id = parseInt(card.dataset.id, 10);

  // Click on action buttons
  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) {
    e.stopPropagation();
    const action = actionBtn.dataset.action;

    if (action === 'pin') {
      const pinned = await window.clipboardAPI.pin(id);
      const item = items.find(i => i.id === id);
      if (item) item.pinned = pinned ? 1 : 0;
      sortItems();
      render();
    }

    if (action === 'delete') {
      await window.clipboardAPI.delete(id);
      items = items.filter(i => i.id !== id);
      render();
    }

    return;
  }
});

// Double-click on card body = paste (keep window visible)
cardList.addEventListener('dblclick', async (e) => {
  const card = e.target.closest('.card');
  if (!card) return;

  const actionBtn = e.target.closest('[data-action]');
  if (actionBtn) return;

  const id = parseInt(card.dataset.id, 10);
  await window.clipboardAPI.paste(id);
});

// Search
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 150);
});

// Settings
settingsBtn.addEventListener('click', () => {
  settingsPanel.classList.remove('hidden');
});

settingsCancel.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

settingsSave.addEventListener('click', async () => {
  const s = {
    retention_days: retentionDays.value,
    max_items: maxItems.value,
    auto_start: autoStart.checked ? 'true' : 'false'
  };
  await window.clipboardAPI.setSettings(s);
  settingsPanel.classList.add('hidden');
});

settingsPanel.addEventListener('click', (e) => {
  if (e.target === settingsPanel) {
    settingsPanel.classList.add('hidden');
  }
});

init();

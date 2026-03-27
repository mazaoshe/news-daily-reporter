const DEFAULT_TOPICS = ['AI', '人工智能', 'ChatGPT', '大模型', '科技', '个人成长', '职场'];

let currentTopics = [...DEFAULT_TOPICS];

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('testBtn').addEventListener('click', testTelegram);
  document.getElementById('addTopicBtn').addEventListener('click', addTopic);
  document.getElementById('topicInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTopic();
  });
  document.getElementById('clearHistoryBtn').addEventListener('click', clearHistory);
});

function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};
    
    document.getElementById('enabled').checked = settings.enabled !== false;
    document.getElementById('hour').value = settings.hour || 9;
    document.getElementById('minute').value = settings.minute ?? 0;
    document.getElementById('dedupDays').value = settings.dedupDays || 7;
    document.getElementById('telegramToken').value = settings.telegramBotToken || '';
    document.getElementById('telegramChatId').value = settings.telegramChatId || '';
    document.getElementById('aiApiUrl').value = settings.aiApiUrl || 'https://api.deepseek.com/v1/chat/completions';
    document.getElementById('aiApiKey').value = settings.aiApiKey || '';
    document.getElementById('aiModel').value = settings.aiModel || 'deepseek-chat';
    document.getElementById('aiPrompt').value = settings.aiPrompt || '';
    
    const platformKeywords = settings.platformKeywords || {};
    const zhihuKeywords = platformKeywords.zhihu || settings.topics;
    const xKeywords = platformKeywords.x || [];
    const redditKeywords = platformKeywords.reddit || settings.redditKeywords || ['obsidian'];

    currentTopics = Array.isArray(zhihuKeywords) && zhihuKeywords.length > 0 ? [...zhihuKeywords] : [...DEFAULT_TOPICS];
    renderTopics();

    const sources = settings.sources || { zhihu: true, x: false, reddit: false };
    document.getElementById('sourceZhihu').checked = sources.zhihu !== false;
    document.getElementById('sourceX').checked = !!sources.x;
    document.getElementById('sourceReddit').checked = !!sources.reddit;

    document.getElementById('redditUseSubscriptions').checked = settings.redditUseSubscriptions !== false;
    document.getElementById('redditSubreddits').value = (settings.redditSubreddits || []).join(', ');
    document.getElementById('redditKeywords').value = (Array.isArray(redditKeywords) ? redditKeywords : ['obsidian']).join(', ');
    document.getElementById('xKeywords').value = (Array.isArray(xKeywords) ? xKeywords : []).join(', ');
    
    const collectedCount = settings.collectedLinks?.length || 0;
    document.getElementById('collectedCount').textContent = collectedCount;
  });
}

function renderTopics() {
  const tagsContainer = document.getElementById('topicTags');
  
  if (currentTopics.length === 0) {
    tagsContainer.innerHTML = '<span style="color:#999;font-size:12px;">暂无关注主题</span>';
    return;
  }
  
  tagsContainer.innerHTML = currentTopics.map((topic, index) => `
    <span class="topic-tag" data-index="${index}">
      ${topic}
      <span class="remove">×</span>
    </span>
  `).join('');
}

function addTopic() {
  const input = document.getElementById('topicInput');
  const topic = input.value.trim();
  
  if (topic && !currentTopics.includes(topic)) {
    currentTopics.push(topic);
    input.value = '';
    renderTopics();
  }
}

// 事件委托处理删除
document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('topicTags').addEventListener('click', function(e) {
    if (e.target.classList.contains('remove')) {
      const tag = e.target.closest('.topic-tag');
      const index = parseInt(tag.dataset.index);
      currentTopics.splice(index, 1);
      renderTopics();
    }
  });
});

function clearHistory() {
  if (confirm('确定要清除历史记录吗？清除后将重新采集所有内容。')) {
    chrome.storage.local.get(['settings'], (result) => {
      const settings = result.settings || {};
      settings.collectedLinks = [];
      settings.collectedTime = {};
      chrome.storage.local.set({ settings }, () => {
        document.getElementById('collectedCount').textContent = '0';
        alert('历史记录已清除！');
      });
    });
  }
}

function saveSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const oldSettings = result.settings || {};

    const sourceZhihu = document.getElementById('sourceZhihu').checked;
    const sourceX = document.getElementById('sourceX').checked;
    const sourceReddit = document.getElementById('sourceReddit').checked;

    const redditUseSubscriptions = document.getElementById('redditUseSubscriptions').checked;
    const redditSubreddits = document.getElementById('redditSubreddits').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const redditKeywords = document.getElementById('redditKeywords').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    const xKeywords = document.getElementById('xKeywords').value
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    const settings = {
      ...oldSettings,
      enabled: document.getElementById('enabled').checked,
      hour: parseInt(document.getElementById('hour').value) || 9,
      minute: Math.min(59, Math.max(0, parseInt(document.getElementById('minute').value) || 0)),
      dedupDays: parseInt(document.getElementById('dedupDays').value) || 7,
      telegramBotToken: document.getElementById('telegramToken').value,
      telegramChatId: document.getElementById('telegramChatId').value,
      aiApiUrl: document.getElementById('aiApiUrl').value,
      aiApiKey: document.getElementById('aiApiKey').value,
      aiModel: document.getElementById('aiModel').value,
      aiPrompt: document.getElementById('aiPrompt').value,
      topics: currentTopics,
      platformKeywords: {
        zhihu: currentTopics,
        x: xKeywords,
        reddit: redditKeywords.length > 0 ? redditKeywords : ['obsidian']
      },
      sources: { zhihu: sourceZhihu, x: sourceX, reddit: sourceReddit },
      redditUseSubscriptions,
      redditSubreddits,
      redditKeywords: redditKeywords.length > 0 ? redditKeywords : ['obsidian'],
      collectedLinks: oldSettings.collectedLinks || [],
      collectedTime: oldSettings.collectedTime || {}
    };
    
    chrome.storage.local.set({ settings }, () => {
      alert('设置已保存！');
    });
  });
}

async function testTelegram() {
  const token = document.getElementById('telegramToken').value;
  const chatId = document.getElementById('telegramChatId').value;
  
  if (!token || !chatId) {
    alert('请先填写 Telegram Token 和 Chat ID');
    return;
  }
  
  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ 测试消息 - 每日运营日报插件配置成功！'
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      alert('测试消息发送成功！');
    } else {
      alert('发送失败: ' + result.description);
    }
  } catch (error) {
    alert('发送失败: ' + error.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  checkStatus();
  
  document.getElementById('generateBtn').addEventListener('click', generateReport);
  document.getElementById('openOptionsBtn').addEventListener('click', openOptions);
  document.getElementById('saveSourcesBtn').addEventListener('click', saveSources);
});

function normalizeSources(sources) {
  const raw = sources || {};
  const zhihu = raw.zhihu === true || raw.zhihu === false ? raw.zhihu : (raw.zhihu === 'false' ? false : true);
  const x = raw.x === true || raw.x === false ? raw.x : (raw.x === 'true' ? true : false);
  const reddit = raw.reddit === true || raw.reddit === false ? raw.reddit : (raw.reddit === 'true' ? true : false);
  return { zhihu, x, reddit };
}

function loadSettings() {
  chrome.storage.local.get(['settings'], (result) => {
    const settings = result.settings || {};

    const hour = settings.hour ?? 9;
    const minute = settings.minute ?? 0;
    const minuteStr = String(minute).padStart(2, '0');
    document.getElementById('execTime').textContent = `每天 ${hour}:${minuteStr}`;
    
    const sources = normalizeSources(settings.sources);
    const enabledSources = [];
    if (sources.zhihu) enabledSources.push('知乎');
    if (sources.x) enabledSources.push('X');
    if (sources.reddit) enabledSources.push('Reddit');
    document.getElementById('sourcesList').textContent = enabledSources.length > 0 ? enabledSources.join(' / ') : '未启用采集平台';

    const pk = settings.platformKeywords || {};
    const lines = [];
    if (sources.zhihu) {
      const list = Array.isArray(pk.zhihu) ? pk.zhihu : (settings.topics || []);
      lines.push(`知乎: ${list.length > 0 ? list.join('、') : '未设置'}`);
    }
    if (sources.x) {
      const list = Array.isArray(pk.x) ? pk.x : [];
      lines.push(`X: ${list.length > 0 ? list.join('、') : '未设置'}`);
    }
    if (sources.reddit) {
      const list = Array.isArray(pk.reddit) ? pk.reddit : (settings.redditKeywords || []);
      lines.push(`Reddit: ${list.length > 0 ? list.join('、') : '未设置'}`);
    }
    document.getElementById('keywordsList').textContent = lines.length > 0 ? lines.join(' | ') : '未配置关键词';

    document.getElementById('sourceZhihuPopup').checked = !!sources.zhihu;
    document.getElementById('sourceXPopup').checked = !!sources.x;
    document.getElementById('sourceRedditPopup').checked = !!sources.reddit;
  });
}

function checkStatus() {
  chrome.runtime.sendMessage({ action: 'getStatus' }, (status) => {
    updateStatusUI(status?.isRunning || false);
  });
}

function updateStatusUI(isRunning) {
  const indicator = document.getElementById('statusIndicator');
  const btn = document.getElementById('generateBtn');
  const statusText = document.getElementById('taskStatus');
  
  if (isRunning) {
    indicator.classList.add('running');
    indicator.querySelector('.status-text').textContent = '执行中...';
    btn.disabled = true;
    btn.textContent = '采集中...';
    statusText.textContent = '正在执行';
  } else {
    indicator.classList.remove('running');
    indicator.querySelector('.status-text').textContent = '等待执行';
    btn.disabled = false;
    btn.textContent = '立即采集';
    statusText.textContent = '已设置定时';
  }
}

function generateReport() {
  updateStatusUI(true);
  
  chrome.runtime.sendMessage({ action: 'generateReport' }, (response) => {
    setTimeout(() => {
      checkStatus();
    }, 3000);
    
    if (response?.success) {
      showToast('日报生成成功！');
    } else {
      showToast('生成失败: ' + (response?.error || '未知错误'), true);
    }
  });
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

function saveSources() {
  const btn = document.getElementById('saveSourcesBtn');
  btn.disabled = true;

  const newSources = {
    zhihu: document.getElementById('sourceZhihuPopup').checked,
    x: document.getElementById('sourceXPopup').checked,
    reddit: document.getElementById('sourceRedditPopup').checked
  };

  chrome.storage.local.get(['settings'], (result) => {
    const oldSettings = result.settings || {};
    const newSettings = { ...oldSettings, sources: newSources };
    chrome.storage.local.set({ settings: newSettings }, () => {
      if (chrome.runtime.lastError) {
        btn.disabled = false;
        showToast('保存失败: ' + chrome.runtime.lastError.message, true);
        return;
      }
      btn.disabled = false;
      document.getElementById('sourceZhihuPopup').checked = !!newSources.zhihu;
      document.getElementById('sourceXPopup').checked = !!newSources.x;
      document.getElementById('sourceRedditPopup').checked = !!newSources.reddit;
      loadSettings();
      showToast('平台设置已保存！');
    });
  });
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: ${isError ? '#f44336' : '#4caf50'};
    color: white;
    padding: 10px 20px;
    border-radius: 6px;
    font-size: 13px;
    z-index: 1000;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.remove(), 3000);
}

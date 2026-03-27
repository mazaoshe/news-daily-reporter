const CONFIG = {
  DEFAULT_HOUR: 9,
  DEFAULT_MINUTE: 0,
  MAX_ITEMS: 15,
  DEFAULT_TOPICS: ['AI', '人工智能', 'ChatGPT', '大模型', '科技', '个人成长', '职场'],
  DEDUP_DAYS: 1,
  REQUEST_BASE_DELAY_MS: 1400,
  REQUEST_JITTER_MS: 1600,
  MAX_ZHIHU_QUERIES: 10,
  MAX_X_QUERIES: 4,
  MAX_REDDIT_SUBS: 10,
  MAX_REDDIT_POSTS_PER_SUB: 8,
  COOLDOWN_MS: 6 * 60 * 60 * 1000
};

let settings = {
  hour: CONFIG.DEFAULT_HOUR,
  minute: CONFIG.DEFAULT_MINUTE,
  telegramBotToken: '',
  telegramChatId: '',
  aiApiKey: '',
  aiApiUrl: '',
  aiModel: 'deepseek-chat',
  aiPrompt: '',
  enabled: true,
  topics: CONFIG.DEFAULT_TOPICS,
  platformKeywords: {
    zhihu: CONFIG.DEFAULT_TOPICS,
    x: ['AI', '科技', 'Tech', '个人成长'],
    reddit: ['obsidian']
  },
  sources: { zhihu: true, x: false, reddit: false },
  redditUseSubscriptions: true,
  redditSubreddits: [],
  redditKeywords: ['obsidian'],
  sourceCooldownUntil: {},
  nextRunTime: 0,
  lastAttemptTime: 0,
  lastReportTime: 0,
  collectedLinks: [],
  collectedTime: {}
};

let isRunning = false;

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
    settings = migrateSettings(settings);
    chrome.storage.local.set({ settings });
    scheduleTask();
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      settings = { ...settings, ...result.settings };
    }
    settings = migrateSettings(settings);
    chrome.storage.local.set({ settings });
    scheduleTask();
  });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.settings) {
    settings = { ...settings, ...changes.settings.newValue };
    settings = migrateSettings(settings);
    scheduleTask();
  }
});

function migrateSettings(s) {
  const merged = { ...s };
  function coerceBool(v, defaultValue) {
    if (v === true || v === false) return v;
    if (v === 'true') return true;
    if (v === 'false') return false;
    return defaultValue;
  }

  const rawSources = merged.sources || {};
  merged.sources = {
    zhihu: coerceBool(rawSources.zhihu, true),
    x: coerceBool(rawSources.x, false),
    reddit: coerceBool(rawSources.reddit, false)
  };

  const pk = merged.platformKeywords || {};
  const defaultZhihu = Array.isArray(merged.topics) && merged.topics.length > 0 ? merged.topics : CONFIG.DEFAULT_TOPICS;
  const redditKw = Array.isArray(merged.redditKeywords) && merged.redditKeywords.length > 0 ? merged.redditKeywords : ['obsidian'];

  merged.platformKeywords = {
    zhihu: Array.isArray(pk.zhihu) && pk.zhihu.length > 0 ? pk.zhihu : defaultZhihu,
    x: Array.isArray(pk.x) && pk.x.length > 0 ? pk.x : ['AI', '科技', 'Tech', '个人成长'],
    reddit: Array.isArray(pk.reddit) && pk.reddit.length > 0 ? pk.reddit : redditKw
  };

  merged.redditKeywords = merged.platformKeywords.reddit;
  merged.topics = merged.platformKeywords.zhihu;
  merged.lastAttemptTime = merged.lastAttemptTime || merged.lastReportTime || 0;
  merged.minute = typeof merged.minute === 'number' ? Math.min(59, Math.max(0, merged.minute)) : CONFIG.DEFAULT_MINUTE;

  return merged;
}

function scheduleTask() {
  chrome.alarms.clear('dailyReport', () => {
    if (!settings.enabled || isRunning) return;

    const now = new Date();
    const todayTarget = new Date(now);
    todayTarget.setHours(settings.hour, settings.minute || 0, 0, 0);

    const nowMs = now.getTime();
    const todayTargetMs = todayTarget.getTime();

    let nextTarget = todayTarget;
    if (todayTargetMs <= nowMs) {
      nextTarget = new Date(todayTargetMs);
      nextTarget.setDate(nextTarget.getDate() + 1);
    }

    const nextRunTime = nextTarget.getTime();
    settings.nextRunTime = nextRunTime;
    chrome.storage.local.set({ settings });

    chrome.alarms.create('dailyReport', { when: nextRunTime, periodInMinutes: 1440 });
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'dailyReport' && !isRunning) generateDailyReport({ trigger: 'alarm' });
});

function isDuplicate(link) {
  const now = Date.now();
  const times = settings.collectedTime || {};
  const dedupDays = settings.dedupDays || CONFIG.DEDUP_DAYS;
  const dedupMs = dedupDays * 24 * 60 * 60 * 1000;
  if (times[link] && (now - times[link]) < dedupMs) return true;
  return false;
}

function addToHistory(links) {
  const now = Date.now();
  const times = settings.collectedTime || {};
  links.forEach(link => { if (link) times[link] = now; });
  settings.collectedTime = times;
  chrome.storage.local.set({ settings });
}

function normalizeLink(link) {
  if (!link) return '';
  const cleaned = String(link).trim().split('?')[0].split('#')[0].replace(/^http:\/\//, 'https://');
  const article = cleaned.match(/^https:\/\/api\.zhihu\.com\/articles\/(\d+)(?:\/)?$/);
  if (article) return 'https://zhuanlan.zhihu.com/p/' + article[1];
  const question = cleaned.match(/^https:\/\/api\.zhihu\.com\/questions\/(\d+)(?:\/)?$/);
  if (question) return 'https://www.zhihu.com/question/' + question[1];
  const answer = cleaned.match(/^https:\/\/api\.zhihu\.com\/answers\/(\d+)(?:\/)?$/);
  if (answer) return 'https://www.zhihu.com/answer/' + answer[1];
  const zvideo = cleaned.match(/^https:\/\/api\.zhihu\.com\/zvideos\/(\d+)(?:\/)?$/);
  if (zvideo) return 'https://www.zhihu.com/zvideo/' + zvideo[1];
  return cleaned;
}

function pickSearchQueries(topics) {
  const raw = Array.isArray(topics) ? topics : [];
  const cleaned = raw.map(t => String(t || '').trim()).filter(Boolean);
  const uniq = [];
  const seen = new Set();
  for (const t of cleaned) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      uniq.push(t);
    }
  }
  const base = uniq.slice(0, 6);
  const queries = [...base];

  for (let i = 0; i < Math.min(2, base.length); i++) {
    for (let j = i + 1; j < Math.min(4, base.length); j++) {
      queries.push(base[i] + ' ' + base[j]);
      if (queries.length >= 8) break;
    }
    if (queries.length >= 8) break;
  }

  const final = [];
  const finalSeen = new Set();
  for (const q of queries) {
    const k = q.toLowerCase();
    if (!finalSeen.has(k)) {
      finalSeen.add(k);
      final.push(q);
    }
  }
  return final;
}

function scoreItem(item, topics) {
  const title = String(item.title || '').toLowerCase();
  const excerpt = String(item.excerpt || '').toLowerCase();
  let score = 0;
  const baseTopics = Array.isArray(topics) ? topics : [];
  const pk = settings.platformKeywords || {};
  const sourceKey = String(item?.source || '').toLowerCase();
  const sourceTopics = Array.isArray(pk[sourceKey]) && pk[sourceKey].length > 0 ? pk[sourceKey] : null;
  const mergedTopics = sourceTopics || baseTopics;
  for (const t of mergedTopics) {
    const k = String(t || '').toLowerCase().trim();
    if (!k) continue;
    if (title.includes(k)) score += 5;
    if (excerpt.includes(k)) score += 2;
  }
  if (item.hot && String(item.hot).includes('搜索:')) score += 1;
  return score;
}

function chooseBestItems(items, topics, limit) {
  const list = Array.isArray(items) ? items : [];
  const normalizedTopics = Array.isArray(topics) ? topics : [];
  const scored = list.map(it => ({ it, score: scoreItem(it, normalizedTopics) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.it);
}

function waitForTabComplete(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('等待页面加载超时'));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId) return;
      if (changeInfo.status === 'complete') {
        cleanup();
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function throttledDelay(multiplier) {
  const m = typeof multiplier === 'number' && multiplier > 0 ? multiplier : 1;
  const base = CONFIG.REQUEST_BASE_DELAY_MS;
  const jitter = Math.floor(Math.random() * CONFIG.REQUEST_JITTER_MS);
  return delay(Math.floor((base + jitter) * m));
}

function isInCooldown(source) {
  const now = Date.now();
  const map = settings.sourceCooldownUntil || {};
  const until = map[source] || 0;
  return until > now;
}

function setCooldown(source, ms) {
  const now = Date.now();
  const until = now + (typeof ms === 'number' && ms > 0 ? ms : CONFIG.COOLDOWN_MS);
  const map = settings.sourceCooldownUntil || {};
  map[source] = until;
  settings.sourceCooldownUntil = map;
  chrome.storage.local.set({ settings });
}

function detectBlockedText(text) {
  const t = String(text || '');
  if (!t) return false;
  return (
    t.includes('暂时限制本次访问') ||
    t.includes('访问存在异常') ||
    t.includes('验证') ||
    t.includes('机器人') ||
    t.includes('unusual') ||
    t.includes('rate limit') ||
    t.includes('Too Many Requests')
  );
}

async function generateDailyReport(opts) {
  if (isRunning) {
    console.log('[每日运营] 任务进行中，跳过');
    return;
  }
  isRunning = true;
  
  // 添加执行中的标识
  const execId = Date.now();
  console.log('[每日运营] 开始生成日报, ID:', execId);
  const trigger = opts && opts.trigger ? String(opts.trigger) : 'unknown';
  console.log('[每日运营] 触发来源:', trigger);
  settings.lastAttemptTime = Date.now();
  chrome.storage.local.set({ settings });
  
  try {
    const collectedData = await collectAllData();
    console.log('[每日运营] 采集完成:', collectedData.length, '条');
    
    const deduped = collectedData
      .map(item => ({ ...item, link: normalizeLink(item.link) }))
      .filter(item => item.link && !isDuplicate(item.link));

    let newItems = deduped;
    console.log('[每日运营] 去重后使用:', newItems.length, '条');
    
    if (newItems.length === 0) {
      console.log('[每日运营] 无数据');
      isRunning = false;
      scheduleTask();
      return;
    }
    
    const topicsForScore = settings.topics || CONFIG.DEFAULT_TOPICS;
    newItems = chooseBestItems(newItems, topicsForScore, 80);
    if (newItems.length > 60) newItems = newItems.slice(0, 60);
    
    console.log('[AI配置] apiKey:', settings.aiApiKey ? '有' : '无');
    console.log('[AI配置] apiUrl:', settings.aiApiUrl ? '有' : '无');
    
    var report;
    if (settings.aiApiKey && settings.aiApiUrl) {
      console.log('[AI] 开始生成...');
      try {
        report = await generateAIReport(newItems);
        console.log('[AI] 生成成功');
      } catch (e) {
        console.log('[AI生成失败]:', e.message);
        report = generateSimpleReport(newItems);
      }
    } else {
      console.log('[日报] 使用简单格式');
      const topicsForScore = settings.topics || CONFIG.DEFAULT_TOPICS;
      report = generateSimpleReport(chooseBestItems(newItems, topicsForScore, 10));
    }
    
    await sendToTelegram(report);

    const newLinks = newItems.map(item => item.link).filter(l => l);
    addToHistory(newLinks);
    
    settings.lastReportTime = Date.now();
    chrome.storage.local.set({ settings });
    console.log('[每日运营] 任务完成');
  } catch (error) {
    console.error('[每日运营] 失败:', error);
  } finally {
    isRunning = false;
    scheduleTask();
  }
}

async function collectAllData() {
  const sources = settings.sources || { zhihu: true, x: false, reddit: false };
  const pk = settings.platformKeywords || {};
  const zhihuKeywords = Array.isArray(pk.zhihu) ? pk.zhihu : (settings.topics || ['AI', '人工智能', '科技', '个人成长']);
  const xKeywords = Array.isArray(pk.x) ? pk.x : [];

  let allResults = [];

  if (sources.zhihu !== false) {
    if (isInCooldown('zhihu')) {
      console.log('[采][知乎] 处于冷却期，跳过');
    } else {
      const zhihu = await collectZhihuData(zhihuKeywords);
      allResults = allResults.concat(zhihu);
    }
  }

  if (sources.x) {
    if (isInCooldown('x')) {
      console.log('[采][X] 处于冷却期，跳过');
    } else {
      const xResults = await collectXData(xKeywords);
      allResults = allResults.concat(xResults);
    }
  }

  if (sources.reddit) {
    if (isInCooldown('reddit')) {
      console.log('[采][Reddit] 处于冷却期，跳过');
    } else {
      const redditResults = await collectRedditData();
      allResults = allResults.concat(redditResults);
    }
  }

  const uniqueResults = [];
  const seen = new Set();
  for (const item of allResults) {
    const link = normalizeLink(item.link);
    if (!link) continue;
    if (!seen.has(link)) {
      seen.add(link);
      uniqueResults.push({ ...item, link });
    }
  }

  console.log('[采] 汇总去重后共:', uniqueResults.length, '条');
  return uniqueResults;
}

async function collectRedditData() {
  let allResults = [];
  let penalty = 1.6;

  const useSubscriptions = settings.redditUseSubscriptions !== false;
  const configuredSubs = Array.isArray(settings.redditSubreddits) ? settings.redditSubreddits : [];
  const subs = await getRedditSubreddits(useSubscriptions, configuredSubs);

  if (subs.length === 0) return [];

  const limitedSubs = subs.slice(0, CONFIG.MAX_REDDIT_SUBS);
  for (let i = 0; i < limitedSubs.length; i++) {
    const sub = limitedSubs[i];
    console.log('[采][Reddit] r/' + sub + ' hot');
    try {
      const posts = await fetchRedditHot(sub, CONFIG.MAX_REDDIT_POSTS_PER_SUB);
      if (posts.length === 0) penalty = Math.min(4, penalty + 0.75);
      else penalty = Math.max(1.2, penalty - 0.2);
      allResults = allResults.concat(posts.map(p => ({ ...p, source: 'reddit', hot: 'r/' + sub })));
    } catch (e) {
      penalty = Math.min(4, penalty + 1);
      console.error('[采][Reddit] 失败:', sub, e);
    }
    await throttledDelay(penalty);
  }

  return allResults;
}

async function getRedditSubreddits(useSubscriptions, configuredSubs) {
  const cleanedConfigured = (Array.isArray(configuredSubs) ? configuredSubs : [])
    .map(s => String(s || '').trim().replace(/^r\//i, ''))
    .filter(Boolean);

  let subs = [];
  if (useSubscriptions) {
    try {
      subs = await scrapeRedditSubscriptions();
    } catch (e) {
      subs = [];
    }
  }

  const merged = [];
  const seen = new Set();
  for (const s of subs.concat(cleanedConfigured)) {
    const key = String(s).toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(s);
    }
  }

  return merged;
}

async function scrapeRedditSubscriptions() {
  return new Promise((resolve) => {
    const url = 'https://www.reddit.com/subreddits/mine/subscriber/';
    chrome.tabs.create({ url, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('[采][Reddit] 错误:', chrome.runtime.lastError.message);
        resolve([]);
        return;
      }

      waitForTabComplete(tab.id, 20000).then(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: function() {
            function uniqLower(arr) {
              var out = [];
              var seen = {};
              for (var i = 0; i < arr.length; i++) {
                var v = String(arr[i] || '').trim();
                if (!v) continue;
                var k = v.toLowerCase();
                if (!seen[k]) {
                  seen[k] = true;
                  out.push(v);
                }
              }
              return out;
            }

            var candidates = [];

            var anchors = document.querySelectorAll('a[href^="/r/"]');
            for (var i = 0; i < anchors.length; i++) {
              var href = anchors[i].getAttribute('href') || '';
              var match = href.match(/^\/r\/([^\/?#]+)(?:\/)?/);
              if (match && match[1]) {
                candidates.push(match[1]);
              }
            }

            return uniqLower(candidates);
          }
        }, function(injectionResults) {
          let subs = [];
          if (injectionResults && injectionResults[0]) subs = injectionResults[0].result || [];
          chrome.tabs.remove(tab.id);
          resolve(Array.isArray(subs) ? subs : []);
        });
      }).catch(() => {
        chrome.tabs.remove(tab.id);
        resolve([]);
      });
    });
  });
}

async function fetchRedditHot(subreddit, limit) {
  const sub = String(subreddit || '').trim().replace(/^r\//i, '');
  if (!sub) return [];
  const lim = typeof limit === 'number' && limit > 0 ? limit : 8;

  const url = 'https://www.reddit.com/r/' + encodeURIComponent(sub) + '/hot.json?limit=' + lim + '&raw_json=1';
  const resp = await fetch(url, { method: 'GET', credentials: 'include' });
  if (resp.status === 429 || resp.status === 403) {
    setCooldown('reddit', CONFIG.COOLDOWN_MS);
    throw new Error('Reddit访问受限: ' + resp.status);
  }
  const json = await resp.json();
  const children = json && json.data && Array.isArray(json.data.children) ? json.data.children : [];

  const results = [];
  const seen = new Set();
  for (const child of children) {
    const d = child && child.data ? child.data : null;
    if (!d) continue;
    const title = String(d.title || '').trim();
    const permalink = String(d.permalink || '').trim();
    if (!title || !permalink) continue;
    const link = 'https://www.reddit.com' + permalink;
    if (seen.has(link)) continue;
    seen.add(link);

    const selftext = String(d.selftext || '').trim();
    let excerpt = selftext ? selftext : (String(d.url || '').trim() || '无简介');
    excerpt = excerpt.replace(/\n/g, ' ').replace(/\s+/g, ' ').substring(0, 180);

    results.push({
      title: title.substring(0, 120),
      excerpt,
      link
    });
  }

  return results;
}

async function collectZhihuData(keywords) {
  let allResults = [];
  const queries = pickSearchQueries(keywords).slice(0, CONFIG.MAX_ZHIHU_QUERIES);
  let penalty = 1;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log('[采][知乎] 搜索:', q);
    try {
      const offsets = i < 4 ? [0, 20] : [0];
      const results = await scrapeZhihuSearch(q, offsets);
      if (results && results._blocked) {
        setCooldown('zhihu', CONFIG.COOLDOWN_MS);
        break;
      }
      if (results.length === 0) penalty = Math.min(3, penalty + 0.5);
      else penalty = Math.max(1, penalty - 0.25);
      allResults = allResults.concat(results.map(r => ({ ...r, source: 'zhihu' })));
    } catch (e) {
      penalty = Math.min(3, penalty + 0.75);
      console.error('[采][知乎] 失败:', q, e);
    }
    await throttledDelay(penalty);
  }

  return allResults;
}

async function collectXData(keywords) {
  let allResults = [];
  const queries = pickSearchQueries(keywords).slice(0, CONFIG.MAX_X_QUERIES);
  let penalty = 1.5;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log('[采][X] 搜索:', q);
    try {
      const results = await scrapeXSearch(q);
      if (results && results._blocked) {
        setCooldown('x', CONFIG.COOLDOWN_MS);
        break;
      }
      if (results.length === 0) penalty = Math.min(4, penalty + 0.75);
      else penalty = Math.max(1.2, penalty - 0.25);
      allResults = allResults.concat(results.map(r => ({ ...r, source: 'x' })));
    } catch (e) {
      penalty = Math.min(4, penalty + 1);
      console.error('[采][X] 失败:', q, e);
    }
    await throttledDelay(penalty);
  }

  return allResults;
}

async function scrapeZhihuSearch(keyword, offsets) {
  return new Promise((resolve) => {
    const searchUrl = 'https://www.zhihu.com/search?type=content&q=' + encodeURIComponent(keyword);
    chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('[采] 错误:', chrome.runtime.lastError.message);
        resolve([]);
        return;
      }
      
      console.log('[采] 打开搜索页:', tab.id, keyword);
      
      waitForTabComplete(tab.id, 12000).then(() => {
        console.log('[采] 注入采集脚本...');

        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async function(kw, offs) {
            function detectBlockedInPage() {
              var title = String(document.title || '');
              var bodyText = String(document.body && document.body.innerText || '');
              return (
                title.includes('验证') ||
                title.includes('安全') ||
                bodyText.includes('暂时限制本次访问') ||
                bodyText.includes('访问存在异常') ||
                bodyText.includes('验证') ||
                bodyText.includes('机器人')
              );
            }

            function normalizeLinkInPage(link) {
              if (!link) return '';
              var cleaned = String(link).trim().split('?')[0].split('#')[0].replace(/^http:\/\//, 'https://');
              var article = cleaned.match(/^https:\/\/api\.zhihu\.com\/articles\/(\d+)(?:\/)?$/);
              if (article) return 'https://zhuanlan.zhihu.com/p/' + article[1];
              var question = cleaned.match(/^https:\/\/api\.zhihu\.com\/questions\/(\d+)(?:\/)?$/);
              if (question) return 'https://www.zhihu.com/question/' + question[1];
              var answer = cleaned.match(/^https:\/\/api\.zhihu\.com\/answers\/(\d+)(?:\/)?$/);
              if (answer) return 'https://www.zhihu.com/answer/' + answer[1];
              var zvideo = cleaned.match(/^https:\/\/api\.zhihu\.com\/zvideos\/(\d+)(?:\/)?$/);
              if (zvideo) return 'https://www.zhihu.com/zvideo/' + zvideo[1];
              return cleaned;
            }

            function stripTags(s) {
              return String(s || '').replace(/<[^>]+>/g, '').trim();
            }

            function safeGet(obj, path) {
              try {
                var cur = obj;
                for (var i = 0; i < path.length; i++) cur = cur[path[i]];
                return cur;
              } catch (e) {
                return undefined;
              }
            }

            function buildLinkFromObject(obj) {
              var type = String(obj && obj.type || '');
              if (obj && obj.url && typeof obj.url === 'string') return normalizeLinkInPage(obj.url);
              if (type === 'question' && obj.id) return 'https://www.zhihu.com/question/' + obj.id;
              if (type === 'answer' && obj.id) {
                var qid = safeGet(obj, ['question', 'id']);
                if (qid) return 'https://www.zhihu.com/question/' + qid + '/answer/' + obj.id;
                return 'https://www.zhihu.com/answer/' + obj.id;
              }
              if (type === 'article' && obj.id) return 'https://zhuanlan.zhihu.com/p/' + obj.id;
              if (type === 'zvideo' && obj.id) return 'https://www.zhihu.com/zvideo/' + obj.id;
              return '';
            }

            function toItem(entry) {
              var obj = entry && (entry.object || entry.object_info || entry.target || entry);
              var highlight = entry && entry.highlight || {};

              var title =
                stripTags(highlight.title) ||
                stripTags(safeGet(obj, ['title'])) ||
                stripTags(safeGet(obj, ['name'])) ||
                '';

              var excerpt =
                stripTags(highlight.description) ||
                stripTags(safeGet(obj, ['excerpt'])) ||
                stripTags(safeGet(obj, ['description'])) ||
                '';

              var link = normalizeLinkInPage(buildLinkFromObject(obj));
              if (!link) return null;

              excerpt = excerpt.replace(/\n/g, ' ').replace(/\s+/g, ' ').substring(0, 180);
              title = title.replace(/\n/g, ' ').replace(/\s+/g, ' ').substring(0, 120);

              if (!title) return null;
              return { title: title, excerpt: excerpt || '无简介', link: link, hot: '搜索: ' + kw };
            }

            async function fetchSearchPage(offset) {
              var url = '/api/v4/search_v3?t=general&q=' + encodeURIComponent(kw) + '&correction=1&offset=' + offset + '&limit=20&lc_idx=0&show_all_topics=0';
              var resp = await fetch(url, { credentials: 'include' });
              if (resp.status === 429 || resp.status === 403) {
                return { blocked: true, items: [] };
              }
              var json = await resp.json();
              var data = Array.isArray(json && json.data) ? json.data : [];
              return { blocked: false, items: data.map(toItem).filter(Boolean) };
            }

            if (detectBlockedInPage()) return { blocked: true, items: [] };

            var results = [];
            var seen = {};

            var offsetsArr = Array.isArray(offs) && offs.length ? offs : [0];
            try {
              for (var i = 0; i < offsetsArr.length; i++) {
                var page = await fetchSearchPage(offsetsArr[i]);
                if (page && page.blocked) return { blocked: true, items: [] };
                var pageItems = page && page.items ? page.items : [];
                for (var j = 0; j < pageItems.length; j++) {
                  var it = pageItems[j];
                  if (!seen[it.link]) {
                    seen[it.link] = true;
                    results.push(it);
                  }
                }
              }
            } catch (e) {
              results = [];
            }

            if (results.length > 0) return { blocked: false, items: results };

            var fallbackResults = [];
            var seenLinks = {};

            for (var s = 0; s < 5; s++) {
              window.scrollTo(0, document.body.scrollHeight);
              await new Promise(function(r) { setTimeout(r, 450); });
            }

            var items = document.querySelectorAll('.ContentItem, .SearchResult-Card, .Card');
            for (var k = 0; k < items.length; k++) {
              var item = items[k];
              var titleEl = item.querySelector('.ContentItem-title, .SearchResult-Card-title, h2, h3');
              if (!titleEl) continue;

              var linkEl = titleEl.querySelector('a');
              if (!linkEl) linkEl = item.querySelector('a[href*="/question/"], a[href*="/p/"], a[href*="/zvideo/"]');
              if (!linkEl) continue;

              var href = linkEl.getAttribute('href');
              if (!href) continue;

              href = href.split('?')[0].split('#')[0];
              if (!href.startsWith('http')) {
                if (href.startsWith('//')) href = 'https:' + href;
                else href = 'https://www.zhihu.com' + (href.startsWith('/') ? '' : '/') + href;
              }
              href = normalizeLinkInPage(href);

              if (seenLinks[href]) continue;
              seenLinks[href] = true;

              var titleText = titleEl.innerText.trim();
              if (!titleText) continue;

              var excerptEl = item.querySelector('.RichContent-inner, .Search-highlight, .RichContent');
              var excerptText = excerptEl ? excerptEl.innerText.trim() : '无简介';
              excerptText = excerptText.replace(/\n/g, ' ').replace(/\s+/g, ' ').substring(0, 180);

              fallbackResults.push({
                title: titleText.replace(/\n/g, ' ').replace(/\s+/g, ' ').substring(0, 120),
                excerpt: excerptText || '无简介',
                link: href,
                hot: '搜索: ' + kw
              });
            }

            if (detectBlockedInPage()) return { blocked: true, items: [] };
            return { blocked: false, items: fallbackResults };
          },
          args: [keyword, Array.isArray(offsets) ? offsets : [0]]
        }, function(injectionResults) {
          console.log('[采] 注入完成');

          var rawData = [];
          var blocked = false;
          if (injectionResults && injectionResults[0]) {
            const result = injectionResults[0].result;
            if (result && typeof result === 'object' && Array.isArray(result.items)) {
              rawData = result.items || [];
              blocked = !!result.blocked;
            } else {
              rawData = result || [];
            }
          }

          if (rawData.length > 30) rawData = rawData.slice(0, 30);

          console.log('[采] 采集到:', rawData.length, '条，关键词:', keyword);

          chrome.tabs.remove(tab.id);
          if (blocked) {
            rawData._blocked = true;
          }
          resolve(rawData);
        });
      }).catch(() => {
        chrome.tabs.remove(tab.id);
        resolve([]);
      });
    });
  });
}

async function scrapeXSearch(keyword) {
  return new Promise((resolve) => {
    const searchUrl = 'https://x.com/search?q=' + encodeURIComponent(keyword) + '&src=typed_query&f=top';
    chrome.tabs.create({ url: searchUrl, active: false }, (tab) => {
      if (chrome.runtime.lastError) {
        console.error('[采][X] 错误:', chrome.runtime.lastError.message);
        resolve([]);
        return;
      }

      waitForTabComplete(tab.id, 20000).then(() => {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: async function(kw) {
            function isBlockedPage() {
              var t = String(document.body && document.body.innerText || '');
              var title = String(document.title || '');
              return (
                title.toLowerCase().includes('log in') ||
                t.includes('Something went wrong') ||
                t.toLowerCase().includes('rate limit') ||
                t.toLowerCase().includes('unusual')
              );
            }

            function normalizeXLink(href) {
              if (!href) return '';
              var cleaned = String(href).trim().split('?')[0].split('#')[0].replace(/^http:\/\//, 'https://');
              if (cleaned.startsWith('/')) cleaned = 'https://x.com' + cleaned;
              if (cleaned.startsWith('//')) cleaned = 'https:' + cleaned;
              cleaned = cleaned.replace(/^https:\/\/twitter\.com\//, 'https://x.com/');
              return cleaned;
            }

            if (isBlockedPage()) return { blocked: true, items: [] };

            var results = [];
            var seen = {};

            for (var s = 0; s < 5; s++) {
              window.scrollTo(0, document.body.scrollHeight);
              await new Promise(function(r) { setTimeout(r, 700); });
            }

            var tweets = document.querySelectorAll('article[data-testid="tweet"]');
            for (var i = 0; i < tweets.length; i++) {
              var tweet = tweets[i];
              var linkEl = tweet.querySelector('a[href*="/status/"]');
              if (!linkEl) continue;

              var href = normalizeXLink(linkEl.getAttribute('href'));
              if (!href) continue;
              if (seen[href]) continue;
              seen[href] = true;

              var textEl = tweet.querySelector('div[data-testid="tweetText"]');
              var text = textEl ? textEl.innerText.trim() : '';
              text = String(text || '').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
              if (!text) continue;

              results.push({
                title: text.substring(0, 80),
                excerpt: text.substring(0, 180),
                link: href,
                hot: 'X搜索: ' + kw
              });

              if (results.length >= 25) break;
            }

            if (isBlockedPage()) return { blocked: true, items: [] };
            return { blocked: false, items: results };
          },
          args: [keyword]
        }, function(injectionResults) {
          var rawData = [];
          var blocked = false;
          if (injectionResults && injectionResults[0]) {
            const result = injectionResults[0].result;
            if (result && typeof result === 'object' && Array.isArray(result.items)) {
              rawData = result.items || [];
              blocked = !!result.blocked;
            } else {
              rawData = result || [];
            }
          }

          chrome.tabs.remove(tab.id);
          if (blocked) {
            rawData._blocked = true;
          }
          resolve(rawData);
        });
      }).catch(() => {
        chrome.tabs.remove(tab.id);
        resolve([]);
      });
    });
  });
}

async function generateAIReport(data) {
  const sources = settings.sources || { zhihu: true, x: false, reddit: false };
  const pk = settings.platformKeywords || {};
  const focus = {};
  if (sources.zhihu !== false) focus.zhihu = Array.isArray(pk.zhihu) ? pk.zhihu : (settings.topics || CONFIG.DEFAULT_TOPICS);
  if (sources.x) focus.x = Array.isArray(pk.x) ? pk.x : [];
  if (sources.reddit) focus.reddit = Array.isArray(pk.reddit) ? pk.reddit : (settings.redditKeywords || ['obsidian']);

  const topics = Object.keys(focus).map(function(k) {
    const list = Array.isArray(focus[k]) ? focus[k] : [];
    return k.toUpperCase() + ': ' + list.join('、');
  }).join(' | ') || 'AI、科技';
  const customPrompt = settings.aiPrompt || '';
  
  // 构建数据列表，包含title, hot, excerpt和link
  const dataList = data.map(function(item, i) {
    return (i+1) + '. 来源: ' + (item.source || '') + '\n   标题: ' + item.title + '\n   热度: ' + item.hot + '\n   简介: ' + item.excerpt + '\n   链接: ' + item.link;
  }).join('\n\n');
  
  const defaultPrompt = '你是一个高级内容筛选助手。请从以下多平台内容中筛选出与关注关键词相关的内容。\n\n' +
    '不同来源的关注关键词如下：\n' +
    '- zhihu: ' + (focus.zhihu || []).join('、') + '\n' +
    '- x: ' + (focus.x || []).join('、') + '\n' +
    '- reddit: ' + (focus.reddit || []).join('、') + '\n\n' +
    '请只返回JSON，不要返回Markdown代码块，不要额外解释。\n' +
    'JSON格式：\n' +
    '{\n' +
    '  "items": [\n' +
    '    { "title": "标题", "intro": "一句话简介", "link": "https://...", "source": "zhihu|x|reddit" }\n' +
    '  ],\n' +
    '  "summary": "一句话今日总结"\n' +
    '}\n\n' +
    '要求：\n' +
    '1. items长度必须在5到10之间（不足5条时，允许稍微放宽标准补足到5条，但不能超过10条）。\n' +
    '2. 对每条内容，必须使用该条内容的来源(source)对应的关键词来判断相关性。\n' +
    '3. intro必须基于我提供的简介信息改写，不要胡编。\n' +
    '4. link必须使用我提供的原始链接。\n' +
    '5. 按相关度优先，其次参考热度。\n\n' +
    '待筛选内容：\n' + dataList;

  const prompt = customPrompt || defaultPrompt;

  console.log('[AI] 发送请求到:', settings.aiApiUrl);

  try {
    const response = await fetch(settings.aiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.aiApiKey },
      body: JSON.stringify({ 
        model: settings.aiModel || 'deepseek-chat', 
        messages: [{ role: 'user', content: prompt }], 
        temperature: 0.7, 
        max_tokens: 1000 
      })
    });
    
    const result = await response.json();
    console.log('[AI] 响应:', JSON.stringify(result));
    
    if (result.error) {
      throw new Error(result.error.message || 'API错误');
    }
    
    if (result.choices && result.choices[0]) {
      const aiContent = String(result.choices[0].message.content || '').trim();
      let parsed = null;
      try {
        const cleaned = aiContent
          .replace(/^```json\s*/i, '')
          .replace(/^```\s*/i, '')
          .replace(/```$/i, '')
          .trim();
        parsed = JSON.parse(cleaned);
      } catch (e) {
        parsed = null;
      }

      const header = '📊 每日运营日报\n📌 关注: ' + topics + '\n📅 ' + new Date().toLocaleDateString('zh-CN') + '\n\n━━━━━━━━━━━━━\n\n';

      if (!parsed || !Array.isArray(parsed.items)) {
        return header + aiContent;
      }

      let items = parsed.items
        .map(function(x) {
          const title = String(x?.title || '').trim();
          const intro = String(x?.intro || '').trim();
          const link = normalizeLink(String(x?.link || '').trim());
          return { title, intro, link };
        })
        .filter(function(x) { return x.title && x.link; });

      const seen = new Set();
      items = items.filter(function(x) {
        if (seen.has(x.link)) return false;
        seen.add(x.link);
        return true;
      });

      if (items.length > 10) items = items.slice(0, 10);

      if (items.length < 5) {
        const topicsForScore = settings.topics || CONFIG.DEFAULT_TOPICS;
        const fallback = chooseBestItems(data, topicsForScore, 12);
        for (const it of fallback) {
          if (items.length >= 5) break;
          const link = normalizeLink(it.link);
          if (!link || seen.has(link)) continue;
          seen.add(link);
          items.push({
            title: String(it.title || '').trim(),
            intro: String(it.excerpt || '无简介').trim(),
            link: link
          });
        }
      }

      let body = '';
      items.forEach(function(it, idx) {
        body += '【' + (idx + 1) + '】' + it.title + '\n';
        body += '简介：' + (it.intro || '无简介') + '\n';
        body += '链接：' + it.link + '\n\n';
      });

      const summary = String(parsed.summary || '').trim();
      if (summary) body += '总结：' + summary;

      return header + body.trim();
    } else {
      throw new Error('AI返回格式异常');
    }
  } catch (e) {
    console.error('[AI生成失败]:', e);
    throw e;
  }
}

function generateSimpleReport(data) {
  const topics = settings.topics?.join('、') || 'AI、科技';
  var report = '📊 每日运营日报\n📌 关注: ' + topics + '\n📅 ' + new Date().toLocaleDateString('zh-CN') + '\n\n';
  
  data.forEach(function(item, i) {
    if (i >= 10) return; // 限制最多输出10条
    report += (i+1) + '. ' + item.title + '\n';
    report += '   简介: ' + (item.excerpt || '无简介') + '\n';
    if (item.link) report += '   链接: ' + item.link + '\n';
    if (item.hot) report += '   热度: ' + item.hot + '\n';
    report += '\n';
  });
  
  report += '💡 配置AI可生成智能分析';
  return report;
}

async function sendToTelegram(message) {
  if (!settings.telegramBotToken || !settings.telegramChatId) {
    throw new Error('Telegram配置未设置');
  }
  
  const response = await fetch('https://api.telegram.org/bot' + settings.telegramBotToken + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: settings.telegramChatId, text: message })
  });
  
  const result = await response.json();
  if (!result.ok) throw new Error(result.description);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'generateReport') {
    generateDailyReport({ trigger: 'manual' }).then(function() { sendResponse({ success: true }); }).catch(function(err) { sendResponse({ success: false, error: err.message }); });
    return true;
  }
  if (message.action === 'getSettings') { sendResponse(settings); return true; }
  if (message.action === 'getStatus') { sendResponse({ isRunning: isRunning }); return true; }
  if (message.action === 'clearHistory') {
    settings.collectedLinks = [];
    settings.collectedTime = {};
    chrome.storage.local.set({ settings });
    sendResponse({ success: true });
    return true;
  }
});

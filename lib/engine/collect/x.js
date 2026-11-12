/**
 * X (Twitter) account collector.
 *
 * Primary path: the same GraphQL endpoint x.com itself uses. A guest token
 * (POST /1.1/guest/activate.json) plus one of the public query ids is enough to
 * read a user's timeline without logging in, and it is far more generous than
 * the old syndication endpoint (30 requests / 15 min per address, which seven
 * followed accounts exhaust on every run). Syndication stays as a secondary
 * path, then the on-disk cache, then an official-blog feed so the AI card is
 * never empty.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../fetch.js';
import { stripHtml, truncate } from '../text.js';
import { collectFeed } from './feed.js';

const GAP_MS = 400;
const CACHE_FRESH_MS = 12 * 60 * 1000;
const GUEST_TTL_MS = 55 * 60 * 1000;
const USER_ID_TTL_MS = 30 * 24 * 3600 * 1000;

// Public web bearer token (the one every logged-out x.com page ships).
const BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Several published UserTweets operation ids; a stale one answers 404
// "Query not found", so try them in turn and remember whichever works.
const QUERY_IDS = ['E3opETHurmVJflFsUBVuUQ', 'HuTx74BxAnezK1gWvYY7zg', 'V7H0Ap3_Hh2FyS75OCDO3Q'];

const FEATURES = {
  rweb_video_screen_enabled: false,
  payments_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: false,
  responsive_web_grok_share_attachment_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

const BROWSER_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'application/json',
  'accept-language': 'en-US,en;q=0.9',
  'content-type': 'application/json',
  authorization: `Bearer ${BEARER}`,
  'x-twitter-active-user': 'yes',
  'x-twitter-client-language': 'en',
  origin: 'https://x.com',
  referer: 'https://x.com/',
};

// 官方博客 / 站点订阅：仅在 X 拿不到新帖时补位，标题会标注「官方博客」。
const FALLBACK_FEEDS = {
  openai: 'https://news.google.com/rss/search?q=site:openai.com&hl=en-US&gl=US&ceid=US:en',
  anthropicai: 'https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en',
  claudeai: 'https://news.google.com/rss/search?q=site:anthropic.com+Claude&hl=en-US&gl=US&ceid=US:en',
  deepseek_ai: 'https://news.google.com/rss/search?q=site:deepseek.com+OR+DeepSeek&hl=en-US&gl=US&ceid=US:en',
  googledeepmind: 'https://news.google.com/rss/search?q=site:deepmind.google+OR+%22Google+DeepMind%22&hl=en-US&gl=US&ceid=US:en',
};

const QUERY_FALLBACKS = {
  thsottiaux: 'Tibo Sottiaux OpenAI',
  ryo_spcl: 'Ryo OpenAI',
};

const FEED_SUFFIX = /\s+-\s+((The )?[A-Z][\w .&]*|OpenAI|Anthropic|Google DeepMind|DeepMind)$/;

let queue = Promise.resolve();
let lastAt = 0;
let preferredQuery = 0;

function cacheFile(storeDir, name) {
  return path.join(storeDir, '.cache', name);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* cache is best effort */
  }
}

function readCache(storeDir, handle) {
  return readJson(cacheFile(storeDir, `x-${handle.toLowerCase()}.json`));
}

function writeCache(storeDir, handle, payload) {
  writeJson(cacheFile(storeDir, `x-${handle.toLowerCase()}.json`), payload);
}

function serialize(task) {
  const run = queue.then(async () => {
    const wait = Math.max(0, GAP_MS - (Date.now() - lastAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAt = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

function cleanText(value) {
  return stripHtml(value)
    .replace(/https:\/\/t\.co\/\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Walk any nested structure and collect tweet_results payloads. */
function collectTweetNodes(node, out = [], depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return out;
  if (Array.isArray(node)) {
    for (const entry of node) collectTweetNodes(entry, out, depth + 1);
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'tweet_results' && value && typeof value === 'object' && value.result) {
      out.push(value.result);
      continue;
    }
    if (value && typeof value === 'object') collectTweetNodes(value, out, depth + 1);
  }
  return out;
}

function unwrapTweet(result) {
  if (!result || typeof result !== 'object') return null;
  if (result.__typename === 'TweetWithVisibilityResults' && result.tweet) return result.tweet;
  return result;
}

function screenNameOf(tweet) {
  const user = tweet?.core?.user_results?.result ?? tweet?.user?.result ?? tweet?.user;
  return String(user?.legacy?.screen_name ?? user?.core?.screen_name ?? '');
}

function normalizeTweet(result) {
  const tweet = unwrapTweet(result);
  const legacy = tweet?.legacy;
  if (!tweet || !legacy) return null;
  const id = String(tweet.rest_id || legacy.id_str || '');
  const text = String(legacy.full_text || legacy.text || '');
  const date = String(legacy.created_at || '');
  if (id === '' || text === '') return null;
  return {
    id_str: id,
    full_text: text,
    created_at: date,
    screen_name: screenNameOf(tweet),
    has_media: Boolean(legacy.entities?.media?.length || legacy.extended_entities?.media?.length),
  };
}

function tweetsFromGraphql(json) {
  const nodes = collectTweetNodes(json?.data ?? json);
  const seen = new Set();
  const tweets = [];
  for (const node of nodes) {
    const tweet = normalizeTweet(node);
    if (!tweet || seen.has(tweet.id_str)) continue;
    // Retweets only repeat someone else's words; the card wants this account's voice.
    if (tweet.full_text.startsWith('RT @')) continue;
    seen.add(tweet.id_str);
    tweets.push(tweet);
  }
  return tweets.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function toItem(tweet, source) {
  const text = cleanText(tweet.full_text || tweet.text || '');
  if (text === '') return null;
  const firstLine = text.split(/(?<=[。！？.!?])\s/)[0] || text;
  const title = truncate(firstLine, 120);
  const rest = text.slice(firstLine.length).trim();
  const label = tweet.screen_name || tweet.user?.screen_name || source.options.handle;
  const media = tweet.has_media || (Array.isArray(tweet.entities?.media) && tweet.entities.media.length > 0);
  return {
    id: `x-${tweet.id_str || `${label}-${tweet.created_at}`}`,
    title,
    detail: rest === '' ? '' : truncate(rest, 160),
    url: tweet.id_str ? `https://x.com/${label}/status/${tweet.id_str}` : `https://x.com/${label}`,
    date: tweet.created_at || '',
    meta: `@${label}${media ? ' · 含图片' : ''}`,
    badge: '',
    tone: '',
  };
}

async function resolveUserId(handle, storeDir) {
  const file = cacheFile(storeDir, `x-user-${handle.toLowerCase()}.json`);
  const cached = readJson(file);
  const age = cached?.at ? Date.now() - new Date(cached.at).getTime() : Infinity;
  if (cached?.id && age >= 0 && age < USER_ID_TTL_MS) return String(cached.id);
  try {
    const response = await safeFetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`, {
      timeoutMs: 10000,
      maxBytes: 512 * 1024,
      headers: { accept: 'application/json', 'user-agent': BROWSER_HEADERS['user-agent'] },
    });
    if (!response.ok) return null;
    const data = JSON.parse(response.text);
    const id = data?.user?.id ?? data?.user?.id_str;
    if (!id) return null;
    writeJson(file, { at: new Date().toISOString(), id: String(id), screenName: data?.user?.screen_name || handle });
    return String(id);
  } catch {
    return null;
  }
}

async function guestToken(storeDir, force = false) {
  const file = cacheFile(storeDir, 'x-guest.json');
  if (!force) {
    const cached = readJson(file);
    const age = cached?.at ? Date.now() - new Date(cached.at).getTime() : Infinity;
    if (cached?.token && age >= 0 && age < GUEST_TTL_MS) return String(cached.token);
  }
  try {
    const response = await safeFetch('https://api.x.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: BROWSER_HEADERS,
      body: '',
      timeoutMs: 12000,
      maxBytes: 64 * 1024,
    });
    if (!response.ok) return null;
    const token = JSON.parse(response.text)?.guest_token;
    if (!token) return null;
    writeJson(file, { at: new Date().toISOString(), token: String(token) });
    return String(token);
  } catch {
    return null;
  }
}

async function graphqlTweets(handle, storeDir) {
  const userId = await resolveUserId(handle, storeDir);
  if (!userId) return { error: '无法解析 X 账号 ID' };
  let token = await guestToken(storeDir);
  if (!token) return { error: 'X 匿名令牌获取失败' };

  const variables = {
    userId,
    count: 40,
    includePromotedContent: false,
    withQuickPromoteEligibilityTweetFields: false,
    withVoice: false,
    withV2Timeline: true,
  };
  const query = `variables=${encodeURIComponent(JSON.stringify(variables))}&features=${encodeURIComponent(JSON.stringify(FEATURES))}`;
  const order = QUERY_IDS.map((_, index) => (preferredQuery + index) % QUERY_IDS.length);

  let refreshed = false;
  for (const index of order) {
    const queryId = QUERY_IDS[index];
    let response;
    try {
      response = await safeFetch(`https://api.x.com/graphql/${queryId}/UserTweets?${query}`, {
        headers: { ...BROWSER_HEADERS, 'x-guest-token': token },
        timeoutMs: 15000,
        maxBytes: 6 * 1024 * 1024,
      });
    } catch (error) {
      return { error: String(error?.message || error).slice(0, 200) };
    }
    if (response.status === 404) continue; // stale operation id, try the next one
    if (response.status === 429) {
      const reset = Number(response.headers?.['x-rate-limit-reset'] || 0);
      return { limited: true, resetAt: reset > 0 ? reset * 1000 : Date.now() + 15 * 60 * 1000 };
    }
    if (response.status === 401 || response.status === 403) {
      if (refreshed) return { error: `X 拒绝访问（${response.status}）` };
      refreshed = true;
      token = await guestToken(storeDir, true);
      if (!token) return { error: 'X 匿名令牌失效' };
      // retry this same operation id with the fresh token
      order.push(index);
      continue;
    }
    if (!response.ok) return { error: `X 返回 ${response.status}` };
    let json;
    try {
      json = JSON.parse(response.text);
    } catch {
      return { error: 'X 返回内容无法解析' };
    }
    const tweets = tweetsFromGraphql(json);
    preferredQuery = index;
    return { tweets, bytes: response.bytes };
  }
  return { error: 'X 接口查询 ID 全部失效' };
}

async function syndicationTweets(handle) {
  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?lang=en&showReplies=false`;
  try {
    const response = await safeFetch(url, {
      timeoutMs: 12000,
      maxBytes: 3 * 1024 * 1024,
      headers: {
        'user-agent': BROWSER_HEADERS['user-agent'],
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        referer: 'https://platform.twitter.com/',
      },
    });
    if (response.status === 429) return { limited: true };
    if (!response.ok) return { error: `X 返回 ${response.status}` };
    const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(response.text);
    if (!match) return { error: 'X 页面结构无法解析' };
    let data;
    try {
      data = JSON.parse(match[1]);
    } catch {
      return { error: 'X 页面结构无法解析' };
    }
    const entries = data?.props?.pageProps?.timeline?.entries;
    if (!Array.isArray(entries)) return { error: 'X 页面结构无法解析' };
    const tweets = [];
    for (const entry of entries) {
      const tweet = entry?.content?.tweet;
      if (!tweet) continue;
      const author = String(tweet.user?.screen_name || '');
      if (author !== '' && author.toLowerCase() !== handle.toLowerCase()) continue;
      tweets.push({
        id_str: tweet.id_str,
        full_text: tweet.full_text || tweet.text || '',
        created_at: tweet.created_at || '',
        screen_name: author,
        has_media: Boolean(tweet.entities?.media?.length),
      });
    }
    return { tweets: tweets.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)) };
  } catch (error) {
    return { error: String(error?.message || error).slice(0, 200) };
  }
}

/**
 * 当 X 限流且没有可用缓存时，用该账号对应的官方博客订阅补位。
 * 仍属于「关注这个账号」的范围，只是换了一条不用配额的通道。
 */
async function fallbackItems(source, handle, sinceHours, limit) {
  const key = handle.toLowerCase();
  const feed =
    FALLBACK_FEEDS[key] ||
    (QUERY_FALLBACKS[key]
      ? `https://news.google.com/rss/search?q=${encodeURIComponent(QUERY_FALLBACKS[key])}&hl=en-US&gl=US&ceid=US:en`
      : '');
  if (!feed) return [];
  try {
    const result = await collectFeed(
      {
        id: `${source.id}-feed`,
        label: source.label,
        section: source.section,
        type: 'rss',
        url: feed,
        options: { limit: Math.max(limit, 4), sinceHours: Math.max(sinceHours, 96) },
      },
      {},
    );
    return (result.items || [])
      .filter((item) => {
        const time = new Date(item.date).getTime();
        return Number.isFinite(time) && time >= Date.now() - Math.max(sinceHours, 96) * 3600 * 1000;
      })
      .slice(0, limit)
      .map((item) => ({
        ...item,
        // Google News appends the outlet name; the card already says 官方博客.
        title: String(item.title || '').replace(FEED_SUFFIX, ''),
        id: `xfeed-${item.id}`,
        meta: `官方博客 · @${handle}`,
        badge: '博客',
        tone: '',
      }));
  } catch {
    return [];
  }
}

export async function collectX(source, context = {}) {
  const started = Date.now();
  const handle = String(source.options?.handle || '').replace(/^@/, '');
  if (handle === '') {
    return { status: 'error', items: [], note: '账号名称为空', elapsedMs: 0 };
  }
  const sinceHours = Number(source.options?.sinceHours) || 40;
  const limit = Number(source.options?.limit) || 3;
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const storeDir = context.storeDir || '';

  // A fresh cache spares the shared request budget.
  const cachedBefore = storeDir ? readCache(storeDir, handle) : null;
  const cachedAge = cachedBefore?.at ? Date.now() - new Date(cachedBefore.at).getTime() : Infinity;
  if (cachedBefore?.items?.length && cachedAge >= 0 && cachedAge < CACHE_FRESH_MS) {
    const items = cachedBefore.items.filter((item) => new Date(item.date).getTime() >= cutoff).slice(0, limit);
    if (items.length > 0) {
      return { status: 'ok', items, note: '', elapsedMs: Date.now() - started, cached: true };
    }
  }

  const payload = await serialize(async () => {
    const primary = await graphqlTweets(handle, storeDir);
    if (primary.tweets?.length) return primary;
    if (primary.limited) return primary;
    const secondary = await syndicationTweets(handle);
    if (secondary.tweets?.length) return secondary;
    return primary.error ? primary : secondary;
  });

  if (!payload.tweets) {
    const cached = storeDir ? readCache(storeDir, handle) : cachedBefore;
    const items = (cached?.items || [])
      .filter((item) => new Date(item.date).getTime() >= cutoff)
      .slice(0, limit);
    if (items.length > 0) {
      return {
        status: 'degraded',
        items,
        note: payload.limited ? 'X 限流，稍后自动重试，先看上次结果' : 'X 获取失败，显示上次结果',
        elapsedMs: Date.now() - started,
      };
    }
    const fromBlog = await fallbackItems(source, handle, sinceHours, limit);
    if (fromBlog.length > 0) {
      return {
        status: 'ok',
        items: fromBlog,
        note: '',
        elapsedMs: Date.now() - started,
        fallback: 'feed',
      };
    }
    return {
      status: payload.limited ? 'degraded' : 'error',
      items: [],
      note: payload.limited ? 'X 限流，稍后自动重试' : payload.error || 'X 获取失败',
      elapsedMs: Date.now() - started,
    };
  }

  const items = payload.tweets
    .map((tweet) => toItem(tweet, source))
    .filter(Boolean)
    .filter((item) => {
      const time = new Date(item.date).getTime();
      return Number.isFinite(time) ? time >= cutoff : true;
    })
    .slice(0, limit);

  if (storeDir) writeCache(storeDir, handle, { at: new Date().toISOString(), items });

  if (items.length === 0) {
    const fromBlog = await fallbackItems(source, handle, sinceHours, limit);
    if (fromBlog.length > 0) {
      return {
        status: 'ok',
        items: fromBlog,
        note: '',
        elapsedMs: Date.now() - started,
        fallback: 'feed',
      };
    }
  }

  return {
    status: items.length > 0 ? 'ok' : 'skipped',
    items,
    note: items.length > 0 ? '' : `${sinceHours} 小时内没有新帖`,
    elapsedMs: Date.now() - started,
    bytes: payload.bytes || 0,
  };
}

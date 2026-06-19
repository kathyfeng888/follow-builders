#!/usr/bin/env node

// ============================================================================
// Follow Builders — Generate Simple Digest
// ============================================================================
// Fetches the central feeds (X/Twitter, Podcasts, Blogs) and formats them
// into a readable markdown digest. No LLM required — pure data formatting.
//
// Usage: node generate-digest.js
// Output: Markdown text to stdout
// ============================================================================

const FEED_X_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-x.json';
const FEED_PODCASTS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-podcasts.json';
const FEED_BLOGS_URL = 'https://raw.githubusercontent.com/zarazhangrui/follow-builders/main/feed-blogs.json';

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

function formatTime(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleString('zh-CN', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function escapeMD(text) {
  return (text || '')
    .replace(/\|/g, '\\|')
    .replace(/_/g, '\\_')
    .replace(/\*/g, '\\*');
}

async function main() {
  console.log(`# 🤖 AI Builders Digest`);
  console.log(`\n> 生成时间：${formatDate(new Date().toISOString())}\n`);

  // Fetch all feeds
  const [feedX, feedPodcasts, feedBlogs] = await Promise.all([
    fetchJSON(FEED_X_URL),
    fetchJSON(FEED_PODCASTS_URL),
    fetchJSON(FEED_BLOGS_URL)
  ]);

  let totalTweets = 0;

  // =========================================
  // Section 1: X/Twitter Builders
  // =========================================
  if (feedX && feedX.x && feedX.x.length > 0) {
    console.log(`---\n## 📱 X / Twitter 动态\n`);

    for (const builder of feedX.x) {
      const tweets = builder.tweets || [];
      if (tweets.length === 0) continue;
      totalTweets += tweets.length;

      // Builder header with bio
      const displayName = builder.name || builder.handle;
      const bio = builder.bio ? builder.bio.replace(/\n/g, ' · ').slice(0, 200) : '';
      console.log(`### [${escapeMD(displayName)}](https://x.com/${builder.handle})`);
      if (bio) console.log(`> ${escapeMD(bio)}\n`);

      // Tweets
      for (const tweet of tweets) {
        const time = tweet.createdAt ? formatTime(tweet.createdAt) : '';
        const text = (tweet.text || '')
          .replace(/https:\/\/t\.co\/\S+/g, '')  // Remove t.co links
          .replace(/\s+/g, ' ').trim();

        const stats = [];
        if (tweet.likes > 0) stats.push(`❤️ ${tweet.likes}`);
        if (tweet.retweets > 0) stats.push(`🔄 ${tweet.retweets}`);
        if (tweet.replies > 0) stats.push(`💬 ${tweet.replies}`);
        const statStr = stats.length > 0 ? ` _(${stats.join(' · ')})_` : '';

        console.log(`- ${escapeMD(text)}${statStr}`);
        console.log(`  [🔗 查看原文](${tweet.url}) ${time ? `· ${time}` : ''}\n`);
      }
    }

    if (totalTweets === 0) {
      console.log('暂无新的推文动态。\n');
    }
  } else {
    console.log('📱 X/Twitter 数据暂未获取到。\n');
  }

  // =========================================
  // Section 2: Podcasts
  // =========================================
  if (feedPodcasts && feedPodcasts.podcasts && feedPodcasts.podcasts.length > 0) {
    console.log(`---\n## 🎙️ 播客节目\n`);

    for (const ep of feedPodcasts.podcasts) {
      console.log(`### [${escapeMD(ep.title || '未知节目')}](${ep.url || ''})`);
      console.log(`来源：**${ep.name || '未知'}**\n`);

      // Extract a brief summary from transcript — first meaningful paragraph
      if (ep.transcript && ep.transcript.length > 0) {
        // Try to get the first ~200 chars that aren't just speaker labels
        let preview = ep.transcript
          .replace(/\[.*?\]/g, '')       // Remove [Music], [Applause]
          .replace(/\*\*.*?\*\*:/g, '')  // Remove speaker labels like "**John:**"
          .replace(/\n+/g, ' ')
          .trim();
        if (preview.length > 300) {
          preview = preview.slice(0, 300) + '...';
        }
        if (preview.length > 50) {
          console.log(`> ${escapeMD(preview)}\n`);
        }
      }
    }
  }

  // =========================================
  // Section 3: Official Blogs
  // =========================================
  if (feedBlogs && feedBlogs.blogs && feedBlogs.blogs.length > 0) {
    console.log(`---\n## 📰 官方博客\n`);

    for (const blog of feedBlogs.blogs) {
      console.log(`### [${escapeMD(blog.title || '未知')}](${blog.url || ''})`);
      console.log(`来源：**${blog.name || '未知'}**`);

      if (blog.content && blog.content.length > 0) {
        let preview = blog.content
          .replace(/&#x27;/g, "'")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/<[^>]*>/g, '')
          .replace(/\n+/g, ' ')
          .trim();
        if (preview.length > 300) {
          preview = preview.slice(0, 300) + '...';
        }
        console.log(`> ${escapeMD(preview)}\n`);
      }
    }
  }

  // =========================================
  // Footer with stats
  // =========================================
  const podcastCount = (feedPodcasts?.podcasts?.length) || 0;
  const blogCount = (feedBlogs?.blogs?.length) || 0;
  const builderCount = (feedX?.x?.length) || 0;

  console.log(`---\n`);
  console.log(`📊 **本日概览**：${builderCount} 位 Builder · ${totalTweets} 条推文 · ${podcastCount} 个播客 · ${blogCount} 篇博客`);
  console.log(`🔗 全部内容来自 [Follow Builders](https://github.com/zarazhangrui/follow-builders) 数据源`);
}

main().catch(err => {
  console.error('Error generating digest:', err.message);
  process.exit(1);
});

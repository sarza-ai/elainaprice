const {
  SITE, redis, sendBatch, buildEmail, esc, layout, unsubscribeUrlFor, unsubscribeFooter, getSubscribers,
} = require('./_lib');

function decode(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tag(block, name) {
  const m = block.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>'));
  if (!m) return '';
  const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return cdata ? cdata[1] : decode(m[1]).trim();
}

function parseItems(xml) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml))) {
    const guid = tag(m[1], 'guid');
    if (!guid) continue;
    items.push({
      guid,
      title: tag(m[1], 'title'),
      link: tag(m[1], 'link'),
      description: tag(m[1], 'description'),
    });
  }
  return items;
}

function postHtml(post, email, token) {
  return layout(
    '<h1 style="font-weight:400;font-size:26px;margin:0 0 24px;">' + esc(post.title) + '</h1>' +
    (post.description || '') +
    '<p><a href="' + esc(post.link) + '" style="color:#9B6B4B;">Read this post on elainaprice.com</a></p>',
    unsubscribeFooter(email, token)
  );
}

module.exports = async (req, res) => {
  // Vercel sends this header automatically when a CRON_SECRET variable exists.
  if (process.env.CRON_SECRET && req.headers.authorization !== 'Bearer ' + process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const feed = await fetch(SITE + '/rss.xml');
    if (!feed.ok) throw new Error('feed ' + feed.status);
    const items = parseItems(await feed.text());

    // First run: remember every existing post without emailing anyone,
    // so the whole back catalog is not sent to the first subscribers.
    const seeded = await redis('GET', 'posts:seeded');
    if (!seeded) {
      for (const item of items) await redis('SADD', 'posts:sent', item.guid);
      await redis('SET', 'posts:seeded', '1');
      return res.status(200).json({ seeded: items.length, sent: 0 });
    }

    const already = new Set((await redis('SMEMBERS', 'posts:sent')) || []);
    const fresh = items.filter((i) => !already.has(i.guid));
    if (!fresh.length) return res.status(200).json({ sent: 0 });

    const subscribers = await getSubscribers();
    let posts = 0;
    let emails = 0;

    for (const post of fresh) {
      for (let i = 0; i < subscribers.length; i += 100) {
        const chunk = subscribers.slice(i, i + 100).map((s) =>
          buildEmail({
            to: s.email,
            subject: post.title,
            html: postHtml(post, s.email, s.token),
            unsubscribeUrl: unsubscribeUrlFor(s.email, s.token),
          })
        );
        await sendBatch(chunk);
        emails += chunk.length;
      }
      // Only mark a post as sent after every chunk went out.
      await redis('SADD', 'posts:sent', post.guid);
      posts += 1;
    }

    return res.status(200).json({ posts, emails });
  } catch (err) {
    console.error('cron failed', err);
    return res.status(500).json({ error: 'Failed' });
  }
};

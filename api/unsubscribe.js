const { redis, safeEqual, page } = require('./_lib');

module.exports = async (req, res) => {
  const email = String((req.query && req.query.email) || '').trim().toLowerCase();
  const token = String((req.query && req.query.token) || '');

  // Mail apps use POST for one click unsubscribe; people clicking the link use GET.
  const oneClick = req.method === 'POST';

  const bad = () =>
    oneClick
      ? res.status(400).end()
      : page(res, 400, 'Link not valid', 'This unsubscribe link is not valid.');

  if (!email || !/^[a-f0-9]{48}$/.test(token)) return bad();

  try {
    const stored = await redis('HGET', 'subscribers', email);
    if (!stored) {
      // Already removed: treat as success.
      return oneClick
        ? res.status(200).end()
        : page(res, 200, 'You are unsubscribed', 'You will not receive any more emails.');
    }

    let saved;
    try { saved = JSON.parse(stored).token; } catch (e) { saved = ''; }
    if (!safeEqual(saved, token)) return bad();

    await redis('HDEL', 'subscribers', email);
    return oneClick
      ? res.status(200).end()
      : page(res, 200, 'You are unsubscribed', 'You will not receive any more emails.');
  } catch (err) {
    console.error('unsubscribe failed', err);
    return oneClick
      ? res.status(500).end()
      : page(res, 500, 'Something went wrong', 'Please try the link again in a moment.');
  }
};

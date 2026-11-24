const {
  SITE, redis, sendBatch, buildEmail, esc, layout, newToken, isValidEmail,
} = require('./_lib');

const MAX_REQUESTS_PER_HOUR = 8;

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  // Hidden field only bots fill in. Pretend it worked.
  if (body.website) return res.status(200).json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  try {
    const ip = String(req.headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
    const rlKey = 'rl:' + ip;
    const hits = await redis('INCR', rlKey);
    if (hits === 1) await redis('EXPIRE', rlKey, 3600);
    if (hits > MAX_REQUESTS_PER_HOUR) {
      return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    }

    // Already subscribed: answer the same way and send nothing, so this
    // form cannot be used to find out who is on the list.
    const existing = await redis('HGET', 'subscribers', email);
    if (existing) return res.status(200).json({ ok: true });

    const token = newToken();
    await redis('SET', 'pending:' + token, email, 'EX', 86400);

    const confirmUrl = SITE + '/api/confirm?token=' + token;
    const html = layout(
      '<p>Thank you for subscribing to my blog.</p>' +
      '<p>Please confirm your email address by clicking the link below.</p>' +
      '<p><a href="' + esc(confirmUrl) + '" style="color:#9B6B4B;">Confirm my subscription</a></p>',
      'If you did not request this, you can safely ignore this message and nothing will happen.'
    );
    await sendBatch([buildEmail({ to: email, subject: 'Please confirm your subscription', html })]);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('subscribe failed', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
};

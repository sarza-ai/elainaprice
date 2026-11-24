const {
  SITE, redis, sendBatch, buildEmail, layout, unsubscribeUrlFor, unsubscribeFooter, newToken, page,
} = require('./_lib');

function welcomeHtml(email, token) {
  return layout(
    '<h1 style="font-weight:400;font-size:26px;margin:0 0 24px;">Welcome!</h1>' +
    '<p>On paper, my career is rooted in real estate. Over the years, I\'ve worked across every facet of the industry, driven by a simple belief: real estate is enduring... timeless.</p>' +
    '<p>Yet, my passion goes well beyond the business of property. Writing has always been how I make sense of the world, a way to slow down, observe, and connect the dots. Perhaps it\'s no surprise that I minored in English in college. Those additional English courses gave me the opportunity to stretch my creative muscles while learning the writing mechanics and fundamentals that had somehow escaped me in high school. More than anything, they helped cultivate a love of words that has stayed with me ever since.</p>' +
    '<p>No matter where my work takes me, words have been and will always be woven into what I do. This space is simply a quiet corner to let those thoughts breathe, wherever they happen to lead.</p>' +
    '<p>Here\'s to new beginnings, good light, and great spaces.</p>' +
    '<p style="margin-bottom:4px;">Warmly,</p>' +
    '<img src="' + SITE + '/elaina-signature-mauve.png" alt="Elaina Price" width="220" style="display:block;width:220px;max-width:70%;height:auto;">',
    unsubscribeFooter(email, token)
  );
}

module.exports = async (req, res) => {
  const token = String((req.query && req.query.token) || '');
  if (!/^[a-f0-9]{48}$/.test(token)) {
    return page(res, 400, 'Link not valid', 'This confirmation link is not valid.');
  }

  try {
    const email = await redis('GET', 'pending:' + token);
    if (!email) {
      return page(res, 400, 'Link expired', 'This confirmation link has expired. Please subscribe again from the blog page.');
    }

    const existing = await redis('HGET', 'subscribers', email);
    if (!existing) {
      const subToken = newToken();
      await redis('HSET', 'subscribers', email, JSON.stringify({ token: subToken, at: Date.now() }));
      await redis('DEL', 'pending:' + token);

      await sendBatch([
        buildEmail({
          to: email,
          subject: 'Welcome!',
          html: welcomeHtml(email, subToken),
          unsubscribeUrl: unsubscribeUrlFor(email, subToken),
        }),
      ]);
    } else {
      await redis('DEL', 'pending:' + token);
    }

    return page(res, 200, 'You are subscribed', 'Thank you. A welcome note is on its way to your inbox.');
  } catch (err) {
    console.error('confirm failed', err);
    return page(res, 500, 'Something went wrong', 'Please try the link again in a moment.');
  }
};

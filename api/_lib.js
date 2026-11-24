const crypto = require('crypto');

const SITE = 'https://www.elainaprice.com';
const FROM = 'Elaina D. Price <hello@elainaprice.com>';
const REPLY_TO = 'hello@elainaprice.com';

// Upstash Redis over REST: POST a JSON array command, get { result } back.
async function redis(...cmd) {
  const res = await fetch(process.env.KV_REST_API_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.KV_REST_API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmd),
  });
  const data = await res.json();
  if (data.error) throw new Error('redis: ' + data.error);
  return data.result;
}

async function sendBatch(emails) {
  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emails),
  });
  if (!res.ok) {
    throw new Error('resend ' + res.status + ': ' + (await res.text()));
  }
}

function buildEmail({ to, subject, html, unsubscribeUrl }) {
  const email = {
    from: FROM,
    to: [to],
    reply_to: REPLY_TO,
    subject,
    html,
    text: toText(html),
  };
  if (unsubscribeUrl) {
    email.headers = {
      'List-Unsubscribe': '<' + unsubscribeUrl + '>',
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  return email;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h1|h2|h3|div|li)>/gi, '\n\n')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function layout(inner, footer) {
  return (
    '<!doctype html><html><body style="margin:0;padding:0;background:#FAF8F5;">' +
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Georgia,\'Times New Roman\',serif;font-size:17px;line-height:1.7;color:#1A1612;">' +
    inner +
    '<hr style="border:none;border-top:1px solid #E8E4DF;margin:32px 0 16px;">' +
    '<p style="font-size:13px;line-height:1.6;color:#8A7F76;">' + footer + '</p>' +
    '</div></body></html>'
  );
}

function unsubscribeUrlFor(email, token) {
  return SITE + '/api/unsubscribe?email=' + encodeURIComponent(email) + '&token=' + token;
}

function unsubscribeFooter(email, token) {
  return (
    'You are receiving this because you subscribed at elainaprice.com. ' +
    '<a href="' + esc(unsubscribeUrlFor(email, token)) + '" style="color:#9B6B4B;">Unsubscribe</a>'
  );
}

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function page(res, status, title, message) {
  res.status(status).setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>' + esc(title) + '</title></head>' +
    '<body style="margin:0;background:#FAF8F5;color:#1A1612;font-family:Georgia,\'Times New Roman\',serif;">' +
    '<div style="max-width:520px;margin:15vh auto;padding:0 24px;text-align:center;">' +
    '<h1 style="font-weight:400;font-size:1.8rem;">' + esc(title) + '</h1>' +
    '<p style="line-height:1.7;">' + esc(message) + '</p>' +
    '<p><a href="' + SITE + '" style="color:#9B6B4B;">Back to elainaprice.com</a></p>' +
    '</div></body></html>'
  );
}

// Subscribers live in one Redis hash: email -> JSON { token, at }.
async function getSubscribers() {
  const flat = (await redis('HGETALL', 'subscribers')) || [];
  const list = [];
  for (let i = 0; i < flat.length; i += 2) {
    try {
      list.push({ email: flat[i], token: JSON.parse(flat[i + 1]).token });
    } catch (e) {
      // skip a malformed entry rather than failing the whole send
    }
  }
  return list;
}

module.exports = {
  SITE,
  redis,
  sendBatch,
  buildEmail,
  esc,
  layout,
  unsubscribeUrlFor,
  unsubscribeFooter,
  newToken,
  safeEqual,
  isValidEmail,
  page,
  getSubscribers,
};

const express    = require('express');
const path       = require('path');
const cron       = require('node-cron');
const { run }    = require('./collector');
require('dotenv').config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

/* ── API ── */
app.get('/api/report/latest', (req, res) => {
  delete require.cache[require.resolve('../data/latest.json')];
  res.json(require('../data/latest.json'));
});
app.get('/api/briefs', (req, res) => {
  delete require.cache[require.resolve('../data/briefs.json')];
  res.json(require('../data/briefs.json'));
});
app.get('/api/scores', (req, res) => {
  delete require.cache[require.resolve('../data/scores.json')];
  res.json(require('../data/scores.json'));
});

/* ── 수동 트리거 (관리자용) ── */
app.post('/api/admin/collect', async (req, res) => {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    await run();
    res.json({ ok: true, message: '데이터 수집 완료' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

/* ── 스케줄러 ── */
// 매월 1일 오전 11시(KST) = UTC 02:00
cron.schedule('0 2 1 * *', async () => {
  console.log('[CRON] 월간 자동 수집 시작');
  try { await run(); }
  catch (e) { console.error('[CRON] 실패:', e.message); }
});

// 매주 월요일 오전 9시(KST) = UTC 00:00
cron.schedule('0 0 * * 1', () => {
  console.log('[CRON] 주간 브리핑 체크');
  // 추후 뉴스 크롤링 추가 예정
});

app.listen(PORT, () => {
  console.log(`TradeSignal running on port ${PORT}`);
});

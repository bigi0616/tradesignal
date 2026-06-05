const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
const fs    = require('fs');
const path  = require('path');

const DATA = path.join(__dirname, '../data');

/* ─────────────────────────────────────────────
   1) 정책브리핑 크롤링 — 수출입 보도문 텍스트
───────────────────────────────────────────── */
async function fetchBriefingText() {
  try {
    const res  = await fetch(
      'https://www.korea.kr/briefing/pressReleaseView.do?newsId=156764654',
      { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 }
    );
    const html = await res.text();

    // 제목 추출
    const titleMatch = html.match(/<h3[^>]*class="[^"]*tit[^"]*"[^>]*>([\s\S]*?)<\/h3>/);
    const title = titleMatch
      ? titleMatch[1].replace(/<[^>]+>/g, '').trim()
      : '수출입 동향 발표';

    // 본문 숫자 추출 (예: 877.5억 달러, 53.2%)
    const exportMatch  = html.match(/수출[은이]\s*([\d,]+\.?\d*)\s*억\s*달러/);
    const growthMatch  = html.match(/([\d.]+)%\s*증가/);
    const balanceMatch = html.match(/무역수지[는은]\s*([\d,]+\.?\d*)\s*억\s*달러/);
    const semiMatch    = html.match(/반도체[^가-힣]*([\d,]+\.?\d*)\s*억\s*달러/);

    return {
      title,
      export:      exportMatch  ? parseFloat(exportMatch[1].replace(/,/g,''))  : null,
      growth:      growthMatch  ? parseFloat(growthMatch[1])                   : null,
      balance:     balanceMatch ? parseFloat(balanceMatch[1].replace(/,/g,'')) : null,
      semiconductor: semiMatch  ? parseFloat(semiMatch[1].replace(/,/g,''))   : null,
    };
  } catch (e) {
    console.error('[collector] 크롤링 실패:', e.message);
    return null;
  }
}

/* ─────────────────────────────────────────────
   2) 공공데이터포털 API — 품목별 수출 통계
   환경변수: DATA_GO_KR_KEY
───────────────────────────────────────────── */
async function fetchExportByItem(yearMonth) {
  const key = process.env.DATA_GO_KR_KEY;
  if (!key) { console.warn('[collector] DATA_GO_KR_KEY 없음 — API 스킵'); return null; }

  try {
    const url = `https://apis.data.go.kr/1160100/service/GetExportImportInfoService`
      + `/getExportInfo?serviceKey=${key}&numOfRows=20&pageNo=1`
      + `&resultType=json&yyyyMm=${yearMonth}`;

    const res  = await fetch(url, { timeout: 10000 });
    const json = await res.json();
    return json?.response?.body?.items?.item || null;
  } catch (e) {
    console.error('[collector] 공공API 실패:', e.message);
    return null;
  }
}

/* ─────────────────────────────────────────────
   3) Claude API — 인사이트 텍스트 자동 생성
   환경변수: CLAUDE_API_KEY
───────────────────────────────────────────── */
async function generateInsight(data) {
  const key = process.env.CLAUDE_API_KEY;
  if (!key) { console.warn('[collector] CLAUDE_API_KEY 없음 — AI 요약 스킵'); return null; }

  const prompt = `
다음 한국 수출입 통계를 분석해서 투자자를 위한 인사이트를 JSON으로 작성해주세요.

데이터:
- 수출: ${data.export}억 달러 (전년비 +${data.growth}%)
- 무역수지: ${data.balance}억 달러 흑자
- 반도체: ${data.semiconductor}억 달러

아래 JSON 형식으로만 답하세요 (다른 텍스트 없이):
{
  "summary": "3줄 이내 핵심 요약",
  "topItem": "이달 가장 주목할 품목 이름",
  "topItemReason": "주목 이유 1-2문장",
  "risk": "주요 리스크 1문장",
  "signal": "매수/관망/매도 중 하나"
}`;

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const json   = await res.json();
    const text   = json.content?.[0]?.text || '{}';
    const clean  = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error('[collector] Claude API 실패:', e.message);
    return null;
  }
}

/* ─────────────────────────────────────────────
   4) 스코어 계산 — 서프라이즈 40% + 모멘텀 35% + 비중 25%
───────────────────────────────────────────── */
function calcScore(yoy, streak, shareChange) {
  const surprise  = Math.min(yoy / 200 * 40, 40);   // YoY 200%기준 만점
  const momentum  = Math.min(streak / 6 * 35, 35);  // 6개월 연속이면 만점
  const share     = Math.min(shareChange * 5, 25);   // 비중 변화 5%p = 만점
  return Math.round(surprise + momentum + share);
}

/* ─────────────────────────────────────────────
   5) 전체 실행 — 매월 1일 cron에서 호출
───────────────────────────────────────────── */
async function run() {
  console.log('[collector] 시작:', new Date().toISOString());

  const now       = new Date();
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const yyyyMm    = `${prevMonth.getFullYear()}${String(prevMonth.getMonth()+1).padStart(2,'0')}`;
  const periodStr = `${prevMonth.getFullYear()}년 ${prevMonth.getMonth()+1}월`;

  // ① 크롤링
  console.log('[collector] 정책브리핑 크롤링 중...');
  const crawled = await fetchBriefingText();

  // ② 공공 API
  console.log('[collector] 공공API 호출 중...');
  const apiData = await fetchExportByItem(yyyyMm);

  // ③ 기본 수치 (크롤링 성공 시 사용, 실패 시 기존값 유지)
  const latest = JSON.parse(fs.readFileSync(`${DATA}/latest.json`, 'utf8'));

  if (crawled?.export) {
    latest.period                     = periodStr;
    latest.publishedAt                = now.toISOString().split('T')[0];
    latest.headline.export            = crawled.export;
    latest.headline.exportGrowth      = crawled.growth;
    latest.headline.tradeBalance      = crawled.balance;
    latest.headline.semiconductor     = crawled.semiconductor || latest.headline.semiconductor;
  }

  // ④ Claude 인사이트 생성
  console.log('[collector] Claude API 인사이트 생성 중...');
  const insight = await generateInsight(latest.headline);
  if (insight) latest.insight = insight;

  // ⑤ latest.json 저장
  fs.writeFileSync(`${DATA}/latest.json`, JSON.stringify(latest, null, 2));
  console.log('[collector] latest.json 업데이트 완료');

  // ⑥ scores.json 스코어 재계산
  const scores = JSON.parse(fs.readFileSync(`${DATA}/scores.json`, 'utf8'));
  // 반도체 YoY 반영 (크롤링 성공 시)
  if (crawled?.semiconductor && crawled?.export) {
    const semiShare = (crawled.semiconductor / crawled.export) * 100;
    const semiItem  = scores.find(s => s.name === '반도체');
    if (semiItem) {
      semiItem.yoy   = `+${crawled.growth ? Math.round(crawled.growth * (crawled.semiconductor/crawled.export)) : '?'}%`;
      semiItem.score = calcScore(169, 3, semiShare - 37);
    }
  }
  fs.writeFileSync(`${DATA}/scores.json`, JSON.stringify(scores, null, 2));
  console.log('[collector] scores.json 업데이트 완료');

  // ⑦ briefs.json 새 항목 추가
  const briefs   = JSON.parse(fs.readFileSync(`${DATA}/briefs.json`, 'utf8'));
  const newBrief = {
    id:      briefs.length + 1,
    date:    `${String(now.getMonth()+1).padStart(2,'0')}.${String(now.getDate()).padStart(2,'0')}`,
    day:     '월간 리포트',
    title:   crawled?.title || `${periodStr} 수출입 동향 발표`,
    summary: insight?.summary || `수출 ${latest.headline.export}억$ 기록. 상세 내용 확인 필요.`,
    tags:    ['월간리포트', insight?.topItem || '반도체']
  };
  briefs.unshift(newBrief);           // 최신 항목을 맨 앞에
  if (briefs.length > 12) briefs.pop(); // 최근 12개만 유지
  fs.writeFileSync(`${DATA}/briefs.json`, JSON.stringify(briefs, null, 2));
  console.log('[collector] briefs.json 업데이트 완료');

  console.log('[collector] 완료:', new Date().toISOString());
}

module.exports = { run };

// 직접 실행 시 (node src/collector.js)
if (require.main === module) run();

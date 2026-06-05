# TradeSignal 🇰🇷

> 수출입 통계 기반 월간 투자 인사이트 서비스

산업통상자원부 월간 수출입 동향 데이터를 분석해 이달의 주목 품목과 수혜 종목을 자동 도출합니다.

## 주요 기능
- 월간 수출 품목 스코어링 (서프라이즈 40% + 모멘텀 35% + 비중 25%)
- 3단계 인사이트 자동 생성 (무슨 일 → 왜 → 어디로)
- 국내 수혜 종목 3개 + 미국 ETF 1개 추천
- 주간 브리핑 (매주 월요일)
- 반응형 웹 (PC / 태블릿 / 모바일)

## 기술 스택
- **Frontend**: Vanilla HTML/CSS/JS + Chart.js
- **Backend**: Node.js + Express
- **Scheduler**: node-cron (월 1회 + 주 1회 자동 수집)
- **Hosting**: Render (Free tier)
- **Data**: 산업통상자원부 공공 API + 정책브리핑 크롤링

## 로컬 실행
```bash
npm install
cp .env.example .env   # 환경변수 설정
npm run dev
```
→ http://localhost:3000

## Render 배포
1. GitHub에 이 저장소 push
2. render.com → New Web Service → GitHub 연결
3. 자동으로 render.yaml 감지 → 배포 완료

## 환경변수 (.env)
```
CLAUDE_API_KEY=sk-ant-...   # AI 인사이트 자동 생성용 (추후)
PORT=3000
NODE_ENV=development
```

## 데이터 업데이트 주기
| 주기 | 내용 | 트리거 |
|------|------|--------|
| 매월 1일 | 산업부 공식 리포트 + Top3 종목 업데이트 | cron |
| 매주 월요일 | 주간 브리핑 + 신호 변화 체크 | cron |
| 11일·21일 | 관세청 잠정치 이상 신호 감지 | cron |

## 폴더 구조
```
tradesignal/
├── public/         # 정적 파일 (HTML/CSS/JS)
│   └── index.html  # 메인 페이지
├── src/
│   └── server.js   # Express 서버 + cron 스케줄러
├── data/           # JSON 데이터 (API 응답)
│   ├── latest.json
│   ├── briefs.json
│   └── scores.json
├── render.yaml     # Render 배포 설정
└── package.json
```

# Desktop Bot Hub (MVP)

우측 하단 캐릭터를 클릭해 각 봇 세션과 대화하는 데스크탑 앱 MVP.

## 목표
- 캐릭터별 세션 직결형 대화
- 말풍선 UI
- 캐릭터별 히스토리 유지

## 구조
- `apps/desktop`: 데스크탑 UI (Tauri + React 예정)
- `apps/gateway`: 캐릭터→세션 라우팅 API
- `config/characters.json`: 캐릭터/세션 매핑
- `docs/`: 아키텍처/실행 계획

## 빠른 시작 (Gateway Mock)
```bash
cd apps/gateway
npm install
npm run dev
```

## 핵심 API
- `GET /characters`
- `GET /chat/history/:characterId`
- `POST /chat/send`

요청 예시:
```json
{
  "characterId": "planner",
  "text": "오늘 기획 우선순위 정리해줘"
}
```

## 상태
- [x] 아키텍처/스키마 정의
- [x] Gateway 기본 라우팅 구현
- [ ] 실제 OpenClaw 세션 연동 어댑터 연결
- [ ] Desktop UI 구현

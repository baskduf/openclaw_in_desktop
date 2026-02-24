# Desktop Bot Hub (MVP)

우측 하단 캐릭터를 클릭해 각 봇 세션과 대화하는 데스크탑 앱 MVP.

## 목표
- 캐릭터별 세션 직결형 대화
- 말풍선 UI
- 캐릭터별 히스토리 유지

## 구조
- `apps/desktop`: 데스크탑 UI (React MVP, 이후 Tauri 래핑)
- `apps/gateway`: 캐릭터→세션 라우팅 API
- `config/characters.json`: 캐릭터/세션 매핑
- `docs/`: 아키텍처/실행 계획

## 빠른 시작 (Gateway)
```bash
cd apps/gateway
npm install
npm run dev
```

### 실제 OpenClaw 세션 연동 (CLI 모드)
1) `config/characters.json`의 `sessionId` 값을 실제 값으로 교체
2) 실행
```bash
OPENCLAW_MODE=cli npm run dev
```

기본값은 `OPENCLAW_MODE=mock`.

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
- [x] 실제 OpenClaw 세션 연동 어댑터 연결
- [x] Desktop UI 구현
- [x] Tauri 래핑 스캐폴딩
- [x] HTTPS/WSS 배포 템플릿(Caddy) 추가

## Desktop 실행
```bash
cd apps/desktop
npm install
npm run dev
```

## Tauri 실행 (사전조건: Rust/cargo 설치)
```bash
cd apps/desktop
npm run tauri:dev
```

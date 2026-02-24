# Architecture (Option 1: Session Direct)

## 1) Data Flow
1. 사용자가 우측 하단 캐릭터 클릭
2. Desktop 앱이 `characterId`, `text`를 Gateway로 전송
3. Gateway가 `characters.json`에서 매핑된 `sessionKey` 조회
4. OpenClaw 세션으로 메시지 전달 (`sessions_send` equivalent)
5. 응답을 Desktop에 반환
6. 캐릭터별 히스토리 저장/조회

## 2) Components
- Desktop Client
  - Character Dock
  - Balloon Chat Panel
  - Quick Action Chips
- Gateway API
  - Character registry
  - Session router
  - History store (MVP: memory, later sqlite)
- OpenClaw Session Layer
  - per-character session mapping

## 3) Reliability
- timeout: 20s default
- retry: 1회 (네트워크 에러만)
- fallback: OpenClaw 실패 시 사용자 메시지로 안내

## 4) Security
- Gateway 인증 토큰 필수
- 캐릭터별 허용 sessionKey allowlist
- 민감 로그 마스킹

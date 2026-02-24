# Session Policy (안정 운영)

## 왜 필요한가
OpenClaw는 **세션별로 맥락을 저장**한다. 운영 DM 세션과 캐릭터 세션을 섞으면 응답이 오염된다.

## 규칙
1. 운영 세션과 캐릭터 세션을 분리한다.
2. `characters.json`에는 캐릭터 전용 `sessionId`만 넣는다.
3. 현재 DM/운영 세션 ID를 캐릭터에 재사용하지 않는다.
4. 문제 발생 시 전체 재시작 대신 문제 세션 매핑만 리셋한다.

## 세션 조회 (카드 API 대신)
```bash
openclaw sessions --json
openclaw sessions --active 120 --json
```

## 증상: call_id mismatch
에러 예:
`No tool call found for function call output with call_id ...`

원인: 꼬인 세션에서 이전 tool call state가 남아 있음.

조치(무중단): 해당 채널 세션 매핑만 제거 → 다음 메시지에서 새 세션 자동 생성.

## 캐릭터 세션 생성 가이드
- 새 UUID 생성 후 `config/characters.json`에 매핑
- 최초 요청 시 OpenClaw가 해당 세션 컨텍스트를 새로 축적

예시:
```json
{
  "id": "planner",
  "sessionId": "f6c9f09c-0d56-427c-a07b-0c42d32a308a"
}
```

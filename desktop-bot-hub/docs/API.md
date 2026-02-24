# Gateway API (MVP)

## GET /characters
캐릭터 목록 조회

Response:
```json
{
  "characters": [
    { "id": "planner", "name": "Planner", "emoji": "🧭", "description": "..." }
  ]
}
```

## GET /chat/history/:characterId
캐릭터별 대화 히스토리 조회

## POST /chat/send
메시지 전송

Request:
```json
{
  "characterId": "planner",
  "text": "MVP 기능 우선순위 정리"
}
```

Response:
```json
{
  "reply": "...",
  "characterId": "planner"
}
```

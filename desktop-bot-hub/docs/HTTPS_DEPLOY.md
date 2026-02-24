# HTTPS/WSS Exposure (AWS + Caddy)

목표: OpenClaw Gateway는 로컬(loopback) 유지, 외부는 HTTPS/WSS로만 접근.

## 권장 아키텍처
- OpenClaw gateway: `127.0.0.1:18789` (변경 없음)
- Caddy: `:443` TLS 종료 후 `127.0.0.1:18789` reverse_proxy
- AWS Security Group: 80/443만 공개, 18789는 비공개

## 1) DNS
도메인 A 레코드를 AWS 퍼블릭 IP로 연결.

## 2) Caddy 적용
```bash
cd deploy/caddy
chmod +x install.sh
./install.sh claw.example.com
```

## 3) OpenClaw 권장 설정
```bash
openclaw config set gateway.bind loopback
openclaw config set gateway.trustedProxies "127.0.0.1,::1"
openclaw gateway restart
```

## 4) 접속 URL
- Dashboard/API: `https://claw.example.com`
- WebSocket: `wss://claw.example.com`

## 5) 데스크탑 앱 연결
`apps/desktop/.env.production` 또는 실행 환경 변수:
```bash
# 분리 도메인 사용 시
VITE_GATEWAY_BASE_URL=https://claw.example.com

# 단일 도메인 + 경로 분리 사용 시(현재 임시 운영)
VITE_GATEWAY_BASE_URL=https://44-211-90-59.sslip.io/claw
```

## 6) 점검
```bash
openclaw status
curl -I https://claw.example.com
```

주의: 토큰 인증은 유지해야 함. HTTPS는 전송 암호화 계층, 토큰은 애플리케이션 인증 계층.

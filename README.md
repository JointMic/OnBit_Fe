# OnBit Consumer
React / TypeScript / Vite / Tailwind CSS v4 소비자용 대시보드.

## 로컬 실행
Monitor를 localhost:3000에서 실행한 뒤 `npm install`, `npm run dev`로 앱을 실행합니다(http://127.0.0.1:5173). Vite가 `/api`를 Monitor에 프록시합니다. `npm run build`로 타입 검사와 빌드를 수행합니다.

## 실시간 데모
Monitor에서 4자리 코드(예: 1234)를 입력하고 Start → START RECORDING. 소비자 앱에서도 같은 코드로 연결합니다. 변경은 기기 또는 마이 탭에서 가능합니다. 회원가입 없이 Monitor가 로컬에서는 0.2초 간격으로 최신 HR/SDNN/신호 품질을 메모리에 전송하고 앱도 0.2초 간격으로 조회합니다. 로컬 실시간 중계는 DB를 사용하지 않으며 서버 재시작 시 초기화됩니다. 프로덕션 Monitor는 1초 간격으로 MongoDB `onbit.live_measurements`에 최신 스냅샷을 저장합니다. 숫자가 아직 계산되지 않으면 —, 6초 이상 새 데이터가 없으면 연결 끊김으로 표시합니다. 앱 그래프는 현재 페이지에서 수신한 최대 600개 스냅샷입니다. 예시 데이터는 표시하지 않습니다.

이 연결 코드는 로컬 시연용 식별자이며 사용자 인증이 아닙니다. Vercel 배포 시에는 API 프록시/접근 제어를 별도로 구성해야 합니다. DB 연결 정보는 Monitor 서버의 환경변수에만 둡니다.

## 위젯
사용자가 제공한 DraggableWidgetGrid를 `src/components/ui/draggable-widget-grid.tsx`에 통합했습니다. 마우스 드래그, 터치 길게 누르기, Alt+방향키 이동과 로컬 배치 저장을 지원합니다.

## Production
Consumer: https://onbit-fe.vercel.app
Monitor: https://onbit-monitor.vercel.app
`vercel.json` forwards /api to the Monitor production URL. DB credentials exist only in Monitor server environment variables. Deploy with `vercel deploy --prod --scope pdgdaccord`.

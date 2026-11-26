로컬 혈당 모델 연결(2026-11-26): [실행 방법](local-glucose/README.md). 터미널 두 개에서 `npm run dev:glucose`와 `npm run dev -- --port 5173` 실행 후 http://127.0.0.1:5173 사용. Vercel 배포에는 로컬 Python 서버가 포함되지 않는다.

> 현재 배포(2026-11-25): 현수님 원본 `2e26543`의 `usePPGProcessing.ts`, `useSignalQuality.ts` 파일을 수정 없이 사용한다. 아래 이전 개선 기록 중 프레임 콜백·FPS 재계산·UI/분석 주기 제한·접촉/주기성 검사는 현재 적용되지 않는다. 프레임 처리는 원래 requestAnimationFrame 루프, 처리 캔버스는 640×480이다. 앱의 기기 카메라 선택과 시작/종료·화면 연결 코드는 앱 구조에 맞춘 연결부로 남아 있다. 이전 버전은 `codex/backup-periodicity-gate-20261125`에 보관되어 있다.

# OnBit Consumer
React / TypeScript / Vite / Tailwind CSS 기반 모바일 건강 데모.

## 실행
`npm install`, `npm run dev` → http://127.0.0.1:5173
`npm run build` → 타입 검사와 프로덕션 빌드.

## 직접 측정
앱의 카메라 카드에서 **카메라 켜기**를 선택합니다. 브라우저 권한 허용 후 렌즈에 손가락을 대면 카메라 영상, PPG 상대 신호와 검출된 골, HR, HRV(SDNN), 신호 품질을 확인할 수 있습니다. 접촉식 측정이며 손등을 떨어져서 촬영하는 방식은 지원하지 않습니다. 외부 카메라 앱으로 이동하지 않습니다.

- 노트북/태블릿/휴대폰: 후면 카메라 우선(ideal), 없으면 사용 가능한 기본 카메라.
- 여러 카메라: 권한 허용 후 카드의 선택 메뉴에서 변경 가능.
- 플래시: 브라우저와 카메라가 torch를 지원할 때만 표시.
- 종료/탭 숨김/페이지 종료/언마운트 시 트랙 해제. 요청 중 취소 가능.
- 권한 거부/카메라 없음/사용 중 오류 표시. HTTPS 또는 localhost 필요.

측정값과 영상 처리는 브라우저 안에서 수행합니다. 4자리 코드, Monitor, MongoDB, API 호출 없이 직접 측정합니다. 기존 Monitor 저장소와 배포는 그대로 유지됩니다.

## 코드
- `src/hooks/heartlens/usePPGProcessing.ts`: HeartLens RGB 신호 추출 및 HR/SDNN 계산을 가져온 처리 로직. 프레임 중복 제외, 부족한 간격/평탄 신호 방어 포함.
- `src/hooks/heartlens/useSignalQuality.ts`: HeartLens의 19개 특징과 품질 모델. TensorFlow.js 지연 로드, 추론 간격 500ms, 텐서/모델 해제.
- `src/hooks/useCameraMeasurement.ts`: 카메라 수명주기, 자동 선택, 장치 전환, 오류, 측정 스냅샷.
- `src/components/CameraWidget.tsx`: 영상/측정 제어/상대 PPG 신호와 검출 지점.
- `public/tfjs_model/`: 원본 품질 모델 구조 및 가중치.

모델 원본 전처리의 FFT 특징 3개는 여전히 0입니다. 학습 시 전처리와 일치 여부, 실제 HR/HRV 정확도는 알고리즘 담당자 검증이 필요합니다. 혈당 모델은 미연결이며 수치를 생성하지 않습니다.

## 기록/화면
수신 추이와 값은 실시간 갱신됩니다. 유효값이 없으면 —, 마지막 값은 시각과 함께 구분합니다. HRV는 유효한 맥박 간격을 확보한 뒤 표시합니다. 브라우저 달력에는 유효 샘플을 최대 5초마다 저장하며 최근 14일, 하루 최대 1,500개를 유지합니다. 11월 20/22/23일은 코드에 명시된 공통 데모 기록입니다. 프로필과 생활 기록도 로컬 저장입니다.

홈 위젯은 제공된 DraggableWidgetGrid(Motion) 기반이며 드래그/터치 길게 누르기/키보드 Alt+방향키 이동을 지원합니다. 카메라 버튼·선택 메뉴에서는 드래그가 시작되지 않습니다.

## 배포
Consumer: https://onbit-fe.vercel.app
Monitor (별도 유지): https://onbit-monitor.vercel.app
`vercel deploy --prod --scope pdgdaccord`

## Measurement validity gate
Non-contact surfaces can produce periodic image noise; valley detection alone is not evidence of a pulse. Output requires a conservative red-dominant, low-texture contact candidate, at least five seconds of contact, a repeating recent optical signal and sufficient pulse intervals. HRV needs at least ten intervals spanning ten seconds. Contact loss clears buffers and masks readings/markers immediately; old values cannot appear as current. Camera archives without the validity flag are excluded.

The original five sampling locations now average 16×16 pixels each to preserve sub-integer variations. Recent eight-second periodicity is evaluated separately from the longer HRV interval buffer. Slow exposure drift is removed for valley detection, and actual frame sample timestamps determine intervals. Quality classification is shown separately, not used as a hard output veto: its preprocessing still contains placeholder FFT features and probabilities are not calibrated accuracy scores. The collapsed camera diagnostics show frame rate, contact time, amplitude, periodicity and interval count.

These are engineering heuristics, not a validated tissue/liveness classifier or medical measurement. Red objects/synthetic periodic illumination may still fool them; legitimate fingers may be rejected in unsupported lighting. Device-level validation and algorithm-team review remain required. `node tests/measurementValidity.test.cjs` checks non-contact colors, darkness, flat signals, exposure drift, noise, weak-pulse recovery and synthetic 60/75/90/120 BPM timestamps. It does not establish real-world accuracy.

카메라 프레임 처리: 지원 브라우저에서는 requestVideoFrameCallback의 프레임 번호와 미디어 시각을 사용한다. 콜백이 멈추거나 미지원이면 디코딩 프레임 카운터 기반 루프로 전환한다. 실제 처리 간격의 최근 3초로 FPS를 계산하며 카메라 설정 FPS와 별도로 표시한다. 광학 샘플은 프레임마다 수집하고 React 신호 갱신은 최대 8Hz, 미리보기 복사는 약 15Hz로 제한한다. 신호 처리 캔버스는 320×240이다. 프레임 부족 검증 기준을 낮추거나 누락된 생체 수치를 생성하지 않는다.

### 현재 배포: HeartLens 원래 계산 방식 복원
2026-11-25 기준 카메라에서는 위에 설명된 접촉 후보·자기상관 주기성·최소 5초/골점 11개 표시 제한을 사용하지 않는다. 해당 버전은 원격 브랜치 `codex/backup-periodicity-gate-20261125`(bd211b1)에 보관했다. RGB 5지점 단일 픽셀 추출, 301개 샘플 버퍼, 원래 골점 검출 및 HR/SDNN 계산으로 복원했다. 품질 모델은 계속 평가·표시하며 수치 표시를 차단하지 않는다. 디코딩 프레임 기반 처리와 UI 갱신 부하 개선은 유지한다. 피부 접촉을 가정하는 데모이며 비생체 영상에서도 수치가 산출될 수 있다. measurementValidity 유틸리티는 참고용으로 남아 있지만 카메라 처리 경로에서 호출하지 않는다.

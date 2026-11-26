# OnBit 로컬 혈당 모델 데모

## 실행
프로젝트 루트의 터미널 두 개에서 각각 실행한다.

```sh
./local-glucose/run.sh
npm run dev -- --port 5173
```

http://127.0.0.1:5173 에서 카메라를 켠다. Python 서버는 127.0.0.1:8073에 바인딩된다. Vite가 `/api/glucose`를 해당 서버로 전달한다. uv와 Python 3.12를 사용하며 의존성은 uv 격리 환경에 설치한다. 포트 상태 확인: `curl http://127.0.0.1:8073/api/glucose/health`.

## 구성과 출처
- assets/best.pt: 전달받은 가중치, 로컬에만 보관(.gitignore). 다른 컴퓨터에서는 이 위치에 복사해야 한다.
- assets/protocol.json: 전달받은 설정, physiocgm 템플릿 100점·cutoff 0.85 사용.
- vendor/: 원본 glucose_live_demo.py, step1_prepare.py 보관. 원본 전체 데모를 실행하는 폴더가 아니다.
- preprocessing.py: 공유 step1_prepare.py에서 관련 함수만 변경 없이 추출. 해당 원본 해시는 protocol.json의 prepare_sha256과 일치함.
- model.py: 앞서 공유된 step1_smoke.py에서 확인한 Block/ResNet34 정의(309–342행)를 분리. 원본 폴더가 교체되어 전체 step1_smoke.py는 현재 보관돼 있지 않다. 가중치 strict=True 로딩으로 구조 일치 확인.
- server.py: 리플레이 DB와 실험 디렉터리 의존성을 제거한 로컬 연결부. 학습이나 테스트 데이터를 내려받지 않는다.

## 처리 흐름
앱 카메라 → 영상에서 원래 RGB 조합(2R-G-B)의 5지점 평균과 실제 video.currentTime 수집 → 최근 최대 8초 전송 → 64Hz 보간 → 원본 clean/detect/window_data/morphology → cutoff 통과 시 원본 ResNet34 추론.

원래 데모와 동일하게 최소 4초 버퍼와 피크 이후 1.25초 지연을 사용한다. 64Hz 변환은 카메라 입력을 연결하기 위해 추가한 어댑터이며, 없는 정보를 복원하는 것이 아니다. 기존 HeartLens 심박수/HRV/품질 훅은 수정하지 않는다. 혈당 형태 검사는 혈당 경로에만 적용된다.

## 범위
카메라로 받아온 신호를 손목 PPG로 학습한 모델에 연결하는 **실행 실험**이다. 카메라 입력에 대한 혈당 정확도는 검증되지 않았다. 모델 출력은 실험 추정값으로 표시하며, 검출/형태 검사 미통과 시 새 혈당 값을 생성하지 않는다. 실제 CGM 대조값은 포함되지 않는다.

이 구성은 로컬 전용이다. Vercel 정적 프론트에서는 Python 서버가 실행되지 않으며 현재 원격 모델 서버 연결도 추가하지 않았다. 재생 데모 원본에는 별도 ppg_cgm.sqlite와 training_complete.json 등이 필요하지만 카메라 어댑터에는 필요하지 않다.

## 확인
```sh
cd local-glucose
uv run --python 3.12 --with 'torch>=2.10,<3' --with 'numpy>=2,<3' --with 'scipy>=1.13,<2' python test_inference.py
```
모델 가중치·출력 형상, 템플릿 자기 유사도, 짧은 신호/끊김/잘못된 시각/상수 신호 처리, 원본 함수 일치 확인. 생체·혈당 정확도 테스트가 아니다.

## 멈춤/대기 개선 (2026-11-26)
기존 품질 평가의 특징 계산식과 모델은 그대로 두고 Worker+CPU로 분리했다. 품질 추론은 한 번에 하나만 진행하고 처리 중 프레임은 대기열에 쌓지 않는다. 원본 useSignalQuality.ts는 보관하되 앱에서는 useBackgroundSignalQuality를 호출한다. 기존 PPG/심박수/HRV 훅은 유지한다. 입력의 오래된 끊김은 계속 거절하는 대신 마지막 끊김 이후 연속 구간으로 다시 모으며 4초가 모이면 분석을 재개한다. 한 번 통과한 추정값은 마지막 추정 시각과 함께 보존하고 후속 후보의 검사를 통과한 새 값으로만 교체한다. 검사 기준 0.85는 유지한다. 혈당 상세 화면의 서버 처리 시간 및 `/api/glucose/health`의 last_request로 최근 상태를 확인할 수 있다.

## 기록 누적 시 화면 처리 개선
HeartLensEngine 컴포넌트에 원본 PPG 훅을 격리해 원본 샘플 계산은 그대로 진행하며 대시보드에는 최대 8Hz로 스냅샷을 전달한다. 영상 미리보기는 기존 RAF 루프에서 그린다. 기록 훅은 새 수신분만 날짜 변환하고 날짜 formatter를 재사용하며 저장은 별도 지연 작업으로 처리한다. NaN/무한대 계산 결과는 화면에 숫자로 표시하지 않는다(계산식은 유지).

## PPG 품질 입력을 Colab 학습식에 맞춤 (2026-11-26)
현재 Worker는 `src/lib/ppgQualityFeatures.ts`를 사용한다. 앞의 ‘원본 특징 계산식 유지’ 설명은 이전 버전 기록이다. BIOF3003_Backend.ipynb의 `extract_ppg_features`와 맞춰 FFT 세 특징(전체 N점, 패딩 없음), 왜도/첨도 분모 epsilon, 음수 샘플 비율, SNR(var(signal)/var(abs(signal)))을 사용한다. 기존 19입력→3분류 모델 가중치는 그대로이며 구조도 Colab과 일치한다. Colab 링크: https://colab.research.google.com/drive/1Ixaw6fdpRqHEStTKe70s2fsco5P0r_Hx . ‘3초 고정 구간’은 확인되지 않아 추가하지 않았다. 버퍼 길이는 기존대로 최대 301개 샘플이다. 특징은 Worker에서 계산하므로 UI 스레드에 FFT를 추가하지 않았다.

검증: `uv run --python 3.12 --with numpy python tests/generate-quality-reference.py`로 NumPy 기준값 생성 후 `node tests/quality-features.test.cjs`. 7종 입력의 특징 19개를 비교하며 실제 분류 정확도 향상을 입증하는 테스트는 아니다. 혈당용 best.pt와 HR/HRV 계산식은 변경하지 않았다.

## 혈당 화면
홈 혈당 카드는 HR/HRV와 같은 크기로 유지하고 선택하면 혈당 추이 탭으로 이동한다. 추이에서는 실시간/30초/1분/5분/전체 범위를 선택하며 현재·평균·최저·최고 및 추정 기록을 확인한다. 상세 보기에는 그래프, 최소·평균·최대, 접을 수 있는 분석 정보와 추정 시각별 기록이 있다. 그래프·통계는 glucoseAt(실제 성공한 추정 시각)별로 중복을 제거하며 화면에 재표시된 마지막 값은 새 결과로 세지 않는다. 혈당 새 결과는 기존 5초 HR 기록 간격 안에 발생해도 보관한다. 측정 종료 후에는 마지막 수신 시각을 기준으로 그래프 범위를 유지한다.

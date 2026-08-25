# Chatwar

링크로 초대하는 Firebase 기반 실시간 채팅 MVP입니다. 무료 Spark 요금제에서 동작하며, Firestore 트랜잭션으로 방별 최근 메시지 100개만 유지합니다.

## Firebase 설정

1. Firebase 프로젝트에서 Authentication의 익명 로그인을 활성화합니다.
2. Firestore Database를 생성합니다.
3. 웹 앱을 등록하고 `.env.example`을 `.env`로 복사한 뒤 설정값을 입력합니다.
4. Firebase CLI에서 프로젝트를 연결합니다: `npx firebase-tools use --add`
5. 규칙을 배포합니다: `npx firebase-tools deploy --only firestore:rules`
6. 프런트엔드를 빌드·배포합니다: `npm run build && npx firebase-tools deploy --only hosting`

Cloud Functions는 사용하지 않습니다. 각 방 문서의 `messages` 배열을 트랜잭션으로 갱신하면서 101번째 메시지가 추가되면 가장 오래된 메시지를 제거합니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## GitHub Pages 배포

`main` 브랜치에 푸시하면 GitHub Actions가 자동으로 빌드하고 배포합니다. 저장소의 Settings → Pages에서 Source를 **GitHub Actions**로 설정하고 Custom domain에 `chatwar.progamer.info`를 입력합니다.

저장소의 Settings → Secrets and variables → Actions에 `VITE_FIREBASE_ENV`라는 Repository Secret 하나를 만들고 `.env` 내용 전체를 값으로 등록합니다. Firebase Authentication의 승인된 도메인에도 `chatwar.progamer.info`를 추가합니다.

GitHub Pages의 직접 경로 404를 피하기 위해 공유 주소는 `https://chatwar.progamer.info/?room=방ID` 형식을 사용합니다.

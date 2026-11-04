# DTaQ LED

3200 × 1200 LED 화면용 HTML 프로젝트입니다. C# 프로그램이 UDP로 받은 문자열을 WebView2의 `SetRevMsg(string)`에 전달하면 해당 화면을 표시합니다. C# UDP 송수신 프로그램은 별도로 구현합니다.

## 화면 제어

```javascript
SetRevMsg("MSG|ROLLING");          // 홍보 영상·이미지 롤링
SetRevMsg("MSG|WELCOME");          // 웰컴 화면, 롤링 중지
SetRevMsg("MSG|EMP|");             // 직원 검색 대기
SetRevMsg("MSG|EMP|261010");       // 직원 상세
SetRevMsg("MSG|WEP|");             // 무기 검색 대기
SetRevMsg("MSG|WEP|weapon-02");    // 무기 상세
SetRevMsg("MSG|WEP|PRJ-2026-001"); // 사업 상세
```

디버그 박스의 직원·무기 입력과 롤링·웰컴 버튼도 모두 위 함수에 동일한 문자열을 전달합니다. ID를 비우면 검색 대기화면을 표시합니다. 수신 항목에는 마지막으로 처리한 문자열이 표시됩니다. D 키 또는 `?debug=0`으로 디버그 박스를 숨길 수 있습니다.

`SetRevMsg`는 문자열만 받습니다. 잘못된 명령은 안내를 표시하고 현재 화면을 유지합니다. JSON 조회 중 다음 명령이 들어오면 마지막 명령을 적용합니다. 반환값은 처리 성공 여부를 나타내는 `Promise<boolean>`입니다.

## C# WebView2 연동

통신 흐름은 `dtaq HTML → dtaq C# 호스트 → UDP → LED C# 호스트 → SetRevMsg(message)`입니다. UDP 포트, 상대 PC 주소, 수신 확인과 순서는 C# 프로그램에서 관리합니다.

LED C# 프로그램은 WebView2 초기화 및 페이지 로딩 후 UI 스레드에서 다음과 같이 호출합니다. 문자열은 JSON 직렬화하여 따옴표 등을 안전하게 전달합니다.

```csharp
using System.Text.Json;

string message = "MSG|EMP|261010"; // UDP에서 받은 문자열
await webView.CoreWebView2.ExecuteScriptAsync(
    $"SetRevMsg({JsonSerializer.Serialize(message)});"
);
```

페이지 로딩 전에 수신한 문자열은 C#에서 보관한 뒤 로딩 후 전달합니다. 함수가 정의된 후라면 초기 JSON 조회가 완료되기 전의 호출도 처리합니다.

C#에서 `PostWebMessageAsString(message)`를 사용하는 경우에도 HTML의 WebView2 message 이벤트가 동일한 `SetRevMsg(message)`로 전달합니다.

HTML·JSON·이미지·영상은 C#의 로컬 웹서버 또는 WebView2 가상 호스트 폴더 매핑으로 제공합니다. 일반 파일 더블클릭 대신 JSON fetch가 가능한 주소로 열어주세요. 운영에 Node.js를 실행할 필요는 없습니다.

## dtaq 송신 어댑터

`integration/dtaq-bridge.js`는 직원 검색 진입, 직원 LED 버튼, 무기 검색 진입, 무기 LED 버튼, 홈/대기 복귀를 감지하여 `window.chrome.webview.postMessage("MSG|...")`로 문자열을 C# 호스트에 전달합니다. C#은 `WebMessageReceived`에서 읽어 UDP로 전송합니다.

현재 인접한 `../dtaq/include/js/led-bridge.js`에도 설치되어 있습니다. 어댑터 수정 또는 다른 dtaq 폴더에 설치할 때:

```powershell
node scripts/install-dtaq-bridge.cjs
node scripts/install-dtaq-bridge.cjs 'D:\kiosk\dtaq'
```

일반 브라우저에서 dtaq를 미리 볼 때는 생성한 문자열을 콘솔에 표시합니다.

## JSON과 홍보 미디어

- `data/employees.json`: 직원 배열. ID로 직원 상세와 근무이력을 조회합니다.
- `data/weapons.json`: `{ "weapons": [...] }` 구조의 무기 정보.
- `data/projects.json`: `PRJ-...` ID의 사업 정보.
- `data/kiosk_contents.json`: 웰컴 문구·배경 및 홍보 미디어 설정. 통신 주소·포트 설정은 C#에서 관리합니다.

직원·무기·사업 정보는 명령을 받을 때마다 JSON을 다시 읽고 웰컴 전환 때도 최신 웰컴 설정을 읽습니다. 두 프로젝트의 JSON은 독립 파일이므로 실제 운영에서는 같은 데이터로 배포해주세요.

홍보 미디어는 `rolling.items` 순서로 재생합니다. 동영상은 끝까지 무음 재생하고 이미지는 `seconds` 또는 `imageSeconds` 동안 표시합니다. 기본 `fit: "fill"`은 원본 비율과 관계없이 LED 화면을 꽉 채웁니다. 다른 화면으로 바꾸면 영상과 타이머를 중지합니다.

`autoDiscover: true`는 개발용 미리보기의 파일 목록 또는 `data/media_manifest.json`을 사용해 새 홍보 파일을 뒤에 추가합니다. 웰컴 전용 `bg_welcome*` 파일은 제외합니다. C# 프로그램에서 파일을 추가/삭제한 뒤에는 목록도 갱신해주세요. 개발 환경에서는 다음 명령으로 생성합니다.

```powershell
node scripts/media-manifest.cjs
```

직원 120명의 근무이력은 스크롤 확인용으로 12줄씩 구성했습니다. 추가 이력은 JSON의 `isTestData: true`로 구분하며 화면에는 테스트 문구를 표시하지 않습니다. 기존 이력은 `tests/fixtures/employee-histories.original.json`에 보관했습니다.

근무이력은 맨 위에서 2초 대기하고 초당 18px(3200 × 1200 기준) 속도로 위로 스크롤합니다. 마지막 줄에서 4초 머문 뒤 맨 위로 돌아가 반복합니다. 이력이 모두 화면에 들어오면 스크롤하지 않으며 직원을 바꾸면 처음부터 시작합니다.

## 개발용 미리보기와 검증

선택적으로 Node.js 18 이상의 정적 파일 미리보기를 사용할 수 있습니다.

```powershell
node server.cjs
```

LED는 `http://127.0.0.1:8090/`, 인접한 dtaq는 `http://127.0.0.1:8090/dtaq/`에서 미리 봅니다. `server.cjs`는 파일과 미디어 목록만 제공하는 개발 도구입니다. 화면 제어는 디버그 박스 또는 브라우저 콘솔의 `SetRevMsg("MSG|...")`로 확인합니다.

```powershell
npm ci
npm test
```

테스트는 문자열 파싱, 전역 수신 함수와 WebView2 메시지, 디버그 버튼 호출, JSON 조회와 빠른 연속 명령, 미디어 전환과 자동 스크롤, 정적 미리보기를 확인합니다. 실제 C# UDP 통신은 호스트 프로그램에서 별도로 확인해주세요.

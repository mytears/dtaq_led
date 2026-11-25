# DTaQ LED

3200 × 1200 LED 화면용 HTML 프로젝트입니다. C# 프로그램이 UDP로 받은 문자열을 WebView2의 `SetRevMsg(string)`에 전달하면 해당 화면을 표시합니다. C# UDP 송수신 프로그램은 별도로 구현합니다.

## 화면 제어

```javascript
SetRevMsg("MSG|ROLLING");          // 대기 화면 복귀 (웰컴 일정 우선)
SetRevMsg("MSG|WELCOME");          // 키오스크 웰컴 화면에서 보내는 대기 복귀 신호
SetRevMsg("MSG|EMP|");             // 직원 검색 대기
SetRevMsg("MSG|EMP|261010");       // 직원 상세
SetRevMsg("MSG|WEP|");             // 무기 검색 대기
SetRevMsg("MSG|WEP|weapon-02");    // 무기 상세
SetRevMsg("MSG|WEP|PRJ-2026-001"); // 사업 상세
```

디버그 박스의 직원·무기 입력과 롤링 버튼도 위 함수에 동일한 문자열을 전달합니다. ID를 비우면 검색 대기화면을 표시합니다. 수신 항목에는 마지막으로 처리한 문자열이 표시됩니다. D 키 또는 `?debug=0`으로 디버그 박스를 숨길 수 있습니다.

대기 화면에서는 재생 시간에 해당하는 웰컴 일정이 홍보 영상보다 우선합니다. 직원이나 사업 검색·상세 명령을 받으면 해당 화면으로 전환합니다. `MSG|ROLLING` 또는 `MSG|WELCOME`을 받으면 LED의 현재 일정에 따라 다시 대기 화면을 표시합니다.

`SetRevMsg`는 문자열만 받습니다. 잘못된 명령과 데이터 오류는 개발자 콘솔에 기록합니다. JSON 조회 중 다음 명령이 들어오면 마지막 명령을 적용합니다. 반환값은 처리 성공 여부를 나타내는 `Promise<boolean>`입니다.

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

동봉된 `dtaq_player.exe`는 WebView2에 `{ type: 'udp-receive', value: message }` 객체를 보냅니다. 플레이어가 주입한 브리지가 `value` 문자열을 `SetRevMsg`에 전달합니다.

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

LED 페이지와 리소스는 저장소의 `htdocs/`에 있습니다. 아래 데이터 경로는 `htdocs/` 기준입니다.

LED 페이지를 열 때 [kiosk_contents.json](htdocs/data/kiosk_contents.json)을 한 번 읽습니다. `MSG|EMP|<id>`는 메모리에 보관한 `employees_list`에서, `MSG|WEP|<id>`는 `weapons_list`에서 같은 ID를 찾아 상세 화면을 표시합니다. 디버그 입력의 ID 목록도 같은 데이터를 사용합니다. 파일을 수정한 뒤에는 LED 페이지를 새로고침합니다.

직원 사진의 `photo`에는 LED 페이지 기준 상대 경로, 서버 루트 기준 경로 또는 HTTP(S) URL을 넣습니다. 직원 사진이 샘플 이미지로 지정되어 있거나 직원·사업 사진이 없거나 불러오지 못하면 키오스크와 같은 국방기술품질원 로고를 표시합니다. 사업 사진은 원본 비율로 전체를 표시합니다.

`PRJ-...` 사업 ID를 사용하는 배포에서는 `data/projects.json`에서 사업 정보를 조회합니다. 웰컴과 홍보 미디어도 `kiosk_contents.json`에서 설정하며, 통신 주소와 포트는 C#에서 관리합니다.

LED는 페이지를 열 때 `welcome.welcome_list`를 읽습니다. LED PC의 날짜가 예약 범위에 들어오면 `stime`의 00초부터 `etime`의 59초까지 `bg_type`과 `bg_path`로 지정한 배경을 화면 전체에 표시하고, 그 위에 `type`과 `file_path`로 지정한 미디어를 화면 전체 크기로 표시합니다. 두 영상은 각각 원본 길이대로 반복합니다. 예약이 겹치면 시작 시각이 늦은 항목이 우선하며, 표시할 예약이 끝나면 홍보 재생으로 돌아갑니다. 시간 형식과 설정 예시는 [LED 키오스크 설정 안내](kiosk_contents.md)에 설명되어 있습니다.

홍보 미디어는 현재 날짜와 시각에 맞는 `notice.notice_list` 묶음을 배열 순서대로 재생합니다. 각 묶음은 1분할, 왼쪽이 넓은 2분할A, 오른쪽이 넓은 2분할B, 가운데가 넓은 3분할 중 하나를 사용합니다. 각 영상 영역은 `ptime`에 따라 반복합니다. 기본 설정에서는 `full_time` 종료까지 2초 미만이면 되감지 않으며, 모든 영상 영역이 끝나면 즉시 다음 묶음으로 넘어갑니다. 이미지만 있는 묶음은 `full_time` 동안 표시합니다. 다음 묶음은 예정 종료 3초 전부터 미리 불러옵니다. 날짜·시각 조건과 JSON 예시는 [LED 키오스크 설정 안내](kiosk_contents.md)에 설명되어 있습니다.

WebView2의 `webViewZoom=0.5`에서 재생 초반의 네이티브 영상 표면이 작게 표시되는 현상을 피하기 위해, 동영상의 디코딩된 프레임을 각 영역의 캔버스에 출력합니다. 캔버스 해상도는 영역 크기와 디바이스 배율에 맞춥니다. 화면 전환이 시작되면 이전 영상의 소리를 즉시 끕니다. 먼저 끝나는 홍보 영상 영역은 개별적으로 페이드 아웃하며, 마지막 영역은 새 화면이 준비될 때까지 남겨 둡니다. 새 홍보 영상은 재생 버퍼를 확보하고 첫 움직이는 프레임을 그린 뒤 이전 화면 위에서 페이드 인합니다. 이전 화면은 새 화면이 완전히 표시된 뒤 제거합니다. 홍보 영상 소리는 1분할에서만 재생합니다.

직원 120명의 근무이력은 스크롤 확인용으로 12줄씩 구성했습니다. 추가 이력은 JSON의 `isTestData: true`로 구분하며 화면에는 테스트 문구를 표시하지 않습니다. 기존 이력은 `tests/fixtures/employee-histories.original.json`에 보관했습니다.

근무이력은 맨 위에서 2초 대기하고 초당 18px(3200 × 1200 기준) 속도로 위로 스크롤합니다. 마지막 줄에서 4초 머문 뒤 맨 위로 돌아가 반복합니다. 이력이 모두 화면에 들어오면 스크롤하지 않으며 직원을 바꾸면 처음부터 시작합니다.

사업 상세에서 한 항목만 표시 영역을 넘으면 해당 항목을 위와 같은 방식으로 스크롤합니다. 주요성능과 기타가 모두 넘으면 주요성능의 마지막 줄에서 1초 뒤에 기타 스크롤을 시작합니다. 기타의 마지막 줄에서 4초 머문 뒤 두 항목을 맨 위로 돌리고 반복합니다. 다른 사업을 열면 맨 위에서 시작합니다.

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

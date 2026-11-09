# LED 키오스크 설정 안내

백엔드에서 LED 화면에 표시할 문구와 홍보 파일을 관리하는 설정입니다. LED 페이지는 `data/kiosk_contents.json`을 읽습니다. `welcome`에는 방문 환영 화면을, `notice`에는 반복 재생할 홍보 콘텐츠를 넣습니다.

## `welcome` 방문 환영 화면

| 필드 | 넣는 값 | 화면에서 하는 일 |
| --- | --- | --- |
| `show` | `true` 또는 `false` | LED 페이지를 열 때 `true`면 환영 화면으로 시작하고, `false`면 홍보 재생으로 시작합니다. |
| `background` | 이미지 경로 | 환영 화면의 배경입니다. `commonfiles/` 또는 `images/`로 시작하는 상대 경로를 넣습니다. |
| `subtitle` | 문자열 | 큰 제목 위에 표시되는 작은 문구입니다. 예시는 `WELCOME`입니다. |
| `title` | 문자열 | 화면의 큰 제목입니다. 방문 기관이나 단체 이름을 넣습니다. |
| `message` | 문자열 | 큰 제목 아래에 표시되는 환영 인사입니다. |
| `scheduleTitle` | 문자열 | 일정 안내의 제목입니다. 빈 문자열 `""`을 넣으면 제목이 숨겨집니다. |
| `schedule` | 문자열 | 장소와 일정 등 안내 내용입니다. 빈 문자열 `""`을 넣으면 내용이 숨겨집니다. |

## `notice.notice_list` 홍보 재생 목록

배열 위에서부터 순서대로 재생하고, 마지막 항목이 끝나면 첫 항목으로 돌아갑니다. 재생 순서를 바꾸려면 배열 안에서 항목의 위치를 바꾸면 됩니다. 재생할 콘텐츠가 없으면 `[]`를 넣습니다.

| 필드 | 넣는 값 | 화면에서 하는 일 |
| --- | --- | --- |
| `id` | 숫자 | 백엔드에서 항목을 구분할 때 쓰는 값입니다. 항목마다 다른 번호를 부여하면 됩니다. |
| `type` | `"MOV"` 또는 `"IMG"` | `MOV`는 동영상, `IMG`는 이미지입니다. 동영상은 무음으로 재생합니다. |
| `file_path` | 파일 경로 | 재생할 파일입니다. `commonfiles/파일명` 형식의 상대 경로를 넣습니다. |
| `ptime` | 0보다 큰 숫자 | 재생 또는 표시 시간입니다. 초 단위이며 MOV와 IMG 모두 값을 넣습니다. `10`을 넣으면 10초 뒤 다음 항목으로 넘어갑니다. 영상이 더 짧으면 남은 시간 동안 반복합니다. |
| `ratio` | `"full"` 또는 `"contain"` | `full`은 화면을 꽉 채웁니다. 원본과 화면의 비율이 다르면 늘어나 보일 수 있습니다. `contain`은 원본 비율을 유지하며 화면 안에 최대 크기로 표시합니다. 남는 공간은 검은색입니다. |

## JSON 예시

아래 설정은 홍보 화면으로 시작해서 영상 10초, 이미지 10초 순으로 반복합니다.

```json
{
  "welcome": {
    "show": false,
    "background": "commonfiles/bg_welcome-1_led.png",
    "subtitle": "WELCOME",
    "title": "방위사업청 대표단",
    "message": "방문을 진심으로 환영합니다",
    "scheduleTitle": "일정",
    "schedule": "본관 3층 대회의실 · 기술협력 간담"
  },
  "notice": {
    "notice_list": [
      {
        "id": 1,
        "type": "MOV",
        "file_path": "commonfiles/MAIN000070.mp4",
        "ptime": 10,
        "ratio": "full"
      },
      {
        "id": 2,
        "type": "IMG",
        "file_path": "commonfiles/San-Francisco-Skyline-Mural-Wallpaper.jpg",
        "ptime": 10,
        "ratio": "full"
      }
    ]
  }
}
```

## 변경 사항 반영

- 홍보 파일을 추가할 때는 `commonfiles/`에 파일을 저장하고 `notice_list`에 해당 경로를 넣습니다. 설정을 저장한 뒤 LED 페이지를 새로고침하면 새 목록을 읽습니다.
- `MSG|WELCOME` 명령을 보내면 최신 환영 화면 설정을 읽어 표시합니다. `MSG|ROLLING` 명령을 보내면 홍보 화면으로 돌아가 첫 항목부터 재생합니다.

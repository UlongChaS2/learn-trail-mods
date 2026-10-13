# learn-trail

> A [Claude Code](https://claude.com/claude-code) mod that keeps a table of contents for long explanations,
> saves each section as written, and lets you replay any of them later with `/recall`.
> The UI and prompts are in Korean.

설명이 길어지면 트리가 되는데, 대화는 한 줄이다. 가지로 내려가면 **돌아올 자리를 잃는다.**

learn-trail 은 Claude 가 여러 항목으로 나눠 설명할 때 **목차와 지금 어디인지**를 옆 패널에 띄우고,
항목마다 쓴 설명을 **그대로 저장**한다. 나중에 `/recall 1.3` 하면 그때 들은 설명이 다시 뜬다 —
요약이 아니라 저장해 둔 본문이다. 세션을 닫아도 남는다.

```
▾ 1. Hikari 커넥션 풀                      ✕
 ✓ 1.1 커넥션 풀이 왜 필요한가  ●
 ✓ 1.2 Hikari가 실제로 하는 일  ●
 ▸ 1.3 기동 성공이 DB 연결이 아닌 이유  ●  ← 지금
   1.4 그래서 어떻게 확인하나

7일 넘게 안 본 주제 — 지울까요?
  ✕ 2. Vertica 붙이기 (9일 전)    두기

▸ 3. Jasypt 열쇠                           ✕

╭───────────────────────────────────────────╮
│ 쌓는 중 — 끄려면  /trail off              │
│ 설명을 대화로 받기   /recall 1.2          │
│ 주제 지우기          /trail drop 1        │
│ 이 패널로 들어오기   ctrl+x 누르고 tab    │
│   들어와서  1~9  그 항목으로   0  접기    │
╰───────────────────────────────────────────╯
```

## 설치

터미널에서 Claude Code 를 켜고 프롬프트에 친다.

```
/plugin install learn-trail --marketplace UlongChaS2/learn-trail-mods
```

1. `Add marketplace?` 에 `y`
2. 설치 범위를 고른다 — 모든 세션에서 쓰려면 user 범위(맨 위)에서 Enter
3. `Installed learn-trail. Plugin is now active.` 가 뜨면 끝. 재시작할 필요 없다

**필요한 것**: 플러그인 hooks 모듈(mod)을 지원하는 Claude Code. `2.1.296` 에서 만들고 시험했다.
데스크톱 앱의 Code 탭에서는 `/plugin` 명령이 없으니 터미널에서 설치한다 — user 범위로 깔면
데스크톱 앱 세션에서도 올라온다.

**지우기**: `/plugin` 에서 learn-trail 을 골라 uninstall.

## 빠른 시작

```
/trail                              ← 패널을 열고 쌓기 시작
백엔드 기초 이론을 항목별로 알려줘     ← 평소처럼 묻는다
/recall 1                           ← 1번 주제 전체를 다시 본다
/recall 1.3                         ← 그중 3번만
```

`/trail` 을 치기 전에는 아무 일도 하지 않는다. 켜 두면 Claude 가 여러 항목짜리 설명을 할 때
알아서 목차를 깔고, 답을 `## 1.` · `## 2.` 머리말로 잘라 항목마다 저장한다.

## 명령

| 치는 것 | 하는 일 |
|---|---|
| `/trail` | **패널을 열고 쌓기 시작한다** |
| `/trail close` | 패널만 닫는다 (기록은 계속된다) |
| `/trail off` | 그만 쌓는다 (쌓인 것은 남는다) |
| `/recall` | 지금 주제의 지금 항목 |
| `/recall 1` | 1번 주제 **전체** |
| `/recall 1.2` | 1번 주제의 2번 |
| `/recall 1.1,3` · `/recall 1.2-4` | 고른 항목만 · 범위로 (`1.1,3-5` 처럼 섞어도 된다) |
| `/recall hikari` · `/recall hikari 2` | 번호가 기억 안 날 때 — 제목 앞부분으로 (전체 · 그 항목) |
| `/trail drop 1` | 1번 주제 지우기 (번호 없으면 지금 주제) |
| `/trail drop all` | 전부 지우기 |

**번호는 패널에 찍힌 것을 그대로 친다.** `1.3` 이라고 적힌 줄을 보고 `/recall 1.3`.
지운 주제 번호는 다시 쓰지 않는다(전부 지우면 1번부터 다시).

### 패널 조작

`ctrl+x` 누르고 `tab` 으로 패널에 들어가, 주제 줄 사이를 오가며 Enter — 지금 주제면 접고 펴고,
다른 주제면 그쪽으로 옮긴다. `✕` 는 버린다. 7일 넘게 안 본 주제는 켤 때 지울지 묻는다.

## 어떻게 동작하나

- **목차**: mod 가 `trail` 도구를 등록하고, 켜져 있을 때만 시스템 프롬프트에 사용법 한 단락을 얹는다.
  Claude 는 설명을 시작하기 전에 `set` 으로 목차를 깐다.
- **본문 저장**: Claude 가 쓴 답을 대화에 들어오는 길목(`session.append`)에서 주워 `## N.` 머리말로
  잘라 담는다. 모델이 같은 글을 두 번 쓰지 않는다.
  - 그 턴에 `trail` 도구(`set` · `focus` · `next`)를 부르지 않은 답은 담지 않는다 — 목차와 상관없는
    대화가 저장된 본문을 덮어쓰지 않게.
  - 곁가지(`push`)가 열린 동안의 답도 담지 않는다. 곁가지 답이 원래 설명을 덮으면 안 된다.
- **보관**: 플러그인 저장소(`$.store`)에 둔다. 세션을 닫아도 남고, 다른 사람과 공유되지 않는다.

## 한계

- 패널의 항목 줄은 눌러도 본문이 뜨지 않는다. 플러그인 버튼에서 대화에 글을 넣을 길이 없어서다 —
  본문은 `/recall` 로 받는다.
- 숫자 단축키는 1~9 까지. 목차가 아홉을 넘으면 애초에 설명이 너무 길다는 신호다.
- 안내 문구와 모델에게 주는 지시가 한국어다.

## 개발

```bash
git clone https://github.com/UlongChaS2/learn-trail-mods.git
claude --plugin-dir ./learn-trail-mods/plugin     # 이 세션에만 올린다
claude plugin validate ./learn-trail-mods/plugin  # 엔진이 뭘 거부할지 미리 본다
claude plugin test ./learn-trail-mods/plugin      # 테스트
```

**경로는 `plugin/` 까지다.** 레포 뿌리에는 마켓플레이스 파일이 있어서, 뿌리를 가리키면 엔진이 그
폴더를 마켓플레이스로 읽고 플러그인은 안 올라온다(명령이 `Unknown command` 로 나온다).

```
learn-trail-mods/                 레포 = 마켓플레이스
├── .claude-plugin/
│   └── marketplace.json          → "source": "./plugin"
└── plugin/                       ← 플러그인은 여기
    ├── .claude-plugin/plugin.json
    ├── hooks/                    register.tsx (본체) · trail.test.ts
    └── types/                    $.state 계약
```

고친 내용은 세션을 다시 시작해야 반영된다. 설계에서 왜 그렇게 정했는지는 `register.tsx` 의 주석에
날짜와 함께 남겨 두었다.

## 라이선스

[MIT](./LICENSE)

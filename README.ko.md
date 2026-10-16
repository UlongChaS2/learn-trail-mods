# learn-trail

[English](./README.md) | **한국어**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Claude Code](https://img.shields.io/badge/Claude%20Code-plugin-d97757.svg)](https://claude.com/claude-code)
![Version](https://img.shields.io/badge/version-0.3.1-informational.svg)

설명이 길어지면 트리가 되는데, 대화는 한 줄이다. 가지로 내려가면 **돌아올 자리를 잃는다.**

learn-trail 은 Claude 가 여러 항목으로 나눠 설명할 때 **목차와 지금 어디인지**를 옆 패널에 띄우고,
항목마다 쓴 설명을 **그대로 저장**한다. 나중에 `/recall 1.3` 하면 그때 들은 설명이 다시 뜬다 —
요약이 아니라 저장해 둔 본문이다. 세션을 닫아도 남는다.

```
▾ 1. Hikari 커넥션 풀  ✕
  ✓ 1.1 커넥션 풀이 왜 필요한가  ●
  ✓ 1.2 Hikari가 실제로 하는 일  ●
  ▸ 1.3 기동 성공이 DB 연결이 아닌 이유  ●  ← 지금
    1.4 그래서 어떻게 확인하나

7일 넘게 안 본 주제 — 지울까요?
  ✕ 2. Vertica 붙이기 (9일 전)  두기

▸ 3. Jasypt 열쇠  ✕

────────────────────────────────
쌓는 중
/trail off             그만 쌓기
/recall 1.2            설명 하나 받기
/recall 1              주제 전체 받기
/recall 1.1,3  1.2-4   여러 항목 · 범위
/trail drop 1          주제 지우기
/trail close           패널 닫기
ctrl+x, tab            패널로 들어오기
Enter                  주제 접기 · 바꾸기 · 항목 다시 보기
```

## 설치

> 처음 설치하거나 동료에게 안내할 때는 **[설치 가이드](https://claude.ai/artifact/Q7BiQPcL7Z6TkbUcAQtPyc#ko)** 를 본다. 준비물, 설치 3단계(복사 버튼),
> 자주 막히는 곳, 업데이트·삭제가 한 페이지에 있다.

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
| `/recall 2a` · `/recall 2a.3` | 2번에서 갈라진 곁가지 전체 · 그 3번 |
| `/recall hikari` · `/recall hikari 2` | 번호가 기억 안 날 때 — 제목 앞부분으로 (전체 · 그 항목) |
| `/trail drop 1` · `/trail drop 2a` | 주제·곁가지 지우기 (번호 없으면 지금 주제). 거기서 갈라진 곁가지도 같이 지운다 |
| `/trail drop all` | 전부 지우기 |

**번호는 패널에 찍힌 것을 그대로 친다.** `1.3` 이라고 적힌 줄을 보고 `/recall 1.3`.
지운 주제 번호는 다시 쓰지 않는다(전부 지우면 1번부터 다시).

### 곁가지

설명 도중 "그건 뭔데?" 로 빠진 질문은 곁가지가 된다. 곁가지는 큰 주제 번호를 가져가지 않고
부모 번호 뒤에 글자를 붙인다 — 2번에서 갈라지면 `2a`, `2b`, 곁가지의 곁가지는 `2aa`.
지운 글자는 다시 채운다(`2b` 를 지우고 새로 열면 다시 `2b`). 곁가지도 본문이 그대로 저장되고,
닫은 뒤에도 `/recall 2a` 로 다시 본다.

```
▾ 2. nginx와 리버스 프록시  ✕
  ✓ 2.5 nginx 설정으로 보는 리버스 프록시  ●
  ▸ 2.6 우리 환경에 대입해보기  ●  ← 지금
      ↳ 2a. 톰캣은 왜 리버스 프록시가 안 되나 (5)
```

패널은 지금 있는 목차 하나만 그린다. 곁가지 줄에서 Enter 로 들어가면 머리줄이
`2. nginx와 리버스 프… › 2a. 톰캣은 왜…` 처럼 경로가 되고, 맨 아래 `↰` 줄로 돌아온다.
몇 단계를 들어가도 패널 모양은 같다. 상태줄에도 `학습 2a.3` 처럼 지금 자리가 뜬다.

### 패널 조작

`ctrl+x` 누르고 `tab` 으로 패널에 들어가, 줄 사이를 오가며 Enter — 지금 주제면 접고 펴고,
다른 주제면 그쪽으로 옮긴다. 항목 줄에서 Enter 하면 입력칸에 `/recall 1.3` 이 채워지고,
Enter 를 한 번 더 누르면 저장된 본문이 뜬다. `✕` 는 버린다. 7일 넘게 안 본 주제는 켤 때 지울지 묻는다.

**패널 키는 사람마다 바꿀 수 있다.** 기본 키 `ctrl+x, tab` 은 두 번 눌러야 해서 길다. 더 짧은 키를
쓰고 싶거나 `ctrl+x` 가 터미널·tmux 같은 다른 도구의 키와 겹치면 `~/.claude/keybindings.json` 에서 `abovePrompt:focus` 에 원하는 키를 붙인다. 패널 안내 상자도
그 키를 읽어 보여 준다(바꾸지 않았으면 기본 키 `ctrl+x, tab`). 세션을 새로 열면 반영된다.

```json
{ "bindings": [{ "context": "Chat", "bindings": { "alt+g": "abovePrompt:focus" } }] }
```

#### 한글 입력 중에 패널 키가 안 먹을 때

한글 상태에서 `alt+g` 를 누르면 패널로 안 들어가고, 영문으로 바꿔야만 들어갈 수 있다.
패널에 들어갈 때마다 한/영 전환을 누르는 게 귀찮다면 아래를 읽는다.

**왜 그런가.** 한글 상태에서는 터미널이 "G 자리 키" 가 아니라 `ㅎ` 이라는 글자를 보낸다.
Claude 는 `alt+ㅎ` 을 `alt+g` 로 알아듣지 못한다. 이건 alt 만의 문제가 아니다. tmux·herdr 같은
도구를 거치면 ctrl 조합도 같은 식으로 깨진다. 키 설정만으로는 못 고치고, 터미널이 **자판 위치
기준으로** 영문 키 신호를 보내게 고쳐야 한다. 예를 들어 Ghostty 라면 이렇게 한다.

```
keybind = alt+key_g=esc:g
```

터미널과 중간 도구는 사람마다 다르다. 그러니 아래 프롬프트를 Claude 에게 그대로 붙여 넣으면
Claude 가 먼저 원인을 찾고 고친다. 고친 뒤에는 한/영 상태와 상관없이 같은 키로 패널에
들어간다.

```
learn-trail 패널로 들어가는 키(~/.claude/keybindings.json 의 abovePrompt:focus)가
한글 입력 상태에서 안 먹는다. 아래 순서로 고쳐 줘.

1. 내가 쓰는 터미널과, 그 사이에 낀 것(tmux·herdr·zellij 등)을 확인해.
2. 고치기 전에 learn-trail 의 scripts/keycap.py
   (설치했다면 ~/.claude/plugins/marketplaces/learn-trail/scripts/keycap.py)로
   그 키가 실제로 어떤 바이트로 들어오는지 찍게 해 줘. 내가 영문·한글 상태에서 각각
   눌러 결과를 붙일게.
3. 한글 상태에서 영문 글자 코드가 안 오면, 터미널 설정에서 "자판 위치(물리 키)" 기준으로
   그 키를 영문 키 신호로 바꿔 보내게 해. 중간 도구가 막고 있으면 그쪽도 봐.
4. 설정 파일은 백업하고, 무엇을 바꿀지 먼저 보여 준 뒤 내 허락을 받고 고쳐.
5. 고친 뒤 keycap.py 로 다시 찍어서 영문 코드가 오는지 확인해.
```

추측으로 고치지 말고 2번에서 먼저 찍어 보는 게 핵심이다. 실제로 들어오는 바이트를 보면
원인이 바로 갈린다(한글 상태의 `alt+ㅎ` 은 `ESC[12622;3u` 로, `alt+g` 는 `ESC[103;3u` 로 찍힌다).

## 어떻게 동작하나

- **목차**: mod 가 `trail` 도구를 등록하고, 켜져 있을 때만 시스템 프롬프트에 사용법 한 단락을 얹는다.
  Claude 는 설명을 시작하기 전에 `set` 으로 목차를 깐다.
- **본문 저장**: Claude 가 쓴 답을 대화에 들어오는 길목(`session.append`)에서 주워 `## N.` 머리말로
  잘라 담는다. 모델이 같은 글을 두 번 쓰지 않는다.
  - 그 턴에 `trail` 도구(`set` · `focus` · `next`)를 부르지 않은 답은 담지 않는다 — 목차와 상관없는
    대화가 저장된 본문을 덮어쓰지 않게.
  - 곁가지(`push`)를 열면 그 뒤의 답은 곁가지 본문으로 담긴다. 부모 항목 본문은 건드리지 않는다.
    `pop` 뒤에 덧붙인 말은 담지 않는다.
- **보관**: 플러그인 저장소(`$.store`)에 둔다. 세션을 닫아도 남고, 다른 사람과 공유되지 않는다.

## 한계

- 패널의 항목 줄은 바로 본문을 띄우지 않고 입력칸에 `/recall` 을 채우기까지만 한다. 바로 보내면
  모델에게 가는 새 턴이 되어 설명을 다시 쓰기 때문이다 — 저장본을 그대로 받으려면 Enter 를 한 번 더.
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

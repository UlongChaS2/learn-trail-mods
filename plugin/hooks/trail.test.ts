import { test, expect } from 'claude-code/testing'

import { captureTarget, migrate, staleOf } from './register'

const TOOL = 'mcp__learn-trail__trail'

/**
 * 명령 하나를 사람이 친 것처럼 돌린다. 엔진은 origin·presentation 을 스스로 채우는데
 * 타입은 그 칸까지 요구해서, 테스트마다 같은 캐스트를 늘어놓지 않게 한 곳에 모았다.
 */
const run = ($: { command: { run: (a: never) => Promise<{ text?: string }> } }, command: string, args = '') =>
  $.command.run({ command, args } as never)

// 본문은 모델이 쓴 답을 session.append(door='response') 에서 주워 담는다. 테스트
// 하네스에서는 그 문을 흉내 낼 수 없다 — 플러그인이 넣는 행은 door 가 'note' 다.
// 그래서 본문이 담겼는지는 사람이 실제 세션에서 본다. 여기서는 목차·이동·주소·지우기를 본다.

/** 목차를 깔면 1번이 '지금' 이 되고, 주제 이름이 제목에서 뽑힌다 */
test('set 이 목차를 깔고 부를 이름을 만든다', async $ => {
  await run($, 'trail')
  const res = await $.tool.call({
    tool: TOOL,
    action: 'set',
    title: 'Hikari 커넥션 풀',
    items: ['왜 필요한가', '무엇을 하나'],
  })

  expect(res.text).toContain('목차 2개')
  // "Hikari 커넥션 풀" → hikari. 번호만 외우게 하면 주제가 여럿일 때 못 찾는다
  expect(res.text).toContain('/recall 1.1')
})

/** 곁가지는 쌓이고, 답하면 빠진다 — 이게 이 mod 를 만든 이유다 */
test('push 로 곁가지를 쌓고 pop 으로 돌아온다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'x y', items: ['하나', '둘'] })

  const pushed = await $.tool.call({ tool: TOOL, action: 'push', label: '커넥션 풀이 뭔지' })
  expect(pushed.text).toContain('곁가지 열림')

  const popped = await $.tool.call({ tool: TOOL, action: 'pop' })
  expect(popped.text).toContain('곁가지 닫음')
})

/** 닫을 것이 없을 때 터지지 않는다 */
test('빈 스택에서 pop 해도 죽지 않는다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'zed', items: ['하나'] })
  const res = await $.tool.call({ tool: TOOL, action: 'pop' })

  expect(res.text).toContain('닫을 곁가지 없음')
})

/** 모르는 action 도 호출을 실패시키지 않는다 — 설명이 끊기면 안 된다 */
test('모르는 action 은 조용히 알려주고 넘어간다', async $ => {
  await run($, 'trail')
  const res = await $.tool.call({ tool: TOOL, action: '없는동작' })

  expect(res.text).toContain('모르는 action')
})

/**
 * 저장한 본문이 그대로 나온다.
 *
 * 2026-10-08: 이 훅이 조용히 터져 엔진이 "아무도 답하지 않았다" 고만 말했다. 이유가
 * 안 보여 한참 헤맸다 — 테스트로 잡는다.
 */
test('본문이 아직 없으면 그렇다고 말한다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['왜', '무엇'] })


  const res = await run($, 'recall')
  expect(res.text).toContain('1. 왜')
  expect(res.text).toContain('아직 설명이 저장되지 않았습니다')
})

/**
 * 연달아 불러도 된다.
 *
 * 2026-10-08: 첫 호출만 되고 그 뒤로 전부 실패했다. 받는 곳 없는 거절(Promise.race 에
 * 남은 타이머)이 플러그인 환경을 죽인 탓이다. 한 번 되는 것으로는 모자라다.
 */
test('연달아 불러도 계속 답한다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Pool 얘기', items: ['하나', '둘'] })

  for (let n = 0; n < 3; n++) {
    const res = await run($, 'recall')
    expect(res.text).toContain('Pool 얘기')
  }
})

/** 주제 이름과 번호를 함께 준다 — 순서는 상관없다 */
test('주제와 번호로 찾는다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Vertica 붙이기', items: ['가', '나', '다'] })
  await $.tool.call({ tool: TOOL, action: 'focus', index: 3 })

  // 패널에 찍힌 주소를 그대로 친다
  const byNo = await run($, 'recall', '1.3')
  expect(byNo.text).toContain('3. 다')

  // 번호가 기억 안 나면 이름으로도 찾는다. 앞부분만 쳐도 된다
  const byName = await run($, 'recall', 'vert 3')
  expect(byName.text).toContain('3. 다')
})

/** 주제가 여럿이어도 지난 것이 안 날아간다 — 하나만 들고 있으면 이 mod 는 반쪽이다 */
test('새 주제를 깔아도 앞 주제가 남아 있다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['가'] })

  await $.tool.call({ tool: TOOL, action: 'set', title: 'Jasypt 열쇠', items: ['가'] })

  const old = await run($, 'recall', '1.1')
  expect(old.text).toContain('Hikari 풀')
})

/** 없는 주제를 부르면 들고 있는 것들을 알려 준다 — 무엇을 칠 수 있는지 모르면 못 쓴다 */
test('없는 주제를 부르면 목록을 알려 준다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['가'] })

  const res = await run($, 'recall', 'nosuch')
  expect(res.text).toContain('Hikari 풀')
})

/** 끝난 주제는 버린다 — 모델이 clear 로, 사람이 /trail drop 으로 */
test('clear 로 지금 주제를 지운다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Temp 주제', items: ['가'] })
  const res = await $.tool.call({ tool: TOOL, action: 'clear' })

  expect(res.text).toContain('지움')
})

test('/trail drop 으로 번호를 찍어 지운다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Alpha 주제', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Beta 주제', items: ['가'] })

  const dropped = await run($, 'trail', 'drop 1')
  expect(dropped.text).toContain('지웠습니다')

  // 지운 것은 더 이상 안 나온다
  const gone = await run($, 'recall', '1.1')
  expect(gone.text).toContain('1번 주제가 없습니다')
})

test('/trail drop all 로 전부 지운다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Gamma 주제', items: ['가'] })

  const res = await run($, 'trail', 'drop all')
  expect(res.text).toContain('전부 지웠습니다')

  const after = await run($, 'recall')
  expect(after.text).toContain('아직 들고 있는 주제가 없습니다')
})

/**
 * 기본은 꺼짐이다.
 *
 * 켜 두면 모든 설명에 끼어든다. 늘 필요한 것이 아니라 — 뭘 배우려고 들어온 자리에서만
 * 켜면 된다. 꺼진 채로 도구가 불려도 아무것도 쌓지 않는다.
 */
test('꺼져 있으면 아무것도 쌓지 않는다', async $ => {
  const res = await $.tool.call({
    tool: TOOL,
    action: 'set',
    title: 'Hikari 풀',
    items: ['가', '나'],
  })

  expect(res.text).toContain('꺼져 있다')

  const after = await run($, 'recall')
  expect(after.text).toContain('아직 들고 있는 주제가 없습니다')
})

test('/trail 하면 쌓기 시작한다', async $ => {
  const on = await run($, 'trail')
  expect(on.text).toContain('쌓입니다')

  const res = await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['가'] })
  expect(res.text).toContain('목차 1개')

  // 꺼도 쌓인 것은 남는다 — 끄는 것은 "더 쌓지 않는다" 는 뜻이다
  const off = await run($, 'trail', 'off')
  expect(off.text).toContain('그만 쌓습니다')

  const still = await run($, 'recall', '1.1')
  expect(still.text).toContain('Hikari 풀')
})

/**
 * 옛 모양으로 저장돼 있던 것을 버리지 않는다.
 *
 * 주소를 이름에서 번호로 바꿀 때 쌓여 있던 것들이 "undefined." 로 찍히고 /recall 로도
 * 안 불렸다. 쌓는 데 시간이 든 것들이라 번호를 매겨 끌어올린다.
 *
 * 저장소를 통째로 흉내 내는 대신 끌어올리는 함수만 본다 — 하네스에 $.store 가 없다.
 */
test('번호 없던 옛 주제에 번호를 매겨 살린다', async () => {
  const old = {
    on: false,
    nextNo: 1,
    collapsed: [],
    kept: [],
    current: 'hikari',
    byTopic: {
      hikari: {
        title: 'Hikari 커넥션 풀',
        slug: 'hikari',
        items: ['왜 필요한가', '무엇을 하나'],
        cursor: 1,
        done: [0],
        notes: { '1': '여기에 옛 본문이 들어 있다' },
        branches: [],
      },
    },
  }

  const now = migrate(old as never)

  expect(now.byTopic['1']?.no).toBe(1)
  expect(now.current).toBe('1')
  expect(now.byTopic['1']?.notes['1']).toContain('옛 본문')
  // 손댄 때가 없던 것을 바로 "묵었다" 고 묻지 않는다
  expect(typeof now.byTopic['1']?.touchedAt).toBe('number')
})

/** 닫기는 패널만 치운다 — 쌓기는 계속된다. 그만두는 것은 off 다 */
test('/trail close 는 패널만 닫고 기록은 계속한다', async $ => {
  await run($, 'trail')

  const closed = await run($, 'trail', 'close')
  expect(closed.text).toContain('닫았습니다')

  // 닫은 뒤에도 목차가 쌓인다
  const res = await $.tool.call({ tool: TOOL, action: 'set', title: 'After Close', items: ['가'] })
  expect(res.text).toContain('목차 1개')
})


// ─────────────────────────────────────────────────────────────
// 2026-10-12 전수 점검에서 나온 것들
// ─────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 12)

/** 테스트용 주제 하나. 필요한 칸만 바꿔 쓴다 */
const topic = (no: number, over: Record<string, unknown> = {}) => ({
  title: `주제${no}`,
  no,
  slug: `t${no}`,
  items: ['가', '나', '다'],
  cursor: 0,
  done: [] as number[],
  notes: {} as Record<string, string>,
  branches: [] as string[],
  touchedAt: NOW,
  ...over,
})

/**
 * "두기" 가 먹혀야 한다.
 *
 * kept 에는 번호를 넣으면서 비교는 이름(slug)으로 하고 있었다 — 두기를 눌러도 계속 물었다.
 */
test('묵은 주제 — 두기를 고른 것과 지금 주제는 묻지 않는다', async () => {
  const old = NOW - 10 * DAY
  const all = {
    on: true,
    nextNo: 4,
    collapsed: [],
    current: '1',
    kept: ['2'],
    byTopic: {
      '1': topic(1, { touchedAt: old }), // 지금 보는 주제 — 오래됐어도 묻지 않는다
      '2': topic(2, { touchedAt: old }), // 두기 — 묻지 않는다
      '3': topic(3, { touchedAt: old }), // 묻는다
    },
  }

  const asked = staleOf(all as never, NOW).map(t => t.no)
  expect(asked).toEqual([3])
})

test('묵은 주제 — 7일이 안 됐으면 묻지 않는다', async () => {
  const all = {
    on: true, nextNo: 2, collapsed: [], current: '', kept: [],
    byTopic: { '1': topic(1, { touchedAt: NOW - 6 * DAY }) },
  }
  expect(staleOf(all as never, NOW)).toEqual([])
})

/**
 * 곁가지 답이 원래 본문을 덮어쓰면 안 된다.
 *
 * 곁가지가 열린 동안의 답은 곁가지 질문에 대한 것이다. 그걸 지금 항목에 담으면
 * /recall 했을 때 원래 설명 대신 곁가지 답이 나온다.
 */
test('곁가지가 열려 있으면 본문으로 담지 않는다', async () => {
  const base = { on: true, nextNo: 2, collapsed: [], current: '1', kept: [] }

  const plain = { ...base, byTopic: { '1': topic(1) } }
  expect(captureTarget(plain as never)?.no).toBe(1)

  const branching = { ...base, byTopic: { '1': topic(1, { branches: ['SqlSession 이 뭔지'] }) } }
  expect(captureTarget(branching as never)).toBeUndefined()
})

test('꺼져 있거나 목차가 끝났으면 담지 않는다', async () => {
  const base = { nextNo: 2, collapsed: [], current: '1', kept: [] }
  expect(captureTarget({ ...base, on: false, byTopic: { '1': topic(1) } } as never)).toBeUndefined()
  expect(captureTarget({ ...base, on: true, byTopic: { '1': topic(1, { cursor: -1 }) } } as never)).toBeUndefined()
})

/** 꺼진 채로 모델이 도구를 불러도 아무것도 쌓지 않고, 켜는 법을 맞게 알려 준다 */
test('/trail off 뒤에는 도구가 쌓지 않고 /trail 로 켜라고 한다', async $ => {
  await run($, 'trail')
  await run($, 'trail', 'off')

  const res = await $.tool.call({ tool: TOOL, action: 'set', title: 'X', items: ['가'] })
  expect(res.text).toContain('꺼져 있다')
  // 없는 명령(/trail on)을 안내하지 않는다
  expect(res.text).not.toContain('/trail on')
})

/** 없는 항목 번호는 없다고 말한다 — 조용히 1번을 보여 주면 그게 맞는 글인 줄 안다 */
test('/recall 에 없는 항목 번호를 주면 없다고 한다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Range 주제', items: ['가', '나'] })

  const res = await run($, 'recall', '1.9')
  expect(res.text).toContain('9번 항목이 없습니다')
  expect(res.text).toContain('1 ~ 2')
})

/** 항목을 옮기면 패널의 "지금" 이 따라간다 — 번호로 불렀을 때와 같은 자리를 보여 준다 */
test('focus 로 옮긴 자리를 /recall 이 그대로 보여 준다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Focus 주제', items: ['가', '나', '다'] })
  await $.tool.call({ tool: TOOL, action: 'focus', index: 3 })

  const res = await run($, 'recall')
  expect(res.text).toContain('3. 다')
})

/** next 로 끝까지 가면 목차 끝이라고 말한다 */
test('next 로 마지막을 넘기면 목차 끝이다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Next 주제', items: ['가', '나'] })

  expect((await $.tool.call({ tool: TOOL, action: 'next' })).text).toContain('2번으로')
  expect((await $.tool.call({ tool: TOOL, action: 'next' })).text).toContain('목차 끝')
})

/** 지운 번호는 다시 쓰지 않는다 — 같은 번호가 다른 주제를 가리키면 헷갈린다 */
test('지운 뒤 새 주제는 다음 번호를 받는다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'A 주제', items: ['가'] })
  await run($, 'trail', 'drop 1')

  const res = await $.tool.call({ tool: TOOL, action: 'set', title: 'B 주제', items: ['가'] })
  expect(res.text).toContain('/recall 2.1')
})

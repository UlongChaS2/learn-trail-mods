import { test, expect } from 'claude-code/testing'

import {
  captureTarget,
  crumbOf,
  focusKeyOf,
  migrate,
  nextBranchId,
  parseArgs,
  parsePicks,
  rootOf,
  splitSections,
  staleOf,
  statusOf,
  without,
} from './register'

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

/**
 * 곁가지는 주제 하나로 남는다 — 닫아도 /recall 로 다시 본다.
 *
 * 예전에는 이름표만 쌓고 pop 하면 그마저 지웠다. 곁가지 답은 다시 볼 길이 없었다(2026-10-14).
 */
test('push 로 곁가지 주제를 열고 pop 으로 부모에 돌아온다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'x y', items: ['하나', '둘'] })

  const pushed = await $.tool.call({ tool: TOOL, action: 'push', label: '커넥션 풀이 뭔지' })
  expect(pushed.text).toContain('곁가지 열림')
  // 곁가지는 큰 주제 번호를 가져가지 않는다 — 1번에서 갈라졌으니 1a
  expect(pushed.text).toContain('/recall 1a')

  const popped = await $.tool.call({ tool: TOOL, action: 'pop' })
  expect(popped.text).toContain('곁가지 닫음')

  // 지금 자리는 부모다 — 다음 곁가지는 또 부모에서 갈라진다
  const bare = await run($, 'recall')
  expect(bare.text).toContain('x y — 1. 하나')

  // 닫은 뒤에도 남아 있고, 어디서 갈라졌는지 말한다. 한 칸짜리면 질문이 곧 항목이다
  const again = await run($, 'recall', '1a')
  expect(again.text).toContain('1.1 의 곁가지')
  expect(again.text).toContain('1. 커넥션 풀이 뭔지')
})

/** 곁가지 답이 여러 항목이면 곁가지도 목차를 갖는다 */
test('push 에 items 를 주면 곁가지 목차가 된다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'nginx', items: ['하나', '둘'] })
  await $.tool.call({ tool: TOOL, action: 'push', label: '톰캣은 왜', items: ['목적', '스레드', '장애'] })

  const res = await run($, 'recall', '1a.3')
  expect(res.text).toContain('톰캣은 왜 (1.1 의 곁가지) — 3. 장애')
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

  expect(now.byTopic['1']?.id).toBe('1')
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
  id: String(no),
  slug: `t${no}`,
  items: ['가', '나', '다'],
  cursor: 0,
  done: [] as number[],
  notes: {} as Record<string, string>,
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

  const asked = staleOf(all as never, NOW).map(t => t.id)
  expect(asked).toEqual(['3'])
})

test('묵은 주제 — 7일이 안 됐으면 묻지 않는다', async () => {
  const all = {
    on: true, nextNo: 2, collapsed: [], current: '', kept: [],
    byTopic: { '1': topic(1, { touchedAt: NOW - 6 * DAY }) },
  }
  expect(staleOf(all as never, NOW)).toEqual([])
})

/**
 * 곁가지 답은 곁가지에 담기고 부모 본문은 그대로다.
 *
 * 부모를 덮어쓰면 /recall 했을 때 원래 설명 대신 곁가지 답이 나온다. 곁가지가 지금 주제가
 * 되므로 담는 곳이 처음부터 다르다.
 */
test('곁가지에 들어가 있으면 곁가지에 담는다', async () => {
  const base = { on: true, nextNo: 3, collapsed: [], kept: [] }
  const byTopic = { '1': topic(1), '2': topic(2, { id: '2', items: ['톰캣'], parent: { id: '1', at: 0 } }) }

  expect(captureTarget({ ...base, current: '1', byTopic } as never, true)?.id).toBe('1')
  expect(captureTarget({ ...base, current: '2', byTopic } as never, true)?.id).toBe('2')
})

/** 주제를 지우면 거기서 갈라진 곁가지도 같이 지운다. 지우던 곁가지면 부모로 돌아간다 */
test('곁가지는 주제와 함께 지워진다', async () => {
  const byTopic = {
    '1': topic(1),
    '1a': topic(1, { id: '1a', parent: { id: '1', at: 0 } }),
    '1aa': topic(1, { id: '1aa', parent: { id: '1a', at: 1 } }),
    '2': topic(2),
  }
  const all = { on: true, nextNo: 3, collapsed: ['1aa'], current: '1aa', kept: [], byTopic }

  expect(rootOf(all as never, byTopic['1aa'] as never).id).toBe('1')

  const gone = without(all as never, '1')
  expect(Object.keys(gone.byTopic)).toEqual(['2'])
  expect(gone.collapsed).toEqual([])

  const leaf = without(all as never, '1aa')
  expect(leaf.current).toBe('1a')
})

/** 이름표로 쌓던 옛 곁가지는 버린다 — 열린 채 남아 있으면 그 주제 답이 영영 안 담겼다 */
test('옛 branches 칸을 걷어 낸다', async () => {
  const old = { on: true, nextNo: 2, collapsed: [], kept: [], current: '1',
    byTopic: { '1': { ...topic(1), branches: ['5432가 밖으로 열렸다'] } } }
  const now = migrate(old as never)
  expect('branches' in (now.byTopic['1'] ?? {})).toBe(false)
  expect(now.byTopic['1']?.id).toBe('1')
})

test('꺼져 있거나 목차가 끝났으면 담지 않는다', async () => {
  const base = { nextNo: 2, collapsed: [], current: '1', kept: [] }
  expect(captureTarget({ ...base, on: false, byTopic: { '1': topic(1) } } as never, true)).toBeUndefined()
  expect(captureTarget({ ...base, on: true, byTopic: { '1': topic(1, { cursor: -1 }) } } as never, true)).toBeUndefined()
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

/** 남은 주제가 있으면 지운 번호를 다시 쓰지 않는다 — 같은 번호가 다른 주제를 가리키면 헷갈린다 */
test('남은 주제가 있으면 지운 번호를 건너뛴다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'A 주제', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'set', title: 'B 주제', items: ['가'] })
  await run($, 'trail', 'drop 1')

  const res = await $.tool.call({ tool: TOOL, action: 'set', title: 'C 주제', items: ['가'] })
  expect(res.text).toContain('/recall 3.1')
})


// ─────────────────────────────────────────────────────────────
// 2026-10-13 — 답이 토막 나던 것 · 다 지웠는데 7번부터 시작하던 것
// ─────────────────────────────────────────────────────────────

/** 다 지웠으면 1번부터 — 남은 게 없으면 번호가 겹칠 일도 없다 */
test('전부 지우면 다음 주제는 1번이다', async $ => {
  await run($, 'trail')
  for (const t of ['가 주제', '나 주제', '다 주제']) {
    await $.tool.call({ tool: TOOL, action: 'set', title: t, items: ['하나'] })
  }
  const dropped = await run($, 'trail', 'drop all')
  expect(dropped.text).toContain('1번부터')

  const res = await $.tool.call({ tool: TOOL, action: 'set', title: '새 주제', items: ['하나'] })
  expect(res.text).toContain('/recall 1.1')
})

test('낱개로 지워 하나도 안 남아도 1번부터다', async () => {
  const one = { on: true, nextNo: 7, collapsed: ['6'], current: '6', kept: ['6'],
    byTopic: { '6': { title: 'x', no: 6, slug: 'x', items: ['가'], cursor: 0, done: [], notes: {}, branches: [], touchedAt: 0 } } }
  const after = without(one as never, '6')
  expect(after.nextNo).toBe(1)
  expect(after.current).toBe('')
  // 지운 주제의 접힘·두기 표시도 같이 치운다 — 같은 번호를 다시 받을 때 따라오면 안 된다
  expect(after.collapsed).toEqual([])
  expect(after.kept).toEqual([])
})

/**
 * 한 번에 쓴 답을 머리말로 자른다.
 *
 * 항목마다 도구를 부르게 했더니 답이 토막 나고 1~7번이 "정리했어요" 한 줄로만 남았다.
 * 답은 한 번에 쓰게 하고, 여기서 번호 머리말로 나눈다.
 */
test('번호 머리말로 항목별 본문을 나눈다', async () => {
  const text = [
    '도입 한 줄.',
    '## 1. 백엔드가 하는 일',
    '요청을 받아 데이터를 처리해 돌려준다.',
    '## 2. HTTP',
    '요청과 응답의 약속이다.',
    '**3. REST**',
    '자원을 URL 로 나타낸다.',
  ].join('\n')

  const parts = splitSections(text, 8)
  expect([...parts.keys()]).toEqual([0, 1, 2])
  expect(parts.get(0)).toContain('데이터를 처리해')
  expect(parts.get(1)).toContain('요청과 응답의 약속')
  expect(parts.get(2)).toContain('URL 로')
  // 다음 머리말은 앞 항목에 섞이지 않는다
  expect(parts.get(0)).not.toContain('HTTP')
})

test('본문 속 번호 목록은 머리말로 치지 않는다', async () => {
  const text = [
    '## 1. 데이터베이스',
    '고를 때 볼 것:',
    '1. 정합성',
    '2. 확장성',
    '## 2. 인증',
    '세션과 토큰.',
  ].join('\n')

  const parts = splitSections(text, 8)
  // "1. 정합성" "2. 확장성" 은 순서상 머리말 자리가 아니다 — 1·2 두 항목만 나온다
  expect([...parts.keys()]).toEqual([0, 1])
  expect(parts.get(0)).toContain('정합성')
  expect(parts.get(0)).toContain('확장성')
})

test('머리말이 하나뿐이면 쪼개지 않는다', async () => {
  expect(splitSections('## 1. 하나\n본문', 8).size).toBe(0)
  expect(splitSections('머리말 없는 답', 8).size).toBe(0)
})

test('목차보다 큰 번호는 머리말이 아니다', async () => {
  const parts = splitSections('## 1. 가\na\n## 2. 나\nb\n## 3. 다\nc', 2)
  expect([...parts.keys()]).toEqual([0, 1])
  expect(parts.get(1)).toContain('3. 다') // 범위 밖 머리말은 앞 항목 본문에 남는다
})

test('표시 없는 머리말만 있는 답도 나눈다', async () => {
  const parts = splitSections('1. 가\n본문 a\n2. 나\n본문 b', 8)
  expect([...parts.keys()]).toEqual([0, 1])
  expect(parts.get(1)).toContain('본문 b')
})

/**
 * 도구를 안 부른 턴의 답은 본문이 아니다.
 *
 * 2026-10-13: `/recall 1.1` 로 커서가 1번에 간 뒤 recall 기능 얘기를 했더니, 그 답이
 * 1번 본문("백엔드가 하는 일")을 덮어썼다.
 */
test('이번 턴에 trail 을 안 불렀으면 본문으로 담지 않는다', async () => {
  const all = { on: true, nextNo: 2, collapsed: [], current: '1', kept: [], byTopic: { '1': topic(1) } }
  expect(captureTarget(all as never, false)).toBeUndefined()
  expect(captureTarget(all as never, true)?.id).toBe('1')
})

test('항목 번호 묶음을 읽는다', () => {
  expect(parsePicks('3')).toEqual([2])
  expect(parsePicks('1,3,5')).toEqual([0, 2, 4])
  expect(parsePicks('2-4')).toEqual([1, 2, 3])
  // 섞어 써도 되고, 겹치거나 순서가 뒤섞여도 한 번씩 차례대로
  expect(parsePicks('5,1-3,2')).toEqual([0, 1, 2, 4])
  // 못 읽는 조각이 있으면 통째로 못 읽는다 — 읽히는 것만 보여 주면 빠진 줄 모른다
  expect(parsePicks('4-2')).toBeUndefined()
  expect(parsePicks('1,,3')).toBeUndefined()
  expect(parsePicks('1-')).toBeUndefined()
})

test('맨 숫자는 주제, 주제.묶음은 항목이다', () => {
  expect(parseArgs('')).toEqual({})
  expect(parseArgs('2')).toEqual({ topic: '2' })
  expect(parseArgs('2.')).toEqual({ topic: '2' })
  expect(parseArgs('2.3')).toEqual({ topic: '2', picks: [2] })
  expect(parseArgs('2.1,3')).toEqual({ topic: '2', picks: [0, 2] })
  expect(parseArgs('2.2-4')).toEqual({ topic: '2', picks: [1, 2, 3] })
  // 이름과 함께 온 숫자는 그 주제의 항목이다
  expect(parseArgs('vert 3')).toEqual({ name: 'vert', picks: [2] })
  // 묶음만 오면 지금 주제의 항목이다 — 묶음은 주제 번호일 수 없으니 헷갈릴 게 없다
  expect(parseArgs('1,3')).toEqual({ picks: [0, 2] })
  expect(parseArgs('2.x')).toEqual({ topic: '2', bad: 'x' })
})

/** 본문을 깔아 둔 세 항목짜리 주제. 본문은 note 로 바로 넣는다 — 답을 줍는 문은 흉내 못 낸다 */
const seeded = async ($: Parameters<Parameters<typeof test>[1]>[0]) => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Multi 주제', items: ['가', '나', '다'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: '본문-가' } as never)
  await $.tool.call({ tool: TOOL, action: 'note', index: 3, text: '본문-다' } as never)
}

test('/recall 주제번호 는 그 주제 전체를 보여 준다', async $ => {
  await seeded($)
  const res = await run($, 'recall', '1')
  expect(res.text).toContain('전체 3개')
  expect(res.text).toContain('본문-가')
  expect(res.text).toContain('본문-다')
  // 저장 안 된 항목도 빼지 않는다
  expect(res.text).toContain('2. 나')
  expect(res.text).toContain('아직 설명이 저장되지 않았습니다')
})

test('/recall 1.1,3 · 1.2-3 은 고른 항목만 보여 준다', async $ => {
  await seeded($)
  const list = await run($, 'recall', '1.1,3')
  expect(list.text).toContain('1, 3번')
  expect(list.text).toContain('본문-가')
  expect(list.text).toContain('본문-다')
  expect(list.text).not.toContain('2. 나')

  const range = await run($, 'recall', '1.2-3')
  expect(range.text).toContain('2, 3번')
  expect(range.text).not.toContain('본문-가')
})

test('/recall 묶음에 없는 번호가 섞이면 무엇이 없는지 말한다', async $ => {
  await seeded($)
  const res = await run($, 'recall', '1.2,8,9')
  expect(res.text).toContain('8, 9번 항목이 없습니다')
  expect(res.text).toContain('1 ~ 3')
})

test('/recall 을 못 읽으면 쓰는 법을 알려 준다', async $ => {
  await seeded($)
  const res = await run($, 'recall', '1.3-1')
  expect(res.text).toContain('읽을 수 없습니다')
  expect(res.text).toContain('1.1,3')
})

/**
 * 몇 단계를 들어가도 패널 머리줄은 한 줄이다.
 *
 * 처음에는 부모 목차 안에 곁가지 목차를 들여 펼쳤다. 한 단계마다 길어지고 글이 잘렸다
 * (2026-10-14). 지금 목차만 그리고 어디서 왔는지는 경로로 말한다.
 */
test('경로는 맨 위부터 지금까지, 길면 가운데를 줄인다', async () => {
  const at = (id: string, title: string, parent?: string, over: Record<string, unknown> = {}) =>
    topic(1, { id, title, ...(parent ? { parent: { id: parent, at: 0 } } : {}), ...over })
  const chain = {
    '1': at('1', 'nginx와 리버스 프록시'),
    '1a': at('1a', '톰캣은 왜 안 되나', '1'),
    '1aa': at('1aa', '스레드', '1a'),
    '1aaa': at('1aaa', 'NIO', '1aa'),
    '1aaab': at('1aaab', '이벤트 루프', '1aaa', { cursor: 1 }),
  }
  const all = { on: true, nextNo: 2, collapsed: [], kept: [], current: '1a', byTopic: chain }

  expect(crumbOf(all as never, chain['1a'] as never)).toBe('1. nginx와 리버스 프… › 1a. 톰캣은 왜 안 되나')
  expect(crumbOf(all as never, chain['1aaab'] as never)).toBe('1. nginx와 리버스 프… › … › 1aaa. NIO › 1aaab. 이벤트 루프')
  // 곁가지 이름에 어디서 왔는지가 이미 들어 있다
  expect(statusOf({ ...all, current: '1aaab' } as never)).toBe('학습 1aaab.2')
  expect(statusOf({ ...all, on: false } as never)).toBeUndefined()
})

/**
 * 곁가지는 큰 주제 번호를 잡아먹지 않고, 지운 글자는 다시 채운다.
 *
 * 곁가지가 번호를 받던 때는 1, 2 다음 주제가 4 였다. 2b 를 지우고 새로 열면 2c 가 아니라
 * 2b 다 — 건너뛰면 왜 b 가 없는지 묻게 된다(2026-10-14).
 */
test('곁가지는 2a · 2b 로, 지운 자리를 채운다', async $ => {
  await run($, 'trail')
  await $.tool.call({ tool: TOOL, action: 'set', title: '하나', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'set', title: '둘', items: ['가', '나'] })

  expect((await $.tool.call({ tool: TOOL, action: 'push', label: '첫 곁가지' })).text).toContain('/recall 2a')
  await $.tool.call({ tool: TOOL, action: 'pop' })
  expect((await $.tool.call({ tool: TOOL, action: 'push', label: '둘째' })).text).toContain('/recall 2b')
  await $.tool.call({ tool: TOOL, action: 'pop' })

  // 큰 주제는 3번으로 이어진다
  expect((await $.tool.call({ tool: TOOL, action: 'set', title: '셋', items: ['가'] })).text).toContain('/recall 3.1')

  // 2b 를 지우면 다음 곁가지가 다시 2b
  expect((await run($, 'trail', 'drop 2b')).text).toContain('2b. 둘째')
  await run($, 'recall', '2.1')
  expect((await $.tool.call({ tool: TOOL, action: 'push', label: '새 둘째' })).text).toContain('/recall 2b')
})

test('비어 있는 첫 글자를 고른다', async () => {
  const all = { on: true, nextNo: 3, collapsed: [], kept: [], current: '2',
    byTopic: { '2': topic(2), '2a': topic(2, { id: '2a' }), '2c': topic(2, { id: '2c' }) } }
  expect(nextBranchId(all as never, '2')).toBe('2b')
  expect(nextBranchId(all as never, '2a')).toBe('2aa')
})

/** 곁가지가 번호를 받던 때의 저장 — 3번이던 곁가지는 2a 가 되고 다음 큰 주제는 3번이다 */
test('번호를 받던 곁가지를 2a 로 옮긴다', async () => {
  const old = {
    on: true, nextNo: 4, collapsed: ['3'], kept: [], current: '3',
    byTopic: {
      '1': { ...topic(1), no: 1, id: undefined },
      '2': { ...topic(2), no: 2, id: undefined },
      '3': { ...topic(3), no: 3, id: undefined, parent: { no: 2, at: 5 } },
    },
  }
  const now = migrate(old as never)
  expect(Object.keys(now.byTopic).sort()).toEqual(['1', '2', '2a'])
  expect(now.byTopic['2a']?.parent).toEqual({ id: '2', at: 5 })
  expect('no' in (now.byTopic['2a'] ?? {})).toBe(false)
  expect(now.current).toBe('2a')
  expect(now.collapsed).toEqual(['2a'])
  expect(now.nextNo).toBe(3)
})

/** 안내 상자의 "패널로 들어오기" 키는 사람이 바꿔 둔 키를 따른다 */
test('바꿔 둔 패널 키를 읽고, 없으면 기본 키다', async () => {
  expect(focusKeyOf(undefined)).toBe('ctrl+x, tab')
  expect(focusKeyOf({ bindings: [] })).toBe('ctrl+x, tab')
  expect(focusKeyOf({ bindings: [{ context: 'Chat', bindings: { 'alt+g': 'abovePrompt:focus' } }] })).toBe('alt+g')
  expect(focusKeyOf({ bindings: [{ context: 'Chat', bindings: { 'ctrl+k tab': 'abovePrompt:focus' } }] })).toBe('ctrl+k, tab')
})

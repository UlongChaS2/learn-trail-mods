import { test, expect } from 'claude-code/testing'

const TOOL = 'mcp__learn-trail__trail'

/** 목차를 깔면 1번이 '지금' 이 된다 */
test('set 이 목차를 깔고 1번을 지금으로 잡는다', async $ => {
  const res = await $.tool.call({
    tool: TOOL,
    action: 'set',
    title: '데이터 접근 계층',
    items: ['DataSource', 'SqlSessionFactory'],
  })

  expect(res.text).toContain('목차 2개')
})

/** 곁가지는 쌓이고, 답하면 빠진다 — 이게 이 mod 를 만든 이유다 */
test('push 로 곁가지를 쌓고 pop 으로 돌아온다', async $ => {
  await $.tool.call({
    tool: TOOL,
    action: 'set',
    title: 'x',
    items: ['하나', '둘'],
  })

  const pushed = await $.tool.call({
    tool: TOOL,
    action: 'push',
    label: '커넥션 풀이 뭔지',
  })
  expect(pushed.text).toContain('곁가지 열림')

  const popped = await $.tool.call({ tool: TOOL, action: 'pop' })
  expect(popped.text).toContain('곁가지 닫음')
})

/** 닫을 것이 없을 때 터지지 않는다 */
test('빈 스택에서 pop 해도 죽지 않는다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'clear' })
  const res = await $.tool.call({ tool: TOOL, action: 'pop' })

  expect(res.text).toContain('닫을 곁가지 없음')
})

/** 모르는 action 도 호출을 실패시키지 않는다 — 설명이 끊기면 안 된다 */
test('모르는 action 은 조용히 알려주고 넘어간다', async $ => {
  const res = await $.tool.call({ tool: TOOL, action: '없는동작' })

  expect(res.text).toContain('모르는 action')
})

/**
 * 되감기가 실제로 저장된 본문을 돌려주는지.
 *
 * 2026-10-08: 이 훅이 조용히 터져서 엔진이 "아무도 답하지 않았다"고만 말했다.
 * 이유가 안 보여 한참 헤맸다 — 테스트로 잡는다.
 */
test('note 로 저장한 본문이 되감기에서 그대로 나온다', async $ => {
  await $.tool.call({
    tool: TOOL,
    action: 'set',
    title: 'Hikari 커넥션 풀',
    items: ['연결을 미리 만들어 두는 이유', '빌려주고 돌려받는 흐름'],
  })

  const body = '연결 하나를 새로 만들려면 TCP·인증·세션 설정을 거쳐\n수십 ms 가 걸린다.'
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: body })

  const res = await $.command.run({ command: 'trail-recall' })

  expect(res.text).toContain('1. 연결을 미리 만들어 두는 이유')
  expect(res.text).toContain('TCP·인증·세션')
  // 실패하면 .catch 가 사유를 글로 돌려준다
  expect(res.text).not.toContain('되감기 실패')
})

/**
 * 두 번 불러도 된다.
 *
 * 2026-10-08: 첫 호출만 되고 그 뒤로 전부 "아무도 답하지 않았다" 였다. 받는 곳 없는
 * 거절(Promise.race 에 남은 타이머)이 플러그인 환경을 죽인 탓이다. 한 번 되는 것으로는
 * 모자라다 — 이어서 부르는 것까지 본다.
 */
test('되감기를 연달아 불러도 계속 답한다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'x', items: ['하나', '둘'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: '첫째 본문' })

  for (let n = 0; n < 3; n++) {
    const res = await $.command.run({ command: 'trail-recall' })
    expect(res.text).toContain('첫째 본문')
  }
})

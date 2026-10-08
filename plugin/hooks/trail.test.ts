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

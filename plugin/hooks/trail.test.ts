import { test, expect } from 'claude-code/testing'

const TOOL = 'mcp__learn-trail__trail'

/** 목차를 깔면 1번이 '지금' 이 되고, 주제 이름이 제목에서 뽑힌다 */
test('set 이 목차를 깔고 부를 이름을 만든다', async $ => {
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
  await $.tool.call({ tool: TOOL, action: 'set', title: 'x y', items: ['하나', '둘'] })

  const pushed = await $.tool.call({ tool: TOOL, action: 'push', label: '커넥션 풀이 뭔지' })
  expect(pushed.text).toContain('곁가지 열림')

  const popped = await $.tool.call({ tool: TOOL, action: 'pop' })
  expect(popped.text).toContain('곁가지 닫음')
})

/** 닫을 것이 없을 때 터지지 않는다 */
test('빈 스택에서 pop 해도 죽지 않는다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'zed', items: ['하나'] })
  const res = await $.tool.call({ tool: TOOL, action: 'pop' })

  expect(res.text).toContain('닫을 곁가지 없음')
})

/** 모르는 action 도 호출을 실패시키지 않는다 — 설명이 끊기면 안 된다 */
test('모르는 action 은 조용히 알려주고 넘어간다', async $ => {
  const res = await $.tool.call({ tool: TOOL, action: '없는동작' })

  expect(res.text).toContain('모르는 action')
})

/**
 * 저장한 본문이 그대로 나온다.
 *
 * 2026-10-08: 이 훅이 조용히 터져 엔진이 "아무도 답하지 않았다" 고만 말했다. 이유가
 * 안 보여 한참 헤맸다 — 테스트로 잡는다.
 */
test('note 로 저장한 본문이 그대로 나온다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['왜', '무엇'] })

  const body = '연결 하나를 새로 만들려면 TCP·인증·세션 설정을 거쳐\n수십 ms 가 걸린다.'
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: body })

  const res = await $.command.run({ command: 'recall' })
  expect(res.text).toContain('TCP·인증·세션')
})

/**
 * 연달아 불러도 된다.
 *
 * 2026-10-08: 첫 호출만 되고 그 뒤로 전부 실패했다. 받는 곳 없는 거절(Promise.race 에
 * 남은 타이머)이 플러그인 환경을 죽인 탓이다. 한 번 되는 것으로는 모자라다.
 */
test('연달아 불러도 계속 답한다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Pool 얘기', items: ['하나', '둘'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: '첫째 본문' })

  for (let n = 0; n < 3; n++) {
    const res = await $.command.run({ command: 'recall' })
    expect(res.text).toContain('첫째 본문')
  }
})

/** 주제 이름과 번호를 함께 준다 — 순서는 상관없다 */
test('주제와 번호로 찾는다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Vertica 붙이기', items: ['가', '나', '다'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 3, text: '셋째 본문' })

  // 패널에 찍힌 주소를 그대로 친다
  const byNo = await $.command.run({ command: 'recall', args: '1.3' })
  expect(byNo.text).toContain('셋째 본문')

  // 번호가 기억 안 나면 이름으로도 찾는다. 앞부분만 쳐도 된다
  const byName = await $.command.run({ command: 'recall', args: 'vert 3' })
  expect(byName.text).toContain('셋째 본문')
})

/** 주제가 여럿이어도 지난 것이 안 날아간다 — 하나만 들고 있으면 이 mod 는 반쪽이다 */
test('새 주제를 깔아도 앞 주제가 남아 있다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: '히카리 본문' })

  await $.tool.call({ tool: TOOL, action: 'set', title: 'Jasypt 열쇠', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'note', index: 1, text: '제이시프트 본문' })

  const old = await $.command.run({ command: 'recall', args: '1.1' })
  expect(old.text).toContain('히카리 본문')
})

/** 없는 주제를 부르면 들고 있는 것들을 알려 준다 — 무엇을 칠 수 있는지 모르면 못 쓴다 */
test('없는 주제를 부르면 목록을 알려 준다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Hikari 풀', items: ['가'] })

  const res = await $.command.run({ command: 'recall', args: 'nosuch' })
  expect(res.text).toContain('Hikari 풀')
})

/** 끝난 주제는 버린다 — 모델이 clear 로, 사람이 /trail drop 으로 */
test('clear 로 지금 주제를 지운다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Temp 주제', items: ['가'] })
  const res = await $.tool.call({ tool: TOOL, action: 'clear' })

  expect(res.text).toContain('지움')
})

test('/trail drop 으로 번호를 찍어 지운다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Alpha 주제', items: ['가'] })
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Beta 주제', items: ['가'] })

  const dropped = await $.command.run({ command: 'trail', args: 'drop 1' })
  expect(dropped.text).toContain('지웠습니다')

  // 지운 것은 더 이상 안 나온다
  const gone = await $.command.run({ command: 'recall', args: '1.1' })
  expect(gone.text).toContain('1번 주제가 없습니다')
})

test('/trail drop all 로 전부 지운다', async $ => {
  await $.tool.call({ tool: TOOL, action: 'set', title: 'Gamma 주제', items: ['가'] })

  const res = await $.command.run({ command: 'trail', args: 'drop all' })
  expect(res.text).toContain('전부 지웠습니다')

  const after = await $.command.run({ command: 'recall' })
  expect(after.text).toContain('아직 들고 있는 주제가 없습니다')
})

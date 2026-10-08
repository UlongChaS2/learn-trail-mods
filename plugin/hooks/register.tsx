import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Trail } from '../types'

const PANE = 'learn-trail'

const EMPTY: Trail = { title: '', items: [], cursor: -1, done: [], notes: {}, branches: [] }

const trail = atom({ plugin: 'learn-trail', key: 'trail' } as const, EMPTY)

/**
 * 세션을 넘겨 남기는 자리.
 *
 * atom 은 $.state 에 얹히는데 그건 <b>세션 단위</b>다 — 창을 닫으면 사라진다.
 * 이 mod 의 쓸모가 "나중에 다시 보기" 라서 그걸로는 반쪽이다(2026-10-08 실제로 날렸다).
 * 그래서 쓸 때마다 $.store 에도 같이 넣고, 기동할 때 거기서 되읽는다.
 */
const STORE_KEY = 'trail'

/** state 와 store 양쪽에 쓴다. store 가 실패해도 화면은 돌아가야 한다 */
const save = async ($: Parameters<typeof read>[0], next: Trail) => {
  await update($, trail, () => next)
  await $.store.set(STORE_KEY, next).catch(() => {})
}

/** 목차를 새로 깔면 진행 상태는 전부 초기화된다 — 반쯤 남은 표시가 섞이면 더 헷갈린다 */
const startTrail = (title: string, items: string[]): Trail => ({
  title,
  items,
  cursor: items.length > 0 ? 0 : -1,
  done: [],
  notes: {},
  branches: [],
})

/** 지금 항목을 끝낸 것으로 치고 다음으로 — 곁가지가 남아 있으면 옮기지 않는다 */
const advance = (t: Trail): Trail => {
  if (t.cursor < 0) return t
  const done = t.done.includes(t.cursor) ? t.done : [...t.done, t.cursor]
  const next = t.cursor + 1
  return { ...t, done, cursor: next < t.items.length ? next : -1 }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trail',
      description: '학습 경로 패널을 연다 (지금 어디를 설명 중인지)',
    })
    await $.command.register({
      name: 'trail-recall',
      description: '지금 고른 항목의 설명을 대화에 다시 띄운다',
    })

    // 모델이 설명하면서 직접 부른다. 사람이 챙길 일이 없어야 한다
    await $.tool.register({
      name: 'trail',
      description: [
        '설명의 목차와 현재 위치를 패널에 표시한다.',
        '여러 항목으로 나눠 설명할 때 set 으로 목차를 깔고,',
        '항목을 옮길 때 focus, 곁가지 질문이 나오면 push,',
        '그 질문에 답하고 원래 자리로 돌아올 때 pop 을 부른다.',
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['set', 'focus', 'next', 'note', 'push', 'pop', 'clear'],
            description:
              'set=목차 깔기, focus=항목으로 이동, next=다음 항목, note=지금 항목에 요약 남기기, push=곁가지 추가, pop=곁가지 닫기, clear=비우기',
          },
          title: { type: 'string', description: 'set 일 때 설명 전체 제목' },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'set 일 때 목차 항목들 (순서가 번호)',
          },
          index: { type: 'number', description: 'focus 일 때 항목 번호 (1부터)' },
          label: { type: 'string', description: 'push 일 때 곁가지 질문 한 줄' },
          text: {
            type: 'string',
            description:
              'note 일 때 그 항목의 요약. 두세 줄로 짧게 — 나중에 돌아왔을 때 이것만 보고 기억이 나야 한다',
          },
        },
        required: ['action'],
      },
    })

    // 지난 세션에서 쌓아 둔 것을 되살린다
    try {
      const saved = (await $.store.get(STORE_KEY)) as Trail | undefined
      if (saved && Array.isArray(saved.items)) {
        await update($, trail, () => saved)
      }
    } catch {
      // 복원 실패는 조용히 넘긴다 — 빈 목차로 시작하면 된다
    }

    return next(e)
  })

  /**
   * 모델에게 이 도구가 있다는 걸 알려 준다.
   *
   * <p>도구만 등록해 두면 모델이 알아서 부르지 않는다 — 도구 설명은 "부를지 말지" 고민할
   * 때나 읽히고, 설명을 쓰기 시작하면 그냥 쓴다. 실제로 그래서 패널이 빈 채로 있었다.
   * 시스템 프롬프트에 한 단락을 얹어 "설명이 갈래지면 먼저 목차를 깔아라"고 말해 준다.
   *
   * <p>`session` 쪽에 둔다. 이 문단은 이 사람의 세션에서만 읽히는 것이라 공용 캐시에
   * 얹을 값이 아니다.
   */
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    return {
      sections: [
        ...result.sections,
        {
          id: 'learn-trail:guide',
          scope: 'session' as const,
          text: [
            '## 학습 경로 패널 (learn-trail)',
            '',
            '설명을 두 갈래 이상으로 나눠서 답할 때는, 글을 쓰기 전에 trail 도구를 먼저 부른다.',
            '',
            '- `set` — 목차를 깐다. title 과 items (항목 제목들). 설명을 시작할 때 한 번',
            '- `focus` / `next` — 항목을 옮긴다. 그 항목을 쓰기 시작할 때마다',
            '- `note` — 그 항목의 설명 본문을 저장한다. 한 항목을 다 쓴 직후에.',
            '  사람이 나중에 그 번호를 누르면 이 글이 그대로 다시 뜬다. 요약이 아니라',
            '  방금 쓴 설명을 그대로 넣는다 — 다시 쓰면 말이 달라진다',
            '- `push` / `pop` — 사람이 중간에 다른 걸 물어 곁가지로 빠질 때 열고, 답한 뒤 닫는다',
            '',
            '목차는 아홉 개를 넘기지 않는다. 그보다 길면 설명을 쪼갤 단위가 잘못 잡힌 것이다.',
            '한 갈래로 끝나는 짧은 답에는 부르지 않는다 — 목차가 한 줄이면 패널이 방해만 된다.',
          ].join('\n'),
        },
      ],
    }
  })

  on('command.run', { command: 'trail' }, async $ => {
    await $.ui.open({ id: PANE, title: '학습 경로' }).catch(() => {})
    return { text: '학습 경로 패널을 열었습니다.' }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    return { text: `패널 열기 실패 — ${String(next.error?.message ?? next.error)}` }
  })

  on('command.run', { command: 'trail-recall' }, async $ => {
    const t = await read($, trail)
    if (t.cursor < 0 || t.cursor >= t.items.length) {
      return { text: '되감을 항목이 없습니다.' }
    }
    const saved = t.notes[String(t.cursor)]
    const head = `${t.cursor + 1}. ${t.items[t.cursor]}`
    // 저장해 둔 설명을 토씨 그대로 돌려준다. 없으면 아직 설명 전이라는 뜻이다
    return {
      text: saved
        ? `${head}\n\n${saved}`
        : `${head}\n\n(아직 이 항목을 설명하지 않았습니다.)`,
    }
  }).catch(($, e, next) => {
    // 이 훅은 next 를 부르지 않고 스스로 답한다. 터지면 엔진이 "아무도 답하지 않았다"고만
    // 말하고 이유는 사라진다 — 실제로 그래서 한참 헤맸다. 이유를 글로 돌려준다
    if (next.called) return next(e)
    return { text: `되감기 실패 — ${String(next.error?.stack ?? next.error ?? '알 수 없음')}` }
  })

  on('tool.call', { tool: 'mcp__learn-trail__trail' }, async ($, e) => {
    // 도구 인자는 e 안에 그대로 실린다 (tool · tool_use_id 같은 예약 키와 나란히).
    // e.input 이 아니다 — 그걸로 읽으면 action 이 undefined 로 온다
    const input = e as unknown as {
      action?: string
      title?: string
      items?: string[]
      index?: number
      label?: string
      text?: string
    }

    let line = ''

    // 상태 갱신이 실패해도 호출 자체는 성공으로 돌려준다.
    // 패널이 안 그려지는 것보다 설명이 끊기는 게 나쁘다
    try {
      const before = await read($, trail)
      const after = ((t: Trail) => {
        switch (input.action) {
          case 'set': {
            const items = input.items ?? []
            line = `목차 ${items.length}개 — ${input.title ?? ''}`
            return startTrail(input.title ?? '', items)
          }
          case 'focus': {
            // 사람이 보는 번호는 1부터, 안에서는 0부터
            const i = Math.max(0, Math.min((input.index ?? 1) - 1, t.items.length - 1))
            const done = t.cursor >= 0 && t.cursor < i && !t.done.includes(t.cursor)
              ? [...t.done, t.cursor]
              : t.done
            line = `${i + 1}번으로 — ${t.items[i] ?? ''}`
            return { ...t, cursor: i, done }
          }
          case 'next': {
            const moved = advance(t)
            line = moved.cursor < 0 ? '목차 끝' : `${moved.cursor + 1}번으로 — ${moved.items[moved.cursor]}`
            return moved
          }
          case 'note': {
          // 번호를 안 주면 지금 항목에 남긴다
          const i = input.index !== undefined ? input.index - 1 : t.cursor
          if (i < 0 || i >= t.items.length) {
            line = '요약을 붙일 항목이 없다'
            return t
          }
          line = `${i + 1}번 요약 저장`
          return { ...t, notes: { ...t.notes, [String(i)]: input.text ?? '' } }
        }
        case 'push': {
            const label = input.label ?? '곁가지'
            line = `곁가지 열림 — ${label}`
            return { ...t, branches: [...t.branches, label] }
          }
          case 'pop': {
            const closed = t.branches[t.branches.length - 1]
            line = closed ? `곁가지 닫음 — ${closed}` : '닫을 곁가지 없음'
            return { ...t, branches: t.branches.slice(0, -1) }
          }
          case 'clear': {
            line = '비움'
            return EMPTY
          }
          default: {
            line = `모르는 action: ${input.action}`
            return t
          }
        }
      })(before)
      await save($, after)
    } catch (err) {
      line = `패널 갱신 실패 — ${String(err)}`
    }

    // 목차를 깔면 패널이 없을 때 열어 준다. 설명이 시작되는 순간이 열기 좋은 때다.
    // 여는 데 실패해도 삼킨다 — 패널이 안 떠도 설명은 계속돼야 한다
    if (input.action === 'set') {
      void $.ui.open({ id: PANE, title: '학습 경로' }).catch(() => {})
    }

    // result 는 문자열·배열만 받는다. 객체를 돌려주면 호출이 통째로 거부된다
    return { result: line, text: line }
  }).catch(($, e, next) => {
    // 이 훅은 호출을 스스로 답한다(next 를 부르지 않는다). 훅이 터지면 엔진이 그 자리를
    // 대신 메우는데, 그때 "패널이 됐다"고 오해할 답이 가면 안 된다 — 안 됐다고 말한다.
    // 설명은 계속돼야 하므로 거부가 아니라 성공으로, 사유만 실어 돌려준다
    if (next.called) return next(e)
    const why = `패널 갱신 실패 — ${String(next.error?.message ?? next.error ?? '알 수 없음')}`
    return { result: why, text: why }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = await read($, trail)

    if (t.items.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>아직 목차가 없습니다.</Text>
          <Text dimColor>설명이 여러 갈래로 나뉠 때 자동으로 채워집니다.</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {t.title !== '' && <Text bold>{t.title}</Text>}
        {t.items.map((item, i) => {
          const isNow = i === t.cursor
          const isDone = t.done.includes(i)
          const note = t.notes[String(i)]
          // 끝낸 것 · 지금 · 아직 — 세 상태가 한눈에 갈려야 한다
          const mark = isDone ? '✓' : isNow ? '▸' : ' '
          // 숫자 단축키는 1~9 까지만. 그 뒤 항목은 Tab 으로 간다
          const hotkey = i < 9 ? String(i + 1) : undefined
          return (
            <Box flexDirection="column">
              <Button
                key={`item-${i}`}
                hotkey={hotkey}
                plain
                dimColor={isDone && !isNow}
                label={`${mark} ${item}${isNow ? '   ← 지금' : !isNow && note ? '  ●' : ''}`}
                onPress={async () => {
                  const cur = await read($, trail)
                  await save($, { ...cur, cursor: i })
                  // 패널은 좁다. 설명 본문은 대화로 돌려준다
                  await $.command.run({ command: 'trail-recall' }).catch(() => {})
                }}
              />
              {/* 요약은 지금 항목만 펼친다. 다 펼치면 목차가 안 보인다 —
                  다른 항목은 점(●)으로 "요약 있음"만 알린다 */}
              {isNow && note && (
                <Text dimColor>{`    ${note.split('\n')[0].slice(0, 60)}…`}</Text>
              )}
            </Box>
          )
        })}
        <Box paddingTop={1}>
          <Text dimColor>ctrl+x tab → 숫자키 또는 Tab+Enter → 설명이 대화에 다시 뜸</Text>
        </Box>
        {t.branches.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text dimColor>곁가지 (답하면 위로 돌아감)</Text>
            {t.branches.map((b, i) => (
              <Text>{`${'  '.repeat(i)}└ ${b}`}</Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Trail, Trails } from '../types'

const PANE = 'learn-trail'
const STORE_KEY = 'trails'

/** 이 날수보다 오래 손 안 댄 주제는 켤 때 "지울까요" 하고 묻는다 */
const STALE_DAYS = 7
const DAY = 24 * 60 * 60 * 1000

const EMPTY: Trails = { on: false, byTopic: {}, current: '', nextNo: 1, collapsed: [], kept: [] }

/**
 * 제목에서 부르기 쉬운 이름을 뽑는다 — "Hikari 커넥션 풀" → `hikari`.
 *
 * 영문·숫자 토막이 있으면 그 첫 번째를 쓴다. 치기 쉽고 기억에 남는 쪽이 대개 거기다.
 * 없으면(순한글 제목) 첫 낱말을 그대로 쓴다.
 */
const slugOf = (title: string): string => {
  const ascii = title.toLowerCase().match(/[a-z][a-z0-9]+/)
  if (ascii) return ascii[0]
  const word = title.trim().split(/\s+/)[0] ?? ''
  return word.slice(0, 12) || 'topic'
}

const trails = atom({ plugin: 'learn-trail', key: 'trails' } as const, EMPTY)

/**
 * state 와 store 양쪽에 쓴다.
 *
 * atom 은 $.state 에 얹히는데 그건 세션 단위다 — 창을 닫으면 사라진다. 이 mod 의 쓸모가
 * "나중에 다시 보기" 라서 그걸로는 반쪽이다(2026-10-08 실제로 날렸다). store 가 실패해도
 * 화면은 돌아가야 하므로 그쪽만 삼킨다.
 */
const save = async ($: Parameters<typeof read>[0], next: Trails) => {
  await update($, trails, () => next)
  await $.store.set(STORE_KEY, next).catch(() => {})
}

/**
 * 옛 모양으로 저장된 것을 지금 모양으로 끌어올린다.
 *
 * 주소를 이름(slug)에서 번호로 바꿨다. 그때 저장돼 있던 것은 번호가 없어 패널에
 * "undefined." 로 찍히고 /recall 로도 못 부른다. 쌓는 데 시간이 걸린 것들이라
 * 버리지 않고 번호를 매겨 준다 — 쌓인 것을 지키는 게 이 mod 의 일이다.
 */
export const migrate = (all: Trails): Trails => {
  if (Object.values(all.byTopic).every(t => typeof t.no === 'number')) return all

  let no = all.nextNo > 1 ? all.nextNo : 1
  const byTopic: Record<string, Trail> = {}
  let current = ''
  for (const [key, t] of Object.entries(all.byTopic)) {
    const assigned = typeof t.no === 'number' ? t.no : no++
    byTopic[String(assigned)] = {
      ...t,
      no: assigned,
      slug: t.slug ?? '',
      // 옛것에는 손댄 때가 없다. 지금으로 치면 바로 "묵었다" 고 묻지 않는다
      touchedAt: typeof t.touchedAt === 'number' ? t.touchedAt : Date.now(),
    }
    if (key === all.current) current = String(assigned)
  }
  return { ...all, byTopic, current: current || (Object.keys(byTopic)[0] ?? ''), nextNo: no }
}

/** 지금 보고 있는 주제. 없으면 undefined */
const currentOf = (all: Trails): Trail | undefined => all.byTopic[all.current]

/**
 * `/recall` 뒤에 적은 것을 읽는다.
 *
 * `2.3` 은 2번 주제의 3번, `2.` 는 2번 주제, `3` 은 지금 주제의 3번, `hikari` 는 이름으로
 * 찾기. 사람이 보는 번호는 1부터, 안에서는 0부터다.
 */
const parseArgs = (args: string): { topic?: string; name?: string; at?: number } => {
  const out: { topic?: string; name?: string; at?: number } = {}
  for (const w of args.trim().split(/\s+/).filter(Boolean)) {
    const dotted = w.match(/^(\d+)\.(\d*)$/)
    if (dotted) {
      out.topic = dotted[1]
      if (dotted[2] !== '') out.at = Number.parseInt(dotted[2], 10) - 1
      continue
    }
    if (/^\d+$/.test(w)) {
      out.at = Number.parseInt(w, 10) - 1
      continue
    }
    out.name = w.toLowerCase()
  }
  return out
}

/** 손댄 것으로 표시한다 — 오래된 주제를 고르는 기준이 된다 */
const touch = (t: Trail): Trail => ({ ...t, touchedAt: Date.now() })

/**
 * 되감아 보여 줄 글. 어디서 부르든 같은 글이어야 한다.
 *
 * 번호가 범위 밖이면 1번으로 떨어뜨린다. 목차는 있는데 커서가 없다고 아무것도 안
 * 보여 주는 것보다, 첫 항목이라도 보여 주는 쪽이 쓸모 있다.
 */
const recallText = (t: Trail | undefined, at?: number): string => {
  if (!t || !Array.isArray(t.items) || t.items.length === 0) {
    return '목차가 비어 있습니다. 설명을 먼저 들어야 되감을 것이 생깁니다.'
  }
  const want = at ?? t.cursor
  const i = want >= 0 && want < t.items.length ? want : 0
  const head = `${t.title} — ${i + 1}. ${t.items[i]}`
  const saved = t.notes?.[String(i)]
  return saved ? `${head}\n\n${saved}` : `${head}\n\n(이 항목은 아직 설명이 저장되지 않았습니다.)`
}

/** 목차를 새로 깔면 그 주제의 진행 상태는 초기화된다 — 반쯤 남은 표시가 섞이면 더 헷갈린다 */
const startTrail = (title: string, no: number, items: string[]): Trail => ({
  title,
  no,
  slug: slugOf(title),
  items,
  cursor: items.length > 0 ? 0 : -1,
  done: [],
  notes: {},
  branches: [],
  touchedAt: Date.now(),
})

/** 지금 항목을 끝낸 것으로 치고 다음으로 */
const advance = (t: Trail): Trail => {
  if (t.cursor < 0) return t
  const done = t.done.includes(t.cursor) ? t.done : [...t.done, t.cursor]
  const next = t.cursor + 1
  return { ...t, done, cursor: next < t.items.length ? next : -1 }
}

/** 오래 손 안 댔고 아직 "두기" 를 고르지 않은 주제들 */
const staleOf = (all: Trails): Trail[] => {
  const line = Date.now() - STALE_DAYS * DAY
  return Object.values(all.byTopic).filter(
    t => t.touchedAt < line && !all.kept.includes(t.slug) && t.slug !== all.current,
  )
}

/** 며칠 전인지 — 사람이 읽는 말로 */
const agoOf = (at: number): string => {
  const days = Math.floor((Date.now() - at) / DAY)
  return days >= 1 ? `${days}일 전` : '오늘'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'trail',
      description: '학습 경로 패널을 열고 쌓기 시작한다 (close 닫기 · off 그만 · drop N 지움)',
    })
    await $.command.register({
      name: 'recall',
      description: '지난 설명을 그대로 다시 본다 — /recall hikari 1 (주제는 생략 가능)',
    })

    // 지난 세션에서 쌓아 둔 것을 되살린다
    try {
      const saved = (await $.store.get(STORE_KEY)) as Trails | undefined
      if (saved && saved.byTopic) {
        await update($, trails, () => migrate({ ...EMPTY, ...saved }))
      }
    } catch {
      // 복원 실패는 조용히 넘긴다 — 빈 목차로 시작하면 된다
    }

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
            enum: ['set', 'focus', 'next', 'push', 'pop', 'clear'],
            description:
              'set=목차 깔기, focus=항목으로 이동, next=다음 항목, push=곁가지 추가, pop=곁가지 닫기, clear=지금 주제 지우기',
          },
          title: { type: 'string', description: 'set 일 때 설명 전체 제목' },
          items: {
            type: 'array',
            items: { type: 'string' },
            description: 'set 일 때 목차 항목들 (순서가 번호)',
          },
          index: { type: 'number', description: 'focus 일 때 항목 번호 (1부터)' },
          label: { type: 'string', description: 'push 일 때 곁가지 질문 한 줄' },
        },
        required: ['action'],
      },
    })

    return next(e)
  })

  /**
   * 모델에게 이 도구가 있다는 걸 알려 준다.
   *
   * 도구만 등록해 두면 모델이 알아서 부르지 않는다 — 도구 설명은 "부를지 말지" 고민할
   * 때나 읽히고, 설명을 쓰기 시작하면 그냥 쓴다. 실제로 그래서 패널이 빈 채로 있었다.
   *
   * `session` 쪽에 둔다. 이 문단은 이 사람의 세션에서만 읽히니 공용 캐시에 얹을 값이 아니다.
   */
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    // 꺼져 있으면 모델에게 아무 말도 하지 않는다. 그래야 끼어들지 않는다
    if (!(await read($, trails)).on) return result
    return {
      sections: [
        ...result.sections,
        {
          id: 'learn-trail:guide',
          scope: 'session' as const,
          text: [
            '설명을 여러 항목으로 나눠 답할 때는 trail 도구를 함께 쓴다.',
            'set 으로 목차를 깔고, 항목을 옮길 때마다 focus 를 부른다.',
            '설명 본문은 따로 넘기지 않는다 — 쓴 글은 자동으로 그 항목에 붙는다.',
            '곁가지로 빠질 때는 push, 돌아올 때는 pop.',
            '한 갈래로 끝나는 짧은 답에는 쓰지 않는다.',
          ].join('\n'),
        },
      ],
    }
  })

  /**
   * 패널 열기, 그리고 지우기.
   *
   * `/trail` · `/trail drop 2` · `/trail drop all`. 지우는 길이 패널의 ✕ 뿐이면
   * 묵지 않은 주제는 버릴 수가 없다 — 끝난 주제는 바로 버리고 싶을 때가 있다.
   */
  /**
   * 모델이 쓴 답을 지금 항목의 본문으로 담는다.
   *
   * 처음에는 도구의 `note` 로 받았다. 모델이 방금 쓴 글을 도구 인자에 통째로 다시 적는
   * 방식인데, 길이가 길어지면 응답이 안전 분류기에 걸려 통째로 끊겼다(2026-10-08,
   * `[reasoning_extraction]`). 같은 글을 두 번 쓰게 하는 설계부터 잘못이었다.
   *
   * 답이 대화에 들어오는 길목에서 그대로 주워 담는다. 모델은 아무것도 더 쓰지 않는다.
   */
  on('session.append', async ($, e, next) => {
    const result = await next(e)
    try {
      // 모델이 쓴 답만. 사람의 말·도구 결과·알림은 본문이 아니다
      if (e.door !== 'response') return result
      if (!(await read($, trails)).on) return result

      const text = (e.message?.content ?? [])
        .filter((b: { type?: string }) => b?.type === 'text')
        .map((b: { text?: string }) => b.text ?? '')
        .join('\n')
        .trim()
      // 한두 줄짜리 맞장구는 본문이 아니다
      if (text.length < 120) return result

      const all = await read($, trails)
      const cur = currentOf(all)
      if (!cur || cur.cursor < 0) return result

      // 한 항목에 여러 번 답할 수 있다. 마지막 것이 가장 다듬어진 글이다
      await save($, {
        ...all,
        byTopic: {
          ...all.byTopic,
          [String(cur.no)]: touch({
            ...cur,
            notes: { ...cur.notes, [String(cur.cursor)]: text },
          }),
        },
      })
    } catch {
      // 본문을 못 담아도 대화는 그대로 간다
    }
    return result
  })

  on('command.run', { command: 'trail' }, async ($, e) => {
    const words = (e.args ?? '').trim().split(/\s+/).filter(Boolean)

    // 패널만 닫는다. 쌓기는 그대로 — 화면이 좁을 때 치워 두는 것이지 그만두는 게 아니다.
    // 그만두려면 /trail off. 둘을 한 명령에 묶으면 "잠깐 치우기" 를 할 수 없다
    if (words[0] === 'close') {
      await $.ui.close({ id: PANE }).catch(() => {})
      return { text: '패널을 닫았습니다. 기록은 계속됩니다 (다시 열기 /trail · 그만 쌓기 /trail off).' }
    }

    if (words[0] === 'off') {
      const all = await read($, trails)
      await save($, { ...all, on: false })
      return { text: '그만 쌓습니다. 쌓인 것은 /recall 로 그대로 볼 수 있습니다.' }
    }

    if (words[0] === 'drop') {
      const all = await read($, trails)
      const what = words[1] ?? ''

      if (what === 'all') {
        await save($, { ...EMPTY, nextNo: all.nextNo })
        return { text: '주제를 전부 지웠습니다.' }
      }

      // 번호를 안 주면 지금 주제. 가장 흔한 경우다
      const key = what === '' ? all.current : what
      const gone = all.byTopic[key]
      if (!gone) return { text: `${key || '지금'} 주제가 없습니다.` }

      const rest = { ...all.byTopic }
      delete rest[key]
      await save($, {
        ...all,
        byTopic: rest,
        current: all.current === key ? (Object.keys(rest)[0] ?? '') : all.current,
      })
      return { text: `${gone.no}. ${gone.title} — 지웠습니다.` }
    }

    // 패널을 여는 것 자체가 "쓰겠다" 는 뜻이다. 따로 켜게 하면, 열어 놓고 안 쌓이는
    // 걸 보며 왜 비었는지 묻게 된다 — 실제로 그랬다. 끄는 것만 따로 둔다
    const all = await read($, trails)
    if (!all.on) await save($, { ...all, on: true })
    await $.ui.open({ id: PANE, title: '학습 경로' }).catch(() => {})
    return {
      text: all.on
        ? '학습 경로 패널을 열었습니다.'
        : '학습 경로를 열었습니다. 설명이 여러 갈래로 나뉘면 목차가 쌓입니다 (그만하려면 /trail off).',
    }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    return { text: `패널 열기 실패 — ${String(next.error?.message ?? next.error)}` }
  })

  /**
   * 지난 설명을 대화로 받는다.
   *
   * 패널에서 눌러 대화에 글을 띄우는 길은 없었다 — `$.command.run` 은 결과를 부른 자리로
   * 돌려줄 뿐이고, `$.session.append` 는 행을 넣어도 화면에 그려지지 않는다(system 도
   * user 도 그랬다). 그래서 대화로 받는 길은 이 명령 하나다.
   *
   * `/recall hikari 1` · `/recall 1` · `/recall hikari` · `/recall` 을 모두 받는다.
   * 어느 쪽이 주제고 어느 쪽이 번호인지는 생김새로 가른다 — 순서를 외우게 하지 않는다.
   */
  on('command.run', { command: 'recall' }, async ($, e) => {
    const all = await read($, trails)
    const { topic, name, at } = parseArgs(e.args ?? '')

    const list = () =>
      Object.values(all.byTopic)
        .sort((a, b) => a.no - b.no)
        .map(x => `${x.no}. ${x.title}  (/recall ${x.no}.1)`)

    let t = currentOf(all)
    if (topic !== undefined) {
      t = all.byTopic[topic]
      if (!t) {
        return { text: `${topic}번 주제가 없습니다.\n\n들고 있는 것:\n- ${list().join('\n- ')}` }
      }
    } else if (name !== undefined) {
      // 번호가 기억 안 날 때를 위해 이름도 받는다. 앞부분만 쳐도 찾는다
      const hit = Object.values(all.byTopic).find(
        x => x.slug.startsWith(name) || x.title.toLowerCase().includes(name),
      )
      if (!hit) {
        return {
          text:
            list().length > 0
              ? `"${name}" 에 맞는 주제가 없습니다.\n\n들고 있는 것:\n- ${list().join('\n- ')}`
              : '아직 들고 있는 주제가 없습니다.',
        }
      }
      t = hit
    }

    if (!t) return { text: '아직 들고 있는 주제가 없습니다.' }

    // 부른 자리로 패널의 "지금" 도 옮긴다. 보여 준 것과 패널이 다르면 그게 더 헷갈린다
    const i = at !== undefined && at >= 0 && at < t.items.length ? at : t.cursor
    await save($, {
      ...all,
      current: String(t.no),
      byTopic: { ...all.byTopic, [String(t.no)]: touch({ ...t, cursor: i }) },
    })
    return { text: recallText(t, at) }
  }).catch(($, e, next) => {
    if (next.called) return next(e)
    return { text: `다시 보기 실패 — ${String(next.error?.message ?? next.error)}` }
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
      const all = await read($, trails)
      if (!all.on) {
        return { result: '학습 경로가 꺼져 있다 (/trail on)', text: '학습 경로가 꺼져 있다 (/trail on)' }
      }
      const cur = currentOf(all)

      /** 그 주제를 지금 주제로 세우고 저장할 모양을 만든다 */
      const put = (t: Trail): Trails => ({
        ...all,
        current: String(t.no),
        byTopic: { ...all.byTopic, [String(t.no)]: touch(t) },
      })

      switch (input.action) {
        case 'set': {
          const title = input.title ?? ''
          const items = input.items ?? []
          const no = all.nextNo
          line = `목차 ${items.length}개 — ${title} (/recall ${no}.1)`
          await save($, {
            ...put(startTrail(title, no, items)),
            // 지운 번호는 다시 쓰지 않는다. 같은 번호가 다른 주제를 가리키면 헷갈린다
            nextNo: no + 1,
          })
          break
        }
        case 'focus': {
          if (!cur) {
            line = '목차가 없다'
            break
          }
          // 사람이 보는 번호는 1부터, 안에서는 0부터
          const i = Math.max(0, Math.min((input.index ?? 1) - 1, cur.items.length - 1))
          const done =
            cur.cursor >= 0 && cur.cursor < i && !cur.done.includes(cur.cursor)
              ? [...cur.done, cur.cursor]
              : cur.done
          line = `${i + 1}번으로 — ${cur.items[i] ?? ''}`
          await save($, put({ ...cur, cursor: i, done }))
          break
        }
        case 'next': {
          if (!cur) {
            line = '목차가 없다'
            break
          }
          const moved = advance(cur)
          line =
            moved.cursor < 0
              ? '목차 끝'
              : `${moved.cursor + 1}번으로 — ${moved.items[moved.cursor]}`
          await save($, put(moved))
          break
        }
        case 'note': {
          if (!cur) {
            line = '본문을 붙일 목차가 없다'
            break
          }
          // 번호를 안 주면 지금 항목에 남긴다
          const i = input.index !== undefined ? input.index - 1 : cur.cursor
          if (i < 0 || i >= cur.items.length) {
            line = '본문을 붙일 항목이 없다'
            break
          }
          line = `본문 저장 (/recall ${cur.no}.${i + 1})`
          await save($, put({ ...cur, notes: { ...cur.notes, [String(i)]: input.text ?? '' } }))
          break
        }
        case 'push': {
          if (!cur) {
            line = '목차가 없다'
            break
          }
          const label = input.label ?? '곁가지'
          line = `곁가지 열림 — ${label}`
          await save($, put({ ...cur, branches: [...cur.branches, label] }))
          break
        }
        case 'pop': {
          if (!cur || cur.branches.length === 0) {
            line = '닫을 곁가지 없음'
            break
          }
          line = `곁가지 닫음 — ${cur.branches[cur.branches.length - 1]}`
          await save($, put({ ...cur, branches: cur.branches.slice(0, -1) }))
          break
        }
        case 'clear': {
          if (!cur) {
            line = '지울 것 없음'
            break
          }
          const rest = { ...all.byTopic }
          delete rest[String(cur.no)]
          line = `"${cur.title}" 지움`
          await save($, { ...all, byTopic: rest, current: Object.keys(rest)[0] ?? '' })
          break
        }
        default: {
          line = `모르는 action: ${input.action}`
        }
      }
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
    const all = await read($, trails)
    const cur = currentOf(all)
    const stale = staleOf(all)
    const others = Object.values(all.byTopic)
      .filter(t => String(t.no) !== all.current)
      .sort((a, b) => a.no - b.no)

    if (!cur && others.length === 0) {
      return (
        <Box flexDirection="column">
          <Text dimColor>아직 목차가 없습니다.</Text>
          {all.on ? (
            <Text dimColor>설명이 여러 갈래로 나뉠 때 자동으로 채워집니다.</Text>
          ) : (
            <Text dimColor>/trail 하면 쌓이기 시작합니다.</Text>
          )}
        </Box>
      )
    }

    /** 주제 하나를 버린다. 지운 번호는 다시 쓰지 않는다 */
    const drop = async (key: string) => {
      const now = await read($, trails)
      const rest = { ...now.byTopic }
      delete rest[key]
      await save($, {
        ...now,
        byTopic: rest,
        current: now.current === key ? (Object.keys(rest)[0] ?? '') : now.current,
      })
    }

    const folded = cur ? all.collapsed.includes(String(cur.no)) : false

    /** 접거나 편다 */
    const fold = async (key: string) => {
      const now = await read($, trails)
      const was = now.collapsed.includes(key)
      await save($, {
        ...now,
        collapsed: was ? now.collapsed.filter(k => k !== key) : [...now.collapsed, key],
      })
    }

    return (
      <Box flexDirection="column">
        {cur && (
          <Box flexDirection="column">
            {/* 주제 줄만 오갈 수 있다. 항목은 글로 둔다 — 눌러 봐야 본문을 띄울 길이
                없으니(버튼에서 대화에 글을 넣지 못한다) 단추로 두면 눌러도 아무 일이
                없는 줄이 아홉 개 생긴다. 본문은 /recall 로 받는다 */}
            <Box>
              <Button
                key={`fold-${cur.no}`}
                plain
                autoFocus
                label={`${folded ? '▸' : '▾'} ${cur.no}. ${cur.title}`}
                onPress={() => fold(String(cur.no))}
              />
              <Button
                key={`x-${cur.no}`}
                plain
                dimColor
                label="  ✕"
                onPress={() => drop(String(cur.no))}
              />
            </Box>

            {!folded &&
              cur.items.map((item, i) => {
                const isNow = i === cur.cursor
                const isDone = cur.done.includes(i)
                const mark = isDone ? '✓' : isNow ? '▸' : ' '
                // 점(●)은 "본문이 저장돼 있다" — /recall 로 꺼낼 것이 있다는 표시다
                const dot = cur.notes?.[String(i)] ? '  ●' : ''
                return (
                  <Text dimColor={isDone && !isNow}>
                    {`${mark} ${cur.no}.${i + 1} ${item}${dot}${isNow ? '  ← 지금' : ''}`}
                  </Text>
                )
              })}

            {!folded && cur.branches.length > 0 && (
              <Box flexDirection="column" paddingTop={1}>
                <Text dimColor>곁가지 (답하면 위로 돌아감)</Text>
                {cur.branches.map((b, i) => (
                  <Text dimColor>{`${'  '.repeat(i)}└ ${b}`}</Text>
                ))}
              </Box>
            )}
          </Box>
        )}

        {/* 오래 묵은 주제는 한 번 묻는다. 안 물으면 패널이 길어지기만 한다.
            "두기" 를 고르면 다시 묻지 않는다 — 켤 때마다 같은 걸 물으면 그게 성가시다 */}
        {stale.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text dimColor>{`${STALE_DAYS}일 넘게 안 본 주제 — 지울까요?`}</Text>
            {stale.map(t => (
              <Box key={`stale-${t.no}`}>
                <Button
                  key={`drop-${t.no}`}
                  plain
                  label={`  ✕ ${t.no}. ${t.title} (${agoOf(t.touchedAt)})`}
                  onPress={() => drop(String(t.no))}
                />
                <Button
                  key={`keep-${t.no}`}
                  plain
                  dimColor
                  label="   두기"
                  onPress={async () => {
                    const now = await read($, trails)
                    await save($, { ...now, kept: [...now.kept, String(t.no)] })
                  }}
                />
              </Box>
            ))}
          </Box>
        )}

        {/* 지금 주제와 같은 모양으로 세운다 — 다르게 생기면 "주석" 처럼 읽혀서
            눌러도 되는 줄인지 모른다. 색만 죽인다. 누르면 그 주제가 열린다 */}
        {others.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            {others.map(t => (
              <Box key={`row-${t.no}`}>
                <Button
                  key={`go-${t.no}`}
                  plain
                  dimColor
                  label={`▸ ${t.no}. ${t.title}`}
                  onPress={async () => {
                    const now = await read($, trails)
                    await save($, { ...now, current: String(t.no) })
                  }}
                />
                <Button
                  key={`gx-${t.no}`}
                  plain
                  dimColor
                  label="  ✕"
                  onPress={() => drop(String(t.no))}
                />
              </Box>
            ))}
          </Box>
        )}

        {/* 쓸 수 있는 말을 상자에 모은다. 목차 줄들과 섞여 흐르면 안내인지 항목인지
            구분이 안 된다 — 테두리가 그 경계를 긋는다 */}
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          <Text dimColor>{all.on ? '쌓는 중 — 그만하려면  /trail off' : '멈춤 — 다시 쌓으려면  /trail'}</Text>
          <Text dimColor>{'설명을 대화로 받기   /recall 1.2'}</Text>
          <Text dimColor>{'주제 지우기          /trail drop 1'}</Text>
          <Text dimColor>{'패널 닫기            /trail close'}</Text>
          <Text dimColor>{'이 패널로 들어오기   ctrl+x 누르고 tab'}</Text>
          <Text dimColor>{'  주제 줄에서 Enter   접기 · 펴기 · 주제 바꾸기'}</Text>
        </Box>
      </Box>
    )
  })
}

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Trail, Trails } from '../types'

const PANE = 'learn-trail'

/** 패널 안내 상자의 왼쪽(명령) 칸 폭. 가장 긴 "/recall 1.1,3  1.2-4" 가 20칸이다 */
const HELP_HOW = 22

/** 패널로 들어오는 엔진 동작. 기본 키는 ctrl+x tab 이다 */
const FOCUS_ACTION = 'abovePrompt:focus'
const FOCUS_DEFAULT = 'ctrl+x tab'

/**
 * 패널로 들어오는 키 — 사람이 keybindings.json 에 바꿔 둔 것이 있으면 그것.
 *
 * 안내 상자에 기본 키만 적어 두면, 키를 바꾼 사람(ctrl+x 가 터미널 키와 겹쳐 alt+g 로
 * 옮긴 경우, 2026-10-14)에게는 틀린 안내가 된다. 엔진에 "이 동작의 키" 를 묻는 길이
 * 없어 설정 파일을 직접 읽는다. 못 읽으면 기본 키다.
 *
 * @returns 화면에 적을 모양 — 연속 키(chord)는 쉼표로 띄운다: `ctrl+x, tab`
 */
export const focusKeyOf = (config: unknown): string => {
  const blocks = (config as { bindings?: unknown })?.bindings
  const mine: string[] = []
  if (Array.isArray(blocks)) {
    for (const b of blocks) {
      const keys = (b as { bindings?: Record<string, unknown> })?.bindings ?? {}
      for (const [key, action] of Object.entries(keys)) {
        if (action === FOCUS_ACTION) mine.push(key)
      }
    }
  }
  return (mine[0] ?? FOCUS_DEFAULT).split(' ').join(', ')
}

/** 이 세션에서 읽은 키. 모듈을 다시 불러오면 session.start 가 다시 읽는다 */
let focusKey = focusKeyOf(undefined)
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
 * 이번 턴에 모델이 trail 로 목차를 깔거나 항목을 옮겼는가 — 그래야 답을 본문으로 담는다.
 *
 * 사람이 말을 걸 때마다 내린다. 세션에만 두면 된다 — 턴을 넘어 남을 값이 아니다.
 */
const armed = atom({ plugin: 'learn-trail', key: 'armed' } as const, false)

/**
 * 도구를 이 중 하나로 부른 턴의 답만 본문이다.
 *
 * push 도 든다 — 그 뒤의 답은 곁가지 본문이다. pop 은 반대로 내린다. pop 뒤에 덧붙이는
 * 마무리 말이 부모 항목 본문을 덮어쓰면 안 된다.
 */
const ARMING = ['set', 'focus', 'next', 'push']

/**
 * state 와 store 양쪽에 쓴다.
 *
 * atom 은 $.state 에 얹히는데 그건 세션 단위다 — 창을 닫으면 사라진다. 이 mod 의 쓸모가
 * "나중에 다시 보기" 라서 그걸로는 반쪽이다(2026-10-08 실제로 날렸다). store 가 실패해도
 * 화면은 돌아가야 하므로 그쪽만 삼킨다.
 */
const save = async ($: EngineInterface, next: Trails) => {
  await update($, trails, () => next)
  // 상태줄이 안 되는 곳(테스트·일부 화면)이어도 저장은 계속된다
  try {
    $.ui.status(statusOf(next))
  } catch {}
  await $.store.set(STORE_KEY, next).catch(() => {})
}

/** 곁가지 글자. 지운 자리는 다시 채운다 — 2b 를 지우고 새로 열면 다시 2b 다 */
const LETTERS = 'abcdefghijklmnopqrstuvwxyz'

/**
 * 주제 이름 순서 — 큰 주제는 번호로, 곁가지는 그 뒤에 글자 순으로.
 *
 * 그냥 문자열로 비교하면 "10" 이 "2" 앞에 온다.
 */
export const byId = (a: Trail, b: Trail): number => {
  const na = Number.parseInt(a.id, 10)
  const nb = Number.parseInt(b.id, 10)
  return na !== nb ? na - nb : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * 이 주제에서 새 곁가지가 받을 이름 — 부모 이름 뒤에 비어 있는 첫 글자.
 *
 * 큰 주제 번호는 다시 쓰지 않지만 곁가지 글자는 채운다. 곁가지는 부모 안에 묶여 있어
 * 다른 주제와 헷갈릴 일이 없고, 지운 자리를 건너뛰면 2a 다음이 2c 라 왜 b 가 없는지 묻게
 * 된다(2026-10-14 요청). 26개를 다 쓰면 undefined.
 */
export const nextBranchId = (all: Trails, parentId: string): string | undefined => {
  for (const l of LETTERS) {
    if (!all.byTopic[parentId + l]) return parentId + l
  }
  return undefined
}

/**
 * 옛 모양으로 저장된 것을 지금 모양으로 끌어올린다.
 *
 * 세 번 바뀌었다. 처음엔 이름(slug)으로 불렀고, 다음엔 번호(`no`)로, 지금은 이름(`id`)으로
 * 부른다 — 큰 주제는 "2", 곁가지는 "2a". 곁가지도 번호를 받던 때는 곁가지가 큰 주제
 * 번호를 잡아먹어 1, 2 다음 주제가 4 가 됐다. 그때 저장된 것을 버리지 않고 옮긴다 —
 * 쌓인 것을 지키는 게 이 mod 의 일이다.
 */
export const migrate = (all: Trails): Trails => {
  type Old = Trail & { no?: number; branches?: string[]; parent?: { id?: string; no?: number; at: number } }
  const olds = Object.entries(all.byTopic) as [string, Old][]
  if (olds.every(([, t]) => typeof t.id === 'string' && !('no' in t) && !('branches' in t))) return all

  // 1) 옛 번호를 정한다. 번호도 없던 것(이름으로 부르던 때)에는 뒤에 이어 매긴다
  let spare = Math.max(1, all.nextNo, ...olds.map(([, t]) => (typeof t.no === 'number' ? t.no + 1 : 1)))
  // 이미 이름(id)이 있는 것은 그 이름을 지킨다 — 옛 칸(branches)만 걷어 내면 된다
  const named = (t: Old) => typeof t.id === 'string' && typeof t.no !== 'number'
  const numbered = olds.map(([key, t]) => ({
    key,
    t,
    n: typeof t.no === 'number' ? t.no : named(t) ? Number.parseInt(t.id, 10) : spare++,
  }))
  numbered.sort((x, y) => x.n - y.n)

  // 2) 부모가 먼저 오도록 번호 순으로 이름을 붙인다. 곁가지는 부모 이름 + 글자
  const idOf = new Map<number, string>()
  const byTopic: Record<string, Trail> = {}
  const keyToId = new Map<string, string>()
  for (const { key, t, n } of numbered) {
    const { branches: _b, no: _n, parent, ...rest } = t
    const parentId = parent ? (parent.id ?? (parent.no !== undefined ? idOf.get(parent.no) : undefined)) : undefined
    const draft = { ...all, byTopic }
    const id = named(t)
      ? t.id
      : parentId && byTopic[parentId]
        ? (nextBranchId(draft, parentId) ?? String(n))
        : String(n)
    if (!named(t)) idOf.set(n, id)
    keyToId.set(key, id)
    byTopic[id] = {
      ...rest,
      id,
      slug: rest.slug ?? '',
      ...(parentId && id !== String(n) ? { parent: { id: parentId, at: parent?.at ?? 0 } } : {}),
      // 옛것에는 손댄 때가 없다. 지금으로 치면 바로 "묵었다" 고 묻지 않는다
      touchedAt: typeof rest.touchedAt === 'number' ? rest.touchedAt : Date.now(),
    }
  }

  // 3) 큰 주제 번호는 남은 큰 주제 다음부터. 곁가지가 잡아먹던 번호를 돌려받는다
  const roots = Object.values(byTopic).filter(t => !t.parent).map(t => Number.parseInt(t.id, 10))
  const map = (k: string) => keyToId.get(k) ?? idOf.get(Number.parseInt(k, 10))
  return {
    ...all,
    byTopic,
    current: map(all.current) ?? Object.keys(byTopic)[0] ?? '',
    nextNo: roots.length > 0 ? Math.max(...roots) + 1 : 1,
    collapsed: all.collapsed.map(map).filter((k): k is string => !!k),
    kept: all.kept.map(map).filter((k): k is string => !!k),
  }
}

/**
 * 주제 하나를 뺀 상태. 큰 주제가 하나도 안 남으면 번호를 1 로 되돌린다.
 *
 * 번호를 다시 쓰지 않는 건 남은 주제와 겹치지 않게 하려는 것이다. 남은 게 없으면 겹칠
 * 것도 없다 — 다 지웠는데 다음 주제가 7번으로 시작하면 왜 7인지 묻게 된다(2026-10-13).
 */
export const without = (all: Trails, key: string): Trails => {
  // 곁가지는 그 주제의 일부다. 부모만 지우면 갈 곳 없는 곁가지가 맨 위로 떠오른다
  const gone = new Set([key])
  let grew = true
  while (grew) {
    grew = false
    for (const t of Object.values(all.byTopic)) {
      if (t.parent && gone.has(t.parent.id) && !gone.has(t.id)) {
        gone.add(t.id)
        grew = true
      }
    }
  }
  const rest = { ...all.byTopic }
  for (const k of gone) delete rest[k]
  const empty = Object.keys(rest).length === 0

  // 지운 것이 지금 보던 곁가지면 부모로 돌아간다. 엉뚱한 첫 주제로 튀면 길을 잃는다
  const parentId = all.byTopic[key]?.parent?.id
  const back = parentId !== undefined && rest[parentId] ? parentId : (Object.keys(rest)[0] ?? '')
  return {
    ...all,
    byTopic: rest,
    current: gone.has(all.current) ? back : all.current,
    nextNo: empty ? 1 : all.nextNo,
    collapsed: all.collapsed.filter(k => !gone.has(k)),
    kept: all.kept.filter(k => !gone.has(k)),
  }
}

/** 곁가지를 따라 올라가 맨 위 주제를 찾는다 */
export const rootOf = (all: Trails, t: Trail): Trail => {
  let at = t
  const seen = new Set<string>()
  while (at.parent && !seen.has(at.id)) {
    seen.add(at.id)
    const up = all.byTopic[at.parent.id]
    if (!up) break
    at = up
  }
  return at
}

/** 이 주제의 이 항목에서 갈라진 곁가지들 */
const childrenAt = (all: Trails, id: string, at: number): Trail[] =>
  Object.values(all.byTopic)
    .filter(t => t.parent?.id === id && t.parent.at === at)
    .sort(byId)

/** 이 길이를 넘는 제목은 경로에서 줄인다. 마지막(지금) 주제만 다 적는다 */
const CRUMB_TITLE = 12

/**
 * 맨 위 주제부터 지금 주제까지의 경로 — `2. nginx와 리버스 프… › 2a. 톰캣은 왜 리버스 프록시가 안 되나`.
 *
 * 네 단계를 넘으면 가운데를 `…` 로 줄인다. 맨 위(무슨 얘기였나)와 끝 둘(어디서 왔고
 * 지금 어디인가)이 남으면 길을 잃지 않는다.
 */
export const crumbOf = (all: Trails, t: Trail): string => {
  const chain: Trail[] = []
  for (let at: Trail | undefined = t; at; at = at.parent ? all.byTopic[at.parent.id] : undefined) {
    if (chain.includes(at)) break
    chain.unshift(at)
  }
  const short = (x: Trail) =>
    x === t || x.title.length <= CRUMB_TITLE ? `${x.id}. ${x.title}` : `${x.id}. ${x.title.slice(0, CRUMB_TITLE)}…`
  const parts = chain.map(short)
  return (parts.length > 4 ? [parts[0], '…', ...parts.slice(-2)] : parts).join(' › ')
}

/**
 * 상태줄 한 줄 — 패널을 닫아 두어도 지금 어디인지 보인다. 꺼져 있거나 목차가 없으면 지운다.
 * 곁가지 이름(2a)에 이미 어디서 왔는지가 들어 있어 경로를 따로 적지 않는다.
 */
export const statusOf = (all: Trails): string | undefined => {
  const cur = all.byTopic[all.current]
  if (!all.on || !cur) return undefined
  const where = cur.cursor >= 0 ? `.${cur.cursor + 1}` : ''
  return `학습 ${cur.id}${where}`
}

/** 곁가지면 어디서 갈라졌는지 한마디. 맨 위 주제면 빈 문자열 */
const fromOf = (t: Trail): string => (t.parent ? ` (${t.parent.id}.${t.parent.at + 1} 의 곁가지)` : '')

/** 지금 보고 있는 주제. 없으면 undefined */
const currentOf = (all: Trails): Trail | undefined => all.byTopic[all.current]

/**
 * 항목 번호 묶음을 읽는다 — `3` · `1,3,5` · `2-4` · `1,3-5`.
 *
 * @returns 0부터 센 번호를 오름차순·중복 없이. 읽을 수 없는 조각이 있으면 undefined —
 *          읽히는 것만 골라 보여 주면 빠진 줄 모르고 그게 전부인 줄 안다
 */
export const parsePicks = (spec: string): number[] | undefined => {
  const picks = new Set<number>()
  for (const part of spec.split(',')) {
    const one = part.match(/^(\d+)$/)
    const range = part.match(/^(\d+)-(\d+)$/)
    if (one) {
      picks.add(Number.parseInt(one[1] ?? '', 10) - 1)
    } else if (range) {
      const from = Number.parseInt(range[1] ?? '', 10)
      const to = Number.parseInt(range[2] ?? '', 10)
      if (from > to) return undefined
      for (let n = from; n <= to; n++) picks.add(n - 1)
    } else {
      return undefined
    }
  }
  return [...picks].sort((a, b) => a - b)
}

type RecallArgs = { topic?: string; name?: string; picks?: number[]; bad?: string }

/**
 * `/recall` 뒤에 적은 것을 읽는다.
 *
 * `2` 는 2번 주제 전체, `2.3` 은 2번 주제의 3번, `2.1,3` · `2.2-4` 는 여러 항목,
 * `2a` · `2a.3` 은 2번에서 갈라진 곁가지 전체 · 그 3번,
 * `hikari` 는 이름으로 찾은 주제 전체, `hikari 3` 은 그 주제의 3번. 사람이 보는 번호는
 * 1부터, 안에서는 0부터다.
 *
 * 맨 숫자 하나는 주제 번호다. 예전에는 "지금 주제의 항목" 이었는데, 패널에 `1.3` 처럼
 * 주제.항목으로 찍히니 `/recall 3` 이 3번 주제인지 3번 항목인지 헷갈렸다(2026-10-13).
 * 이름과 함께 오거나 `1,3` 처럼 묶음이면 항목이다 — 그때는 헷갈릴 게 없다.
 */
export const parseArgs = (args: string): RecallArgs => {
  const out: RecallArgs = {}
  let bare: string | undefined
  let spec: string | undefined
  for (const w of args.trim().split(/\s+/).filter(Boolean)) {
    const dotted = w.toLowerCase().match(/^(\d+[a-z]*)\.(.*)$/)
    if (dotted) {
      out.topic = dotted[1] ?? ''
      if (dotted[2]) spec = dotted[2]
      continue
    }
    // 곁가지 이름(2a)은 숫자로 시작해도 항목 번호일 수 없다 — 바로 주제다
    if (/^\d+[a-z]+$/i.test(w)) {
      out.topic = w.toLowerCase()
      continue
    }
    if (/^\d+$/.test(w)) {
      bare = w
      continue
    }
    if (/^[\d,-]+$/.test(w)) {
      spec = w
      continue
    }
    out.name = w.toLowerCase()
  }

  if (bare !== undefined) {
    if (out.topic !== undefined || out.name !== undefined) spec = bare
    else out.topic = bare
  }
  if (spec !== undefined) {
    const picks = parsePicks(spec)
    if (picks) out.picks = picks
    else out.bad = spec
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
  const head = `${t.title}${fromOf(t)} — ${i + 1}. ${t.items[i]}`
  const saved = t.notes?.[String(i)]
  return saved ? `${head}\n\n${saved}` : `${head}\n\n(이 항목은 아직 설명이 저장되지 않았습니다.)`
}

/**
 * 여러 항목을 한 번에 — `/recall 1` 이면 전체, `/recall 1.1,3` 이면 고른 것만.
 *
 * 번호는 이미 범위를 확인하고 들어온다. 저장 안 된 항목도 빼지 않고 그렇다고 적는다 —
 * 빠져 있으면 원래 없던 항목인 줄 안다.
 */
const recallManyText = (t: Trail, picks: number[]): string => {
  const whole = picks.length === t.items.length
  const head = whole
    ? `${t.title}${fromOf(t)} — 전체 ${t.items.length}개`
    : `${t.title}${fromOf(t)} — ${picks.map(i => i + 1).join(', ')}번`
  const parts = picks.map(i => {
    const saved = t.notes?.[String(i)]
    return `${i + 1}. ${t.items[i]}\n\n${saved || '(이 항목은 아직 설명이 저장되지 않았습니다.)'}`
  })
  return [head, ...parts].join('\n\n---\n\n')
}

/** 목차를 새로 깔면 그 주제의 진행 상태는 초기화된다 — 반쯤 남은 표시가 섞이면 더 헷갈린다 */
const startTrail = (title: string, id: string, items: string[]): Trail => ({
  title,
  id,
  slug: slugOf(title),
  items,
  cursor: items.length > 0 ? 0 : -1,
  done: [],
  notes: {},
  touchedAt: Date.now(),
})

/** 지금 항목을 끝낸 것으로 치고 다음으로 */
const advance = (t: Trail): Trail => {
  if (t.cursor < 0) return t
  const done = t.done.includes(t.cursor) ? t.done : [...t.done, t.cursor]
  const next = t.cursor + 1
  return { ...t, done, cursor: next < t.items.length ? next : -1 }
}

/**
 * 오래 손 안 댔고 아직 "두기" 를 고르지 않은 주제들.
 *
 * 주제는 번호로 가리킨다(kept · current 둘 다 번호 문자열). 주소를 이름에서 번호로 바꿀 때
 * 여기만 이름(slug)으로 비교하던 것이 남아, "두기" 를 눌러도 계속 묻고 지금 보는 주제까지
 * 묵은 목록에 떴다.
 */
export const staleOf = (all: Trails, now: number = Date.now()): Trail[] => {
  const line = now - STALE_DAYS * DAY
  return Object.values(all.byTopic).filter(
    // 곁가지는 묻지 않는다. 지우면 그 주제와 함께 지워진다
    t => !t.parent && t.touchedAt < line && !all.kept.includes(t.id) && t.id !== all.current,
  )
}

/**
 * 한 번에 쓴 답을 번호 머리말로 잘라 항목별 본문으로 나눈다.
 *
 * 처음에는 항목마다 도구(focus)를 부르게 했다. 그러면 답이 도구 호출 사이로 여덟 토막이
 * 나고, 모델은 그 틈에 본문 대신 "~를 정리했어요, 다음으로 넘어갈게요" 한 줄만 남겼다
 * (2026-10-13 실제 화면 — 1~7번이 전부 한 줄 요약, 8번만 본문). 설명이 화면에 안 남았다.
 *
 * 그래서 답은 한 번에 끝까지 쓰게 하고, 여기서 `## 1. …` · `**2. …**` · `3. …` 같은
 * 머리말을 찾아 자른다. 머리말 줄부터 다음 머리말 직전까지가 그 항목의 본문이다.
 * 목차 범위 밖 번호(본문 속 번호 매긴 목록 등)는 머리말로 치지 않는다.
 *
 * @returns 항목 번호(0부터) → 본문. 머리말을 둘 이상 못 찾으면 빈 맵이다 — 한 덩어리 답은
 *          쪼갤 근거가 없으니 지금 항목 하나에 담는 쪽으로 돌린다
 */
export const splitSections = (text: string, itemCount: number): Map<number, string> => {
  const lines = text.split('\n')

  // 표시가 붙은 머리말("## 3." · "**3.**")을 먼저 믿는다. 표시 없는 "3." 는 본문 속 번호
  // 목록과 구별이 안 된다 — "1. 정합성 / 2. 확장성" 같은 목록의 2 가 다음 항목 머리말 자리에
  // 맞아 떨어지면 항목이 엉뚱하게 잘린다. 표시 있는 머리말이 없을 때만 맨 번호로 자른다
  const marked = /^\s*(?:#{1,4}\s*(?:\*\*)?|\*\*)\s*(\d{1,2})[.)]\s+\S/
  const plain = /^\s*(\d{1,2})[.)]\s+\S/

  const find = (head: RegExp) => {
    const starts: { line: number; idx: number }[] = []
    let expect = 1
    lines.forEach((line, n) => {
      const m = line.match(head)
      if (!m) return
      const no = Number.parseInt(m[1] ?? '', 10)
      // 머리말은 1, 2, 3 … 순서로 나온다. 순서를 벗어난 번호는 머리말이 아니다
      if (no === expect && no <= itemCount) {
        starts.push({ line: n, idx: no - 1 })
        expect += 1
      }
    })
    return starts
  }

  const markedStarts = find(marked)
  const starts = markedStarts.length >= 2 ? markedStarts : find(plain)

  const out = new Map<number, string>()
  if (starts.length < 2) return out
  starts.forEach((st, k) => {
    const end = k + 1 < starts.length ? (starts[k + 1]?.line ?? lines.length) : lines.length
    const body = lines.slice(st.line, end).join('\n').trim()
    if (body !== '') out.set(st.idx, body)
  })
  return out
}

/**
 * 모델의 답을 지금 항목의 본문으로 담아도 되는가.
 *
 * 곁가지에 들어가 있으면 지금 주제가 그 곁가지다. 답은 곁가지 본문으로 담기고 부모 항목은
 * 건드리지 않는다. 예전에는 부모를 덮어쓸까 봐 곁가지 답을 아예 버렸다(2026-10-14).
 *
 * 이번 턴에 도구를 안 불렀으면(`armed` 가 아니면) 담지 않는다. 그 답은 목차와 상관없는
 * 대화다 — `/recall 1.1` 로 커서를 1번에 옮긴 뒤 다른 얘기를 하니, 그 답이 1번 본문을
 * 덮어썼다(2026-10-13).
 */
export const captureTarget = (all: Trails, armed: boolean): Trail | undefined => {
  if (!all.on || !armed) return undefined
  const cur = all.byTopic[all.current]
  if (!cur || cur.cursor < 0) return undefined
  return cur
}

/** 며칠 전인지 — 사람이 읽는 말로 */
const agoOf = (at: number): string => {
  const days = Math.floor((Date.now() - at) / DAY)
  return days >= 1 ? `${days}일 전` : '오늘'
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const dir = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? `${(await $.env.get('HOME')) ?? ''}/.claude`
      focusKey = focusKeyOf(JSON.parse(await $.fs.read(`${dir}/keybindings.json`)))
    } catch {
      // 파일이 없거나 못 읽으면 기본 키 그대로
    }
    await $.command.register({
      name: 'trail',
      description: '학습 경로 패널을 열고 쌓기 시작한다 (close 닫기 · off 그만 · drop N 지움)',
    })
    await $.command.register({
      name: 'recall',
      description: '지난 설명을 그대로 다시 본다 — /recall 1.2 (패널에 찍힌 번호)',
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
            description: 'set 일 때 목차 항목들 (순서가 번호). push 일 때는 곁가지 답이 여러 항목이면 그 목차',
          },
          index: { type: 'number', description: 'focus 일 때 항목 번호 (1부터)' },
          label: { type: 'string', description: 'push 일 때 곁가지 질문 한 줄 (곁가지 제목이 된다)' },
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
            '설명을 여러 항목으로 나눠 답할 때는 trail 도구로 목차를 남긴다.',
            '1) 답을 쓰기 전에 trail 의 set 을 한 번 불러 목차를 깐다.',
            '2) 그다음 답은 한 번에 끝까지 쓴다. 항목 사이에 도구를 부르지 않는다 —',
            '   부르면 답이 토막 나 설명이 화면에 온전히 남지 않는다.',
            '3) 각 항목은 "## 1. 제목" 처럼 번호 머리말로 시작한다. 그 머리말로 항목이 나뉘어 저장된다.',
            '4) 각 항목은 요약이 아니라 실제 설명을 쓴다. "정리했다" 같은 한 줄로 넘기지 않는다.',
            '5) 중간에 멈추고 "다음으로 넘어갈까요?" 묻지 않는다. 사람이 "다음" 이라고 해야 넘어가는 게 아니라',
            '   목차 끝까지 한 번에 이어서 쓴다. 더 파고들지는 사람이 다 읽고 정한다.',
            '6) 이미 깐 목차의 한 항목을 다시·더 설명할 때는 focus 로 그 항목을 짚은 뒤 쓴다.',
            '   trail 을 부르지 않은 턴의 답은 저장되지 않는다.',
            '사람이 중간에 다른 걸 물어 곁가지로 빠질 때는 답을 쓰기 전에 push, 그 답을 마치면 pop 을 부른다.',
            '   곁가지 답이 여러 항목이면 push 에 items 도 넘기고 각 항목을 "## 1. 제목" 으로 쓴다.',
            '   한 덩어리면 label 만 넘긴다. pop 뒤에 쓴 말은 저장되지 않는다.',
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
      // 사람이 새로 말을 걸면 새 턴이다. 이 턴의 답은 도구를 다시 불러야 본문이 된다
      if (e.door === 'prompt') {
        await update($, armed, () => false)
        return result
      }
      // 모델이 쓴 답만. 사람의 말·도구 결과·알림은 본문이 아니다.
      // 하위 에이전트의 답도 아니다 — 그건 사람에게 한 설명이 아니다
      if (e.door !== 'response' || e.agentId) return result

      const text = (e.message?.content ?? [])
        .map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : ''))
        .filter(Boolean)
        .join('\n')
        .trim()
      // 한두 줄짜리 맞장구는 본문이 아니다
      if (text.length < 120) return result

      const all = await read($, trails)
      const cur = captureTarget(all, await read($, armed))
      if (!cur) return result

      // 한 번에 쓴 답이면 머리말로 잘라 번호마다 담는다
      const sections = splitSections(text, cur.items.length)
      if (sections.size >= 2) {
        const notes = { ...cur.notes }
        sections.forEach((body, idx) => {
          notes[String(idx)] = body
        })
        const written = [...sections.keys()].sort((a, b) => a - b)
        const last = written[written.length - 1] ?? cur.cursor
        await save($, {
          ...all,
          byTopic: {
            ...all.byTopic,
            [cur.id]: touch({
              ...cur,
              notes,
              // 쓴 항목은 끝낸 것으로, 마지막으로 쓴 곳을 "지금" 으로 둔다
              done: [...new Set([...cur.done, ...written.slice(0, -1)])],
              cursor: last,
            }),
          },
        })
        return result
      }

      // 머리말이 없는 한 덩어리 답 — 지금 항목 하나에 담는다.
      // 한 항목에 여러 번 답할 수 있다. 마지막 것이 가장 다듬어진 글이다
      await save($, {
        ...all,
        byTopic: {
          ...all.byTopic,
          [cur.id]: touch({
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
        // 다 지웠으면 1번부터 다시 센다. 번호를 안 되살리는 건 남은 주제와 겹치지 않게
        // 하려는 것인데, 남은 게 없으면 겹칠 것도 없다. 켜짐 상태는 그대로 둔다
        await save($, { ...EMPTY, on: all.on })
        return { text: '주제를 전부 지웠습니다. 다음 주제는 1번부터 시작합니다.' }
      }

      // 번호를 안 주면 지금 주제. 가장 흔한 경우다
      const key = what === '' ? all.current : what
      const gone = all.byTopic[key]
      if (!gone) return { text: `${key || '지금'} 주제가 없습니다.` }

      await save($, without(all, key))
      return { text: `${gone.id}. ${gone.title} — 지웠습니다.` }
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
    const { topic, name, picks, bad } = parseArgs(e.args ?? '')

    if (bad !== undefined) {
      return { text: `"${bad}" 은 읽을 수 없습니다. 예: /recall 1 · 1.2 · 1.1,3 · 1.2-4` }
    }

    const list = () =>
      Object.values(all.byTopic)
        .sort(byId)
        .map(x => `${x.id}. ${x.title}${fromOf(x)}  (/recall ${x.id}.1)`)

    let t = currentOf(all)
    if (topic !== undefined) {
      t = all.byTopic[topic]
      if (!t) {
        return { text: `${topic}${/^\d+$/.test(topic) ? '번' : ''} 주제가 없습니다.\n\n들고 있는 것:\n- ${list().join('\n- ')}` }
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

    // 없는 번호면 그렇다고 말한다. 조용히 다른 항목을 보여 주면 그게 맞는 글인 줄 안다
    const missing = (picks ?? []).filter(i => i < 0 || i >= t.items.length)
    if (missing.length > 0) {
      const nos = missing.map(i => i + 1).join(', ')
      return { text: `${t.id}번 주제에는 ${nos}번 항목이 없습니다 (1 ~ ${t.items.length}).` }
    }

    // 주제만 짚으면 전체다. 아무것도 안 짚으면 지금 자리 하나
    const named = topic !== undefined || name !== undefined
    const want = picks ?? (named ? t.items.map((_, i) => i) : undefined)

    // 여럿을 보여 줄 때는 패널의 "지금" 을 그대로 둔다. 어느 하나로 옮길 근거가 없다
    if (want && want.length > 1) {
      await save($, { ...all, current: t.id, byTopic: { ...all.byTopic, [t.id]: touch(t) } })
      return { text: recallManyText(t, want) }
    }

    // 부른 자리로 패널의 "지금" 도 옮긴다. 보여 준 것과 패널이 다르면 그게 더 헷갈린다.
    // 위치와 글은 같은 번호에서 나와야 한다
    const i = want?.[0] ?? t.cursor
    await save($, {
      ...all,
      current: t.id,
      byTopic: { ...all.byTopic, [t.id]: touch({ ...t, cursor: i }) },
    })
    return { text: recallText(t, i) }
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
        return { result: '학습 경로가 꺼져 있다 (/trail 로 켠다)', text: '학습 경로가 꺼져 있다 (/trail 로 켠다)' }
      }
      const cur = currentOf(all)

      /** 그 주제를 지금 주제로 세우고 저장할 모양을 만든다 */
      const put = (t: Trail): Trails => ({
        ...all,
        current: t.id,
        byTopic: { ...all.byTopic, [t.id]: touch(t) },
      })

      switch (input.action) {
        case 'set': {
          const title = input.title ?? ''
          const items = input.items ?? []
          const no = all.nextNo
          line = `목차 ${items.length}개 — ${title} (/recall ${no}.1)`
          await save($, {
            ...put(startTrail(title, String(no), items)),
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
          line = `본문 저장 (/recall ${cur.id}.${i + 1})`
          await save($, put({ ...cur, notes: { ...cur.notes, [String(i)]: input.text ?? '' } }))
          break
        }
        case 'push': {
          if (!cur) {
            line = '목차가 없다'
            break
          }
          // 곁가지도 주제 하나다. 목차를 안 주면 질문 한 줄이 한 칸짜리 목차가 된다
          const label = input.label ?? '곁가지'
          const items = input.items && input.items.length > 0 ? input.items : [label]
          // 큰 주제 번호는 건드리지 않는다. 곁가지는 부모 이름 뒤 빈 글자를 받는다
          const id = nextBranchId(all, cur.id)
          if (!id) {
            line = `${cur.id} 의 곁가지가 26개를 넘었다 — 하나를 지우거나 새 주제로 연다`
            break
          }
          const at = Math.max(0, cur.cursor)
          line = `곁가지 열림 — ${label} (/recall ${id})`
          await save($, put({ ...startTrail(label, id, items), parent: { id: cur.id, at } }))
          break
        }
        case 'pop': {
          const up = cur?.parent ? all.byTopic[cur.parent.id] : undefined
          if (!cur || !up) {
            line = '닫을 곁가지 없음'
            break
          }
          // 곁가지는 지우지 않는다. 지금 자리만 부모로 돌린다 — 나중에 /recall 로 다시 본다
          line = `곁가지 닫음 — ${cur.title} (/recall ${cur.id})`
          await save($, put(up))
          await update($, armed, () => false)
          break
        }
        case 'clear': {
          if (!cur) {
            line = '지울 것 없음'
            break
          }
          line = `"${cur.title}" 지움`
          await save($, without(all, cur.id))
          break
        }
        default: {
          line = `모르는 action: ${input.action}`
        }
      }

      // 목차를 깔거나 항목을 옮긴 턴이다 — 이 턴의 답은 그 항목의 본문이다
      if (ARMING.includes(input.action ?? '')) await update($, armed, () => true)
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
    // 곁가지는 지금 주제 안에 한 줄씩 그려진다. 아래 목록에는 맨 위 주제만 둔다
    const top = cur ? rootOf(all, cur) : undefined
    const others = Object.values(all.byTopic)
      .filter(t => !t.parent && t.id !== top?.id)
      .sort(byId)

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
      await save($, without(await read($, trails), key))
    }

    const folded = cur ? all.collapsed.includes(cur.id) : false

    /** 그 주제로 옮긴다 */
    const go = async (id: string) => {
      const now = await read($, trails)
      await save($, { ...now, current: id })
    }

    /** 접거나 편다 */
    const fold = async (key: string) => {
      const now = await read($, trails)
      const was = now.collapsed.includes(key)
      await save($, {
        ...now,
        collapsed: was ? now.collapsed.filter(k => k !== key) : [...now.collapsed, key],
      })
    }

    const up = cur?.parent ? all.byTopic[cur.parent.id] : undefined

    return (
      <Box flexDirection="column">
        {cur && (
          <Box flexDirection="column">
            {/* 지금 있는 목차 하나만 그린다. 부모와 곁가지를 같이 펼치면 한 단계 들어갈
                때마다 패널이 길어지고 들여쓰기만큼 글이 잘렸다(2026-10-14). 어디서 왔는지는
                머리줄 경로가 말한다 — 몇 단계를 들어가도 패널 모양은 같다.
                주제·곁가지·돌아가기 줄만 누를 수 있다. 항목은 글로 둔다 — 눌러 봐야 본문을
                띄울 길이 없다(버튼에서 대화에 글을 넣지 못한다). 본문은 /recall 로 받는다 */}
            <Box>
              <Button
                key={`fold-${cur.id}`}
                plain
                autoFocus
                label={`${folded ? '▸' : '▾'} ${crumbOf(all, cur)}`}
                onPress={() => fold(cur.id)}
              />
              <Button
                key={`x-${cur.id}`}
                plain
                dimColor
                label="  ✕"
                onPress={() => drop(cur.id)}
              />
            </Box>

            {!folded &&
              cur.items.flatMap((item, i) => {
                const isNow = i === cur.cursor
                const isDone = cur.done.includes(i)
                const mark = isDone ? '✓' : isNow ? '▸' : ' '
                // 점(●)은 "본문이 저장돼 있다" — /recall 로 꺼낼 것이 있다는 표시다
                const dot = cur.notes?.[String(i)] ? '  ●' : ''
                const row = (
                  <Text key={`i-${cur.id}-${i}`} dimColor={isDone && !isNow}>
                    {`${mark} ${cur.id}.${i + 1} ${item}${dot}${isNow ? '  ← 지금' : ''}`}
                  </Text>
                )
                // 여기서 갈라진 곁가지는 제목 한 줄씩만. 펼치지 않는다 — 들어가서 본다
                const kids = childrenAt(all, cur.id, i).map(c => (
                  <Button
                    key={`b-${c.id}`}
                    plain
                    dimColor
                    label={`    ↳ ${c.id}. ${c.title}${c.items.length > 1 ? ` (${c.items.length})` : ''}`}
                    onPress={() => go(c.id)}
                  />
                ))
                return [row, ...kids]
              })}

            {!folded && up && (
              <Button
                key={`up-${up.id}`}
                plain
                dimColor
                label={`↰ ${up.id}.${(cur.parent?.at ?? 0) + 1} 로 돌아가기`}
                onPress={() => go(up.id)}
              />
            )}
          </Box>
        )}

        {/* 오래 묵은 주제는 한 번 묻는다. 안 물으면 패널이 길어지기만 한다.
            "두기" 를 고르면 다시 묻지 않는다 — 켤 때마다 같은 걸 물으면 그게 성가시다 */}
        {stale.length > 0 && (
          <Box flexDirection="column" paddingTop={1}>
            <Text dimColor>{`${STALE_DAYS}일 넘게 안 본 주제 — 지울까요?`}</Text>
            {stale.map(t => (
              <Box key={`stale-${t.id}`}>
                <Button
                  key={`drop-${t.id}`}
                  plain
                  label={`  ✕ ${t.id}. ${t.title} (${agoOf(t.touchedAt)})`}
                  onPress={() => drop(t.id)}
                />
                <Button
                  key={`keep-${t.id}`}
                  plain
                  dimColor
                  label="   두기"
                  onPress={async () => {
                    const now = await read($, trails)
                    await save($, { ...now, kept: [...now.kept, t.id] })
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
              <Box key={`row-${t.id}`}>
                <Button
                  key={`go-${t.id}`}
                  plain
                  dimColor
                  label={`▸ ${t.id}. ${t.title}`}
                  onPress={() => go(t.id)}
                />
                <Button
                  key={`gx-${t.id}`}
                  plain
                  dimColor
                  label="  ✕"
                  onPress={() => drop(t.id)}
                />
              </Box>
            ))}
          </Box>
        )}

        {/* 쓸 수 있는 말을 상자에 모은다. 목차 줄들과 섞여 흐르면 안내인지 항목인지
            구분이 안 된다 — 테두리가 그 경계를 긋는다 */}
        {/* 명령과 설명을 두 칸으로 나눈다. 공백으로 줄을 맞추면 한글·"—"·"·" 의 폭을
            사람이 세야 하는데, 터미널마다 달라 어긋났다(2026-10-13). 왼쪽 칸 폭을 고정해
            엔진이 재게 한다.
            명령(영문)을 왼쪽에 둔다. 설명을 왼쪽에 두니 오른쪽 칸이 "/" 로 시작하는 줄과
            한글로 시작하는 줄이 섞였고, 칸은 맞아도 글자 모양 탓에 한글 줄이 한 칸 당겨져
            보였다. 오른쪽 칸을 전부 한글로 시작하게 하면 그런 줄이 없다 */}
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1} marginTop={1}>
          <Text dimColor>{all.on ? '쌓는 중' : '멈춤'}</Text>
          {[
            all.on ? ['/trail off', '그만 쌓기'] : ['/trail', '다시 쌓기'],
            ['/recall 1.2', '설명 하나 받기'],
            ['/recall 1', '주제 전체 받기'],
            ['/recall 1.1,3  1.2-4', '여러 항목 · 범위'],
            ['/trail drop 1', '주제 지우기'],
            ['/trail close', '패널 닫기'],
            [focusKey, '패널로 들어오기'],
            ['Enter', '주제 접기 · 펴기 · 바꾸기'],
          ].map(([how, what]) => (
            <Box key={how} flexDirection="row">
              <Box width={HELP_HOW} flexShrink={0}>
                <Text dimColor>{how}</Text>
              </Box>
              <Text dimColor>{what}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })
}

/** 설명 한 묶음 — 목차와 지금 어디인지, 그리고 곁가지 스택 */
export type Trail = {
  /** 설명 전체의 제목 (예: "Hikari 커넥션 풀") */
  title: string
  /**
   * 주제를 부르는 짧은 이름. 제목에서 뽑는다 — "Hikari 커넥션 풀" 이면 `hikari`.
   *
   * `/recall hikari 1` 의 그 `hikari` 다. 번호만 외우게 하면 주제가 여럿일 때
   * 무슨 번호였는지 알 수 없다.
   */
  slug: string
  /** 목차 항목들. 순서가 곧 번호다 */
  items: string[]
  /** 지금 설명 중인 항목 (0부터). 아직 안 들어갔으면 -1 */
  cursor: number
  /** 끝낸 항목 번호들 */
  done: number[]
  /**
   * 항목별 본문 — 설명을 끝낼 때 그 글을 그대로 남긴다.
   * 나중에 그 번호를 부르면 다시 쓰지 않고 이걸 꺼낸다. 다시 쓰면 말이 달라진다.
   * 키는 항목 번호(0부터)를 문자열로 쓴다.
   */
  notes: Record<string, string>
  /**
   * 곁가지 — 설명 도중 "그건 뭔데요?" 로 파생된 질문들.
   * 쌓인 순서대로 들어가고, 답하면 뒤에서부터 빠진다.
   */
  branches: string[]
  /** 마지막으로 손댄 때 (epoch ms). 오래된 주제를 골라내는 기준 */
  touchedAt: number
}

/**
 * 들고 있는 주제 전부.
 *
 * 하나만 들고 있으면 새 설명이 시작될 때마다 지난 것이 날아간다. 이 mod 의 쓸모가
 * "나중에 다시 보기" 라서 그건 반쪽이다 — 주제별로 따로 둔다.
 */
export type Trails = {
  /** slug → 그 주제의 목차 */
  byTopic: Record<string, Trail>
  /** 지금 보고 있는 주제의 slug. 없으면 빈 문자열 */
  current: string
  /** 목차를 접어 둔 주제들의 slug — 제목만 남기고 항목을 숨긴다 */
  collapsed: string[]
  /**
   * 오래됐다고 물어본 주제들의 slug.
   *
   * 한 번 "두기" 를 고르면 다시 묻지 않는다. 켤 때마다 같은 것을 물으면 그게 더 성가시다.
   */
  kept: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'learn-trail': { trails: Trails }
  }
}

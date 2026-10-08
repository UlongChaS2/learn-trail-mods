/** 설명 한 묶음 — 목차와 지금 어디인지, 그리고 곁가지 스택 */
export type Trail = {
  /** 설명 전체의 제목 (예: "데이터 접근 계층") */
  title: string
  /** 목차 항목들. 순서가 곧 번호다 */
  items: string[]
  /** 지금 설명 중인 항목 (0부터). 아직 안 들어갔으면 -1 */
  cursor: number
  /** 끝낸 항목 번호들 */
  done: number[]
  /**
   * 항목별 요약 — 설명을 끝낼 때 핵심 두세 줄을 남긴다.
   * 나중에 그 항목으로 돌아오면 다시 설명하지 않아도 이게 뜬다.
   * 키는 항목 번호(0부터)를 문자열로 쓴다.
   */
  notes: Record<string, string>
  /**
   * 곁가지 — 설명 도중 "그건 뭔데요?" 로 파생된 질문들.
   * 쌓인 순서대로 들어가고, 답하면 뒤에서부터 빠진다.
   */
  branches: string[]
}

declare module 'claude-code' {
  interface PluginState {
    'learn-trail': { trail: Trail }
  }
}

export function createCommunityPostPageGate() {
  let generation = 0;
  let pending = false;
  let ready = false;

  return {
    refresh() {
      generation += 1;
      pending = false;
      ready = false;
    },
    activate() {
      ready = true;
    },
    begin(): number | null {
      if (!ready || pending) return null;
      pending = true;
      return generation;
    },
    isCurrent(requestGeneration: number) {
      return requestGeneration === generation;
    },
    finish(requestGeneration: number) {
      if (requestGeneration !== generation) return false;
      pending = false;
      return true;
    },
  };
}

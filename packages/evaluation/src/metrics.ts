export interface RankedItem {
  id: string;
  rank: number;
}

export function recallAtK(relevant: string[], retrieved: string[], k: number): number {
  if (relevant.length === 0) return 0;
  const top = new Set(retrieved.slice(0, k));
  const hits = relevant.filter((id) => top.has(id)).length;
  return hits / relevant.length;
}

export function meanReciprocalRank(relevant: string[], retrieved: string[]): number {
  const relevantSet = new Set(relevant);
  const index = retrieved.findIndex((id) => relevantSet.has(id));
  if (index < 0) return 0;
  return 1 / (index + 1);
}

export function ndcgAtK(relevant: Set<string>, retrieved: string[], k: number): number {
  const dcg = retrieved.slice(0, k).reduce((sum, id, index) => {
    const gain = relevant.has(id) ? 1 : 0;
    return sum + gain / Math.log2(index + 2);
  }, 0);
  const ideal = Math.min(k, relevant.size);
  const idcg = Array.from({ length: ideal }, (_, index) => 1 / Math.log2(index + 2)).reduce((sum, value) => sum + value, 0);
  if (idcg === 0) return 0;
  return dcg / idcg;
}

export function precision(predicted: string[], truth: string[]): number {
  if (predicted.length === 0) return truth.length === 0 ? 1 : 0;
  const truthSet = new Set(truth);
  return predicted.filter((id) => truthSet.has(id)).length / predicted.length;
}

export function binaryRecall(predictedPositive: boolean, truthPositive: boolean): number {
  if (!truthPositive) return 0;
  return predictedPositive ? 1 : 0;
}

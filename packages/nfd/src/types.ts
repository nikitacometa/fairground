/** A resolved, forward-verified NFD (Algorand name service) identity. */
export interface NfdRecord {
  /** Full NFD name including the `.algo` suffix, e.g. `goanna.algo`. */
  name: string;
  /** The Algorand address this record was resolved for. */
  address: string;
  /** Always true — only forward-verified matches (address ∈ caAlgo[]) are surfaced. */
  verified: boolean;
  /** Optional avatar image URL (only present in thumbnail/full views). */
  avatar?: string;
}

import { BlocklistEntry, ClientName, DuplicateGroup } from '../types/blocklist';

/**
 * Analyzes entries to find duplicate IPs (both within the same client and cross-client)
 */
export function analyzeDuplicates(entries: BlocklistEntry[], clientFilter?: ClientName): {
  groups: DuplicateGroup[];
  totalDuplicates: number;
  sameClientDuplicatesCount: number;
  crossClientDuplicatesCount: number;
  uniqueIpCount: number;
} {
  const map = new Map<string, BlocklistEntry[]>();

  // If a client filter is applied (and not 'ALL'), we analyze entries for that client or all entries
  const listToAnalyze = clientFilter && clientFilter !== 'ALL'
    ? entries.filter(e => e.client === clientFilter)
    : entries;

  for (const entry of entries) {
    if (!entry.normalizedIp || entry.status === 'removed') continue;
    const key = entry.normalizedIp;
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key)!.push(entry);
  }

  const groups: DuplicateGroup[] = [];
  let sameClientDuplicatesCount = 0;
  let crossClientDuplicatesCount = 0;

  for (const [ipKey, list] of map.entries()) {
    // Check if relevant to filter
    if (clientFilter && clientFilter !== 'ALL') {
      const hasClient = list.some(e => e.client === clientFilter);
      if (!hasClient) continue;
    }

    const clientSet = new Set(list.map(e => e.client));
    const hasSameClient = list.length > clientSet.size;
    const isCross = clientSet.size > 1;

    if (list.length > 1) {
      if (hasSameClient) {
        sameClientDuplicatesCount += (list.length - clientSet.size);
      }
      if (isCross) {
        crossClientDuplicatesCount++;
      }

      groups.push({
        ip: list[0].ip,
        normalizedIp: ipKey,
        count: list.length,
        clients: Array.from(clientSet),
        entries: list,
        hasSameClientDuplicates: hasSameClient,
        isCrossClient: isCross
      });
    }
  }

  // Sort groups: same client duplicates first (highest count first), then cross-client
  groups.sort((a, b) => {
    if (a.hasSameClientDuplicates && !b.hasSameClientDuplicates) return -1;
    if (!a.hasSameClientDuplicates && b.hasSameClientDuplicates) return 1;
    return b.count - a.count;
  });

  const activeNonRemoved = listToAnalyze.filter(e => e.status !== 'removed');
  const uniqueIpCount = new Set(activeNonRemoved.map(e => e.normalizedIp)).size;

  return {
    groups,
    totalDuplicates: groups.length,
    sameClientDuplicatesCount,
    crossClientDuplicatesCount,
    uniqueIpCount
  };
}

/**
 * Removes internal duplicate IPs for a client or across all clients.
 * Keeps the latest or earliest entry, removes other copies.
 */
export function removeInternalDuplicates(
  entries: BlocklistEntry[],
  targetClient?: ClientName,
  keepStrategy: 'keep_oldest' | 'keep_newest' = 'keep_newest'
): {
  cleanedEntries: BlocklistEntry[];
  removedCount: number;
} {
  const seenPerClient = new Map<string, Set<string>>();
  let removedCount = 0;

  // Sort by date depending on strategy
  const sorted = [...entries].sort((a, b) => {
    const timeA = new Date(a.addedDate).getTime() || 0;
    const timeB = new Date(b.addedDate).getTime() || 0;
    return keepStrategy === 'keep_newest' ? timeB - timeA : timeA - timeB;
  });

  const kept: BlocklistEntry[] = [];

  for (const entry of sorted) {
    if (entry.status === 'removed') continue;

    // If targetClient is provided, only deduplicate that client's list
    if (targetClient && targetClient !== 'ALL' && entry.client !== targetClient) {
      kept.push(entry);
      continue;
    }

    if (!seenPerClient.has(entry.client)) {
      seenPerClient.set(entry.client, new Set());
    }

    const clientSet = seenPerClient.get(entry.client)!;
    if (clientSet.has(entry.normalizedIp)) {
      // Duplicate! skip keeping it
      removedCount++;
    } else {
      clientSet.add(entry.normalizedIp);
      kept.push(entry);
    }
  }

  return {
    cleanedEntries: kept,
    removedCount
  };
}

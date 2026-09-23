import { HANDLED_DOWNLOAD_LIMIT } from "./constants";

export interface DownloadClaim {
  claimed: boolean;
  nextIds: number[];
}

export function claimDownload(
  handledIds: readonly number[],
  downloadId: number,
  limit = HANDLED_DOWNLOAD_LIMIT,
): DownloadClaim {
  if (handledIds.includes(downloadId)) {
    return { claimed: false, nextIds: [...handledIds] };
  }
  return {
    claimed: true,
    nextIds: [downloadId, ...handledIds].slice(0, Math.max(0, limit)),
  };
}

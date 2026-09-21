import {Endpoints} from '../Endpoints'
import {findUpcomingFeature, isIntro, sameMediaId, type PlaybackContext, type TvMediaItem, type TvMediaKind} from './TvMediaSource'

export class PlaybackTimeoutError extends Error {
    constructor(kind: TvMediaKind) {
        const noun = kind === 'movie' ? 'film' : kind
        super(`The TV did not start this ${noun}. Press OK to try again.`)
        this.name = 'PlaybackTimeoutError'
    }
}

/** Snapshot before dispatch so the old stream cannot confirm a new selection. */
export function captureLocalPlaybackCheck(itemId: string, currentItemId: () => string | null): () => boolean {
    const videos = (): HTMLVideoElement[] => Array.from(document.querySelectorAll<HTMLVideoElement>('video.htmlvideoplayer'))
    const source = (video: HTMLVideoElement) => video.srcObject || video.currentSrc
    const previousSources = new Map(videos().map(video => [video, source(video)] as const))
    return () => sameMediaId(currentItemId(), itemId) && videos().some(video => {
        const currentSource = source(video)
        return !!currentSource && (!previousSources.has(video) || previousSources.get(video) !== currentSource)
            && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
            && !video.paused && !video.ended && !video.error
    })
}

/** Confirm a new local stream or the client's server report, never metadata/HTTP alone. */
export function waitForPlayback(item: Pick<TvMediaItem, 'id' | 'kind'>, signal: AbortSignal,
    previous: {id: string | null, playlistItemId?: string}, isPlayingLocally?: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false
        let pollTimer: ReturnType<typeof setTimeout> | undefined
        let localTimer: ReturnType<typeof setInterval> | undefined
        let timeout: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error): void => {
            if (settled) return
            settled = true
            clearTimeout(pollTimer)
            clearInterval(localTimer)
            clearTimeout(timeout)
            signal.removeEventListener('abort', onAbort)
            if (error) reject(error)
            else resolve()
        }
        const onAbort = (): void => finish(new Error('Playback confirmation cancelled.'))
        const check = async (): Promise<void> => {
            if (settled) return
            try {
                const context: PlaybackContext = await ApiClient.ajax({type: 'GET', dataType: 'json',
                    url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAYBACK_CONTEXT}`)})
                if (settled) return
                if (sameMediaId(context?.PlayingItemId, item.id)) { finish(); return }
                // Some clients expose the current programme instead of its channel.
                if (item.kind === 'channel' && context?.PlayingItemType === 'Program' && context.PlayingItemId) {
                    const program = await ApiClient.getItem(ApiClient.getCurrentUserId(), context.PlayingItemId)
                    if (settled) return
                    if (sameMediaId(program?.ChannelId, item.id)) { finish(); return }
                }
                // Cinema mode starts an intro before the requested feature. A
                // pre-existing intro/queue is not evidence that this play worked.
                const newPlayingItem = previous.id && context?.PlayingItemId
                    && !sameMediaId(previous.id, context.PlayingItemId)
                const newPlaylistItem = previous.playlistItemId && context?.PlaylistItemId
                    && previous.playlistItemId !== context.PlaylistItemId
                if (item.kind !== 'channel' && context?.PlayingItemId && (newPlayingItem || newPlaylistItem)
                    && isIntro({Type: context.PlayingItemType, ExtraType: context.PlayingItemExtraType})) {
                    const feature = await findUpcomingFeature(context, ApiClient.getCurrentUserId(), () => !settled)
                    if (settled) return
                    if (sameMediaId(feature.Id, item.id)) { finish(); return }
                }
            } catch {
                // The player/session can briefly disappear during a stream change.
                // Keep waiting until the deadline, which also bounds stalled requests.
            }
            if (!settled) pollTimer = setTimeout(() => { void check() }, 600)
        }

        if (signal.aborted) { onAbort(); return }
        signal.addEventListener('abort', onAbort, {once: true})
        timeout = setTimeout(() => finish(new PlaybackTimeoutError(item.kind)), 20000)
        if (isPlayingLocally) {
            const checkLocal = (): void => { if (!settled && isPlayingLocally()) finish() }
            // The TV may start playing before its session updates. Keep this
            // independent so a slow or stalled server request cannot hold the panel open.
            localTimer = setInterval(checkLocal, 100)
            checkLocal()
        }
        if (!settled) void check()
    })
}

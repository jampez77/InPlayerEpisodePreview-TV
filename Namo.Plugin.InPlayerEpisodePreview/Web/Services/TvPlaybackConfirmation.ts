import {Endpoints} from '../Endpoints'
import {findUpcomingFeature, isIntro, sameMediaId, type PlaybackContext, type TvMediaItem, type TvMediaKind} from './TvMediaSource'

export class PlaybackTimeoutError extends Error {
    constructor(kind: TvMediaKind) {
        const noun = kind === 'movie' ? 'film' : kind
        super(`The TV did not start this ${noun}. Press OK to try again.`)
        this.name = 'PlaybackTimeoutError'
    }
}

/** Wait for the client's playback report, not its OSD metadata or an HTTP acknowledgement. */
export function waitForPlayback(item: Pick<TvMediaItem, 'id' | 'kind'>, signal: AbortSignal,
    previous: {id: string | null, playlistItemId?: string}): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false
        let pollTimer: ReturnType<typeof setTimeout> | undefined
        let timeout: ReturnType<typeof setTimeout> | undefined
        const finish = (error?: Error): void => {
            if (settled) return
            settled = true
            clearTimeout(pollTimer)
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
        void check()
    })
}

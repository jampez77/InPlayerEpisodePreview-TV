import {Endpoints} from '../Endpoints'
import {sameMediaId} from './TvMediaSource'

export class ChannelPlaybackTimeoutError extends Error {
    constructor() {
        super('The TV did not start this channel. Press OK to try again.')
        this.name = 'ChannelPlaybackTimeoutError'
    }
}

/** A sent play command is not proof that the client's player started the channel. */
export function waitForChannelPlayback(channelId: string, currentItemId: () => string | null,
    signal: AbortSignal): Promise<void> {
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
        const onAbort = (): void => finish(new Error('Channel tuning cancelled.'))
        const check = async (): Promise<void> => {
            if (settled) return
            if (sameMediaId(currentItemId(), channelId)) { finish(); return }
            try {
                const context = await ApiClient.ajax({type: 'GET', dataType: 'json',
                    url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAYBACK_CONTEXT}`)})
                if (settled) return
                if (sameMediaId(context?.PlayingItemId, channelId)) { finish(); return }
                // Some clients expose the current programme instead of its channel.
                if (context?.PlayingItemType === 'Program' && context.PlayingItemId) {
                    const program = await ApiClient.getItem(ApiClient.getCurrentUserId(), context.PlayingItemId)
                    if (settled) return
                    if (sameMediaId(program?.ChannelId, channelId)) { finish(); return }
                }
            } catch {
                // The player/session can briefly disappear during a stream change.
                // Keep waiting until the deadline, which also bounds stalled requests.
            }
            if (!settled) pollTimer = setTimeout(() => { void check() }, 600)
        }

        if (signal.aborted) { onAbort(); return }
        signal.addEventListener('abort', onAbort, {once: true})
        timeout = setTimeout(() => finish(new ChannelPlaybackTimeoutError()), 20000)
        void check()
    })
}

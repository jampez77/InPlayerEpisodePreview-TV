import {TvEpisodePanel} from '../Components/TvEpisodePanel'
import {wrappedIndex} from './TvEpisodeSource'
import {TvMediaDisabledError, TvMediaUnavailableError, TvMediaSource, sameMediaId, type TvMediaItem, type TvMediaKind} from './TvMediaSource'
import {PluginSettings} from '../Models/PluginSettings'
import {Endpoints} from '../Endpoints'
import {Logger} from './Logger'
import {tryPlayChannelLocally} from './TvChannelPlayback'
import {ChannelPlaybackTimeoutError, waitForChannelPlayback} from './TvChannelPlaybackConfirmation'

export function isTvLayout(): boolean {
    return document.documentElement.classList.contains('layout-tv') || document.body.classList.contains('layout-tv')
}

export function isVideoRoute(): boolean {
    const route = window.location.hash.replace(/^#/, '') || window.location.pathname
    return /(?:^|\/)video\/?(?:\?|$)/.test(route)
}

const keyCommands: Record<string, string> = {
    ArrowDown: 'down', ArrowUp: 'up', ArrowLeft: 'left', ArrowRight: 'right',
    Enter: 'select', Escape: 'back', Backspace: 'back', BrowserBack: 'back', GoBack: 'back'
}
const remoteCodes: Record<number, string> = {
    13: 'select', 37: 'left', 38: 'up', 39: 'right', 40: 'down', 8: 'back', 27: 'back',
    461: 'back', 10009: 'back'
}

/** Owns TV media navigation; ordinary player commands pass through when closed. */
export class TvPreviewController {
    private panel: TvEpisodePanel | null = null
    private items: TvMediaItem[] = []
    private index = 0
    private nowPlayingId: string | null = null
    private playingMediaId: string | null = null
    private upcomingItemId: string | null = null
    private leavingPlayer = false
    private previousFocus: HTMLElement | null = null
    private state: 'closed' | 'loading' | 'ready' | 'error' | 'playing' = 'closed'
    private generation = 0
    private observer: MutationObserver
    private playerObserver: MutationObserver | null = null
    private readonly source = new TvMediaSource()
    private readonly heldKeys = new Set<string>()
    private playbackAbort: AbortController | null = null

    constructor(private options: {
        currentItemId: () => string | null,
        enabled: (kind: TvMediaKind) => boolean,
        settings: () => PluginSettings,
        logger: Logger
    }) {
        // Capture before Jellyfin's keyboard mapper and window-level player seek handler.
        window.addEventListener('keydown', this.onKeyDown, true)
        window.addEventListener('keyup', this.onKeyUp, true)
        window.addEventListener('command', this.onCommand, true)
        window.addEventListener('popstate', this.onViewChange)
        window.addEventListener('hashchange', this.onViewChange)
        window.addEventListener('blur', this.onBlur)
        document.addEventListener('viewshow', this.onViewChange)
        document.addEventListener('viewbeforehide', this.onViewBeforeHide, true)
        document.addEventListener('focusin', this.onFocus, true)
        document.addEventListener('pointerdown', this.onPointerDown, true)
        document.addEventListener('mousedown', this.onPointerDown, true)
        this.observer = new MutationObserver(() => this.onViewChange())
        this.observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
        this.observer.observe(document.body, {attributes: true, attributeFilter: ['class']})
    }

    private hasOtherDialog(): boolean {
        return Array.from(document.querySelectorAll<HTMLElement>(
            '.dialogContainer .dialog.opened, dialog[open], [role="dialog"][aria-modal="true"]'
        )).some(element => !this.panel?.element.contains(element) && element !== this.panel?.element
            && !element.closest('[hidden], .hide') && element.getClientRects().length > 0)
    }

    private activePlayer(): HTMLElement | null {
        const player = document.querySelector<HTMLElement>('[data-type="video-osd"]:not(.hide):not([hidden])')
        return player && !player.closest('[hidden], .hide, [aria-hidden="true"]') && player.getClientRects().length ? player : null
    }

    private isPlayerActive(): boolean {
        return !this.leavingPlayer && isTvLayout() && isVideoRoute() && !!this.activePlayer()
    }

    private canOpen(): boolean {
        return this.isPlayerActive()
            && typeof ApiClient !== 'undefined' && !!ApiClient.getCurrentUserId() && !this.hasOtherDialog()
    }

    private onViewChange = (event?: Event): void => {
        if (event?.type === 'viewshow' && (event.target as HTMLElement)?.matches?.('[data-type="video-osd"]')) this.leavingPlayer = false
        if (!this.isPlayerActive()) this.close(false)
    }

    private onViewBeforeHide = (event: Event): void => {
        const target = event.target as HTMLElement | null
        if (target?.matches?.('[data-type="video-osd"]')) {
            this.leavingPlayer = true
            this.close(false)
        }
    }

    private onBlur = (): void => { this.heldKeys.clear() }

    private onFocus = (event: FocusEvent): void => {
        if (!this.isPlayerActive()) { this.close(false); return }
        if (this.panel?.element.isConnected && !this.panel.element.contains(event.target as Node) && !this.hasOtherDialog()) this.panel.focus()
    }

    private onPointerDown = (event: Event): void => {
        // Let shared Back/Home controls receive this very click, before focus changes.
        if (this.panel && !this.panel.element.contains(event.target as Node)) this.close(false)
    }

    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        if (!this.isPlayerActive()) { this.close(false); return }
        const physicalKey = event.code || event.key || String(event.keyCode)
        // Some remotes omit keyup. A fresh press must never be treated as a held key.
        if (!event.repeat) this.heldKeys.delete(physicalKey)
        // A held Up/Back must not close the panel and then also leave the player.
        if (!this.panel && this.heldKeys.has(physicalKey)) { this.consume(event); return }
        const command = keyCommands[event.key] ?? remoteCodes[event.keyCode]
        if (command && this.handleCommand(command, event.repeat)) {
            this.heldKeys.add(physicalKey)
            this.consume(event)
        } else if (this.panel && event.key === 'Tab' && !this.hasOtherDialog()) {
            // Mouse/keyboard users can still reach each action without escaping to the OSD.
            const buttons = Array.from(this.panel.element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
                .filter(button => !button.hidden && !button.closest('[hidden]'))
            if (buttons.length) {
                const active = buttons.indexOf(document.activeElement as HTMLButtonElement)
                buttons[wrappedIndex(active, event.shiftKey ? -1 : 1, buttons.length)].focus()
            }
            this.consume(event)
        }
    }

    private onKeyUp = (event: KeyboardEvent): void => {
        if (!this.isPlayerActive()) { this.close(false); return }
        const key = event.code || event.key || String(event.keyCode)
        if (this.heldKeys.delete(key)) this.consume(event)
    }

    private onCommand = (event: Event): void => {
        const command = (event as CustomEvent<{command?: string}>).detail?.command?.toLowerCase()
        if (command && this.handleCommand(command)) this.consume(event)
    }

    private consume(event: Event): void {
        event.preventDefault()
        event.stopImmediatePropagation()
    }

    private handleCommand(command: string, repeated = false): boolean {
        if (!this.isPlayerActive()) { this.close(false); return false }
        if (this.hasOtherDialog()) return false
        const target = document.activeElement as HTMLElement | null
        if (!this.panel && target?.closest('input, textarea, select, [contenteditable="true"]')) return false
        if (!this.panel) {
            if (command !== 'down' || !this.canOpen()) return false
            if (!repeated) void this.open()
            return true
        }
        switch (command) {
            case 'up': case 'back': case 'escape':
                this.close()
                return true
            case 'left':
                this.navigate(-1)
                return true
            case 'right':
                this.navigate(1)
                return true
            case 'select': case 'enter': case 'ok':
                if (!repeated) this.panel.activateFocused()
                return true
            case 'down':
                return true
            default:
                return false
        }
    }

    async open(): Promise<void> {
        if (this.panel || !this.canOpen()) return
        this.previousFocus = document.activeElement as HTMLElement
        this.panel = new TvEpisodePanel({
            previous: () => this.navigate(-1), next: () => this.navigate(1),
            play: () => { void this.play() }, close: () => this.close()
        })
        const player = this.activePlayer()
        this.playerObserver = new MutationObserver(() => {
            const currentId = this.options.currentItemId()
            if (!this.isPlayerActive() || player !== this.activePlayer()
                || (currentId && this.nowPlayingId && !sameMediaId(currentId, this.nowPlayingId))
                || this.hasOtherDialog()) this.close(false)
        })
        this.playerObserver.observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['data-id', 'class', 'hidden', 'aria-hidden', 'style']
        })
        await this.load()
    }

    private async load(): Promise<void> {
        const generation = ++this.generation
        this.state = 'loading'
        this.panel?.showLoading()
        if (this.panel?.element.isConnected) this.panel.focus()
        try {
            let itemId = this.options.currentItemId()
            if (!itemId) {
                try {
                    const context = await ApiClient.ajax({
                        type: 'GET', url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAYBACK_CONTEXT}`), dataType: 'json'
                    })
                    itemId = context?.PlayingItemId || null
                } catch (error) {
                    const status = (error as {status?: number; statusCode?: number})?.status
                        ?? (error as {statusCode?: number})?.statusCode
                    if (status === 404) throw new TvMediaUnavailableError()
                    throw error
                }
            }
            if (!this.isCurrent(generation)) return
            if (!itemId) throw new TvMediaUnavailableError()
            this.nowPlayingId = itemId
            if (!this.isCurrent(generation)) return
            const result = await this.source.load(itemId, this.options.enabled)
            if (!this.isCurrent(generation)) return
            if (!this.options.enabled(result.kind)) { this.close(); return }
            this.items = result.items
            this.playingMediaId = result.playingItemId
            this.upcomingItemId = result.upcomingItemId || null
            this.index = result.activeIndex
            this.state = 'ready'
            this.mountPanel()
            this.render()
            this.panel?.focus()
        } catch (error) {
            if (!this.isCurrent(generation)) return
            if (error instanceof TvMediaDisabledError || error instanceof TvMediaUnavailableError) { this.close(); return }
            this.options.logger.error("Couldn't load TV media preview", error)
            this.state = 'error'
            this.mountPanel()
            this.panel?.showError(error instanceof Error ? error.message : 'Could not load the preview. Check your connection and try again.')
            this.panel?.focus()
        }
    }

    private isCurrent(generation: number): boolean {
        if (generation !== this.generation || !this.panel) return false
        const currentId = this.options.currentItemId()
        if (!this.isPlayerActive() || (currentId && this.nowPlayingId && !sameMediaId(currentId, this.nowPlayingId))) {
            this.close(false)
            return false
        }
        return true
    }

    private mountPanel(): void {
        // Resolve unsupported intro clips first, so they never flash an empty/error panel.
        if (!this.panel || this.panel.element.isConnected) return
        document.documentElement.classList.add('ipep-tv-preview-open')
        this.panel.mount()
    }

    private navigate(direction: -1 | 1): void {
        if (this.state !== 'ready' || !this.items.length) return
        const previous = this.index
        this.index = wrappedIndex(this.index, direction, this.items.length)
        const wrapped = this.items.length > 1 && (direction > 0 ? this.index < previous : this.index > previous)
        const kind = this.items[this.index].kind
        const noun = kind === 'channel' ? 'channel' : kind === 'movie' ? 'film' : 'episode'
        this.render(wrapped ? (direction > 0 ? (kind === 'movie' ? `Back to the ${this.upcomingItemId ? 'upcoming' : 'current'} film` : `Back to the first ${noun}`) : `Wrapped to the last ${noun}`) : '')
        this.panel?.focus()
    }

    private render(announcement = ''): void {
        const episode = this.items[this.index]
        if (!episode || !this.panel) return
        const settings = this.options.settings()
        const shouldBlur = episode.kind !== 'channel' && (!settings.OnlyBlurUnwatched || !episode.played)
        this.panel.showEpisode(episode, {
            previous: this.items[wrappedIndex(this.index, -1, this.items.length)],
            next: this.items[wrappedIndex(this.index, 1, this.items.length)],
            index: this.index, total: this.items.length,
            isPlaying: episode.id === this.playingMediaId, announcement,
            isUpcoming: episode.id === this.upcomingItemId,
            blurThumbnail: settings.BlurThumbnail && shouldBlur,
            blurDescription: settings.BlurDescription && shouldBlur
        })
    }

    private async play(): Promise<void> {
        if (this.state === 'error') { await this.load(); return }
        if (this.state !== 'ready') return
        const episode = this.items[this.index]
        if (episode.id === this.playingMediaId) { this.close(); return }
        const generation = this.generation
        this.state = 'playing'
        this.panel?.setPlaying(true)
        const playbackAbort = new AbortController()
        this.playbackAbort = playbackAbort
        try {
            const ticks = episode.kind === 'channel' || episode.played ? 0 : episode.playbackPositionTicks
            // Channel changes should originate in this client's player, without depending
            // on a server-to-client WebSocket command making a round trip back to the TV.
            const handledLocally = episode.kind === 'channel' && await tryPlayChannelLocally(episode.id,
                () => !playbackAbort.signal.aborted && this.isCurrent(generation))
            if (!this.isCurrent(generation)) return
            const sendPlayRequest = async (): Promise<void> => {
                await ApiClient.ajax({type: 'GET', url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAY_MEDIA}`
                    .replace('{itemId}', episode.id).replace('{ticks}', String(ticks)))})
            }
            if (episode.kind === 'channel') {
                // Start the deadline before the fallback request, which itself may stall.
                // A successful HTTP response alone must never count as a successful tune.
                const confirmation = waitForChannelPlayback(episode.id, this.options.currentItemId, playbackAbort.signal)
                await (handledLocally ? confirmation
                    : Promise.race([confirmation, sendPlayRequest().then(() => confirmation)]))
            } else await sendPlayRequest()
            if (this.isCurrent(generation)) this.close()
        } catch (error) {
            if (!this.isCurrent(generation)) return
            this.options.logger.error("Couldn't play the selected media", error)
            this.state = 'ready'
            this.panel?.setPlaying(false)
            this.render(error instanceof ChannelPlaybackTimeoutError ? error.message
                : 'Could not start playback. Press OK to try again.')
            this.panel?.focus()
        } finally {
            if (this.playbackAbort === playbackAbort) this.playbackAbort = null
            playbackAbort.abort()
        }
    }

    close(restoreFocus = true): void {
        if (!restoreFocus) this.heldKeys.clear()
        this.playbackAbort?.abort()
        this.playbackAbort = null
        if (!this.panel) return
        ++this.generation
        this.state = 'closed'
        this.playerObserver?.disconnect()
        this.playerObserver = null
        const panel = this.panel
        this.panel = null
        panel.destroy()
        this.items = []
        this.nowPlayingId = null
        this.playingMediaId = null
        this.upcomingItemId = null
        document.documentElement.classList.remove('ipep-tv-preview-open')
        if (restoreFocus && this.isPlayerActive() && this.previousFocus?.isConnected && this.previousFocus.getClientRects().length
            && !this.previousFocus.closest('[hidden], .hide')) this.previousFocus.focus({preventScroll: true})
        this.previousFocus = null
    }

    destroy(): void {
        this.close(false)
        this.observer.disconnect()
        window.removeEventListener('keydown', this.onKeyDown, true)
        window.removeEventListener('keyup', this.onKeyUp, true)
        window.removeEventListener('command', this.onCommand, true)
        window.removeEventListener('popstate', this.onViewChange)
        window.removeEventListener('hashchange', this.onViewChange)
        window.removeEventListener('blur', this.onBlur)
        document.removeEventListener('viewshow', this.onViewChange)
        document.removeEventListener('viewbeforehide', this.onViewBeforeHide, true)
        document.removeEventListener('focusin', this.onFocus, true)
        document.removeEventListener('pointerdown', this.onPointerDown, true)
        document.removeEventListener('mousedown', this.onPointerDown, true)
        this.heldKeys.clear()
    }
}

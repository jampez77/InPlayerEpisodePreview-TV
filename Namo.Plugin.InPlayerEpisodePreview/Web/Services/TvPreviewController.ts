import {TvEpisodePanel} from '../Components/TvEpisodePanel'
import {TvEpisode, TvEpisodeSource, wrappedIndex} from './TvEpisodeSource'
import {PluginSettings} from '../Models/PluginSettings'
import {Endpoints} from '../Endpoints'
import {Logger} from './Logger'

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

/** Owns only TV episode navigation; ordinary player commands pass through when closed. */
export class TvPreviewController {
    private panel: TvEpisodePanel | null = null
    private episodes: TvEpisode[] = []
    private index = 0
    private nowPlayingId: string | null = null
    private previousFocus: HTMLElement | null = null
    private state: 'closed' | 'loading' | 'ready' | 'error' | 'playing' = 'closed'
    private generation = 0
    private observer: MutationObserver
    private playerObserver: MutationObserver | null = null
    private readonly source = new TvEpisodeSource()
    private readonly heldKeys = new Set<string>()

    constructor(private options: {
        currentItemId: () => string | null,
        enabled: () => boolean,
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
        document.addEventListener('viewbeforehide', this.onViewBeforeHide)
        document.addEventListener('focusin', this.onFocus, true)
        this.observer = new MutationObserver(this.onViewChange)
        this.observer.observe(document.documentElement, {attributes: true, attributeFilter: ['class']})
        this.observer.observe(document.body, {attributes: true, attributeFilter: ['class']})
    }

    private hasOtherDialog(): boolean {
        return Array.from(document.querySelectorAll<HTMLElement>(
            '.dialogContainer .dialog.opened, dialog[open], [role="dialog"][aria-modal="true"]'
        )).some(element => !this.panel?.element.contains(element) && element !== this.panel?.element
            && !element.closest('[hidden], .hide') && element.getClientRects().length > 0)
    }

    private canOpen(): boolean {
        return isTvLayout() && isVideoRoute() && this.options.enabled()
            && typeof ApiClient !== 'undefined' && !!ApiClient.getCurrentUserId() && !this.hasOtherDialog()
    }

    private onViewChange = (): void => {
        if (!isVideoRoute() || !isTvLayout()) this.close(false)
    }

    private onViewBeforeHide = (event: Event): void => {
        const target = event.target as HTMLElement | null
        if (target?.matches?.('[data-type="video-osd"]')) this.close(false)
    }

    private onBlur = (): void => { this.heldKeys.clear() }

    private onFocus = (event: FocusEvent): void => {
        if (this.panel && !this.panel.element.contains(event.target as Node) && !this.hasOtherDialog()) this.panel.focus()
    }

    private onKeyDown = (event: KeyboardEvent): void => {
        if (event.altKey || event.ctrlKey || event.metaKey) return
        const physicalKey = event.code || event.key || String(event.keyCode)
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
        if (!isTvLayout() || !isVideoRoute() || this.hasOtherDialog()) return false
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
        document.documentElement.classList.add('ipep-tv-preview-open')
        this.panel.mount()
        const player = document.querySelector<HTMLElement>('[data-type="video-osd"]:not(.hide)')
        this.playerObserver = new MutationObserver(() => {
            const currentId = this.options.currentItemId()
            if ((player && (!player.isConnected || player.classList.contains('hide')))
                || (currentId && this.nowPlayingId && currentId !== this.nowPlayingId)
                || this.hasOtherDialog()) this.close(false)
        })
        this.playerObserver.observe(document.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['data-id', 'class']
        })
        await this.load()
    }

    private async load(): Promise<void> {
        const generation = ++this.generation
        this.state = 'loading'
        this.panel?.showLoading()
        this.panel?.focus()
        try {
            let itemId = this.options.currentItemId()
            if (!itemId) {
                itemId = await ApiClient.ajax({
                    type: 'GET', url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.NOW_PLAYING_ITEM}`), dataType: 'json'
                })
            }
            if (!this.isCurrent(generation)) return
            if (!itemId) throw new Error('Start an episode to browse this show.')
            this.nowPlayingId = itemId
            const result = await this.source.load(itemId)
            if (!this.isCurrent(generation)) return
            this.episodes = result.episodes
            this.index = result.activeIndex
            this.state = 'ready'
            this.render()
            this.panel?.focus()
        } catch (error) {
            if (!this.isCurrent(generation)) return
            this.options.logger.error("Couldn't load TV episode preview", error)
            this.state = 'error'
            this.panel?.showError(error instanceof Error ? error.message : 'Could not load episodes. Check your connection and try again.')
            this.panel?.focus()
        }
    }

    private isCurrent(generation: number): boolean {
        return generation === this.generation && !!this.panel && isVideoRoute() && isTvLayout()
    }

    private navigate(direction: -1 | 1): void {
        if (this.state !== 'ready' || !this.episodes.length) return
        const previous = this.index
        this.index = wrappedIndex(this.index, direction, this.episodes.length)
        const wrapped = this.episodes.length > 1 && (direction > 0 ? this.index < previous : this.index > previous)
        this.render(wrapped ? (direction > 0 ? 'Back to the first episode' : 'Wrapped to the last episode') : '')
        this.panel?.focus()
    }

    private render(announcement = ''): void {
        const episode = this.episodes[this.index]
        if (!episode || !this.panel) return
        const settings = this.options.settings()
        const shouldBlur = !settings.OnlyBlurUnwatched || !episode.played
        this.panel.showEpisode(episode, {
            previous: this.episodes[wrappedIndex(this.index, -1, this.episodes.length)],
            next: this.episodes[wrappedIndex(this.index, 1, this.episodes.length)],
            index: this.index, total: this.episodes.length,
            isPlaying: episode.id === (this.options.currentItemId() || this.nowPlayingId), announcement,
            blurThumbnail: settings.BlurThumbnail && shouldBlur,
            blurDescription: settings.BlurDescription && shouldBlur
        })
    }

    private async play(): Promise<void> {
        if (this.state === 'error') { await this.load(); return }
        if (this.state !== 'ready') return
        const episode = this.episodes[this.index]
        if (episode.id === (this.options.currentItemId() || this.nowPlayingId)) { this.close(); return }
        const generation = this.generation
        this.state = 'playing'
        this.panel?.setPlaying(true)
        try {
            const ticks = episode.played ? 0 : episode.playbackPositionTicks
            // Use the existing authenticated session endpoint, retaining errors for an actionable retry.
            await ApiClient.ajax({type: 'GET', url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAY_MEDIA}`
                .replace('{itemId}', episode.id).replace('{ticks}', String(ticks)))})
            if (this.isCurrent(generation)) this.close()
        } catch (error) {
            if (!this.isCurrent(generation)) return
            this.options.logger.error("Couldn't play the selected TV episode", error)
            this.state = 'ready'
            this.panel?.setPlaying(false)
            this.render('Could not start playback. Press OK to try again.')
            this.panel?.focus()
        }
    }

    close(restoreFocus = true): void {
        if (!this.panel) return
        ++this.generation
        this.state = 'closed'
        this.playerObserver?.disconnect()
        this.playerObserver = null
        this.panel?.destroy()
        this.panel = null
        this.episodes = []
        this.nowPlayingId = null
        document.documentElement.classList.remove('ipep-tv-preview-open')
        if (restoreFocus && this.previousFocus?.isConnected && this.previousFocus.getClientRects().length
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
        document.removeEventListener('viewbeforehide', this.onViewBeforeHide)
        document.removeEventListener('focusin', this.onFocus, true)
        this.heldKeys.clear()
    }
}

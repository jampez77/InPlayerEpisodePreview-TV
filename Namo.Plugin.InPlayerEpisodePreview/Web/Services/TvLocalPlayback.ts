type ItemsContainer = HTMLDivElement & {attachedCallback?: () => void}

/**
 * Uses the same local play action as Jellyfin's media cards. The playback
 * manager is bundled privately, but its registered items container owns this
 * command handler in Jellyfin Web 10.10, 10.11, and 12.0.
 *
 * A handled command only confirms dispatch; callers must observe playback to
 * determine whether the player actually started the selected item.
 */
export async function tryPlayLocally(
    media: {id: string, kind: 'episode' | 'movie' | 'channel'},
    ticks: number,
    isCurrent: () => boolean
): Promise<boolean> {
    if (!media.id || !isCurrent() || typeof ApiClient === 'undefined' || !document.body) return false

    let container: ItemsContainer | undefined
    try {
        const client = ApiClient as typeof ApiClient & {serverInfo?: () => {Id?: string}}
        const serverId = client.serverId?.() || client.serverInfo?.()?.Id
        if (!serverId) return false

        // Jellyfin uses the v0 webcomponents.js API. Its second argument is a
        // string; passing the modern {is: ...} form throws in that polyfill.
        const createElement = document.createElement as unknown as
            (tag: string, extension: string) => ItemsContainer
        container = createElement.call(document, 'div', 'emby-itemscontainer')
        container.setAttribute('is', 'emby-itemscontainer')
        container.hidden = true
        container.setAttribute('aria-hidden', 'true')
        container.setAttribute('data-contextmenu', 'false')
        container.setAttribute('data-multiselect', 'false')
        container.style.display = 'none'

        const item = document.createElement('div')
        item.className = 'itemAction'
        item.setAttribute('data-id', media.id)
        item.setAttribute('data-type', media.kind === 'channel' ? 'TvChannel' : media.kind === 'movie' ? 'Movie' : 'Episode')
        item.setAttribute('data-mediatype', 'Video')
        item.setAttribute('data-serverid', serverId)
        item.setAttribute('data-isfolder', 'false')
        item.setAttribute('data-positionticks', String(media.kind === 'channel' ? 0 : ticks))
        container.appendChild(item)
        document.body.appendChild(container)

        // The v0 polyfill runs attachedCallback from a MutationObserver. A
        // task boundary lets its shortcut handler attach before dispatch.
        await new Promise<void>(resolve => setTimeout(resolve, 0))
        if (!isCurrent() || !container.isConnected || typeof container.attachedCallback !== 'function') return false

        // Do not let an unhandled play command bubble into another player
        // handler. Jellyfin's own listener was registered before this one.
        container.addEventListener('command', event => event.stopPropagation())
        const command = new CustomEvent('command', {
            detail: {command: 'play'}, bubbles: true, cancelable: true
        })
        item.dispatchEvent(command)
        return command.defaultPrevented
    } catch {
        // Clients without this registered element can use the server fallback.
        return false
    } finally {
        // Jellyfin's detachedCallback removes shortcut and session listeners.
        container?.remove()
    }
}

import {TvEpisode} from "../Services/TvEpisodeSource";
import "../Styles/TvEpisodePanel.css";

type PanelActions = {
    previous: () => void;
    next: () => void;
    play: () => void;
    close: () => void;
};

type EpisodeContext = {
    previous: TvEpisode;
    next: TvEpisode;
    index: number;
    total: number;
    isPlaying: boolean;
    announcement?: string;
    blurThumbnail?: boolean;
    blurDescription?: boolean;
};

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function episodeNumber(episode: TvEpisode): string {
    if (episode.episodeNumber === null) return "Episode";
    const range = episode.episodeNumberEnd && episode.episodeNumberEnd !== episode.episodeNumber
        ? `–${episode.episodeNumberEnd}` : "";
    return `Episode ${episode.episodeNumber}${range}`;
}

function seasonLabel(episode: TvEpisode): string {
    const number = episode.seasonNumber === null ? "" : `Season ${episode.seasonNumber}`;
    const name = episode.seasonName.trim() || (episode.seasonNumber === 0 ? "Specials" : "");
    const numberedName = /^(?:season|series|chapter)\s+(\d+)$/i.exec(name);
    const repeatsNumber = numberedName !== null && Number(numberedName[1]) === episode.seasonNumber;
    return name && !repeatsNumber
        ? [number, name].filter(Boolean).join(" · ") : number || name || "Season";
}

/** TV presentation only. Playback, remote keys and focus trapping belong to the controller. */
export class TvEpisodePanel {
    readonly element: HTMLElement;
    private readonly series = node("div", "ipep-tv-series");
    private readonly count = node("span", "ipep-tv-count");
    private readonly season = node("div", "ipep-tv-season");
    private readonly title = node("h2", "ipep-tv-title");
    private readonly metadata = node("div", "ipep-tv-metadata");
    private readonly playing = node("span", "ipep-tv-playing", "Currently playing");
    private readonly description = node("p", "ipep-tv-description");
    private readonly descriptionFrame = node("div", "ipep-tv-description-frame");
    private readonly spoilerNotice = node("span", "ipep-tv-spoiler-notice", "Description hidden to avoid spoilers");
    private readonly image = node("img", "ipep-tv-image");
    private readonly imageFrame = node("div", "ipep-tv-image-frame");
    private readonly imageFallback = node("div", "ipep-tv-image-fallback");
    private readonly progress = node("div", "ipep-tv-progress");
    private readonly progressFill = node("div", "ipep-tv-progress-fill");
    private readonly details = node("div", "ipep-tv-details");
    private readonly content = node("div", "ipep-tv-content");
    private readonly message = node("div", "ipep-tv-message");
    private readonly messageTitle = node("h2", "ipep-tv-message-title");
    private readonly messageText = node("p", "ipep-tv-message-text");
    private readonly announcement = node("div", "ipep-tv-announcement");
    private readonly live = node("div", "ipep-tv-sr-only");
    private readonly previous: HTMLButtonElement;
    private readonly next: HTMLButtonElement;
    private readonly play: HTMLButtonElement;
    private readonly close: HTMLButtonElement;
    private readonly previousLabel = node("span", "ipep-tv-neighbor-title");
    private readonly nextLabel = node("span", "ipep-tv-neighbor-title");
    private readonly playLabel = node("span", "ipep-tv-play-label", "Play episode");
    private readonly actionsRow = node("div", "ipep-tv-actions");
    private state: "loading" | "error" | "episode" = "loading";
    private selected: TvEpisode | null = null;
    private isPlaying = false;
    private busy = false;

    constructor(private readonly actions: PanelActions) {
        this.element = node("section", "ipep-tv-panel focuscontainer");
        this.element.id = "tvEpisodePreview";
        this.element.setAttribute("role", "dialog");
        this.element.setAttribute("aria-modal", "true");
        this.element.setAttribute("aria-label", "Browse episodes");
        this.element.tabIndex = -1;

        this.previous = this.button("ipep-tv-neighbor ipep-tv-previous", "Previous episode", actions.previous);
        this.next = this.button("ipep-tv-neighbor ipep-tv-next", "Next episode", actions.next);
        this.play = this.button("ipep-tv-play", "Play episode", actions.play);
        this.close = this.button("ipep-tv-close", "Close episode browser", actions.close);

        const shell = node("div", "ipep-tv-shell");
        const header = node("header", "ipep-tv-header");
        const heading = node("div", "ipep-tv-heading");
        heading.append(node("span", "ipep-tv-eyebrow", "EPISODES"), this.series);
        this.close.append(node("span", "", "Close"));
        header.append(heading, this.count, this.close);

        this.image.alt = "Episode thumbnail";
        this.image.draggable = false;
        this.image.addEventListener("error", () => {
            this.image.hidden = true;
            this.imageFallback.hidden = false;
        });
        this.image.addEventListener("load", () => {
            this.image.hidden = false;
            this.imageFallback.hidden = true;
        });
        this.imageFallback.append(this.icon("▷"), node("span", "", "No episode image"));
        this.progress.append(this.progressFill);
        this.progress.setAttribute("role", "progressbar");
        this.progress.setAttribute("aria-label", "Episode watch progress");
        this.progress.setAttribute("aria-valuemin", "0");
        this.progress.setAttribute("aria-valuemax", "100");
        this.imageFrame.append(this.image, this.imageFallback, this.playing, this.progress);

        this.title.id = "ipep-tv-episode-title";
        this.descriptionFrame.append(this.description, this.spoilerNotice);
        this.play.append(this.icon("▶"), this.playLabel);
        this.actionsRow.append(this.play);
        this.details.append(this.season, this.title, this.metadata, this.descriptionFrame, this.actionsRow);
        this.content.append(this.imageFrame, this.details);

        this.message.append(this.messageTitle, this.messageText);
        this.previous.append(this.icon("‹"), this.neighborText("PREVIOUS", this.previousLabel));
        this.next.append(this.neighborText("NEXT", this.nextLabel), this.icon("›"));
        const footer = node("footer", "ipep-tv-footer");
        footer.append(this.previous, this.next);
        this.live.setAttribute("role", "status");
        this.live.setAttribute("aria-live", "polite");
        this.live.setAttribute("aria-atomic", "true");
        shell.append(header, this.message, this.content, this.announcement, footer, this.live);
        this.element.append(shell);
        this.showLoading();
    }

    mount(): void {
        if (!this.element.isConnected) {
            // Keep the dialog visible when the Jellyfin player uses DOM fullscreen.
            const fullscreen = document.fullscreenElement;
            const parent = fullscreen instanceof HTMLElement && fullscreen.tagName !== "VIDEO"
                ? fullscreen : document.body;
            parent.append(this.element);
        }
    }

    focus(): void {
        const preferred = this.play.hidden || this.play.disabled ? this.close : this.play;
        preferred.focus({preventScroll: true});
    }

    /** Remote activation bypasses Jellyfin's global synthetic-click suppression. */
    activateFocused(): void {
        const focused = document.activeElement;
        const candidates: Array<[HTMLButtonElement, () => void]> = [
            [this.previous, this.actions.previous],
            [this.next, this.actions.next],
            [this.close, this.actions.close]
        ];
        for (const [button, action] of candidates) {
            if (focused === button) {
                if (!button.disabled && !button.hidden) action();
                return;
            }
        }
        if (!this.play.disabled && !this.play.hidden) this.actions.play();
    }

    showLoading(): void {
        this.state = "loading";
        this.selected = null;
        this.element.setAttribute("aria-busy", "true");
        this.element.dataset.state = "loading";
        this.series.textContent = "Browse this show";
        this.count.textContent = "";
        this.content.hidden = true;
        this.message.hidden = false;
        this.messageTitle.textContent = "Loading episodes…";
        this.messageText.textContent = "Getting every season ready to browse.";
        this.previous.hidden = true;
        this.next.hidden = true;
        this.play.hidden = true;
        this.actionsRow.hidden = true;
        this.announcement.textContent = "";
        this.live.textContent = "Loading episodes";
    }

    showError(message: string): void {
        this.state = "error";
        this.busy = false;
        this.element.setAttribute("aria-busy", "false");
        this.element.dataset.state = "error";
        this.content.hidden = true;
        this.message.hidden = false;
        this.messageTitle.textContent = "Couldn’t load episodes";
        this.messageText.textContent = message || "Please try again.";
        this.previous.hidden = true;
        this.next.hidden = true;
        this.play.hidden = false;
        this.actionsRow.hidden = false;
        this.play.disabled = false;
        this.playLabel.textContent = "Try again";
        this.play.setAttribute("aria-label", "Try loading episodes again");
        this.message.append(this.actionsRow);
        this.announcement.textContent = "";
        this.live.textContent = `${this.messageTitle.textContent}. ${this.messageText.textContent}`;
    }

    showEpisode(episode: TvEpisode, context: EpisodeContext): void {
        this.state = "episode";
        this.selected = episode;
        this.busy = false;
        this.isPlaying = context.isPlaying;
        this.element.dataset.state = "episode";
        this.element.setAttribute("aria-busy", "false");
        this.content.hidden = false;
        this.message.hidden = true;
        this.details.append(this.actionsRow);
        this.actionsRow.hidden = false;
        this.series.textContent = episode.seriesName || "Browse this show";
        this.count.textContent = `${context.index + 1} / ${context.total} episodes`;
        this.season.textContent = `${seasonLabel(episode)} · ${episodeNumber(episode)}`;
        this.title.textContent = episode.name || "Untitled episode";
        this.description.textContent = episode.description || "No description available for this episode.";
        const hideDescription = Boolean(context.blurDescription);
        this.descriptionFrame.classList.toggle("ipep-tv-description-hidden", hideDescription);
        this.description.setAttribute("aria-hidden", String(hideDescription));
        this.spoilerNotice.hidden = !hideDescription;
        this.imageFrame.classList.toggle("ipep-tv-thumbnail-hidden", Boolean(context.blurThumbnail));
        this.image.hidden = true;
        this.imageFallback.hidden = false;
        if (episode.imageUrl) {
            this.image.src = episode.imageUrl;
            if (this.image.complete && this.image.naturalWidth > 0) {
                this.image.hidden = false;
                this.imageFallback.hidden = true;
            }
        } else {
            this.image.removeAttribute("src");
        }
        this.playing.hidden = !context.isPlaying;
        const minutes = Math.round(episode.runtimeTicks / 600000000);
        this.metadata.textContent = [
            minutes > 0 ? `${minutes} min` : "",
            episode.played ? "Watched" : episode.playbackPositionTicks > 0 ? "In progress" : "Unwatched"
        ].filter(Boolean).join(" · ");
        const percent = episode.runtimeTicks > 0
            ? Math.min(100, Math.max(0, 100 * episode.playbackPositionTicks / episode.runtimeTicks)) : 0;
        this.progress.hidden = percent <= 0;
        this.progressFill.style.width = `${percent}%`;
        this.progress.setAttribute("aria-valuenow", String(Math.round(percent)));
        this.previous.hidden = context.total <= 1;
        this.next.hidden = context.total <= 1;
        this.previousLabel.textContent = this.neighborLabel(context.previous);
        this.nextLabel.textContent = this.neighborLabel(context.next);
        this.previous.setAttribute("aria-label", `Previous: ${seasonLabel(context.previous)}, ${episodeNumber(context.previous)}, ${context.previous.name}${context.index === 0 ? ". Wraps to the end of the show" : ""}`);
        this.next.setAttribute("aria-label", `Next: ${seasonLabel(context.next)}, ${episodeNumber(context.next)}, ${context.next.name}${context.index === context.total - 1 ? ". Wraps to the start of the show" : ""}`);
        const wrapHint = context.total <= 1 ? "The only episode in this show"
            : context.index === 0 ? "First episode"
                : context.index === context.total - 1 ? "Last episode" : "";
        this.announcement.textContent = context.announcement || wrapHint;
        this.live.textContent = [context.announcement, `${seasonLabel(episode)}, ${episodeNumber(episode)}: ${episode.name}.`, `${context.index + 1} of ${context.total} episodes.`, context.isPlaying ? "Currently playing." : ""].filter(Boolean).join(" ");
        this.play.hidden = false;
        this.updatePlayButton();
    }

    /** Indicate a playback request in flight; the current item marker comes from showEpisode. */
    setPlaying(playing: boolean): void {
        this.busy = playing;
        this.element.setAttribute("aria-busy", String(playing));
        this.updatePlayButton();
    }

    destroy(): void {
        this.element.remove();
        this.image.removeAttribute("src");
        this.selected = null;
    }

    private updatePlayButton(): void {
        this.play.disabled = this.busy;
        this.previous.disabled = this.busy;
        this.next.disabled = this.busy;
        const label = this.busy ? "Starting episode…" : this.state === "error" ? "Try again"
            : this.isPlaying ? "Return to episode" : this.selected?.playbackPositionTicks > 0 ? "Resume episode" : "Play episode";
        this.playLabel.textContent = label;
        this.play.setAttribute("aria-label", label);
    }

    private neighborLabel(episode: TvEpisode): string {
        const season = episode.seasonNumber === null ? episode.seasonName : `S${episode.seasonNumber}`;
        const number = episode.episodeNumber === null ? "" : `E${episode.episodeNumber}`;
        return `${[season, number].filter(Boolean).join(" · ")} — ${episode.name}`;
    }

    private neighborText(label: string, title: HTMLElement): HTMLElement {
        const text = node("span", "ipep-tv-neighbor-text");
        text.append(node("span", "ipep-tv-neighbor-caption", label), title);
        return text;
    }

    private button(className: string, label: string, action: () => void): HTMLButtonElement {
        const button = node("button", className);
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.addEventListener("click", action);
        return button;
    }

    private icon(text: string): HTMLElement {
        const icon = node("span", "ipep-tv-icon", text);
        icon.setAttribute("aria-hidden", "true");
        return icon;
    }

}

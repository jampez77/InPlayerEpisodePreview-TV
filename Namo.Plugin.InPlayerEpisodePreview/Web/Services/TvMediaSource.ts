import type {BaseItemDto} from '@jellyfin/sdk/lib/generated-client';
import {TvEpisodeSource, type TvEpisode} from './TvEpisodeSource';
import {Endpoints} from '../Endpoints';

export type TvMediaKind = 'episode' | 'movie' | 'channel';
export type TvMediaItem = TvEpisode & {
    kind: TvMediaKind
    productionYear?: number
    genres?: string[]
    officialRating?: string
    channelNumber?: string
    programName?: string
    programStart?: string
    programEnd?: string
};
export type TvMediaList = {
    items: TvMediaItem[]
    activeIndex: number
    kind: TvMediaKind
    playingItemId: string
    upcomingItemId?: string
};

/** Disabled media types should quietly return control to Jellyfin instead of showing a loading error. */
export class TvMediaDisabledError extends Error {
    constructor() {
        super('Browsing is disabled for this media type.');
        this.name = 'TvMediaDisabledError';
    }
}

/** Unsupported playback, including intros with no identifiable queued feature, has no preview. */
export class TvMediaUnavailableError extends Error {
    constructor() {
        super('No supported feature is available to preview.');
        this.name = 'TvMediaUnavailableError';
    }
}

type MediaDto = BaseItemDto & {IsMissing?: boolean; IsVirtualItem?: boolean};
type AvailableDto = MediaDto & {Id: string};
type PlaybackContext = {
    PlayingItemId?: string
    PlayingItemType?: BaseItemDto['Type']
    PlayingItemExtraType?: BaseItemDto['ExtraType']
    PlaylistItemId?: string
    Queue?: {Id?: string; PlaylistItemId?: string}[]
};
const SIMILAR_LIMIT = 30;
const CHANNEL_PAGE_SIZE = 200;
const MAX_CHANNEL_PAGES = 100;
const MAX_INTRO_ITEMS = 32;

export function sameMediaId(left?: string | null, right?: string | null): boolean {
    if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
    const normalize = (id: string): string => /^[\da-f]{32}$|^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)
        ? id.replace(/-/g, '').toLowerCase() : id;
    return normalize(left) === normalize(right);
}

function isIntro(item: MediaDto): boolean {
    return item.Type === 'Trailer' || item.Type === 'Video' || item.ExtraType === 'Trailer';
}

function mediaKind(item: MediaDto): TvMediaKind | null {
    if (isIntro(item)) return null;
    return item.Type === 'Episode' ? 'episode' : item.Type === 'Movie' ? 'movie'
        : item.Type === 'TvChannel' || item.Type === 'Program' ? 'channel' : null;
}

function available(item: MediaDto, type: 'Movie' | 'TvChannel'): item is AvailableDto {
    if (!item?.Id || item.Type !== type || item.IsFolder || item.PlayAccess === 'None') return false;
    // Live streams do not need a local library file; the channel endpoint applies user access.
    return type === 'TvChannel' || (item.LocationType !== 'Virtual'
        && !item.IsMissing && !item.IsVirtualItem && !item.IsPlaceHolder);
}

function requestError(action: string, error: unknown): Error {
    const status = (error as {status?: number; statusCode?: number})?.status
        ?? (error as {statusCode?: number})?.statusCode;
    if (status === 401 || status === 403) {
        return new Error(`Unable to ${action}. Sign in to Jellyfin again and check access to this media.`);
    }
    if (status === 404) {
        return new Error(`Unable to ${action}. This item may have moved or been removed; refresh Jellyfin and try again.`);
    }
    return new Error(`Unable to ${action}. Check your connection to Jellyfin and try opening the browser again.`);
}

function imageUrl(item?: BaseItemDto): string | null {
    if (!item?.Id) return null;
    // Landscape artwork suits the TV card; retain a poster/channel logo when that is all the server has.
    const type = item.ImageTags?.Thumb ? 'Thumb' : item.BackdropImageTags?.length ? 'Backdrop'
        : item.ImageTags?.Primary ? 'Primary' : null;
    if (!type) return null;
    return ApiClient.getImageUrl(item.Id, {
        type,
        tag: type === 'Backdrop' ? item.BackdropImageTags[0] : item.ImageTags[type],
        maxWidth: 960,
        quality: 90
    });
}

function movieItem(item: AvailableDto, anchorName: string): TvMediaItem {
    return {
        kind: 'movie', id: item.Id, name: item.Name || 'Untitled film',
        seriesName: anchorName, seasonName: '', seasonNumber: null, episodeNumber: null,
        description: item.Overview || '', imageUrl: imageUrl(item),
        runtimeTicks: Math.max(0, item.RunTimeTicks || 0),
        playbackPositionTicks: Math.max(0, item.UserData?.PlaybackPositionTicks || 0),
        played: item.UserData?.Played === true,
        productionYear: item.ProductionYear ?? undefined,
        genres: item.Genres || [], officialRating: item.OfficialRating || undefined
    };
}

function channelNumber(item: BaseItemDto): string {
    return item.ChannelNumber?.trim() || item.Number?.trim() || '';
}

function channelItem(item: AvailableDto): TvMediaItem {
    const program = item.CurrentProgram;
    return {
        kind: 'channel', id: item.Id, name: item.Name || 'Unnamed channel',
        seriesName: 'Live TV', seasonName: '', seasonNumber: null, episodeNumber: null,
        description: program?.Overview || item.Overview || '',
        imageUrl: imageUrl(program) || imageUrl(item),
        runtimeTicks: Math.max(0, program?.RunTimeTicks || 0),
        playbackPositionTicks: 0, played: false,
        channelNumber: channelNumber(item) || undefined,
        programName: program?.Name || undefined,
        programStart: program?.StartDate || undefined,
        programEnd: program?.EndDate || undefined,
        genres: program?.Genres || item.Genres || [],
        officialRating: program?.OfficialRating || undefined
    };
}

function compareChannels(a: AvailableDto, b: AvailableDto): number {
    const aNumber = channelNumber(a);
    const bNumber = channelNumber(b);
    if (Boolean(aNumber) !== Boolean(bNumber)) return aNumber ? -1 : 1;
    return aNumber.localeCompare(bNumber, undefined, {numeric: true})
        || (a.Name || '').localeCompare(b.Name || '', undefined, {numeric: true})
        || a.Id.localeCompare(b.Id);
}

/** Use the signed-in Jellyfin client for episodes, similar library films, and live channels. */
export class TvMediaSource {
    private readonly episodes = new TvEpisodeSource();

    async load(itemId: string, enabled: (kind: TvMediaKind) => boolean = () => true): Promise<TvMediaList> {
        if (!itemId) throw new Error('No playing item was found. Start an episode, film, or live TV channel and try again.');
        if (typeof ApiClient === 'undefined' || !ApiClient.getCurrentUserId()) {
            throw new Error('Sign in to Jellyfin before opening the media browser.');
        }
        const userId = ApiClient.getCurrentUserId();
        let current: MediaDto;
        try {
            current = await ApiClient.getItem(userId, itemId);
        } catch (error) {
            const status = (error as {status?: number; statusCode?: number})?.status
                ?? (error as {statusCode?: number})?.statusCode;
            if (status !== 404) throw requestError('load the playing item', error);
            // Some intro providers create playback-only items which getItem cannot return.
            // A confirmed ordinary feature still deserves the normal missing-item error.
            const context = await this.playbackContext(itemId);
            const reported: MediaDto = {Id: context.PlayingItemId, Type: context.PlayingItemType,
                ExtraType: context.PlayingItemExtraType};
            if (mediaKind(reported)) throw requestError('load the playing item', error);
            if (!isIntro(reported)) throw new TvMediaUnavailableError();
            return this.loadUpcoming(itemId, userId, enabled, context);
        }
        if (!current?.Id) throw new Error('Jellyfin did not return the playing item. Refresh Jellyfin and try again.');
        if (isIntro(current)) {
            if (!sameMediaId(current.Id, itemId)) throw new TvMediaUnavailableError();
            return this.loadUpcoming(itemId, userId, enabled);
        }
        return this.loadFeature(current, userId, enabled);
    }

    private async loadFeature(current: MediaDto, userId: string,
        enabled: (kind: TvMediaKind) => boolean): Promise<TvMediaList> {
        const kind = mediaKind(current);
        if (!kind) throw new TvMediaUnavailableError();
        if (!enabled(kind)) throw new TvMediaDisabledError();
        if (current.Type === 'Episode') {
            const result = await this.episodes.load(current.Id, current);
            return {
                items: result.episodes.map(episode => ({...episode, kind: 'episode'})),
                activeIndex: result.activeIndex, kind: 'episode', playingItemId: current.Id
            };
        }
        if (current.Type === 'Movie') return this.loadMovies(current, userId);
        if (current.Type === 'Program') {
            if (!current.ChannelId) {
                throw new Error('This programme has no live channel. Start a live TV channel and try again.');
            }
            try {
                current = await ApiClient.getItem(userId, current.ChannelId);
            } catch (error) {
                throw requestError('load the playing live TV channel', error);
            }
            if (current?.Type !== 'TvChannel') {
                throw new Error('The programme’s live TV channel is unavailable. Refresh your channels and try again.');
            }
        }
        if (current.Type === 'TvChannel') return this.loadChannels(current, userId);
        throw new TvMediaUnavailableError();
    }

    private async playbackContext(itemId: string): Promise<PlaybackContext> {
        let context: PlaybackContext;
        try {
            context = await ApiClient.ajax({type: 'GET', dataType: 'json',
                url: ApiClient.getUrl(`/${Endpoints.BASE}${Endpoints.PLAYBACK_CONTEXT}`)});
        } catch {
            throw new TvMediaUnavailableError();
        }
        // A late session report must never substitute a feature from an earlier playback.
        if (!context || !sameMediaId(context.PlayingItemId, itemId)) throw new TvMediaUnavailableError();
        return context;
    }

    private async loadUpcoming(itemId: string, userId: string, enabled: (kind: TvMediaKind) => boolean,
        suppliedContext?: PlaybackContext): Promise<TvMediaList> {
        const context = suppliedContext ?? await this.playbackContext(itemId);
        const queue = context.Queue;
        if (!Array.isArray(queue)) throw new TvMediaUnavailableError();
        const matches = queue.map((item, index) => ({item, index})).filter(({item}) =>
            sameMediaId(item?.Id, itemId) && (!context.PlaylistItemId || item.PlaylistItemId === context.PlaylistItemId));
        if (matches.length !== 1) throw new TvMediaUnavailableError();
        const currentIndex = matches[0].index;
        for (let index = currentIndex + 1; index < Math.min(queue.length, currentIndex + 1 + MAX_INTRO_ITEMS); index++) {
            const queued = queue[index];
            if (!queued?.Id) throw new TvMediaUnavailableError();
            let candidate: MediaDto;
            try {
                candidate = await ApiClient.getItem(userId, queued.Id);
            } catch {
                // An unknown queue entry could itself be the intended feature. Do not skip it.
                throw new TvMediaUnavailableError();
            }
            if (!candidate?.Id || !sameMediaId(candidate.Id, queued.Id)) throw new TvMediaUnavailableError();
            if (isIntro(candidate)) continue;
            if (candidate.Type !== 'Movie' && candidate.Type !== 'Episode') throw new TvMediaUnavailableError();
            try {
                const result = await this.loadFeature(candidate, userId, enabled);
                return {...result, playingItemId: itemId, upcomingItemId: candidate.Id};
            } catch (error) {
                // Intros should stay unobstructed when the upcoming details cannot be loaded.
                if (error instanceof TvMediaDisabledError) throw error;
                throw new TvMediaUnavailableError();
            }
        }
        throw new TvMediaUnavailableError();
    }

    private async loadMovies(current: MediaDto, userId: string): Promise<TvMediaList> {
        if (!available(current, 'Movie')) {
            throw new Error('This film is unavailable in your library. Refresh the library and play an available film.');
        }
        let result;
        try {
            // Similar items are ranked by Jellyfin; this endpoint accepts a limit, but not pagination.
            result = await ApiClient.getSimilarItems(current.Id, {
                UserId: userId, Limit: SIMILAR_LIMIT, Fields: 'Overview,Genres'
            });
        } catch (error) {
            throw requestError('load similar films', error);
        }
        if (!Array.isArray(result?.Items)) {
            throw new Error('Jellyfin returned an invalid similar-film list. Refresh your library and try again.');
        }
        const anchorName = current.Name || 'Untitled film';
        const items = [movieItem(current, anchorName)];
        const seen = new Set([current.Id]);
        for (const item of result.Items) {
            if (available(item, 'Movie') && !seen.has(item.Id)) {
                seen.add(item.Id);
                items.push(movieItem(item, anchorName));
                if (items.length > SIMILAR_LIMIT) break;
            }
        }
        return {items, activeIndex: 0, kind: 'movie', playingItemId: current.Id};
    }

    private async loadChannels(current: MediaDto, userId: string): Promise<TvMediaList> {
        if (!available(current, 'TvChannel')) {
            throw new Error('This live TV channel is unavailable. Refresh your channels and try again.');
        }
        const channels = await this.channelPages(userId);
        const unique = new Map<string, AvailableDto>();
        for (const channel of channels) {
            if (available(channel, 'TvChannel') && !unique.has(channel.Id)) unique.set(channel.Id, channel);
        }
        // getItem confirmed the playing channel. Keep it when a changing list or tuner omits it.
        if (!unique.has(current.Id)) unique.set(current.Id, current);
        const items = Array.from(unique.values()).sort(compareChannels).map(channelItem);
        return {
            items, activeIndex: items.findIndex(channel => channel.id === current.Id),
            kind: 'channel', playingItemId: current.Id
        };
    }

    private async channelPages(userId: string): Promise<MediaDto[]> {
        const channels: MediaDto[] = [];
        const seen = new Set<string>();
        let startIndex = 0;
        for (let page = 0; page < MAX_CHANNEL_PAGES; page++) {
            let result;
            try {
                result = await ApiClient.getLiveTvChannels({
                    UserId: userId, AddCurrentProgram: true, Fields: 'Overview,Genres',
                    EnableImages: true, EnableImageTypes: 'Primary,Thumb,Backdrop', EnableUserData: true,
                    SortBy: 'ChannelNumber,SortName', SortOrder: 'Ascending', EnableFavoriteSorting: false,
                    StartIndex: startIndex, Limit: CHANNEL_PAGE_SIZE
                });
            } catch (error) {
                throw requestError('load live TV channels', error);
            }
            if (!Array.isArray(result?.Items)) {
                throw new Error('Jellyfin returned an invalid channel list. Refresh your channels and try again.');
            }
            const batch: MediaDto[] = result.Items;
            const total = Number.isInteger(result.TotalRecordCount) && result.TotalRecordCount >= 0
                ? result.TotalRecordCount : null;
            if (batch.length === 0) {
                if (total !== null && startIndex < total) {
                    throw new Error('Jellyfin returned an incomplete channel list. Refresh your channels and try again.');
                }
                return channels;
            }
            const previousSize = seen.size;
            for (const channel of batch) if (channel.Id) seen.add(channel.Id);
            if (seen.size === previousSize) {
                throw new Error('Jellyfin repeated a channel page. Refresh your channels and try again.');
            }
            channels.push(...batch);
            startIndex += batch.length;
            if (total !== null ? startIndex >= total : batch.length < CHANNEL_PAGE_SIZE) return channels;
        }
        throw new Error('The channel list exceeded the browsing limit. Check for duplicate channels and try again.');
    }
}
